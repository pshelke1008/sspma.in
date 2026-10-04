/**
 * Sending to donors — one at a time from a profile, or as a paced broadcast.
 *
 * Every message is a row before it is a network call, so the donor timeline,
 * the broadcast progress bar and the audit trail all read the same record, and
 * a broadcast interrupted by a restart resumes from the rows still QUEUED.
 */
import type { Request } from 'express';
import type { Prisma, WhatsAppMessageStatus, WhatsAppProvider } from '@prisma/client';
import { prisma } from '../../db';
import { notFound } from '../../lib/errors';
import { AUDIT_ACTIONS, recordAudit } from '../../lib/audit';
import type { AuthContext } from '../../middleware/auth';
import { messagingNumber, statsFor } from '../donors/donor.service';
import * as cloud from './cloudApi';
import * as manager from './connectionManager';
import { cloudCredentials, getOrCreateChannel, reserveWebSend, resolveSender } from './channel.service';
import { WhatsAppError, WhatsAppErrorCode, sanitizeError, type WhatsAppErrorCodeValue } from './errors';
import { normalizePhone } from './phone';
import { findByPhoneNumberId } from './numbers.service';
import { fetchInboundMedia } from './media.service';
import { findDonorByPhone } from './link';

export interface MessageContent {
  body?: string | null;
  templateName?: string | null;
  templateLanguage?: string | null;
  templateParams?: string[];
}

type DonorForMessaging = {
  id: string;
  name: string;
  isActive: boolean;
  whatsappOptIn: boolean;
  phone: string | null;
  whatsappNumber: string | null;
  preferredLanguage: string;
};

// ----------------------------- Personalisation --------------------------------

interface RenderContext {
  name: string;
  total_donated: string;
  last_donation_date: string;
  organization: string;
}

export async function contextsFor(organizationId: string, donors: DonorForMessaging[]): Promise<Map<string, RenderContext>> {
  const [stats, organization] = await Promise.all([
    statsFor(organizationId, donors.map((donor) => donor.id)),
    prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { name: true } }),
  ]);

  return new Map(
    donors.map((donor) => {
      const donorStats = stats.get(donor.id);
      // Dates follow the donor's own language; digits stay Latin for clarity.
      const locale = donor.preferredLanguage === 'mr' ? 'mr-IN-u-nu-latn' : 'en-IN';
      return [
        donor.id,
        {
          name: donor.name,
          total_donated: `₹${new Intl.NumberFormat('en-IN').format(donorStats?.totalDonated ?? 0)}`,
          last_donation_date: donorStats?.lastDonationAt
            ? new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric' }).format(
                donorStats.lastDonationAt,
              )
            : '—',
          organization: organization.name,
        },
      ];
    }),
  );
}

export function render(text: string, context: RenderContext): string {
  return text.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (match, key: string) =>
    key in context ? context[key as keyof RenderContext] : match,
  );
}

type Eligibility = 'OK' | 'INACTIVE' | 'NO_NUMBER' | 'NOT_OPTED_IN';

export function eligibilityOf(donor: DonorForMessaging): Eligibility {
  if (!donor.isActive) return 'INACTIVE';
  if (!messagingNumber(donor)) return 'NO_NUMBER';
  if (!donor.whatsappOptIn) return 'NOT_OPTED_IN';
  return 'OK';
}

export const ELIGIBILITY_ERROR: Record<Exclude<Eligibility, 'OK'>, WhatsAppErrorCodeValue> = {
  INACTIVE: WhatsAppErrorCode.DONOR_INACTIVE,
  NO_NUMBER: WhatsAppErrorCode.INVALID_NUMBER,
  NOT_OPTED_IN: WhatsAppErrorCode.NOT_OPTED_IN,
};

export function assertContentFits(provider: WhatsAppProvider, content: MessageContent) {
  if (content.templateName && provider !== 'CLOUD_API') {
    throw new WhatsAppError(WhatsAppErrorCode.TEMPLATE_NEEDS_CLOUD);
  }
  if (!content.templateName && !content.body?.trim()) {
    throw new WhatsAppError(WhatsAppErrorCode.EMPTY_MESSAGE);
  }
}

// ----------------------------- Delivery ---------------------------------------

/**
 * Sends through the given provider. For the Cloud API, `numberId` picks which
 * connected business number sends; without it the organization's default does.
 */
export async function deliver(
  organizationId: string,
  provider: WhatsAppProvider,
  phone: string,
  content: { body: string | null; templateName: string | null; templateLanguage: string | null; templateParams: string[] },
  numberId?: string | null,
): Promise<{ providerMessageId: string; numberId: string | null }> {
  if (provider === 'WEB_QR') {
    if (!manager.isLive(organizationId)) throw new WhatsAppError(WhatsAppErrorCode.NOT_CONNECTED);
    try {
      if (!(await manager.isOnWhatsApp(organizationId, phone))) {
        throw new WhatsAppError(WhatsAppErrorCode.NOT_ON_WHATSAPP);
      }
      await reserveWebSend(organizationId);
      return { providerMessageId: await manager.sendText(organizationId, phone, content.body ?? ''), numberId: null };
    } catch (error) {
      if (error instanceof WhatsAppError) throw error;
      if (error instanceof Error && error.message === 'NOT_CONNECTED') {
        throw new WhatsAppError(WhatsAppErrorCode.NOT_CONNECTED);
      }
      console.warn('[whatsapp] linked-device send failed', sanitizeError(error));
      throw new WhatsAppError(WhatsAppErrorCode.SEND_FAILED);
    }
  }

  const credentials = await cloudCredentials(organizationId, numberId);
  const providerMessageId = content.templateName
    ? await cloud.sendTemplate(credentials.phoneNumberId, credentials.token, phone, {
        name: content.templateName,
        language: content.templateLanguage ?? 'en',
        bodyParams: content.templateParams,
      })
    : await cloud.sendText(credentials.phoneNumberId, credentials.token, phone, content.body ?? '');
  return { providerMessageId, numberId: credentials.numberId };
}

/** Readable record of a template send for the donor timeline. */
export function templateSummary(name: string, params: string[]): string {
  return params.length ? `[${name}] ${params.join(' · ')}` : `[${name}]`;
}

export async function sendToDonor(auth: AuthContext, donorId: string, content: MessageContent, req: Request) {
  const donor = await prisma.donor.findFirst({ where: { id: donorId, organizationId: auth.organizationId } });
  if (!donor) throw notFound('Donor not found');

  const eligibility = eligibilityOf(donor);
  if (eligibility !== 'OK') throw new WhatsAppError(ELIGIBILITY_ERROR[eligibility]);

  const provider = await resolveSender(auth.organizationId);
  assertContentFits(provider, content);

  const phone = messagingNumber(donor)!;
  const context = (await contextsFor(auth.organizationId, [donor])).get(donor.id)!;
  const body = content.body ? render(content.body, context) : null;
  const templateParams = (content.templateParams ?? []).map((param) => render(param, context));

  const message = await prisma.whatsAppMessage.create({
    data: {
      organizationId: auth.organizationId,
      donorId: donor.id,
      direction: 'OUTBOUND',
      provider,
      phone,
      body: content.templateName ? templateSummary(content.templateName, templateParams) : body,
      templateName: content.templateName ?? null,
      status: 'QUEUED',
      sentById: auth.userId,
    },
  });

  try {
    const delivered = await deliver(auth.organizationId, provider, phone, {
      body,
      templateName: content.templateName ?? null,
      templateLanguage: content.templateLanguage ?? null,
      templateParams,
    });
    const sent = await prisma.whatsAppMessage.update({
      where: { id: message.id },
      data: {
        status: 'SENT',
        providerMessageId: delivered.providerMessageId || null,
        whatsappNumberId: delivered.numberId,
        sentAt: new Date(),
      },
      include: { sentBy: { select: { id: true, name: true } } },
    });

    await recordAudit({
      organizationId: auth.organizationId,
      userId: auth.userId,
      action: AUDIT_ACTIONS.WHATSAPP_MESSAGE_SENT,
      entityType: 'Donor',
      entityId: donor.id,
      entityLabel: `${donor.code} ${donor.name}`,
      newValue: { provider, template: content.templateName ?? null },
      req,
    });
    return sent;
  } catch (error) {
    await prisma.whatsAppMessage.update({
      where: { id: message.id },
      data: { status: 'FAILED', error: sanitizeError(error) },
    });
    throw error;
  }
}

// ----------------------------- Broadcasts -------------------------------------

export async function previewBroadcast(organizationId: string, donorIds: string[], content: MessageContent) {
  const [provider, donors, channel] = await Promise.all([
    resolveSender(organizationId).catch(() => null),
    prisma.donor.findMany({ where: { organizationId, id: { in: donorIds } } }),
    getOrCreateChannel(organizationId),
  ]);

  const skipped: Record<Exclude<Eligibility, 'OK'>, number> = { INACTIVE: 0, NO_NUMBER: 0, NOT_OPTED_IN: 0 };
  const eligible = donors.filter((donor) => {
    const result = eligibilityOf(donor);
    if (result !== 'OK') skipped[result] += 1;
    return result === 'OK';
  });

  const sampleDonor = eligible[0] ?? donors[0];
  let sample: { donorName: string; body: string | null; templateParams: string[] } | null = null;
  if (sampleDonor) {
    const context = (await contextsFor(organizationId, [sampleDonor])).get(sampleDonor.id)!;
    sample = {
      donorName: sampleDonor.name,
      body: content.body ? render(content.body, context) : null,
      templateParams: (content.templateParams ?? []).map((param) => render(param, context)),
    };
  }

  const month = new Date().toISOString().slice(0, 7);
  const usedThisMonth = channel.countedMonth === month ? channel.messagesSent : 0;

  return {
    provider,
    selected: donorIds.length,
    found: donors.length,
    eligible: eligible.length,
    skipped,
    quota:
      provider === 'WEB_QR'
        ? { limit: channel.monthlyLimit, remaining: Math.max(0, channel.monthlyLimit - usedThisMonth) }
        : null,
    sample,
  };
}

export async function createBroadcast(
  auth: AuthContext,
  input: MessageContent & { name: string; donorIds: string[] },
  req: Request,
) {
  const provider = await resolveSender(auth.organizationId);
  assertContentFits(provider, input);

  const donors = await prisma.donor.findMany({
    where: { organizationId: auth.organizationId, id: { in: input.donorIds } },
  });
  if (donors.length === 0) throw new WhatsAppError(WhatsAppErrorCode.NO_RECIPIENTS);

  const rows: Prisma.WhatsAppMessageCreateManyInput[] = donors.map((donor) => {
    const eligibility = eligibilityOf(donor);
    return {
      organizationId: auth.organizationId,
      donorId: donor.id,
      direction: 'OUTBOUND',
      provider,
      phone: messagingNumber(donor) ?? '',
      status: eligibility === 'OK' ? 'QUEUED' : 'SKIPPED',
      error: eligibility === 'OK' ? null : ELIGIBILITY_ERROR[eligibility],
      templateName: input.templateName ?? null,
      sentById: auth.userId,
    };
  });
  const skippedCount = rows.filter((row) => row.status === 'SKIPPED').length;

  const broadcast = await prisma.$transaction(async (tx) => {
    const created = await tx.whatsAppBroadcast.create({
      data: {
        organizationId: auth.organizationId,
        name: input.name,
        provider,
        body: input.body ?? null,
        templateName: input.templateName ?? null,
        templateLanguage: input.templateLanguage ?? null,
        templateParams: input.templateParams ?? [],
        totalRecipients: rows.length,
        skippedCount,
        status: rows.length === skippedCount ? 'COMPLETED' : 'QUEUED',
        completedAt: rows.length === skippedCount ? new Date() : null,
        createdById: auth.userId,
      },
    });
    await tx.whatsAppMessage.createMany({ data: rows.map((row) => ({ ...row, broadcastId: created.id })) });
    return created;
  });

  await recordAudit({
    organizationId: auth.organizationId,
    userId: auth.userId,
    action: AUDIT_ACTIONS.WHATSAPP_BROADCAST_CREATED,
    entityType: 'WhatsAppBroadcast',
    entityId: broadcast.id,
    entityLabel: broadcast.name,
    newValue: { provider, recipients: rows.length, skipped: skippedCount },
    req,
  });

  if (broadcast.status === 'QUEUED') void runBroadcast(broadcast.id);
  return broadcast;
}

const running = new Set<string>();
/** Errors that affect every remaining recipient, not just this one. */
const HALTING = new Set<string>([
  WhatsAppErrorCode.NOT_CONNECTED,
  WhatsAppErrorCode.NOT_CONFIGURED,
  WhatsAppErrorCode.MONTHLY_LIMIT,
  WhatsAppErrorCode.CLOUD_AUTH_FAILED,
  WhatsAppErrorCode.TEMPLATE_NOT_FOUND,
]);

async function recount(broadcastId: string) {
  const groups = await prisma.whatsAppMessage.groupBy({
    by: ['status'],
    where: { broadcastId },
    _count: { _all: true },
  });
  const count = (statuses: WhatsAppMessageStatus[]) =>
    groups.filter((group) => statuses.includes(group.status)).reduce((sum, group) => sum + group._count._all, 0);
  await prisma.whatsAppBroadcast.update({
    where: { id: broadcastId },
    data: {
      sentCount: count(['SENT', 'DELIVERED', 'READ']),
      failedCount: count(['FAILED']),
      skippedCount: count(['SKIPPED']),
    },
  });
}

export async function runBroadcast(broadcastId: string): Promise<void> {
  if (running.has(broadcastId)) return;
  running.add(broadcastId);

  try {
    const broadcast = await prisma.whatsAppBroadcast.findUnique({ where: { id: broadcastId } });
    if (!broadcast || broadcast.status === 'CANCELLED' || broadcast.status === 'COMPLETED') return;

    await prisma.whatsAppBroadcast.update({
      where: { id: broadcastId },
      data: { status: 'RUNNING', startedAt: broadcast.startedAt ?? new Date() },
    });

    for (;;) {
      const current = await prisma.whatsAppBroadcast.findUnique({ where: { id: broadcastId }, select: { status: true } });
      if (!current || current.status === 'CANCELLED') break;

      const message = await prisma.whatsAppMessage.findFirst({
        where: { broadcastId, status: 'QUEUED' },
        orderBy: { createdAt: 'asc' },
        include: { donor: true },
      });
      if (!message) break;

      try {
        if (!message.donor) throw new WhatsAppError(WhatsAppErrorCode.INVALID_NUMBER);
        const context = (await contextsFor(broadcast.organizationId, [message.donor])).get(message.donor.id)!;
        const body = broadcast.body ? render(broadcast.body, context) : null;
        const templateParams = broadcast.templateParams.map((param) => render(param, context));

        const delivered = await deliver(broadcast.organizationId, broadcast.provider, message.phone, {
          body,
          templateName: broadcast.templateName,
          templateLanguage: broadcast.templateLanguage,
          templateParams,
        });

        await prisma.whatsAppMessage.update({
          where: { id: message.id },
          data: {
            status: 'SENT',
            providerMessageId: delivered.providerMessageId || null,
            whatsappNumberId: delivered.numberId,
            sentAt: new Date(),
            body: broadcast.templateName ? templateSummary(broadcast.templateName, templateParams) : body,
          },
        });
      } catch (error) {
        const code = sanitizeError(error);
        await prisma.whatsAppMessage.update({ where: { id: message.id }, data: { status: 'FAILED', error: code } });

        if (HALTING.has(code)) {
          // No point trying the rest: record why, once, on every remaining row.
          await prisma.whatsAppMessage.updateMany({
            where: { broadcastId, status: 'QUEUED' },
            data: { status: 'FAILED', error: code },
          });
          break;
        }
      }

      await recount(broadcastId);
      // The linked-device queue already spaces sends by seconds; the Cloud API
      // is paced gently so a large list never trips per-second throughput.
      if (broadcast.provider === 'CLOUD_API') await new Promise((resolve) => setTimeout(resolve, 300));
    }

    await recount(broadcastId);
    await prisma.whatsAppBroadcast.updateMany({
      where: { id: broadcastId, status: { in: ['QUEUED', 'RUNNING'] } },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
  } catch (error) {
    console.error('[whatsapp] broadcast worker stopped unexpectedly', { broadcastId, error: sanitizeError(error) });
  } finally {
    running.delete(broadcastId);
  }
}

export async function cancelBroadcast(auth: AuthContext, broadcastId: string) {
  const broadcast = await prisma.whatsAppBroadcast.findFirst({
    where: { id: broadcastId, organizationId: auth.organizationId },
  });
  if (!broadcast) throw notFound('Broadcast not found');
  if (broadcast.status === 'COMPLETED' || broadcast.status === 'CANCELLED') return broadcast;

  await prisma.$transaction([
    prisma.whatsAppBroadcast.update({
      where: { id: broadcastId },
      data: { status: 'CANCELLED', completedAt: new Date() },
    }),
    prisma.whatsAppMessage.updateMany({
      where: { broadcastId, status: 'QUEUED' },
      data: { status: 'SKIPPED', error: 'CANCELLED' },
    }),
  ]);
  await recount(broadcastId);
  return prisma.whatsAppBroadcast.findUniqueOrThrow({ where: { id: broadcastId } });
}

/**
 * Picks up broadcasts a restart interrupted. Delayed so a QR-linked phone has
 * time to reconnect first — otherwise every row would fail as NOT_CONNECTED.
 */
export function resumeBroadcasts(delayMs = 30_000): void {
  setTimeout(() => {
    prisma.whatsAppBroadcast
      .findMany({ where: { status: { in: ['QUEUED', 'RUNNING'] } }, select: { id: true } })
      .then((rows) => rows.forEach((row) => void runBroadcast(row.id)))
      .catch((error) => console.error('[whatsapp] could not resume broadcasts', sanitizeError(error)));
  }, delayMs).unref();
}

export async function listBroadcasts(organizationId: string) {
  return prisma.whatsAppBroadcast.findMany({
    where: { organizationId },
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: { createdBy: { select: { id: true, name: true } } },
  });
}

export async function getBroadcast(organizationId: string, broadcastId: string, options: { summary?: boolean } = {}) {
  const broadcast = await prisma.whatsAppBroadcast.findFirst({
    where: { id: broadcastId, organizationId },
    include: {
      createdBy: { select: { id: true, name: true } },
      ...(options.summary
        ? {}
        : {
            messages: {
              orderBy: { createdAt: 'asc' as const },
              include: { donor: { select: { id: true, name: true, code: true } } },
            },
          }),
    },
  });
  if (!broadcast) throw notFound('Broadcast not found');
  return broadcast;
}

export async function listMessages(
  organizationId: string,
  query: { donorId?: string; page: number; pageSize: number },
) {
  const where: Prisma.WhatsAppMessageWhereInput = {
    organizationId,
    ...(query.donorId ? { donorId: query.donorId } : {}),
  };
  const [data, total] = await Promise.all([
    prisma.whatsAppMessage.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      include: {
        donor: { select: { id: true, name: true, code: true } },
        sentBy: { select: { id: true, name: true } },
      },
    }),
    prisma.whatsAppMessage.count({ where }),
  ]);
  return {
    data,
    meta: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.max(1, Math.ceil(total / query.pageSize)) },
  };
}

// ----------------------------- Inbound & receipts -----------------------------

const STATUS_RANK: Record<string, number> = { QUEUED: 0, SENT: 1, DELIVERED: 2, READ: 3 };

async function applyReceipt(
  organizationId: string,
  providerMessageId: string,
  status: 'SENT' | 'DELIVERED' | 'READ' | 'FAILED',
  error?: string,
) {
  const message = await prisma.whatsAppMessage.findFirst({
    where: { organizationId, providerMessageId },
    select: { id: true, status: true, broadcastId: true },
  });
  if (!message) return;

  if (status === 'FAILED') {
    await prisma.whatsAppMessage.update({
      where: { id: message.id },
      data: { status: 'FAILED', error: error ?? WhatsAppErrorCode.SEND_FAILED },
    });
  } else if ((STATUS_RANK[status] ?? 0) > (STATUS_RANK[message.status] ?? -1)) {
    // Receipts can arrive out of order; never move a message backwards.
    await prisma.whatsAppMessage.update({
      where: { id: message.id },
      data: {
        status,
        ...(status === 'DELIVERED' ? { deliveredAt: new Date() } : {}),
        ...(status === 'READ' ? { readAt: new Date() } : {}),
      },
    });
  }
  if (message.broadcastId) await recount(message.broadcastId);
}

interface InboundExtras {
  numberId?: string | null;
  contactName?: string | null;
  media?: { kind: string; mediaId: string; fileName?: string | null; mimeType?: string | null } | null;
}

async function recordInbound(
  organizationId: string,
  provider: WhatsAppProvider,
  rawPhone: string,
  text: string,
  providerMessageId: string,
  extras: InboundExtras = {},
) {
  const phone = normalizePhone(rawPhone) ?? rawPhone;
  if (providerMessageId) {
    const duplicate = await prisma.whatsAppMessage.findFirst({
      where: { organizationId, providerMessageId },
      select: { id: true },
    });
    if (duplicate) return;
  }

  const donor = await findDonorByPhone(organizationId, phone);

  const created = await prisma.whatsAppMessage.create({
    data: {
      organizationId,
      donorId: donor?.id ?? null,
      whatsappNumberId: extras.numberId ?? null,
      direction: 'INBOUND',
      provider,
      phone,
      body: text ? text.slice(0, 4096) : null,
      contactName: extras.contactName?.slice(0, 160) ?? null,
      mediaType: extras.media?.kind ?? null,
      mediaFileName: extras.media?.fileName ?? null,
      mediaMimeType: extras.media?.mimeType ?? null,
      status: 'RECEIVED',
      providerMessageId: providerMessageId || null,
      sentAt: new Date(),
    },
  });

  // Media is fetched from Meta after the row exists, so a slow download never
  // loses the message itself.
  if (extras.media && extras.numberId) {
    await fetchInboundMedia(created.id, organizationId, extras.numberId, extras.media).catch((error) =>
      console.warn('[whatsapp] inbound media download failed', sanitizeError(error)),
    );
  }
}

/** Wires the linked-device socket events to the same records the webhook uses. */
export function registerLinkedDeviceHandlers() {
  manager.setEventHandlers({
    inbound: (organizationId, phone, text, id) => recordInbound(organizationId, 'WEB_QR', phone, text, id),
    receipt: (organizationId, id, status) => applyReceipt(organizationId, id, status),
  });
}

interface CloudMediaObject {
  id?: string;
  caption?: string;
  filename?: string;
  mime_type?: string;
}

interface CloudWebhookPayload {
  entry?: {
    changes?: {
      value?: {
        metadata?: { phone_number_id?: string };
        contacts?: { wa_id?: string; profile?: { name?: string } }[];
        statuses?: { id: string; status: string; errors?: { code?: number }[] }[];
        messages?: {
          id: string;
          from: string;
          type: string;
          text?: { body?: string };
          button?: { text?: string };
          interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
          image?: CloudMediaObject;
          document?: CloudMediaObject;
          audio?: CloudMediaObject;
          video?: CloudMediaObject;
          sticker?: CloudMediaObject;
        }[];
      };
    }[];
  }[];
}

const MEDIA_KINDS = ['image', 'document', 'audio', 'video', 'sticker'] as const;

export async function processCloudWebhook(payload: CloudWebhookPayload) {
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      const phoneNumberId = value?.metadata?.phone_number_id;
      if (!value || !phoneNumberId) continue;

      // Callbacks are routed to a tenant by the business number they belong to.
      const number = await findByPhoneNumberId(phoneNumberId);
      if (!number) continue;

      for (const status of value.statuses ?? []) {
        const mapped =
          status.status === 'read'
            ? 'READ'
            : status.status === 'delivered'
              ? 'DELIVERED'
              : status.status === 'failed'
                ? 'FAILED'
                : status.status === 'sent'
                  ? 'SENT'
                  : null;
        if (!mapped) continue;
        const code = status.errors?.[0]?.code;
        const error =
          code === 131047
            ? WhatsAppErrorCode.OUTSIDE_WINDOW
            : code === 131026
              ? WhatsAppErrorCode.NOT_ON_WHATSAPP
              : WhatsAppErrorCode.SEND_FAILED;
        await applyReceipt(number.organizationId, status.id, mapped, mapped === 'FAILED' ? error : undefined);
      }

      const names = new Map((value.contacts ?? []).map((contact) => [contact.wa_id ?? '', contact.profile?.name ?? null]));
      for (const message of value.messages ?? []) {
        const kind = MEDIA_KINDS.find((item) => item === message.type);
        const media = kind ? message[kind] : undefined;
        const text =
          message.text?.body ??
          message.button?.text ??
          message.interactive?.button_reply?.title ??
          message.interactive?.list_reply?.title ??
          media?.caption ??
          (kind ? '' : `[${message.type}]`);
        await recordInbound(number.organizationId, 'CLOUD_API', message.from, text, message.id, {
          numberId: number.id,
          contactName: names.get(message.from) ?? null,
          media: kind && media?.id ? { kind, mediaId: media.id, fileName: media.filename ?? null, mimeType: media.mime_type ?? null } : null,
        });
      }
    }
  }
}

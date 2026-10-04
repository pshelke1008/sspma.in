/**
 * The WhatsApp inbox (CAThrives' inbox, for donors): one conversation per
 * phone number, built from the message log.
 *
 * A conversation exists once someone writes to us or we write to them
 * directly; broadcast-only recipients stay out of the list (their broadcast
 * messages still appear inside a thread once a conversation exists).
 *
 * Who may be messaged:
 *  - Anyone who wrote to us in the last 24 hours (WhatsApp's customer-service
 *    window) may be answered — they started the conversation.
 *  - Outside the window, only donors who agreed to WhatsApp messages, and on
 *    the Cloud API only with an approved template (Meta's rule).
 */
import type { Request } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../../db';
import { AUDIT_ACTIONS, recordAudit } from '../../lib/audit';
import { badRequest, notFound } from '../../lib/errors';
import { storeFile, validateUpload } from '../../lib/storage';
import type { AuthContext } from '../../middleware/auth';
import * as cloud from './cloudApi';
import { cloudCredentials, resolveSender } from './channel.service';
import { WhatsAppError, WhatsAppErrorCode, sanitizeError } from './errors';
import { findDonorByPhone } from './link';
import { assertContentFits, contextsFor, deliver, render, templateSummary, type MessageContent } from './messaging.service';

const WINDOW_MS = 24 * 60 * 60 * 1000;

export interface ConversationQuery {
  search?: string;
  filter: 'all' | 'unread' | 'donors' | 'unknown';
  page: number;
  pageSize: number;
}

interface ConversationRow {
  phone: string;
  lastId: string;
  lastAt: Date;
  unread: bigint;
  lastInboundAt: Date | null;
  donorId: string | null;
  contactName: string | null;
  numberId: string | null;
}

function windowState(lastInboundAt: Date | null) {
  const expiresAt = lastInboundAt ? new Date(lastInboundAt.getTime() + WINDOW_MS) : null;
  return { windowOpen: Boolean(expiresAt && expiresAt > new Date()), windowExpiresAt: expiresAt };
}

/** One row per phone with the latest message, unread count and window, as SQL. */
function conversationsSql(organizationId: string, phone?: string) {
  return Prisma.sql`
    SELECT
      m.phone,
      (array_agg(m.id ORDER BY m."createdAt" DESC))[1] AS "lastId",
      max(m."createdAt") AS "lastAt",
      count(*) FILTER (WHERE m.direction = 'INBOUND' AND m."seenAt" IS NULL) AS unread,
      max(m."createdAt") FILTER (WHERE m.direction = 'INBOUND') AS "lastInboundAt",
      (array_agg(m."donorId" ORDER BY m."createdAt" DESC) FILTER (WHERE m."donorId" IS NOT NULL))[1] AS "donorId",
      (array_agg(m."contactName" ORDER BY m."createdAt" DESC) FILTER (WHERE m."contactName" IS NOT NULL))[1] AS "contactName",
      (array_agg(m."whatsappNumberId" ORDER BY m."createdAt" DESC) FILTER (WHERE m."whatsappNumberId" IS NOT NULL))[1] AS "numberId"
    FROM "WhatsAppMessage" m
    WHERE m."organizationId" = ${organizationId}
      ${phone ? Prisma.sql`AND m.phone = ${phone}` : Prisma.empty}
    GROUP BY m.phone
    HAVING bool_or(m."broadcastId" IS NULL OR m.direction = 'INBOUND')
  `;
}

async function decorate(organizationId: string, rows: ConversationRow[]) {
  const [lastMessages, donors] = await Promise.all([
    prisma.whatsAppMessage.findMany({
      where: { id: { in: rows.map((row) => row.lastId) } },
      select: { id: true, body: true, direction: true, status: true, mediaType: true, templateName: true, createdAt: true },
    }),
    prisma.donor.findMany({
      where: { organizationId, id: { in: rows.map((row) => row.donorId).filter((id): id is string => Boolean(id)) } },
      select: { id: true, name: true, code: true, whatsappOptIn: true, isActive: true },
    }),
  ]);
  const lastById = new Map(lastMessages.map((message) => [message.id, message]));
  const donorById = new Map(donors.map((donor) => [donor.id, donor]));
  return rows.map((row) => ({
    phone: row.phone,
    donor: row.donorId ? (donorById.get(row.donorId) ?? null) : null,
    contactName: row.contactName,
    lastMessage: lastById.get(row.lastId) ?? null,
    lastMessageAt: row.lastAt,
    unreadCount: Number(row.unread),
    numberId: row.numberId,
    ...windowState(row.lastInboundAt),
  }));
}

export async function listConversations(organizationId: string, query: ConversationQuery) {
  const term = query.search?.trim();
  const digits = term?.replace(/\D/g, '') ?? '';
  const conditions: Prisma.Sql[] = [];
  if (query.filter === 'unread') conditions.push(Prisma.sql`c.unread > 0`);
  if (query.filter === 'donors') conditions.push(Prisma.sql`c."donorId" IS NOT NULL`);
  if (query.filter === 'unknown') conditions.push(Prisma.sql`c."donorId" IS NULL`);
  if (term) {
    const like = `%${term}%`;
    conditions.push(Prisma.sql`(
      d.name ILIKE ${like} OR d.code ILIKE ${like} OR c."contactName" ILIKE ${like}
      ${digits.length >= 3 ? Prisma.sql`OR c.phone LIKE ${`%${digits}%`}` : Prisma.empty}
    )`);
  }
  const where = conditions.length ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.empty;
  const base = Prisma.sql`FROM (${conversationsSql(organizationId)}) c LEFT JOIN "Donor" d ON d.id = c."donorId" ${where}`;

  const [rows, totals] = await Promise.all([
    prisma.$queryRaw<ConversationRow[]>`
      SELECT c.* ${base}
      ORDER BY c."lastAt" DESC
      LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}
    `,
    prisma.$queryRaw<{ total: bigint }[]>`SELECT count(*) AS total ${base}`,
  ]);
  const total = Number(totals[0]?.total ?? 0);
  return {
    data: await decorate(organizationId, rows),
    meta: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.max(1, Math.ceil(total / query.pageSize)) },
  };
}

/** Unread inbound messages across all conversations — the inbox badge. */
export async function unreadCount(organizationId: string) {
  const count = await prisma.whatsAppMessage.count({
    where: { organizationId, direction: 'INBOUND', seenAt: null },
  });
  return { count };
}

export async function getConversation(organizationId: string, phone: string) {
  const rows = await prisma.$queryRaw<ConversationRow[]>`${conversationsSql(organizationId, phone)}`;
  if (rows.length) return (await decorate(organizationId, rows))[0];
  // A donor we have never messaged: an empty conversation they can start.
  const match = await findDonorByPhone(organizationId, phone);
  const donor = match
    ? await prisma.donor.findUnique({
        where: { id: match.id },
        select: { id: true, name: true, code: true, whatsappOptIn: true, isActive: true },
      })
    : null;
  if (!donor) throw notFound('Conversation not found');
  return {
    phone,
    donor,
    contactName: null,
    lastMessage: null,
    lastMessageAt: null,
    unreadCount: 0,
    numberId: null,
    ...windowState(null),
  };
}

const MESSAGE_SELECT = {
  id: true,
  direction: true,
  provider: true,
  phone: true,
  body: true,
  templateName: true,
  contactName: true,
  mediaType: true,
  mediaFileName: true,
  mediaMimeType: true,
  mediaStorageKey: true,
  status: true,
  error: true,
  broadcastId: true,
  whatsappNumberId: true,
  sentAt: true,
  deliveredAt: true,
  readAt: true,
  createdAt: true,
  sentBy: { select: { id: true, name: true } },
} satisfies Prisma.WhatsAppMessageSelect;

function publicMessage(message: Prisma.WhatsAppMessageGetPayload<{ select: typeof MESSAGE_SELECT }>) {
  const { mediaStorageKey, ...rest } = message;
  return { ...rest, hasMedia: Boolean(mediaStorageKey) };
}

/** Newest page of a thread, returned oldest-first; pass `before` (a message id) for older pages. */
export async function listThread(organizationId: string, phone: string, query: { before?: string; limit: number }) {
  let cursorDate: Date | undefined;
  if (query.before) {
    const cursor = await prisma.whatsAppMessage.findFirst({ where: { id: query.before, organizationId }, select: { createdAt: true } });
    cursorDate = cursor?.createdAt;
  }
  const rows = await prisma.whatsAppMessage.findMany({
    where: { organizationId, phone, ...(cursorDate ? { createdAt: { lt: cursorDate } } : {}) },
    orderBy: { createdAt: 'desc' },
    take: query.limit + 1,
    select: MESSAGE_SELECT,
  });
  const hasMore = rows.length > query.limit;
  return { data: rows.slice(0, query.limit).reverse().map(publicMessage), hasMore };
}

export async function markSeen(organizationId: string, phone: string) {
  const result = await prisma.whatsAppMessage.updateMany({
    where: { organizationId, phone, direction: 'INBOUND', seenAt: null },
    data: { seenAt: new Date() },
  });
  return { updated: result.count };
}

/** Who this conversation is with, and whether we may write to them now. */
async function permissionToWrite(organizationId: string, phone: string, wantsTemplate: boolean) {
  const conversation = await getConversation(organizationId, phone);
  const donor = conversation.donor;
  if (donor && !donor.isActive) throw new WhatsAppError(WhatsAppErrorCode.DONOR_INACTIVE);
  const consented = Boolean(donor?.whatsappOptIn);
  if (!conversation.windowOpen && !consented) throw new WhatsAppError(WhatsAppErrorCode.NOT_OPTED_IN);
  return { conversation, needsTemplate: !conversation.windowOpen && !wantsTemplate };
}

export async function sendInConversation(
  auth: AuthContext,
  phone: string,
  content: MessageContent & { numberId?: string | null },
  req: Request,
) {
  const provider = await resolveSender(auth.organizationId);
  assertContentFits(provider, content);
  const { conversation, needsTemplate } = await permissionToWrite(auth.organizationId, phone, Boolean(content.templateName));
  // Meta only delivers free text inside the 24-hour window.
  if (provider === 'CLOUD_API' && needsTemplate) throw new WhatsAppError(WhatsAppErrorCode.OUTSIDE_WINDOW);

  // Placeholders work for donors; for an unknown contact {{name}} is their WhatsApp name.
  let context = { name: conversation.contactName ?? '', total_donated: '', last_donation_date: '', organization: '' };
  if (conversation.donor) {
    const donor = await prisma.donor.findUniqueOrThrow({ where: { id: conversation.donor.id } });
    context = (await contextsFor(auth.organizationId, [donor])).get(donor.id)!;
  }
  const body = content.body ? render(content.body, context) : null;
  const templateParams = (content.templateParams ?? []).map((param) => render(param, context));
  const numberId = content.numberId ?? conversation.numberId;

  const message = await prisma.whatsAppMessage.create({
    data: {
      organizationId: auth.organizationId,
      donorId: conversation.donor?.id ?? null,
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
    const delivered = await deliver(
      auth.organizationId,
      provider,
      phone,
      { body, templateName: content.templateName ?? null, templateLanguage: content.templateLanguage ?? null, templateParams },
      provider === 'CLOUD_API' ? numberId : null,
    );
    const sent = await prisma.whatsAppMessage.update({
      where: { id: message.id },
      data: { status: 'SENT', providerMessageId: delivered.providerMessageId || null, whatsappNumberId: delivered.numberId, sentAt: new Date() },
      select: MESSAGE_SELECT,
    });
    await auditSend(auth, conversation, provider, content.templateName ?? null, req);
    return publicMessage(sent);
  } catch (error) {
    await prisma.whatsAppMessage.update({ where: { id: message.id }, data: { status: 'FAILED', error: sanitizeError(error) } });
    throw error;
  }
}

/** Sends a photo or PDF (Cloud API only, inside the 24-hour window). */
export async function sendMediaInConversation(
  auth: AuthContext,
  phone: string,
  file: Express.Multer.File | undefined,
  options: { caption?: string | null; numberId?: string | null },
  req: Request,
) {
  if (!file) throw badRequest('Choose a photo or PDF to send');
  validateUpload(file);
  const provider = await resolveSender(auth.organizationId);
  if (provider !== 'CLOUD_API') throw new WhatsAppError(WhatsAppErrorCode.MEDIA_NEEDS_CLOUD);
  const { conversation, needsTemplate } = await permissionToWrite(auth.organizationId, phone, false);
  if (needsTemplate) throw new WhatsAppError(WhatsAppErrorCode.OUTSIDE_WINDOW);

  const kind = file.mimetype === 'application/pdf' ? 'document' : 'image';
  const stored = await storeFile(auth.organizationId, 'whatsapp', file);
  const credentials = await cloudCredentials(auth.organizationId, options.numberId ?? conversation.numberId);
  const message = await prisma.whatsAppMessage.create({
    data: {
      organizationId: auth.organizationId,
      donorId: conversation.donor?.id ?? null,
      whatsappNumberId: credentials.numberId,
      direction: 'OUTBOUND',
      provider: 'CLOUD_API',
      phone,
      body: options.caption?.slice(0, 1024) || null,
      mediaType: kind,
      mediaStorageKey: stored.key,
      mediaMimeType: stored.mimeType,
      mediaFileName: stored.fileName,
      status: 'QUEUED',
      sentById: auth.userId,
    },
  });
  try {
    const mediaId = await cloud.uploadMedia(credentials.phoneNumberId, credentials.token, {
      buffer: file.buffer,
      mimeType: file.mimetype,
      fileName: stored.fileName,
    });
    const providerMessageId = await cloud.sendMedia(credentials.phoneNumberId, credentials.token, phone, {
      kind,
      mediaId,
      caption: options.caption,
      fileName: stored.fileName,
    });
    const sent = await prisma.whatsAppMessage.update({
      where: { id: message.id },
      data: { status: 'SENT', providerMessageId: providerMessageId || null, sentAt: new Date() },
      select: MESSAGE_SELECT,
    });
    await auditSend(auth, conversation, 'CLOUD_API', null, req);
    return publicMessage(sent);
  } catch (error) {
    await prisma.whatsAppMessage.update({ where: { id: message.id }, data: { status: 'FAILED', error: sanitizeError(error) } });
    throw error;
  }
}

async function auditSend(
  auth: AuthContext,
  conversation: { phone: string; donor: { id: string; name: string; code: string } | null; contactName: string | null },
  provider: string,
  template: string | null,
  req: Request,
) {
  await recordAudit({
    organizationId: auth.organizationId,
    userId: auth.userId,
    action: AUDIT_ACTIONS.WHATSAPP_MESSAGE_SENT,
    entityType: conversation.donor ? 'Donor' : 'WhatsAppConversation',
    entityId: conversation.donor?.id,
    entityLabel: conversation.donor ? `${conversation.donor.code} ${conversation.donor.name}` : (conversation.contactName ?? `+${conversation.phone}`),
    newValue: { provider, template, via: 'inbox' },
    req,
  });
}

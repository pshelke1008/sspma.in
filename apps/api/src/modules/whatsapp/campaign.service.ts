/**
 * The broadcast wizard's backend: who a template broadcast would reach, what
 * each recipient's message will say, what it will roughly cost — and then
 * creating it, now or for later.
 *
 * Campaigns are Cloud API template sends. `resolve` is shared by the review
 * step and by creation, so what the review shows is exactly what is queued.
 */
import type { Request } from 'express';
import type { Prisma } from '@prisma/client';
import { BROADCAST_DONOR_FIELDS, type VariableMapping } from '@ashram/types';
import { prisma } from '../../db';
import { AUDIT_ACTIONS, recordAudit } from '../../lib/audit';
import type { AuthContext } from '../../middleware/auth';
import { messagingNumber } from '../donors/donor.service';
import * as cloud from './cloudApi';
import { cloudCredentials } from './channel.service';
import { WhatsAppError, WhatsAppErrorCode } from './errors';
import {
  ELIGIBILITY_ERROR,
  contextsFor,
  eligibilityOf,
  render,
  runBroadcast,
  type RenderContext,
} from './messaging.service';
import { maskPhone, normalizePhone } from './phone';
import { listAll } from './template.service';
import { assertTemplateUsable, renderTemplateText, type MessageTemplate } from './templates';
import { parseRecipientSheet, type ParsedSheet } from './recipients.upload';

export const CAMPAIGN_MAX_RECIPIENTS = 5000;
export const SCHEDULE_MIN_LEAD_MS = 60_000;
export const SCHEDULE_MAX_LEAD_MS = 30 * 24 * 60 * 60 * 1000;
const PREVIEW_SAMPLES = 10;

export const AUDIENCE_MODES = ['ALL', 'FILTER', 'SELECT', 'UPLOAD'] as const;
export type AudienceMode = (typeof AUDIENCE_MODES)[number];

/**
 * Approximate WhatsApp Business conversation prices in INR, for the review step
 * only — Meta's invoice is the truth and rates change.
 */
const PRICE_PER_MESSAGE_INR: Record<string, number> = { MARKETING: 0.78, UTILITY: 0.115, AUTHENTICATION: 0.115 };
const GST = 1.18;

export function estimateCost(category: string, messages: number): number {
  const rate = PRICE_PER_MESSAGE_INR[category] ?? PRICE_PER_MESSAGE_INR.MARKETING;
  return Math.round(rate * messages * GST * 100) / 100;
}

export interface HeaderMediaInput {
  mediaId: string;
  fileName: string;
  kind: 'image' | 'video' | 'document';
}

export interface CampaignInput {
  templateName: string;
  templateLanguage: string;
  audienceMode: AudienceMode;
  /** ALL, FILTER and SELECT: the donors chosen on screen (resolved there from the filters). */
  donorIds?: string[];
  /** UPLOAD: donors matched from the spreadsheet, with the columns the mapping uses. */
  recipients?: { donorId: string; row?: Record<string, string> }[];
  variableMapping: VariableMapping;
  headerMedia?: HeaderMediaInput | null;
}

type RowStatus = 'OK' | 'INACTIVE' | 'NO_NUMBER' | 'NOT_OPTED_IN' | 'MISSING_DATA';

interface ResolvedRow {
  donorId: string;
  donorName: string;
  phone: string | null;
  status: RowStatus;
  params: string[];
}

// ----------------------------- Resolving --------------------------------------

async function findTemplate(organizationId: string, input: CampaignInput): Promise<MessageTemplate> {
  const templates = await listAll(organizationId);
  const template = templates.find((item) => item.name === input.templateName && item.language === input.templateLanguage);
  // Variable values differ per recipient, so only the shape is checked here.
  assertTemplateUsable(template, Array(template?.bodyParameterCount ?? 0).fill('x'), { headerMedia: Boolean(input.headerMedia) });

  if (template.requiresHeaderMedia && input.headerMedia?.kind !== template.headerFormat?.toLowerCase()) {
    throw new WhatsAppError(WhatsAppErrorCode.MEDIA_INVALID);
  }
  for (let index = 1; index <= template.bodyParameterCount; index += 1) {
    const source = input.variableMapping[String(index)];
    const missing =
      !source ||
      (source.source === 'static' && !source.value.trim()) ||
      (source.source === 'column' && (input.audienceMode !== 'UPLOAD' || !source.column.trim())) ||
      (source.source === 'donor' && !(BROADCAST_DONOR_FIELDS as readonly string[]).includes(source.field));
    if (missing) throw new WhatsAppError(WhatsAppErrorCode.TEMPLATE_PARAMS_MISMATCH);
  }
  return template;
}

/** The renderer's stand-in for "no such value" (a donor who has never donated). */
const NO_VALUE = '—';

function paramsFor(template: MessageTemplate, mapping: VariableMapping, context: RenderContext, row?: Record<string, string>) {
  return Array.from({ length: template.bodyParameterCount }, (_, index) => {
    const source = mapping[String(index + 1)];
    if (source.source === 'static') return render(source.value, context).trim();
    if (source.source === 'donor') {
      const value = context[source.field].trim();
      // "—" is what a message shows for a donor with no donation yet; Meta would deliver it as the value.
      return value === NO_VALUE ? '' : value;
    }
    return (row?.[source.column] ?? '').trim();
  });
}

async function resolve(organizationId: string, input: CampaignInput) {
  // Templates are Cloud API only, whichever channel the organization sends texts on.
  await cloudCredentials(organizationId);
  const template = await findTemplate(organizationId, input);

  const rowsByDonor = new Map<string, Record<string, string> | undefined>();
  if (input.audienceMode === 'UPLOAD') {
    for (const recipient of input.recipients ?? []) if (!rowsByDonor.has(recipient.donorId)) rowsByDonor.set(recipient.donorId, recipient.row);
  } else {
    for (const donorId of input.donorIds ?? []) rowsByDonor.set(donorId, undefined);
  }

  const donors = await prisma.donor.findMany({
    where: { organizationId, id: { in: [...rowsByDonor.keys()] } },
    orderBy: { name: 'asc' },
  });
  const contexts = await contextsFor(organizationId, donors);

  const rows: ResolvedRow[] = donors.map((donor) => {
    const context = contexts.get(donor.id)!;
    const params = paramsFor(template, input.variableMapping, context, rowsByDonor.get(donor.id));
    const eligibility = eligibilityOf(donor);
    const status: RowStatus = eligibility !== 'OK' ? eligibility : params.some((param) => !param) ? 'MISSING_DATA' : 'OK';
    return { donorId: donor.id, donorName: donor.name, phone: messagingNumber(donor), status, params };
  });

  return { template, rows, requested: rowsByDonor.size };
}

function summarise(template: MessageTemplate, rows: ResolvedRow[]) {
  const skipped = { INACTIVE: 0, NO_NUMBER: 0, NOT_OPTED_IN: 0, MISSING_DATA: 0 };
  for (const row of rows) if (row.status !== 'OK') skipped[row.status] += 1;
  const willReceive = rows.filter((row) => row.status === 'OK').length;
  return { skipped, willReceive, estimatedCost: estimateCost(template.category, willReceive) };
}

// ----------------------------- Review -----------------------------------------

export async function previewCampaign(organizationId: string, input: CampaignInput) {
  const { template, rows, requested } = await resolve(organizationId, input);
  const { skipped, willReceive, estimatedCost } = summarise(template, rows);

  // A few of each kind, so the review shows both what goes out and what is left out.
  const ordered = [...rows.filter((row) => row.status === 'OK'), ...rows.filter((row) => row.status !== 'OK')];
  return {
    provider: 'CLOUD_API' as const,
    template: {
      name: template.name,
      language: template.language,
      category: template.category,
      headerFormat: template.headerFormat,
      headerText: template.headerText,
      bodyText: template.bodyText,
      footerText: template.footerText,
      buttons: template.buttons,
      parameterCount: template.bodyParameterCount,
    },
    selected: requested,
    found: rows.length,
    willReceive,
    skipped,
    estimatedCost,
    samples: ordered.slice(0, PREVIEW_SAMPLES).map((row) => ({
      donorId: row.donorId,
      donorName: row.donorName,
      phone: maskPhone(row.phone),
      status: row.status,
      body: renderTemplateText(template.bodyText, row.params),
    })),
  };
}

// ----------------------------- Creating ---------------------------------------

export function assertScheduleValid(scheduledAt: Date | null | undefined, now = new Date()) {
  if (!scheduledAt) return;
  const lead = scheduledAt.getTime() - now.getTime();
  if (Number.isNaN(lead) || lead < SCHEDULE_MIN_LEAD_MS || lead > SCHEDULE_MAX_LEAD_MS) {
    throw new WhatsAppError(WhatsAppErrorCode.SCHEDULE_INVALID);
  }
}

export async function createCampaign(
  auth: AuthContext,
  input: CampaignInput & { name: string; scheduledAt?: Date | null },
  req: Request,
) {
  assertScheduleValid(input.scheduledAt);
  const { template, rows } = await resolve(auth.organizationId, input);
  if (rows.length === 0) throw new WhatsAppError(WhatsAppErrorCode.NO_RECIPIENTS);

  const { skipped, willReceive, estimatedCost } = summarise(template, rows);
  const skippedCount = rows.length - willReceive;
  const allSkipped = willReceive === 0;
  const status = allSkipped ? 'COMPLETED' : input.scheduledAt ? 'SCHEDULED' : 'QUEUED';

  const messages: Prisma.WhatsAppMessageCreateManyInput[] = rows.map((row) => ({
    organizationId: auth.organizationId,
    donorId: row.donorId,
    direction: 'OUTBOUND',
    provider: 'CLOUD_API',
    phone: row.phone ?? '',
    status: row.status === 'OK' ? 'QUEUED' : 'SKIPPED',
    error:
      row.status === 'OK'
        ? null
        : row.status === 'MISSING_DATA'
          ? WhatsAppErrorCode.MISSING_DATA
          : ELIGIBILITY_ERROR[row.status],
    templateName: template.name,
    templateParams: row.params,
    sentById: auth.userId,
  }));

  const broadcast = await prisma.$transaction(async (tx) => {
    const created = await tx.whatsAppBroadcast.create({
      data: {
        organizationId: auth.organizationId,
        name: input.name,
        provider: 'CLOUD_API',
        // The approved text as it was when this was created; each message's own text is stored when sent.
        body: template.bodyText,
        templateName: template.name,
        templateLanguage: template.language,
        templateCategory: template.category,
        variableMapping: input.variableMapping as Prisma.InputJsonValue,
        audienceMode: input.audienceMode,
        estimatedCost,
        scheduledAt: input.scheduledAt ?? null,
        headerFormat: template.requiresHeaderMedia ? template.headerFormat : null,
        headerMediaId: template.requiresHeaderMedia ? (input.headerMedia?.mediaId ?? null) : null,
        headerMediaName: template.requiresHeaderMedia ? (input.headerMedia?.fileName ?? null) : null,
        totalRecipients: rows.length,
        skippedCount,
        status,
        completedAt: allSkipped ? new Date() : null,
        createdById: auth.userId,
      },
    });
    await tx.whatsAppMessage.createMany({ data: messages.map((message) => ({ ...message, broadcastId: created.id })) });
    return created;
  });

  await recordAudit({
    organizationId: auth.organizationId,
    userId: auth.userId,
    action: AUDIT_ACTIONS.WHATSAPP_BROADCAST_CREATED,
    entityType: 'WhatsAppBroadcast',
    entityId: broadcast.id,
    entityLabel: broadcast.name,
    newValue: {
      provider: 'CLOUD_API',
      template: template.name,
      audience: input.audienceMode,
      recipients: rows.length,
      skipped,
      scheduledAt: input.scheduledAt?.toISOString() ?? null,
    },
    req,
  });

  if (broadcast.status === 'QUEUED') void runBroadcast(broadcast.id);
  return broadcast;
}

// ----------------------------- Header media -----------------------------------

const HEADER_MEDIA_RULES = [
  { kind: 'image' as const, mimeTypes: ['image/jpeg', 'image/png'], maxBytes: 5 * 1024 * 1024 },
  { kind: 'video' as const, mimeTypes: ['video/mp4', 'video/3gpp'], maxBytes: 16 * 1024 * 1024 },
  { kind: 'document' as const, mimeTypes: ['application/pdf'], maxBytes: 100 * 1024 * 1024 },
];

/** Uploads the image, video or PDF a media-header template is sent with. */
export async function uploadHeaderMedia(
  organizationId: string,
  file: { buffer: Buffer; mimetype: string; originalname: string } | undefined,
): Promise<HeaderMediaInput & { mimeType: string; size: number }> {
  if (!file) throw new WhatsAppError(WhatsAppErrorCode.MEDIA_INVALID);
  const rule = HEADER_MEDIA_RULES.find((candidate) => candidate.mimeTypes.includes(file.mimetype));
  if (!rule || file.buffer.length > rule.maxBytes) throw new WhatsAppError(WhatsAppErrorCode.MEDIA_INVALID);

  const credentials = await cloudCredentials(organizationId);
  const fileName = file.originalname.replace(/[^\w.\- ]+/g, '_').slice(0, 120) || `header.${rule.kind}`;
  const mediaId = await cloud.uploadMedia(credentials.phoneNumberId, credentials.token, {
    buffer: file.buffer,
    mimeType: file.mimetype,
    fileName,
  });
  return { mediaId, fileName, kind: rule.kind, mimeType: file.mimetype, size: file.buffer.length };
}

// ----------------------------- Spreadsheet audience ---------------------------

/** Reads the uploaded sheet and matches each number to a donor of this organization. */
export async function matchUploadedRecipients(organizationId: string, buffer: Buffer) {
  const sheet: ParsedSheet = await parseRecipientSheet(buffer);

  const donors = await prisma.donor.findMany({
    where: { organizationId },
    select: { id: true, name: true, code: true, isActive: true, whatsappOptIn: true, phone: true, whatsappNumber: true, alternatePhone: true, preferredLanguage: true },
    orderBy: { createdAt: 'asc' },
  });
  // Either of a donor's numbers may be what the sheet lists.
  const byNumber = new Map<string, (typeof donors)[number]>();
  for (const donor of donors) {
    for (const raw of [donor.whatsappNumber, donor.phone, donor.alternatePhone]) {
      const number = normalizePhone(raw);
      if (number && !byNumber.has(number)) byNumber.set(number, donor);
    }
  }

  const seen = new Set<string>();
  const recipients: { donorId: string; donorName: string; phone: string; eligible: boolean; row: Record<string, string> }[] = [];
  const unmatched: { rowNumber: number; phone: string }[] = [];
  let invalid = 0;
  let duplicates = 0;

  for (const row of sheet.rows) {
    if (!row.phone) {
      invalid += 1;
      continue;
    }
    const donor = byNumber.get(row.phone);
    if (!donor) {
      unmatched.push({ rowNumber: row.rowNumber, phone: maskPhone(row.phone) });
      continue;
    }
    if (seen.has(donor.id)) {
      duplicates += 1;
      continue;
    }
    seen.add(donor.id);
    recipients.push({
      donorId: donor.id,
      donorName: donor.name,
      phone: maskPhone(row.phone),
      eligible: eligibilityOf(donor) === 'OK',
      row: row.values,
    });
  }

  return {
    columns: sheet.columns,
    phoneColumn: sheet.phoneColumn,
    recipients,
    unmatched: unmatched.slice(0, 20),
    stats: {
      rows: sheet.rows.length,
      matched: recipients.length,
      unmatched: unmatched.length,
      invalid,
      duplicates,
      notOptedIn: recipients.filter((recipient) => !recipient.eligible).length,
    },
  };
}

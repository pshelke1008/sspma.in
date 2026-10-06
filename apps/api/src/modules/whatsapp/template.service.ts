/**
 * Message templates of the connected WhatsApp Business Account: listing them,
 * submitting new ones to Meta for review, deleting them, and checking one
 * before it is sent.
 *
 * Meta is the source of truth — nothing is stored here. A short in-memory cache
 * keeps a broadcast's preview, create and send from each asking Meta again.
 */
import type { Request } from 'express';
import { AUDIT_ACTIONS, recordAudit } from '../../lib/audit';
import type { AuthContext } from '../../middleware/auth';
import * as cloud from './cloudApi';
import { cloudCredentials } from './channel.service';
import { WhatsAppError, WhatsAppErrorCode } from './errors';
import { assertTemplateUsable, type CreateTemplateInput, type MessageTemplate } from './templates';

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { at: number; templates: MessageTemplate[] }>();

async function accountFor(organizationId: string, numberId?: string | null) {
  const credentials = await cloudCredentials(organizationId, numberId);
  if (!credentials.businessAccountId) throw new WhatsAppError(WhatsAppErrorCode.NOT_CONNECTED);
  return credentials;
}

/** All templates of the number's business account. `fresh` skips the cache. */
export async function listAll(organizationId: string, numberId?: string | null, fresh = false) {
  const { businessAccountId, token } = await accountFor(organizationId, numberId);
  const cached = cache.get(businessAccountId);
  if (!fresh && cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.templates;

  const templates = await cloud.listTemplates(businessAccountId, token);
  cache.set(businessAccountId, { at: Date.now(), templates });
  return templates;
}

/**
 * Templates a user can pick to send: approved and sendable. `hidden` counts the
 * approved ones left out (header media, dynamic buttons …), so the picker can say so.
 */
export async function listSendable(
  organizationId: string,
  numberId?: string | null,
  options: { includeMedia?: boolean } = {},
) {
  const approved = (await listAll(organizationId, numberId)).filter((template) => template.status === 'APPROVED');
  // A media-header template needs a file with every send, which only a broadcast supplies.
  const sendable = approved.filter((template) => template.sendable && (options.includeMedia || !template.requiresHeaderMedia));
  return { templates: sendable, hidden: approved.length - sendable.length };
}

/** Throws unless `name`/`language` is an approved template that `params` can fill. */
export async function requireUsable(
  organizationId: string,
  name: string,
  language: string | null | undefined,
  params: string[],
  options: { numberId?: string | null; headerMedia?: boolean } = {},
): Promise<MessageTemplate> {
  const templates = await listAll(organizationId, options.numberId);
  const lang = language ?? 'en';
  const template = templates.find((item) => item.name === name && item.language === lang);
  assertTemplateUsable(template, params, { headerMedia: options.headerMedia });
  return template;
}

/** Uploads the sample file a media-header template is reviewed with; returns Meta's handle. */
export async function uploadHeaderSample(
  organizationId: string,
  file: { buffer: Buffer; mimeType: string; fileName: string },
  numberId?: string | null,
) {
  const { token } = await accountFor(organizationId, numberId);
  return cloud.uploadTemplateSample(token, file);
}

export async function create(auth: AuthContext, input: CreateTemplateInput, numberId: string | null, req: Request) {
  const { businessAccountId, token } = await accountFor(auth.organizationId, numberId);
  const result = await cloud.createTemplate(businessAccountId, token, input);
  cache.delete(businessAccountId);

  await recordAudit({
    organizationId: auth.organizationId,
    userId: auth.userId,
    action: AUDIT_ACTIONS.WHATSAPP_TEMPLATE_CREATED,
    entityType: 'WhatsAppTemplate',
    entityId: result.id,
    entityLabel: `${input.name} (${input.language})`,
    newValue: { category: input.category, status: result.status },
    req,
  });
  return result;
}

export async function remove(
  auth: AuthContext,
  name: string,
  templateId: string | null,
  numberId: string | null,
  req: Request,
) {
  const { businessAccountId, token } = await accountFor(auth.organizationId, numberId);
  await cloud.deleteTemplate(businessAccountId, token, name, templateId ?? undefined);
  cache.delete(businessAccountId);

  await recordAudit({
    organizationId: auth.organizationId,
    userId: auth.userId,
    action: AUDIT_ACTIONS.WHATSAPP_TEMPLATE_DELETED,
    entityType: 'WhatsAppTemplate',
    entityId: templateId ?? undefined,
    entityLabel: name,
    req,
  });
}

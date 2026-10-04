import { Router } from 'express';
import multer from 'multer';
import { env } from '../../env';
import { z } from 'zod';
import { BROADCAST_DONOR_FIELDS, WHATSAPP_PROVIDERS } from '@ashram/types';
import { asyncHandler } from '../../lib/http';
import { badRequest } from '../../lib/errors';
import { validate, validated } from '../../middleware/validate';
import { getCurrentOrganization, getCurrentUser, requirePermission } from '../../middleware/auth';
import * as channel from './channel.service';
import * as messaging from './messaging.service';
import * as oauth from './oauth.service';
import * as conversations from './conversations.service';
import * as templates from './template.service';
import { MEDIA_HEADER_FORMATS, TEMPLATE_CATEGORIES, bodyProblem, parameterCount } from './templates';
import * as campaigns from './campaign.service';
import { buildRecipientTemplate } from './recipients.upload';
import { readMessageMedia } from './media.service';
import { listNumbers } from './numbers.service';

export const whatsappRouter = Router();

const contentShape = {
  body: z.string().trim().max(4096).optional().nullable(),
  templateName: z
    .string()
    .trim()
    .regex(/^[a-z0-9_]+$/, 'Template names use lowercase letters, digits and underscores')
    .optional()
    .nullable(),
  templateLanguage: z.string().trim().max(10).optional().nullable(),
  templateParams: z.array(z.string().max(1024)).max(10).optional(),
};

const hasContent = (data: { body?: string | null; templateName?: string | null }) =>
  Boolean(data.templateName) || Boolean(data.body?.trim());

// ----------------------------- Connection -------------------------------------

whatsappRouter.get(
  '/status',
  requirePermission('whatsapp.send', 'whatsapp.inbox', 'whatsapp.manage'),
  asyncHandler(async (req, res) => {
    res.json(await channel.getStatus(getCurrentOrganization(req)));
  }),
);

whatsappRouter.put(
  '/cloud',
  requirePermission('whatsapp.manage'),
  validate(
    z.object({
      phoneNumberId: z.string().trim().regex(/^\d{6,25}$/, 'Phone number ID is the numeric ID from Meta'),
      businessAccountId: z.string().trim().regex(/^\d{6,25}$/, 'Business account ID is the numeric WABA ID'),
      accessToken: z.string().trim().min(20, 'Paste the full access token'),
    }),
  ),
  asyncHandler(async (req, res) => {
    res.json(await channel.connectCloud(getCurrentUser(req), req.body, req));
  }),
);

// ----------------------------- Connect with Facebook --------------------------

whatsappRouter.get(
  '/oauth/start',
  requirePermission('whatsapp.manage'),
  asyncHandler(async (req, res) => {
    res.json({ authUrl: oauth.buildAuthUrl(getCurrentUser(req)) });
  }),
);

/** The numbers a Facebook sign-in shared, for the admin to choose from. */
whatsappRouter.get(
  '/oauth/pending/:id',
  requirePermission('whatsapp.manage'),
  asyncHandler(async (req, res) => {
    res.json({ data: await oauth.getPending(getCurrentOrganization(req), req.params.id) });
  }),
);

whatsappRouter.post(
  '/oauth/complete',
  requirePermission('whatsapp.manage'),
  validate(
    z.object({
      pendingId: z.string().min(1),
      // CAThrives connects every number the admin ticks in one go.
      numbers: z
        .array(z.object({ businessAccountId: z.string().regex(/^\d{6,25}$/), phoneNumberId: z.string().regex(/^\d{6,25}$/) }))
        .min(1, 'Choose at least one number')
        .max(20),
    }),
  ),
  asyncHandler(async (req, res) => {
    const auth = getCurrentUser(req);
    const choices = [];
    // Resolve every choice before connecting any, so one bad pick connects nothing.
    for (const pick of req.body.numbers as { businessAccountId: string; phoneNumberId: string }[]) {
      choices.push(await oauth.takePendingChoice(auth.organizationId, req.body.pendingId, pick));
    }
    let status = await channel.getStatus(auth.organizationId);
    for (const choice of choices) {
      status = await channel.connectCloud(auth, choice.credentials, req, { method: 'OAUTH', tokenExpiresAt: choice.tokenExpiresAt });
    }
    await oauth.discardPending(req.body.pendingId);
    res.json(status);
  }),
);

whatsappRouter.delete(
  '/cloud',
  requirePermission('whatsapp.manage'),
  asyncHandler(async (req, res) => {
    res.json(await channel.disconnectCloud(getCurrentUser(req), req));
  }),
);

// ----------------------------- Numbers ----------------------------------------

whatsappRouter.get(
  '/numbers',
  requirePermission('whatsapp.send', 'whatsapp.inbox', 'whatsapp.manage'),
  asyncHandler(async (req, res) => {
    res.json({ data: await listNumbers(getCurrentOrganization(req)) });
  }),
);

whatsappRouter.delete(
  '/numbers/:id',
  requirePermission('whatsapp.manage'),
  asyncHandler(async (req, res) => {
    res.json(await channel.disconnectCloudNumber(getCurrentUser(req), req.params.id, req));
  }),
);

whatsappRouter.get(
  '/cloud/templates',
  requirePermission('whatsapp.send', 'whatsapp.inbox'),
  asyncHandler(async (req, res) => {
    const numberId = typeof req.query.numberId === 'string' && req.query.numberId ? req.query.numberId : null;
    // The broadcast wizard supplies a file for media-header templates; single sends cannot.
    const { templates: data, hidden } = await templates.listSendable(getCurrentOrganization(req), numberId, {
      includeMedia: req.query.media === '1',
    });
    res.json({ data, hidden });
  }),
);

// ----------------------------- Template management ----------------------------

const optionalNumberId = (req: { query: Record<string, unknown> }) =>
  typeof req.query.numberId === 'string' && req.query.numberId ? req.query.numberId : null;

/** Every template of the business account with its review status (not only approved ones). */
whatsappRouter.get(
  '/templates',
  requirePermission('whatsapp.manage'),
  asyncHandler(async (req, res) => {
    const data = await templates.listAll(getCurrentOrganization(req), optionalNumberId(req), req.query.fresh === '1');
    res.json({ data });
  }),
);

const buttonSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('QUICK_REPLY'), text: z.string().trim().min(1).max(25) }),
  z.object({
    type: z.literal('URL'),
    text: z.string().trim().min(1).max(25),
    url: z.string().trim().url().max(2000).refine((value) => value.startsWith('https://'), 'Use an https:// address'),
  }),
  z.object({
    type: z.literal('PHONE_NUMBER'),
    text: z.string().trim().min(1).max(25),
    phoneNumber: z.string().trim().regex(/^\+\d{8,15}$/, 'Use international format, e.g. +919876543210'),
  }),
]);

const createTemplateSchema = z
  .object({
    numberId: z.string().min(1).optional().nullable(),
    name: z
      .string()
      .trim()
      .min(1)
      .max(512)
      .regex(/^[a-z0-9_]+$/, 'Use lowercase letters, digits and underscores only'),
    language: z.string().trim().regex(/^[a-z]{2,3}(_[A-Z]{2})?$/, 'Use a language code such as en, en_US or mr'),
    category: z.enum(TEMPLATE_CATEGORIES),
    headerText: z.string().trim().max(60).optional().nullable(),
    headerFormat: z.enum(MEDIA_HEADER_FORMATS).optional().nullable(),
    headerHandle: z.string().trim().max(2048).optional().nullable(),
    bodyText: z.string().trim().min(1, 'Write the message text').max(1024),
    bodyExamples: z.array(z.string().trim().max(200)).max(10).default([]),
    footerText: z.string().trim().max(60).optional().nullable(),
    buttons: z.array(buttonSchema).max(3).default([]),
  })
  .superRefine((data, ctx) => {
    const problem = bodyProblem(data.bodyText);
    if (problem === 'GAPS') {
      ctx.addIssue({ code: 'custom', path: ['bodyText'], message: 'Number the variables {{1}}, {{2}}, … without skipping any' });
    } else if (problem === 'EDGE') {
      ctx.addIssue({ code: 'custom', path: ['bodyText'], message: 'The text cannot start or end with a variable' });
    }
    const count = parameterCount(data.bodyText);
    if (data.bodyExamples.slice(0, count).filter(Boolean).length < count) {
      ctx.addIssue({ code: 'custom', path: ['bodyExamples'], message: 'Give an example value for every variable' });
    }
    if (data.headerFormat && !data.headerHandle) {
      ctx.addIssue({ code: 'custom', path: ['headerHandle'], message: 'Upload a sample file for the header' });
    }
    if (data.headerText && /\{\{/.test(data.headerText)) {
      ctx.addIssue({ code: 'custom', path: ['headerText'], message: 'The header cannot contain variables' });
    }
  });

/** Submits a template to Meta for review; it stays PENDING until Meta approves it. */
whatsappRouter.post(
  '/templates',
  requirePermission('whatsapp.manage'),
  validate(createTemplateSchema),
  asyncHandler(async (req, res) => {
    const { numberId, ...input } = req.body;
    res.status(201).json({ data: await templates.create(getCurrentUser(req), input, numberId ?? null, req) });
  }),
);

/** Deletes a template; `?id=` limits it to one language, otherwise every language goes. */
whatsappRouter.delete(
  '/templates/:name',
  requirePermission('whatsapp.manage'),
  asyncHandler(async (req, res) => {
    const id = typeof req.query.id === 'string' && req.query.id ? req.query.id : null;
    await templates.remove(getCurrentUser(req), req.params.name, id, optionalNumberId(req), req);
    res.status(204).end();
  }),
);

whatsappRouter.post(
  '/web/connect',
  requirePermission('whatsapp.manage'),
  asyncHandler(async (req, res) => {
    res.json(await channel.connectWeb(getCurrentOrganization(req)));
  }),
);

whatsappRouter.post(
  '/web/reconnect',
  requirePermission('whatsapp.manage'),
  asyncHandler(async (req, res) => {
    res.json(await channel.reconnectWeb(getCurrentOrganization(req)));
  }),
);

whatsappRouter.delete(
  '/web',
  requirePermission('whatsapp.manage'),
  asyncHandler(async (req, res) => {
    res.json(await channel.disconnectWeb(getCurrentUser(req), req));
  }),
);

whatsappRouter.put(
  '/provider',
  requirePermission('whatsapp.manage'),
  validate(z.object({ provider: z.enum(WHATSAPP_PROVIDERS) })),
  asyncHandler(async (req, res) => {
    res.json(await channel.setActiveProvider(getCurrentUser(req), req.body.provider, req));
  }),
);

// ----------------------------- Sending ----------------------------------------

whatsappRouter.post(
  '/send',
  requirePermission('whatsapp.send'),
  validate(
    z.object({ donorId: z.string().min(1), ...contentShape }).refine(hasContent, {
      message: 'Write a message or choose a template',
      path: ['body'],
    }),
  ),
  asyncHandler(async (req, res) => {
    const { donorId, ...content } = req.body;
    res.status(201).json({ data: await messaging.sendToDonor(getCurrentUser(req), donorId, content, req) });
  }),
);

const recipientsShape = { donorIds: z.array(z.string().min(1)).min(1, 'Select at least one donor').max(5000) };

whatsappRouter.post(
  '/broadcasts/preview',
  requirePermission('whatsapp.send'),
  validate(z.object({ ...recipientsShape, ...contentShape })),
  asyncHandler(async (req, res) => {
    const { donorIds, ...content } = req.body;
    res.json(await messaging.previewBroadcast(getCurrentOrganization(req), donorIds, content));
  }),
);

whatsappRouter.post(
  '/broadcasts',
  requirePermission('whatsapp.send'),
  validate(
    z
      .object({ name: z.string().trim().min(2, 'Give this broadcast a name').max(120), ...recipientsShape, ...contentShape })
      .refine(hasContent, { message: 'Write a message or choose a template', path: ['body'] }),
  ),
  asyncHandler(async (req, res) => {
    res.status(201).json({ data: await messaging.createBroadcast(getCurrentUser(req), req.body, req) });
  }),
);

whatsappRouter.get(
  '/broadcasts',
  requirePermission('whatsapp.send'),
  asyncHandler(async (req, res) => {
    res.json({ data: await messaging.listBroadcasts(getCurrentOrganization(req)) });
  }),
);

whatsappRouter.get(
  '/broadcasts/:id',
  requirePermission('whatsapp.send'),
  asyncHandler(async (req, res) => {
    // `?summary=1` skips the per-recipient rows, so a progress bar can poll cheaply.
    const summary = req.query.summary === '1';
    res.json({ data: await messaging.getBroadcast(getCurrentOrganization(req), req.params.id, { summary }) });
  }),
);

whatsappRouter.post(
  '/broadcasts/:id/cancel',
  requirePermission('whatsapp.send'),
  asyncHandler(async (req, res) => {
    res.json({ data: await messaging.cancelBroadcast(getCurrentUser(req), req.params.id) });
  }),
);

const mediaUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: env.maxUploadBytes, files: 1 } });

// ----------------------------- Broadcast wizard -------------------------------

const variableSourceSchema = z.discriminatedUnion('source', [
  z.object({ source: z.literal('static'), value: z.string().max(1024) }),
  z.object({ source: z.literal('donor'), field: z.enum(BROADCAST_DONOR_FIELDS) }),
  z.object({ source: z.literal('column'), column: z.string().trim().min(1).max(120) }),
]);

const campaignShape = {
  templateName: z.string().trim().regex(/^[a-z0-9_]+$/, 'Template names use lowercase letters, digits and underscores'),
  templateLanguage: z.string().trim().min(2).max(10),
  audienceMode: z.enum(campaigns.AUDIENCE_MODES),
  donorIds: z.array(z.string().min(1)).max(campaigns.CAMPAIGN_MAX_RECIPIENTS).optional(),
  recipients: z
    .array(z.object({ donorId: z.string().min(1), row: z.record(z.string().max(200)).optional() }))
    .max(campaigns.CAMPAIGN_MAX_RECIPIENTS)
    .optional(),
  variableMapping: z.record(z.string().regex(/^\d+$/), variableSourceSchema).default({}),
  headerMedia: z
    .object({
      mediaId: z.string().trim().min(1).max(200),
      fileName: z.string().trim().max(200),
      kind: z.enum(['image', 'video', 'document']),
    })
    .nullable()
    .optional(),
};

const hasAudience = (data: { audienceMode: string; donorIds?: unknown[]; recipients?: unknown[] }) =>
  data.audienceMode === 'UPLOAD' ? Boolean(data.recipients?.length) : Boolean(data.donorIds?.length);
const audienceIssue = { message: 'Choose who should receive this broadcast', path: ['donorIds'] };

whatsappRouter.post(
  '/campaigns/preview',
  requirePermission('whatsapp.send'),
  validate(z.object(campaignShape).refine(hasAudience, audienceIssue)),
  asyncHandler(async (req, res) => {
    res.json(await campaigns.previewCampaign(getCurrentOrganization(req), req.body));
  }),
);

whatsappRouter.post(
  '/campaigns',
  requirePermission('whatsapp.send'),
  validate(
    z
      .object({
        name: z.string().trim().min(2, 'Give this broadcast a name').max(120),
        scheduledAt: z.string().datetime().nullable().optional(),
        ...campaignShape,
      })
      .refine(hasAudience, audienceIssue),
  ),
  asyncHandler(async (req, res) => {
    const { scheduledAt, ...input } = req.body;
    const broadcast = await campaigns.createCampaign(
      getCurrentUser(req),
      { ...input, scheduledAt: scheduledAt ? new Date(scheduledAt) : null },
      req,
    );
    res.status(201).json({ data: broadcast });
  }),
);

/** The image, video or PDF a media-header template is sent with. */
whatsappRouter.post(
  '/campaigns/header-media',
  requirePermission('whatsapp.send'),
  mediaUpload.single('file'),
  asyncHandler(async (req, res) => {
    res.status(201).json({ data: await campaigns.uploadHeaderMedia(getCurrentOrganization(req), req.file) });
  }),
);

/** A spreadsheet of phone numbers, matched to donors. */
whatsappRouter.post(
  '/campaigns/recipients',
  requirePermission('whatsapp.send'),
  mediaUpload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw badRequest('Choose a spreadsheet to upload');
    res.json(await campaigns.matchUploadedRecipients(getCurrentOrganization(req), req.file.buffer));
  }),
);

whatsappRouter.get(
  '/campaigns/recipients/template',
  requirePermission('whatsapp.send'),
  asyncHandler(async (req, res) => {
    const variables = Math.min(10, Math.max(0, Number.parseInt(String(req.query.variables ?? '0'), 10) || 0));
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="broadcast-recipients.xlsx"');
    res.send(await buildRecipientTemplate(variables));
  }),
);

/** The sample file a media-header template is submitted to Meta with. */
whatsappRouter.post(
  '/templates/header-sample',
  requirePermission('whatsapp.manage'),
  mediaUpload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw badRequest('Choose a sample file');
    const handle = await templates.uploadHeaderSample(
      getCurrentOrganization(req),
      { buffer: req.file.buffer, mimeType: req.file.mimetype, fileName: req.file.originalname },
      typeof req.body.numberId === 'string' && req.body.numberId ? req.body.numberId : null,
    );
    res.status(201).json({ data: { handle } });
  }),
);

const broadcastMessagesQuery = z.object({
  status: z.enum(['QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'SKIPPED']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

whatsappRouter.get(
  '/broadcasts/:id/messages',
  requirePermission('whatsapp.send'),
  validate(broadcastMessagesQuery, 'query'),
  asyncHandler(async (req, res) => {
    res.json(await messaging.listBroadcastMessages(getCurrentOrganization(req), req.params.id, validated<z.infer<typeof broadcastMessagesQuery>>(req)));
  }),
);

const messagesQuery = z.object({
  donorId: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
});

whatsappRouter.get(
  '/messages',
  requirePermission('whatsapp.send', 'donor.view'),
  validate(messagesQuery, 'query'),
  asyncHandler(async (req, res) => {
    res.json(await messaging.listMessages(getCurrentOrganization(req), validated<z.infer<typeof messagesQuery>>(req)));
  }),
);

// ----------------------------- Inbox -------------------------------------------

/** Conversations are addressed by the contact's number in international digits. */
function phoneOf(value: string) {
  if (!/^\d{8,15}$/.test(value)) throw badRequest('Invalid phone number');
  return value;
}

const conversationsQuery = z.object({
  search: z.string().trim().max(120).optional(),
  filter: z.enum(['all', 'unread', 'donors', 'unknown']).default('all'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
});

whatsappRouter.get(
  '/conversations',
  requirePermission('whatsapp.inbox'),
  validate(conversationsQuery, 'query'),
  asyncHandler(async (req, res) => {
    res.json(await conversations.listConversations(getCurrentOrganization(req), validated<z.infer<typeof conversationsQuery>>(req)));
  }),
);

whatsappRouter.get(
  '/conversations/unread-count',
  requirePermission('whatsapp.inbox'),
  asyncHandler(async (req, res) => {
    res.json(await conversations.unreadCount(getCurrentOrganization(req)));
  }),
);

whatsappRouter.get(
  '/conversations/:phone',
  requirePermission('whatsapp.inbox'),
  asyncHandler(async (req, res) => {
    res.json({ data: await conversations.getConversation(getCurrentOrganization(req), phoneOf(req.params.phone)) });
  }),
);

const threadQuery = z.object({
  before: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

whatsappRouter.get(
  '/conversations/:phone/messages',
  requirePermission('whatsapp.inbox'),
  validate(threadQuery, 'query'),
  asyncHandler(async (req, res) => {
    res.json(await conversations.listThread(getCurrentOrganization(req), phoneOf(req.params.phone), validated<z.infer<typeof threadQuery>>(req)));
  }),
);

whatsappRouter.post(
  '/conversations/:phone/seen',
  requirePermission('whatsapp.inbox'),
  asyncHandler(async (req, res) => {
    res.json(await conversations.markSeen(getCurrentOrganization(req), phoneOf(req.params.phone)));
  }),
);

whatsappRouter.post(
  '/conversations/:phone/messages',
  requirePermission('whatsapp.inbox'),
  validate(
    z.object({ ...contentShape, numberId: z.string().optional().nullable() }).refine(hasContent, {
      message: 'Write a message or choose a template',
      path: ['body'],
    }),
  ),
  asyncHandler(async (req, res) => {
    const message = await conversations.sendInConversation(getCurrentUser(req), phoneOf(req.params.phone), req.body, req);
    res.status(201).json({ data: message });
  }),
);

whatsappRouter.post(
  '/conversations/:phone/media',
  requirePermission('whatsapp.inbox'),
  mediaUpload.single('file'),
  asyncHandler(async (req, res) => {
    const caption = typeof req.body.caption === 'string' ? req.body.caption.trim().slice(0, 1024) : null;
    const numberId = typeof req.body.numberId === 'string' && req.body.numberId ? req.body.numberId : null;
    const message = await conversations.sendMediaInConversation(getCurrentUser(req), phoneOf(req.params.phone), req.file, { caption, numberId }, req);
    res.status(201).json({ data: message });
  }),
);

/**
 * A message's photo or file. Images are shown inline; anything else is always a
 * download, since inbound files from Meta are not limited to safe types.
 */
whatsappRouter.get(
  '/messages/:id/media',
  requirePermission('whatsapp.inbox', 'whatsapp.send'),
  asyncHandler(async (req, res) => {
    const file = await readMessageMedia(getCurrentOrganization(req), req.params.id);
    // Photos, voice notes and videos play in the chat; everything else downloads.
    const mimeType = file.mimeType.split(';')[0].trim().toLowerCase();
    const inline = /^(image\/(jpeg|png|webp)|audio\/(ogg|mpeg|mp4|aac|amr)|video\/(mp4|3gpp))$/.test(mimeType);
    res.setHeader('Content-Type', inline ? mimeType : 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const asciiName = file.fileName.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '');
    res.setHeader(
      'Content-Disposition',
      `${inline ? 'inline' : 'attachment'}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
    );
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(file.buffer);
  }),
);

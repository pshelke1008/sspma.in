import { Router } from 'express';
import { z } from 'zod';
import { WHATSAPP_PROVIDERS } from '@ashram/types';
import { asyncHandler } from '../../lib/http';
import { validate, validated } from '../../middleware/validate';
import { getCurrentOrganization, getCurrentUser, requirePermission } from '../../middleware/auth';
import * as channel from './channel.service';
import * as messaging from './messaging.service';

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
  requirePermission('whatsapp.send', 'whatsapp.manage'),
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

whatsappRouter.delete(
  '/cloud',
  requirePermission('whatsapp.manage'),
  asyncHandler(async (req, res) => {
    res.json(await channel.disconnectCloud(getCurrentUser(req), req));
  }),
);

whatsappRouter.get(
  '/cloud/templates',
  requirePermission('whatsapp.send'),
  asyncHandler(async (req, res) => {
    res.json({ data: await channel.listTemplates(getCurrentOrganization(req)) });
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

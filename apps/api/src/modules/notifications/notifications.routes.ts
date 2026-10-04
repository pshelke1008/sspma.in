import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db';
import { asyncHandler } from '../../lib/http';
import { validate, validated } from '../../middleware/validate';
import { getCurrentUser } from '../../middleware/auth';
import { notFound } from '../../lib/errors';

export const notificationsRouter = Router();

const querySchema = z.object({
  unreadOnly: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

notificationsRouter.get(
  '/',
  validate(querySchema, 'query'),
  asyncHandler(async (req, res) => {
    const auth = getCurrentUser(req);
    const query = validated<z.infer<typeof querySchema>>(req);

    const where = {
      organizationId: auth.organizationId,
      userId: auth.userId,
      ...(query.unreadOnly ? { isRead: false } : {}),
    };

    const [data, unreadCount] = await Promise.all([
      prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, take: query.limit }),
      prisma.notification.count({
        where: { organizationId: auth.organizationId, userId: auth.userId, isRead: false },
      }),
    ]);

    res.json({ data, unreadCount });
  }),
);

notificationsRouter.post(
  '/:id/read',
  asyncHandler(async (req, res) => {
    const auth = getCurrentUser(req);
    const existing = await prisma.notification.findFirst({
      where: { id: req.params.id, organizationId: auth.organizationId, userId: auth.userId },
    });
    if (!existing) throw notFound('Notification not found');

    await prisma.notification.update({
      where: { id: existing.id },
      data: { isRead: true, readAt: new Date() },
    });
    res.json({ success: true });
  }),
);

notificationsRouter.post(
  '/read-all',
  asyncHandler(async (req, res) => {
    const auth = getCurrentUser(req);
    const result = await prisma.notification.updateMany({
      where: { organizationId: auth.organizationId, userId: auth.userId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
    res.json({ success: true, updated: result.count });
  }),
);

import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../db';
import { asyncHandler, paginated } from '../../lib/http';
import { validate, validated } from '../../middleware/validate';
import { getCurrentOrganization, requirePermission } from '../../middleware/auth';

export const auditRouter = Router();

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  action: z.string().trim().optional(),
  entityType: z.string().trim().optional(),
  userId: z.string().trim().optional(),
  search: z.string().trim().max(120).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

auditRouter.get(
  '/',
  requirePermission('audit.view'),
  validate(querySchema, 'query'),
  asyncHandler(async (req, res) => {
    const organizationId = getCurrentOrganization(req);
    const query = validated<z.infer<typeof querySchema>>(req);

    const where: Prisma.AuditLogWhereInput = {
      organizationId,
      ...(query.action ? { action: query.action } : {}),
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.userId ? { userId: query.userId } : {}),
      ...(query.from || query.to
        ? { timestamp: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } }
        : {}),
      ...(query.search
        ? {
            OR: [
              { entityLabel: { contains: query.search, mode: 'insensitive' } },
              { action: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [rows, total, actions] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { user: { select: { id: true, name: true, designation: true } } },
      }),
      prisma.auditLog.count({ where }),
      prisma.auditLog.groupBy({ by: ['action'], where: { organizationId }, _count: { _all: true } }),
    ]);

    res.json({
      ...paginated(rows, total, query.page, query.pageSize),
      actions: actions.map((a) => ({ action: a.action, count: a._count._all })).sort((a, b) => a.action.localeCompare(b.action)),
    });
  }),
);

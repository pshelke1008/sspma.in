import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../db';
import { asyncHandler } from '../../lib/http';
import { toNumber, round2 } from '../../lib/money';
import { validate, validated } from '../../middleware/validate';
import { getCurrentOrganization, getCurrentUser, requirePermission } from '../../middleware/auth';

export const approvalsRouter = Router();

const querySchema = z.object({
  tab: z.enum(['pending', 'approved', 'rejected', 'all']).default('pending'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(120).optional(),
  departmentId: z.string().optional(),
});

type ApprovalQuery = z.infer<typeof querySchema>;

const statusByTab: Record<ApprovalQuery['tab'], Prisma.ExpenseWhereInput> = {
  pending: { status: 'PENDING_APPROVAL' },
  approved: { status: { in: ['APPROVED', 'PAYMENT_PENDING', 'PAID', 'ACCOUNTING_POSTED'] } },
  rejected: { status: 'REJECTED' },
  all: { status: { in: ['PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'PAYMENT_PENDING', 'PAID', 'ACCOUNTING_POSTED'] } },
};

approvalsRouter.get(
  '/',
  requirePermission('expense.approve', 'expense.view'),
  validate(querySchema, 'query'),
  asyncHandler(async (req, res) => {
    const organizationId = getCurrentOrganization(req);
    const auth = getCurrentUser(req);
    const query = validated<ApprovalQuery>(req);

    const where: Prisma.ExpenseWhereInput = {
      organizationId,
      ...statusByTab[query.tab],
      ...(query.departmentId ? { departmentId: query.departmentId } : {}),
      ...(query.search
        ? {
            OR: [
              { expenseNumber: { contains: query.search, mode: 'insensitive' } },
              { title: { contains: query.search, mode: 'insensitive' } },
              { supplier: { name: { contains: query.search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const [rows, total, counts] = await Promise.all([
      prisma.expense.findMany({
        where,
        orderBy: query.tab === 'pending' ? { submittedAt: 'asc' } : { updatedAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          expenseNumber: true,
          title: true,
          date: true,
          total: true,
          status: true,
          submittedAt: true,
          approvedAt: true,
          rejectionReason: true,
          createdById: true,
          onBehalfOfId: true,
          onBehalfOf: { select: { id: true, name: true, designation: true } },
          department: { select: { id: true, name: true } },
          fund: { select: { id: true, name: true } },
          category: { select: { id: true, name: true } },
          supplier: { select: { id: true, name: true } },
          createdBy: { select: { id: true, name: true, designation: true } },
          approvedBy: { select: { id: true, name: true } },
        },
      }),
      prisma.expense.count({ where }),
      prisma.expense.groupBy({
        by: ['status'],
        where: { organizationId },
        _count: { _all: true },
      }),
    ]);

    const countFor = (statuses: string[]) =>
      counts.filter((c) => statuses.includes(c.status)).reduce((sum, c) => sum + c._count._all, 0);

    // Budget headroom shown on each approval card.
    const departmentIds = Array.from(new Set(rows.map((row) => row.department.id)));
    const [departments, spendByDept] = await Promise.all([
      prisma.department.findMany({ where: { organizationId, id: { in: departmentIds } } }),
      prisma.expense.groupBy({
        by: ['departmentId'],
        where: {
          organizationId,
          departmentId: { in: departmentIds },
          status: { in: ['APPROVED', 'PAYMENT_PENDING', 'PAID', 'ACCOUNTING_POSTED'] },
        },
        _sum: { total: true },
      }),
    ]);
    const budgets = new Map(departments.map((d) => [d.id, toNumber(d.budgetAmount)]));
    const spent = new Map(spendByDept.map((row) => [row.departmentId, toNumber(row._sum.total)]));

    res.json({
      data: rows.map((row) => ({
        ...row,
        total: toNumber(row.total),
        isOwnRequest: row.createdById === auth.userId || row.onBehalfOfId === auth.userId,
        canAct:
          row.status === 'PENDING_APPROVAL' &&
          auth.permissions.has('expense.approve') &&
          (auth.permissions.has('expense.approve_own') ||
            (row.createdById !== auth.userId && row.onBehalfOfId !== auth.userId)),
        budget: {
          allocated: budgets.get(row.department.id) ?? 0,
          spent: spent.get(row.department.id) ?? 0,
          remaining: round2((budgets.get(row.department.id) ?? 0) - (spent.get(row.department.id) ?? 0)),
        },
      })),
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      },
      counts: {
        pending: countFor(['PENDING_APPROVAL']),
        approved: countFor(['APPROVED', 'PAYMENT_PENDING', 'PAID', 'ACCOUNTING_POSTED']),
        rejected: countFor(['REJECTED']),
        all: countFor([
          'PENDING_APPROVAL',
          'APPROVED',
          'REJECTED',
          'PAYMENT_PENDING',
          'PAID',
          'ACCOUNTING_POSTED',
        ]),
      },
    });
  }),
);

/** Badge count for the sidebar. */
approvalsRouter.get(
  '/count',
  asyncHandler(async (req, res) => {
    const organizationId = getCurrentOrganization(req);
    const auth = getCurrentUser(req);
    if (!auth.permissions.has('expense.approve')) return res.json({ count: 0 });

    // The badge counts what this user can actually act on.
    const count = await prisma.expense.count({
      where: {
        organizationId,
        status: 'PENDING_APPROVAL',
        ...(auth.permissions.has('expense.approve_own')
          ? {}
          : {
              createdById: { not: auth.userId },
              OR: [{ onBehalfOfId: null }, { onBehalfOfId: { not: auth.userId } }],
            }),
      },
    });
    res.json({ count });
  }),
);

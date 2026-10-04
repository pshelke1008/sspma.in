import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { PURCHASE_STATUSES, UNITS } from '@ashram/types';
import { prisma } from '../../db';
import { asyncHandler } from '../../lib/http';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { computeTotals, decimal, toNumber } from '../../lib/money';
import { nextNumber } from '../../lib/sequence';
import { AUDIT_ACTIONS, recordAudit } from '../../lib/audit';
import { validate, validated } from '../../middleware/validate';
import { getCurrentOrganization, getCurrentUser, requirePermission } from '../../middleware/auth';
import { assertOwned } from '../../lib/ownership';

export const purchasesRouter = Router();

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(120).optional(),
  status: z.enum(PURCHASE_STATUSES).optional(),
  supplierId: z.string().optional(),
});

const itemSchema = z.object({
  description: z.string().trim().min(1, 'Description is required').max(300),
  quantity: z.coerce.number().gt(0, 'Quantity must be greater than zero'),
  unit: z.enum(UNITS).default('NOS'),
  rate: z.coerce.number().min(0),
  taxRate: z.coerce.number().min(0).max(100).default(0),
});

const createSchema = z.object({
  date: z.coerce.date(),
  expectedDate: z.coerce.date().optional().nullable(),
  supplierId: z.string().min(1, 'Select a supplier'),
  departmentId: z.string().min(1, 'Select a department'),
  fundId: z.string().min(1, 'Select a fund'),
  categoryId: z.string().optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
  items: z.array(itemSchema).min(1, 'Add at least one line item'),
});

purchasesRouter.get(
  '/',
  requirePermission('purchase.view'),
  validate(listQuery, 'query'),
  asyncHandler(async (req, res) => {
    const organizationId = getCurrentOrganization(req);
    const query = validated<z.infer<typeof listQuery>>(req);

    const where: Prisma.PurchaseOrderWhereInput = {
      organizationId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.supplierId ? { supplierId: query.supplierId } : {}),
      ...(query.search
        ? {
            OR: [
              { orderNumber: { contains: query.search, mode: 'insensitive' } },
              { supplier: { name: { contains: query.search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const [rows, total, agg] = await Promise.all([
      prisma.purchaseOrder.findMany({
        where,
        orderBy: { date: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          supplier: { select: { id: true, name: true } },
          department: { select: { id: true, name: true } },
          fund: { select: { id: true, name: true } },
          _count: { select: { items: true } },
        },
      }),
      prisma.purchaseOrder.count({ where }),
      prisma.purchaseOrder.aggregate({ where, _sum: { total: true } }),
    ]);

    res.json({
      data: rows.map((row) => ({ ...row, total: toNumber(row.total), subtotal: toNumber(row.subtotal), tax: toNumber(row.tax) })),
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
        totalAmount: toNumber(agg._sum.total),
      },
    });
  }),
);

purchasesRouter.get(
  '/:id',
  requirePermission('purchase.view'),
  asyncHandler(async (req, res) => {
    const organizationId = getCurrentOrganization(req);
    const order = await prisma.purchaseOrder.findFirst({
      where: { id: req.params.id, organizationId },
      include: {
        supplier: true,
        department: true,
        fund: true,
        category: true,
        createdBy: { select: { id: true, name: true } },
        items: { orderBy: { sortOrder: 'asc' } },
      },
    });
    if (!order) throw notFound('Purchase order not found');

    res.json({
      data: {
        ...order,
        subtotal: toNumber(order.subtotal),
        tax: toNumber(order.tax),
        total: toNumber(order.total),
        items: order.items.map((item) => ({
          ...item,
          quantity: toNumber(item.quantity),
          rate: toNumber(item.rate),
          taxRate: toNumber(item.taxRate),
          amount: toNumber(item.amount),
        })),
      },
    });
  }),
);

purchasesRouter.post(
  '/',
  requirePermission('purchase.create'),
  validate(createSchema),
  asyncHandler(async (req, res) => {
    const auth = getCurrentUser(req);
    const body = req.body as z.infer<typeof createSchema>;

    const order = await prisma.$transaction(async (tx) => {
      const [supplier, department, fund] = await Promise.all([
        tx.supplier.findFirst({ where: { id: body.supplierId, organizationId: auth.organizationId } }),
        tx.department.findFirst({ where: { id: body.departmentId, organizationId: auth.organizationId } }),
        tx.fund.findFirst({ where: { id: body.fundId, organizationId: auth.organizationId } }),
      ]);
      if (!supplier) throw badRequest('Selected supplier is not available in this organization');
      if (!department) throw badRequest('Selected department is not available in this organization');
      if (!fund) throw badRequest('Selected fund is not available in this organization');
      await assertOwned(auth.organizationId, { expenseCategory: body.categoryId }, tx);

      const totals = computeTotals(body.items);
      const orderNumber = await nextNumber(tx, auth.organizationId, 'PURCHASE', body.date);

      return tx.purchaseOrder.create({
        data: {
          organizationId: auth.organizationId,
          orderNumber,
          date: body.date,
          expectedDate: body.expectedDate || null,
          supplierId: body.supplierId,
          departmentId: body.departmentId,
          fundId: body.fundId,
          categoryId: body.categoryId || null,
          subtotal: decimal(totals.subtotal),
          tax: decimal(totals.tax),
          total: decimal(totals.total),
          status: 'DRAFT',
          notes: body.notes || null,
          createdById: auth.userId,
          items: {
            create: body.items.map((item, index) => ({
              description: item.description,
              quantity: item.quantity,
              unit: item.unit,
              rate: decimal(item.rate),
              taxRate: item.taxRate,
              amount: decimal(totals.lines[index].amount),
              sortOrder: index,
            })),
          },
        },
        include: { supplier: true, items: true },
      });
    });

    await recordAudit({
      organizationId: auth.organizationId,
      userId: auth.userId,
      action: AUDIT_ACTIONS.PURCHASE_CREATED,
      entityType: 'PurchaseOrder',
      entityId: order.id,
      entityLabel: order.orderNumber,
      newValue: { supplier: order.supplier.name, total: toNumber(order.total) },
      req,
    });

    res.status(201).json({ data: { ...order, total: toNumber(order.total) } });
  }),
);

const statusSchema = z.object({ status: z.enum(PURCHASE_STATUSES) });

const PURCHASE_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ['ORDERED', 'CANCELLED'],
  ORDERED: ['PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'],
  PARTIALLY_RECEIVED: ['RECEIVED', 'CANCELLED'],
  RECEIVED: [],
  CANCELLED: [],
};

purchasesRouter.post(
  '/:id/status',
  requirePermission('purchase.create'),
  validate(statusSchema),
  asyncHandler(async (req, res) => {
    const auth = getCurrentUser(req);
    const order = await prisma.purchaseOrder.findFirst({
      where: { id: req.params.id, organizationId: auth.organizationId },
    });
    if (!order) throw notFound('Purchase order not found');

    const target = req.body.status as string;
    if (!(PURCHASE_TRANSITIONS[order.status] ?? []).includes(target)) {
      throw conflict(`A ${order.status} purchase order cannot move to ${target}.`);
    }

    const updated = await prisma.purchaseOrder.update({ where: { id: order.id }, data: { status: target as never } });

    await recordAudit({
      organizationId: auth.organizationId,
      userId: auth.userId,
      action: 'purchase.status_changed',
      entityType: 'PurchaseOrder',
      entityId: order.id,
      entityLabel: order.orderNumber,
      oldValue: { status: order.status },
      newValue: { status: target },
      req,
    });

    res.json({ data: { ...updated, total: toNumber(updated.total) } });
  }),
);

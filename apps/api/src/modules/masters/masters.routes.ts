import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db';
import { asyncHandler } from '../../lib/http';
import { toNumber } from '../../lib/money';
import { AUDIT_ACTIONS, recordAudit } from '../../lib/audit';
import { validate } from '../../middleware/validate';
import { getCurrentOrganization, getCurrentUser, requirePermission } from '../../middleware/auth';
import { notFound } from '../../lib/errors';

export const mastersRouter = Router();

/**
 * One call that fills every dropdown in the app. Always scoped to the caller's
 * organization, so a tenant can only ever select its own masters.
 */
mastersRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const organizationId = getCurrentOrganization(req);
    const where = { organizationId, isActive: true };

    const [departments, funds, costCenters, categories, suppliers, bankAccounts, donors, financialYears, accounts] =
      await Promise.all([
        prisma.department.findMany({ where, orderBy: { name: 'asc' } }),
        prisma.fund.findMany({ where, orderBy: { name: 'asc' } }),
        prisma.costCenter.findMany({ where, orderBy: { name: 'asc' } }),
        prisma.expenseCategory.findMany({ where, orderBy: { name: 'asc' } }),
        prisma.supplier.findMany({ where, orderBy: { name: 'asc' } }),
        prisma.bankAccount.findMany({ where, orderBy: { name: 'asc' } }),
        // Every signed-in user loads masters, so donors expose only what a picker needs —
        // contact details, PAN and notes stay behind donor.view.
        prisma.donor.findMany({ where, orderBy: { name: 'asc' }, select: { id: true, name: true, code: true } }),
        prisma.financialYear.findMany({ where: { organizationId }, orderBy: { startDate: 'desc' } }),
        prisma.account.findMany({ where: { organizationId, isActive: true }, orderBy: { code: 'asc' } }),
      ]);

    res.json({
      departments: departments.map((d) => ({ ...d, budgetAmount: toNumber(d.budgetAmount) })),
      funds: funds.map((f) => ({ ...f, openingBalance: toNumber(f.openingBalance) })),
      costCenters,
      categories,
      suppliers: suppliers.map((v) => ({ ...v, openingBalance: toNumber(v.openingBalance) })),
      bankAccounts: bankAccounts.map((b) => ({ ...b, openingBalance: toNumber(b.openingBalance) })),
      donors,
      financialYears,
      accounts: accounts.map((a) => ({ ...a, openingBalance: toNumber(a.openingBalance) })),
    });
  }),
);

const supplierSchema = z.object({
  name: z.string().trim().min(2, 'Supplier name is required').max(160),
  contactPerson: z.string().trim().max(120).optional().nullable(),
  email: z.string().trim().email('Enter a valid email').optional().nullable().or(z.literal('')),
  phone: z.string().trim().max(20).optional().nullable(),
  gstin: z
    .string()
    .trim()
    .regex(/^[0-9A-Z]{15}$/, 'GSTIN must be 15 characters')
    .optional()
    .nullable()
    .or(z.literal('')),
  panNumber: z
    .string()
    .trim()
    .regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, 'Enter a valid PAN')
    .optional()
    .nullable()
    .or(z.literal('')),
  addressLine1: z.string().trim().max(200).optional().nullable(),
  city: z.string().trim().max(80).optional().nullable(),
  state: z.string().trim().max(80).optional().nullable(),
  postalCode: z.string().trim().max(12).optional().nullable(),
});

function slugCode(prefix: string, name: string) {
  const base = name
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6);
  return `${prefix}-${base || 'X'}-${Date.now().toString().slice(-5)}`;
}

function blankToNull<T extends Record<string, unknown>>(input: T): T {
  const out = { ...input };
  for (const key of Object.keys(out)) {
    if (out[key] === '') (out as Record<string, unknown>)[key] = null;
  }
  return out;
}

mastersRouter.get(
  '/suppliers',
  requirePermission('expense.view'),
  asyncHandler(async (req, res) => {
    const organizationId = getCurrentOrganization(req);
    const search = String(req.query.search ?? '').trim();
    const suppliers = await prisma.supplier.findMany({
      where: {
        organizationId,
        ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
      },
      orderBy: { name: 'asc' },
      take: 100,
    });
    res.json({ data: suppliers.map((v) => ({ ...v, openingBalance: toNumber(v.openingBalance) })) });
  }),
);

mastersRouter.post(
  '/suppliers',
  requirePermission('expense.create'),
  validate(supplierSchema),
  asyncHandler(async (req, res) => {
    const auth = getCurrentUser(req);
    const payload = blankToNull(req.body);
    const supplier = await prisma.supplier.create({
      data: {
        organizationId: auth.organizationId,
        code: slugCode('SUP', payload.name),
        ...payload,
      },
    });
    await recordAudit({
      organizationId: auth.organizationId,
      userId: auth.userId,
      action: AUDIT_ACTIONS.SUPPLIER_CREATED,
      entityType: 'Supplier',
      entityId: supplier.id,
      entityLabel: supplier.name,
      newValue: { name: supplier.name },
      req,
    });
    res.status(201).json({ data: { ...supplier, openingBalance: toNumber(supplier.openingBalance) } });
  }),
);

mastersRouter.put(
  '/suppliers/:id',
  requirePermission('expense.edit'),
  validate(supplierSchema),
  asyncHandler(async (req, res) => {
    const auth = getCurrentUser(req);
    const existing = await prisma.supplier.findFirst({
      where: { id: req.params.id, organizationId: auth.organizationId },
    });
    if (!existing) throw notFound('Supplier not found');

    const supplier = await prisma.supplier.update({ where: { id: existing.id }, data: blankToNull(req.body) });
    await recordAudit({
      organizationId: auth.organizationId,
      userId: auth.userId,
      action: AUDIT_ACTIONS.SUPPLIER_UPDATED,
      entityType: 'Supplier',
      entityId: supplier.id,
      entityLabel: supplier.name,
      oldValue: { name: existing.name, phone: existing.phone },
      newValue: { name: supplier.name, phone: supplier.phone },
      req,
    });
    res.json({ data: { ...supplier, openingBalance: toNumber(supplier.openingBalance) } });
  }),
);

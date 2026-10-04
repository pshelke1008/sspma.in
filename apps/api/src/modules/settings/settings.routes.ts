import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db';
import { asyncHandler } from '../../lib/http';
import { toNumber } from '../../lib/money';
import { AUDIT_ACTIONS, recordAudit } from '../../lib/audit';
import { validate } from '../../middleware/validate';
import { getCurrentOrganization, getCurrentUser, requirePermission } from '../../middleware/auth';
import { conflict, notFound } from '../../lib/errors';
import { assertOwned } from '../../lib/ownership';
import { publicDonor } from '../donors/donor.service';

export const settingsRouter = Router();

settingsRouter.get(
  '/',
  requirePermission('settings.view'),
  asyncHandler(async (req, res) => {
    const organizationId = getCurrentOrganization(req);

    const [organization, financialYears, accounts, preferences, counts] = await Promise.all([
      prisma.organization.findUniqueOrThrow({ where: { id: organizationId } }),
      prisma.financialYear.findMany({ where: { organizationId }, orderBy: { startDate: 'desc' } }),
      prisma.account.findMany({ where: { organizationId }, orderBy: { code: 'asc' } }),
      prisma.orgSetting.findMany({ where: { organizationId } }),
      Promise.all([
        prisma.user.count({ where: { organizationId, isActive: true } }),
        prisma.role.count({ where: { organizationId } }),
        prisma.auditLog.count({ where: { organizationId } }),
        prisma.expense.count({ where: { organizationId } }),
      ]),
    ]);

    res.json({
      organization,
      financialYears,
      accounts: accounts.map((a) => ({ ...a, openingBalance: toNumber(a.openingBalance) })),
      preferences: Object.fromEntries(preferences.map((p) => [p.key, p.value])),
      counts: { users: counts[0], roles: counts[1], auditLogs: counts[2], expenses: counts[3] },
    });
  }),
);

const organizationSchema = z.object({
  name: z.string().trim().min(2, 'Organization name is required').max(160),
  legalName: z.string().trim().max(200).optional().nullable(),
  registrationNo: z.string().trim().max(80).optional().nullable(),
  panNumber: z.string().trim().max(10).optional().nullable(),
  email: z.string().trim().email('Enter a valid email').optional().nullable().or(z.literal('')),
  phone: z.string().trim().max(20).optional().nullable(),
  website: z.string().trim().max(200).optional().nullable(),
  addressLine1: z.string().trim().max(200).optional().nullable(),
  addressLine2: z.string().trim().max(200).optional().nullable(),
  city: z.string().trim().max(80).optional().nullable(),
  state: z.string().trim().max(80).optional().nullable(),
  postalCode: z.string().trim().max(12).optional().nullable(),
  country: z.string().trim().max(80).optional(),
  tagline: z.string().trim().max(160).optional().nullable(),
});

settingsRouter.put(
  '/organization',
  requirePermission('settings.manage'),
  validate(organizationSchema),
  asyncHandler(async (req, res) => {
    const auth = getCurrentUser(req);
    const before = await prisma.organization.findUniqueOrThrow({ where: { id: auth.organizationId } });

    const payload = Object.fromEntries(
      Object.entries(req.body).map(([key, value]) => [key, value === '' ? null : value]),
    );

    const organization = await prisma.organization.update({
      where: { id: auth.organizationId },
      data: payload as never,
    });

    await recordAudit({
      organizationId: auth.organizationId,
      userId: auth.userId,
      action: AUDIT_ACTIONS.SETTINGS_CHANGED,
      entityType: 'Organization',
      entityId: organization.id,
      entityLabel: organization.name,
      oldValue: { name: before.name, email: before.email, phone: before.phone },
      newValue: { name: organization.name, email: organization.email, phone: organization.phone },
      req,
    });

    res.json({ data: organization });
  }),
);

const financialYearSchema = z.object({
  label: z.string().trim().regex(/^\d{4}-\d{4}$/, 'Use the format 2026-2027'),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  isActive: z.boolean().default(false),
});

settingsRouter.post(
  '/financial-years',
  requirePermission('settings.manage'),
  validate(financialYearSchema),
  asyncHandler(async (req, res) => {
    const auth = getCurrentUser(req);
    const body = req.body as z.infer<typeof financialYearSchema>;
    if (body.endDate <= body.startDate) throw conflict('The end date must be after the start date');

    const year = await prisma.$transaction(async (tx) => {
      if (body.isActive) {
        await tx.financialYear.updateMany({
          where: { organizationId: auth.organizationId },
          data: { isActive: false },
        });
      }
      return tx.financialYear.create({ data: { organizationId: auth.organizationId, ...body } });
    });

    await recordAudit({
      organizationId: auth.organizationId,
      userId: auth.userId,
      action: AUDIT_ACTIONS.SETTINGS_CHANGED,
      entityType: 'FinancialYear',
      entityId: year.id,
      entityLabel: year.label,
      newValue: { label: year.label, isActive: year.isActive },
      req,
    });

    res.status(201).json({ data: year });
  }),
);

settingsRouter.post(
  '/financial-years/:id/activate',
  requirePermission('settings.manage'),
  asyncHandler(async (req, res) => {
    const auth = getCurrentUser(req);
    const year = await prisma.financialYear.findFirst({
      where: { id: req.params.id, organizationId: auth.organizationId },
    });
    if (!year) throw notFound('Financial year not found');

    await prisma.$transaction([
      prisma.financialYear.updateMany({ where: { organizationId: auth.organizationId }, data: { isActive: false } }),
      prisma.financialYear.update({ where: { id: year.id }, data: { isActive: true } }),
    ]);

    await recordAudit({
      organizationId: auth.organizationId,
      userId: auth.userId,
      action: AUDIT_ACTIONS.SETTINGS_CHANGED,
      entityType: 'FinancialYear',
      entityId: year.id,
      entityLabel: year.label,
      newValue: { isActive: true },
      req,
    });

    res.json({ success: true });
  }),
);

const accountSchema = z.object({
  code: z.string().trim().regex(/^\d{3,6}$/, 'Account code must be 3–6 digits'),
  name: z.string().trim().min(2, 'Account name is required').max(160),
  type: z.enum(['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE']),
  parentId: z.string().optional().nullable(),
  openingBalance: z.coerce.number().default(0),
  isBankAccount: z.boolean().default(false),
});

settingsRouter.post(
  '/accounts',
  requirePermission('settings.manage'),
  validate(accountSchema),
  asyncHandler(async (req, res) => {
    const auth = getCurrentUser(req);
    await assertOwned(auth.organizationId, { account: req.body.parentId });
    const account = await prisma.account.create({
      data: { organizationId: auth.organizationId, ...req.body, parentId: req.body.parentId || null },
    });

    await recordAudit({
      organizationId: auth.organizationId,
      userId: auth.userId,
      action: AUDIT_ACTIONS.SETTINGS_CHANGED,
      entityType: 'Account',
      entityId: account.id,
      entityLabel: `${account.code} ${account.name}`,
      newValue: { code: account.code, name: account.name, type: account.type },
      req,
    });

    res.status(201).json({ data: { ...account, openingBalance: toNumber(account.openingBalance) } });
  }),
);

const preferenceSchema = z.object({
  key: z.string().trim().min(1).max(64),
  value: z.any(),
});

settingsRouter.put(
  '/preferences',
  requirePermission('settings.manage'),
  validate(preferenceSchema),
  asyncHandler(async (req, res) => {
    const auth = getCurrentUser(req);
    const { key, value } = req.body as z.infer<typeof preferenceSchema>;

    const setting = await prisma.orgSetting.upsert({
      where: { organizationId_key: { organizationId: auth.organizationId, key } },
      create: { organizationId: auth.organizationId, key, value },
      update: { value },
    });

    await recordAudit({
      organizationId: auth.organizationId,
      userId: auth.userId,
      action: AUDIT_ACTIONS.SETTINGS_CHANGED,
      entityType: 'OrgSetting',
      entityId: setting.id,
      entityLabel: key,
      newValue: { key, value },
      req,
    });

    res.json({ data: setting });
  }),
);

/** A full JSON export of the tenant's own data — never another tenant's. */
settingsRouter.get(
  '/backup',
  requirePermission('settings.manage'),
  asyncHandler(async (req, res) => {
    const organizationId = getCurrentOrganization(req);
    const auth = getCurrentUser(req);

    const [organization, departments, funds, costCenters, categories, suppliers, donors, accounts, bankAccounts, expenses, donations, incomeEntries, payments, transactions] =
      await Promise.all([
        prisma.organization.findUniqueOrThrow({ where: { id: organizationId } }),
        prisma.department.findMany({ where: { organizationId } }),
        prisma.fund.findMany({ where: { organizationId } }),
        prisma.costCenter.findMany({ where: { organizationId } }),
        prisma.expenseCategory.findMany({ where: { organizationId } }),
        prisma.supplier.findMany({ where: { organizationId } }),
        // Aadhaar numbers leave the server masked, backups included.
        prisma.donor.findMany({ where: { organizationId } }).then((rows) => rows.map(publicDonor)),
        prisma.account.findMany({ where: { organizationId } }),
        prisma.bankAccount.findMany({ where: { organizationId } }),
        prisma.expense.findMany({ where: { organizationId }, include: { items: true } }),
        prisma.donation.findMany({ where: { organizationId } }),
        prisma.incomeEntry.findMany({ where: { organizationId } }),
        prisma.payment.findMany({ where: { organizationId } }),
        prisma.transaction.findMany({ where: { organizationId }, include: { lines: true } }),
      ]);

    await recordAudit({
      organizationId,
      userId: auth.userId,
      action: 'settings.backup_exported',
      entityType: 'Organization',
      entityId: organizationId,
      entityLabel: organization.name,
      req,
    });

    res.setHeader('Content-Type', 'application/json');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="ashram-management-backup-${organization.slug}-${new Date().toISOString().slice(0, 10)}.json"`,
    );
    res.send(
      JSON.stringify(
        {
          exportedAt: new Date().toISOString(),
          organization,
          masters: { departments, funds, costCenters, categories, suppliers, donors, accounts, bankAccounts },
          records: { expenses, donations, incomeEntries, payments, transactions },
        },
        null,
        2,
      ),
    );
  }),
);

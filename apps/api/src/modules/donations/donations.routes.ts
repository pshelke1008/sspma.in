import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { DONATION_MODES } from '@ashram/types';
import { prisma } from '../../db';
import { asyncHandler } from '../../lib/http';
import { badRequest } from '../../lib/errors';
import { decimal, toNumber, round2 } from '../../lib/money';
import { nextNumber } from '../../lib/sequence';
import { AUDIT_ACTIONS, recordAudit } from '../../lib/audit';
import { accountByCode, postJournal, SYSTEM_ACCOUNTS } from '../../lib/accounting';
import { validate, validated } from '../../middleware/validate';
import { getCurrentOrganization, getCurrentUser, requirePermission } from '../../middleware/auth';

export const donationsRouter = Router();

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(120).optional(),
  fundId: z.string().optional(),
  mode: z.enum(DONATION_MODES).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

const createSchema = z.object({
  date: z.coerce.date().refine((d) => d.getTime() <= Date.now() + 86_400_000, 'Date cannot be in the future'),
  donorId: z.string().optional().nullable(),
  donorName: z.string().trim().min(2, 'Donor name is required').max(160),
  amount: z.coerce.number().gt(0, 'Amount must be greater than zero'),
  mode: z.enum(DONATION_MODES).default('CASH'),
  fundId: z.string().min(1, 'Select a fund'),
  departmentId: z.string().optional().nullable(),
  bankAccountId: z.string().optional().nullable(),
  purpose: z.string().trim().max(300).optional().nullable(),
  referenceNumber: z.string().trim().max(80).optional().nullable(),
  is80GEligible: z.boolean().default(true),
  notes: z.string().trim().max(1000).optional().nullable(),
});

donationsRouter.get(
  '/',
  requirePermission('donation.view'),
  validate(listQuery, 'query'),
  asyncHandler(async (req, res) => {
    const organizationId = getCurrentOrganization(req);
    const query = validated<z.infer<typeof listQuery>>(req);

    const where: Prisma.DonationWhereInput = {
      organizationId,
      ...(query.fundId ? { fundId: query.fundId } : {}),
      ...(query.mode ? { mode: query.mode } : {}),
      ...(query.from || query.to
        ? { date: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } }
        : {}),
      ...(query.search
        ? {
            OR: [
              { receiptNumber: { contains: query.search, mode: 'insensitive' } },
              { donorName: { contains: query.search, mode: 'insensitive' } },
              { purpose: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [rows, total, agg] = await Promise.all([
      prisma.donation.findMany({
        where,
        orderBy: { date: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          fund: { select: { id: true, name: true } },
          department: { select: { id: true, name: true } },
          donor: { select: { id: true, name: true } },
          bankAccount: { select: { id: true, name: true } },
        },
      }),
      prisma.donation.count({ where }),
      prisma.donation.aggregate({ where, _sum: { amount: true } }),
    ]);

    res.json({
      data: rows.map((row) => ({ ...row, amount: toNumber(row.amount) })),
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
        totalAmount: toNumber(agg._sum.amount),
      },
    });
  }),
);

donationsRouter.post(
  '/',
  requirePermission('donation.create'),
  validate(createSchema),
  asyncHandler(async (req, res) => {
    const auth = getCurrentUser(req);
    const body = req.body as z.infer<typeof createSchema>;

    const donation = await prisma.$transaction(async (tx) => {
      const fund = await tx.fund.findFirst({ where: { id: body.fundId, organizationId: auth.organizationId } });
      if (!fund) throw badRequest('Selected fund is not available in this organization');

      if (body.bankAccountId) {
        const account = await tx.bankAccount.findFirst({
          where: { id: body.bankAccountId, organizationId: auth.organizationId },
        });
        if (!account) throw badRequest('Selected receiving account is not available');
      }

      const receiptNumber = await nextNumber(tx, auth.organizationId, 'DONATION', body.date);
      const created = await tx.donation.create({
        data: {
          organizationId: auth.organizationId,
          receiptNumber,
          date: body.date,
          donorId: body.donorId || null,
          donorName: body.donorName,
          amount: decimal(body.amount),
          mode: body.mode,
          fundId: body.fundId,
          departmentId: body.departmentId || null,
          bankAccountId: body.bankAccountId || null,
          purpose: body.purpose || null,
          referenceNumber: body.referenceNumber || null,
          is80GEligible: body.is80GEligible,
          notes: body.notes || null,
          createdById: auth.userId,
        },
        include: { fund: true, department: true, bankAccount: true },
      });

      // Dr the receiving account, Cr donation income.
      if (body.mode !== 'KIND') {
        const debitCode = body.bankAccountId ? null : SYSTEM_ACCOUNTS.CASH_IN_HAND;
        let debitAccountId: string | null = null;

        if (body.bankAccountId) {
          const bank = await tx.bankAccount.findUnique({
            where: { id: body.bankAccountId },
            include: { account: true },
          });
          debitAccountId = bank?.account?.id ?? null;
        }
        if (!debitAccountId && debitCode) {
          debitAccountId = (await accountByCode(tx, auth.organizationId, debitCode))?.id ?? null;
        }
        const incomeAccount = await accountByCode(tx, auth.organizationId, SYSTEM_ACCOUNTS.DONATION_INCOME);

        if (debitAccountId && incomeAccount) {
          await postJournal(tx, {
            organizationId: auth.organizationId,
            date: body.date,
            type: 'DONATION',
            narration: `${receiptNumber} — Donation from ${body.donorName}`,
            sourceType: 'Donation',
            sourceId: created.id,
            createdById: auth.userId,
            lines: [
              { accountId: debitAccountId, debit: body.amount, description: `Donation received`, fundId: body.fundId },
              { accountId: incomeAccount.id, credit: body.amount, description: body.donorName, fundId: body.fundId },
            ],
          });
        }
      }

      return created;
    });

    await recordAudit({
      organizationId: auth.organizationId,
      userId: auth.userId,
      action: AUDIT_ACTIONS.DONATION_CREATED,
      entityType: 'Donation',
      entityId: donation.id,
      entityLabel: donation.receiptNumber,
      newValue: { donor: donation.donorName, amount: toNumber(donation.amount) },
      req,
    });

    res.status(201).json({ data: { ...donation, amount: toNumber(donation.amount) } });
  }),
);

/** Summary cards on the donations page. */
donationsRouter.get(
  '/summary',
  requirePermission('donation.view'),
  asyncHandler(async (req, res) => {
    const organizationId = getCurrentOrganization(req);
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const [total, thisMonth, donorCount, byFund] = await Promise.all([
      prisma.donation.aggregate({ where: { organizationId }, _sum: { amount: true }, _count: { _all: true } }),
      prisma.donation.aggregate({ where: { organizationId, date: { gte: startOfMonth } }, _sum: { amount: true } }),
      prisma.donor.count({ where: { organizationId, isActive: true } }),
      prisma.donation.groupBy({ by: ['fundId'], where: { organizationId }, _sum: { amount: true } }),
    ]);

    const funds = await prisma.fund.findMany({ where: { organizationId } });
    const fundNames = new Map(funds.map((f) => [f.id, f.name]));

    res.json({
      totalAmount: toNumber(total._sum.amount),
      totalCount: total._count._all,
      thisMonth: toNumber(thisMonth._sum.amount),
      donorCount,
      byFund: byFund
        .map((row) => ({ name: fundNames.get(row.fundId) ?? 'Unknown', amount: toNumber(row._sum.amount) }))
        .sort((a, b) => b.amount - a.amount),
    });
  }),
);

// ----------------------------- Other income --------------------------------

export const incomeRouter = Router();

const incomeSchema = z.object({
  date: z.coerce.date(),
  source: z.string().trim().min(2, 'Income source is required').max(160),
  amount: z.coerce.number().gt(0, 'Amount must be greater than zero'),
  fundId: z.string().min(1, 'Select a fund'),
  departmentId: z.string().optional().nullable(),
  bankAccountId: z.string().optional().nullable(),
  method: z.enum(['CASH', 'BANK_TRANSFER', 'UPI', 'CHEQUE', 'OTHER']).default('BANK_TRANSFER'),
  referenceNumber: z.string().trim().max(80).optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
});

incomeRouter.post(
  '/',
  requirePermission('donation.create', 'finance.view'),
  validate(incomeSchema),
  asyncHandler(async (req, res) => {
    const auth = getCurrentUser(req);
    const body = req.body as z.infer<typeof incomeSchema>;

    const entry = await prisma.$transaction(async (tx) => {
      const fund = await tx.fund.findFirst({ where: { id: body.fundId, organizationId: auth.organizationId } });
      if (!fund) throw badRequest('Selected fund is not available in this organization');

      const entryNumber = await nextNumber(tx, auth.organizationId, 'INCOME', body.date);
      const created = await tx.incomeEntry.create({
        data: {
          organizationId: auth.organizationId,
          entryNumber,
          date: body.date,
          source: body.source,
          amount: decimal(body.amount),
          fundId: body.fundId,
          departmentId: body.departmentId || null,
          bankAccountId: body.bankAccountId || null,
          method: body.method,
          referenceNumber: body.referenceNumber || null,
          notes: body.notes || null,
          createdById: auth.userId,
        },
      });

      let debitAccountId: string | null = null;
      if (body.bankAccountId) {
        const bank = await tx.bankAccount.findUnique({
          where: { id: body.bankAccountId },
          include: { account: true },
        });
        debitAccountId = bank?.account?.id ?? null;
      }
      if (!debitAccountId) {
        debitAccountId = (await accountByCode(tx, auth.organizationId, SYSTEM_ACCOUNTS.CASH_IN_HAND))?.id ?? null;
      }
      const incomeAccount = await accountByCode(tx, auth.organizationId, SYSTEM_ACCOUNTS.DEFAULT_INCOME);

      if (debitAccountId && incomeAccount) {
        await postJournal(tx, {
          organizationId: auth.organizationId,
          date: body.date,
          type: 'INCOME',
          narration: `${entryNumber} — ${body.source}`,
          sourceType: 'IncomeEntry',
          sourceId: created.id,
          createdById: auth.userId,
          lines: [
            { accountId: debitAccountId, debit: body.amount, description: body.source, fundId: body.fundId },
            { accountId: incomeAccount.id, credit: body.amount, description: body.source, fundId: body.fundId },
          ],
        });
      }

      return created;
    });

    await recordAudit({
      organizationId: auth.organizationId,
      userId: auth.userId,
      action: AUDIT_ACTIONS.INCOME_CREATED,
      entityType: 'IncomeEntry',
      entityId: entry.id,
      entityLabel: entry.entryNumber,
      newValue: { source: entry.source, amount: toNumber(entry.amount) },
      req,
    });

    res.status(201).json({ data: { ...entry, amount: toNumber(entry.amount) } });
  }),
);

incomeRouter.get(
  '/',
  requirePermission('finance.view'),
  asyncHandler(async (req, res) => {
    const organizationId = getCurrentOrganization(req);
    const rows = await prisma.incomeEntry.findMany({
      where: { organizationId },
      orderBy: { date: 'desc' },
      take: 50,
      include: { fund: { select: { name: true } }, department: { select: { name: true } } },
    });
    res.json({
      data: rows.map((row) => ({ ...row, amount: toNumber(row.amount) })),
      totalAmount: round2(rows.reduce((sum, row) => sum + toNumber(row.amount), 0)),
    });
  }),
);

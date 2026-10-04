import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db';
import { asyncHandler } from '../../lib/http';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { decimal, round2, toNumber } from '../../lib/money';
import { nextNumber } from '../../lib/sequence';
import { AUDIT_ACTIONS, recordAudit } from '../../lib/audit';
import { postJournal } from '../../lib/accounting';
import { validate } from '../../middleware/validate';
import { getCurrentOrganization, getCurrentUser, requirePermission } from '../../middleware/auth';

export const bankingRouter = Router();

/** Live balance per account: opening + receipts − payments ± transfers. */
async function accountBalances(organizationId: string) {
  const accounts = await prisma.bankAccount.findMany({
    where: { organizationId },
    orderBy: { name: 'asc' },
    include: { account: { select: { id: true, code: true, name: true } } },
  });

  const [payments, donations, income, transfersOut, transfersIn] = await Promise.all([
    prisma.payment.groupBy({ by: ['bankAccountId'], where: { organizationId }, _sum: { amount: true } }),
    prisma.donation.groupBy({ by: ['bankAccountId'], where: { organizationId }, _sum: { amount: true } }),
    prisma.incomeEntry.groupBy({ by: ['bankAccountId'], where: { organizationId }, _sum: { amount: true } }),
    prisma.bankTransfer.groupBy({ by: ['fromAccountId'], where: { organizationId }, _sum: { amount: true } }),
    prisma.bankTransfer.groupBy({ by: ['toAccountId'], where: { organizationId }, _sum: { amount: true } }),
  ]);

  const sum = (rows: { _sum: { amount: unknown } }[], key: string, idField: string) => {
    const map = new Map<string, number>();
    for (const row of rows as never as Record<string, unknown>[]) {
      const id = row[idField] as string | null;
      if (!id) continue;
      map.set(id, toNumber((row._sum as { amount: unknown }).amount as never));
    }
    return map;
  };

  const paidMap = sum(payments as never, 'amount', 'bankAccountId');
  const donationMap = sum(donations as never, 'amount', 'bankAccountId');
  const incomeMap = sum(income as never, 'amount', 'bankAccountId');
  const outMap = sum(transfersOut as never, 'amount', 'fromAccountId');
  const inMap = sum(transfersIn as never, 'amount', 'toAccountId');

  return accounts.map((account) => {
    const credits = (donationMap.get(account.id) ?? 0) + (incomeMap.get(account.id) ?? 0) + (inMap.get(account.id) ?? 0);
    const debits = (paidMap.get(account.id) ?? 0) + (outMap.get(account.id) ?? 0);
    return {
      ...account,
      openingBalance: toNumber(account.openingBalance),
      credits: round2(credits),
      debits: round2(debits),
      balance: round2(toNumber(account.openingBalance) + credits - debits),
    };
  });
}

bankingRouter.get(
  '/accounts',
  requirePermission('banking.view'),
  asyncHandler(async (req, res) => {
    const accounts = await accountBalances(getCurrentOrganization(req));
    res.json({
      data: accounts,
      totals: {
        balance: round2(accounts.reduce((sum, a) => sum + a.balance, 0)),
        credits: round2(accounts.reduce((sum, a) => sum + a.credits, 0)),
        debits: round2(accounts.reduce((sum, a) => sum + a.debits, 0)),
      },
    });
  }),
);

const accountSchema = z.object({
  name: z.string().trim().min(2, 'Account name is required').max(120),
  accountType: z.enum(['BANK', 'CASH', 'UPI_WALLET']).default('BANK'),
  bankName: z.string().trim().max(120).optional().nullable(),
  accountNumber: z.string().trim().max(30).optional().nullable(),
  ifsc: z
    .string()
    .trim()
    .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Enter a valid IFSC code')
    .optional()
    .nullable()
    .or(z.literal('')),
  branch: z.string().trim().max(120).optional().nullable(),
  upiId: z.string().trim().max(80).optional().nullable(),
  openingBalance: z.coerce.number().default(0),
});

bankingRouter.post(
  '/accounts',
  requirePermission('banking.manage'),
  validate(accountSchema),
  asyncHandler(async (req, res) => {
    const auth = getCurrentUser(req);
    const payload = Object.fromEntries(
      Object.entries(req.body).map(([key, value]) => [key, value === '' ? null : value]),
    ) as z.infer<typeof accountSchema>;

    const account = await prisma.bankAccount.create({
      data: {
        organizationId: auth.organizationId,
        ...payload,
        openingBalance: decimal(payload.openingBalance ?? 0),
      },
    });

    await recordAudit({
      organizationId: auth.organizationId,
      userId: auth.userId,
      action: AUDIT_ACTIONS.SETTINGS_CHANGED,
      entityType: 'BankAccount',
      entityId: account.id,
      entityLabel: account.name,
      newValue: { name: account.name, type: account.accountType },
      req,
    });

    res.status(201).json({ data: { ...account, openingBalance: toNumber(account.openingBalance) } });
  }),
);

const transferSchema = z
  .object({
    date: z.coerce.date(),
    fromAccountId: z.string().min(1, 'Select the account to transfer from'),
    toAccountId: z.string().min(1, 'Select the account to transfer to'),
    amount: z.coerce.number().gt(0, 'Amount must be greater than zero'),
    referenceNumber: z.string().trim().max(80).optional().nullable(),
    notes: z.string().trim().max(1000).optional().nullable(),
  })
  .refine((data) => data.fromAccountId !== data.toAccountId, {
    path: ['toAccountId'],
    message: 'Choose a different account to transfer into',
  });

bankingRouter.post(
  '/transfers',
  requirePermission('banking.manage'),
  validate(transferSchema),
  asyncHandler(async (req, res) => {
    const auth = getCurrentUser(req);
    const body = req.body as z.infer<typeof transferSchema>;

    const transfer = await prisma.$transaction(async (tx) => {
      const [from, to] = await Promise.all([
        tx.bankAccount.findFirst({
          where: { id: body.fromAccountId, organizationId: auth.organizationId },
          include: { account: true },
        }),
        tx.bankAccount.findFirst({
          where: { id: body.toAccountId, organizationId: auth.organizationId },
          include: { account: true },
        }),
      ]);
      if (!from || !to) throw badRequest('Selected accounts are not available in this organization');

      const balances = await accountBalances(auth.organizationId);
      const fromBalance = balances.find((b) => b.id === from.id)?.balance ?? 0;
      if (body.amount > fromBalance) {
        throw conflict(`${from.name} has only ₹${fromBalance.toLocaleString('en-IN')} available`);
      }

      const transferNumber = await nextNumber(tx, auth.organizationId, 'TRANSFER', body.date);
      const created = await tx.bankTransfer.create({
        data: {
          organizationId: auth.organizationId,
          transferNumber,
          date: body.date,
          fromAccountId: body.fromAccountId,
          toAccountId: body.toAccountId,
          amount: decimal(body.amount),
          referenceNumber: body.referenceNumber || null,
          notes: body.notes || null,
          createdById: auth.userId,
        },
        include: { fromAccount: true, toAccount: true },
      });

      if (from.account && to.account) {
        await postJournal(tx, {
          organizationId: auth.organizationId,
          date: body.date,
          type: 'TRANSFER',
          narration: `${transferNumber} — ${from.name} to ${to.name}`,
          sourceType: 'BankTransfer',
          sourceId: created.id,
          createdById: auth.userId,
          lines: [
            { accountId: to.account.id, debit: body.amount, description: `Transfer in from ${from.name}` },
            { accountId: from.account.id, credit: body.amount, description: `Transfer out to ${to.name}` },
          ],
        });
      }

      return created;
    });

    await recordAudit({
      organizationId: auth.organizationId,
      userId: auth.userId,
      action: AUDIT_ACTIONS.TRANSFER_CREATED,
      entityType: 'BankTransfer',
      entityId: transfer.id,
      entityLabel: transfer.transferNumber,
      newValue: {
        from: transfer.fromAccount.name,
        to: transfer.toAccount.name,
        amount: toNumber(transfer.amount),
      },
      req,
    });

    res.status(201).json({ data: { ...transfer, amount: toNumber(transfer.amount) } });
  }),
);

bankingRouter.get(
  '/transfers',
  requirePermission('banking.view'),
  asyncHandler(async (req, res) => {
    const organizationId = getCurrentOrganization(req);
    const rows = await prisma.bankTransfer.findMany({
      where: { organizationId },
      orderBy: { date: 'desc' },
      take: 50,
      include: {
        fromAccount: { select: { id: true, name: true } },
        toAccount: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
      },
    });
    res.json({ data: rows.map((row) => ({ ...row, amount: toNumber(row.amount) })) });
  }),
);

/** Combined money-in / money-out ledger for one account. */
bankingRouter.get(
  '/accounts/:id/transactions',
  requirePermission('banking.view'),
  asyncHandler(async (req, res) => {
    const organizationId = getCurrentOrganization(req);
    const account = await prisma.bankAccount.findFirst({ where: { id: req.params.id, organizationId } });
    if (!account) throw notFound('Account not found');

    const [payments, donations, income, out, incoming] = await Promise.all([
      prisma.payment.findMany({
        where: { organizationId, bankAccountId: account.id },
        orderBy: { date: 'desc' },
        take: 50,
        include: { expense: { select: { id: true, expenseNumber: true, title: true } } },
      }),
      prisma.donation.findMany({
        where: { organizationId, bankAccountId: account.id },
        orderBy: { date: 'desc' },
        take: 50,
      }),
      prisma.incomeEntry.findMany({
        where: { organizationId, bankAccountId: account.id },
        orderBy: { date: 'desc' },
        take: 50,
      }),
      prisma.bankTransfer.findMany({ where: { organizationId, fromAccountId: account.id }, take: 50 }),
      prisma.bankTransfer.findMany({ where: { organizationId, toAccountId: account.id }, take: 50 }),
    ]);

    const entries = [
      ...payments.map((p) => ({
        id: p.id,
        date: p.date,
        reference: p.paymentNumber,
        particulars: p.expense ? `${p.expense.expenseNumber} — ${p.expense.title}` : 'Payment',
        debit: toNumber(p.amount),
        credit: 0,
      })),
      ...donations.map((d) => ({
        id: d.id,
        date: d.date,
        reference: d.receiptNumber,
        particulars: `Donation — ${d.donorName}`,
        debit: 0,
        credit: toNumber(d.amount),
      })),
      ...income.map((i) => ({
        id: i.id,
        date: i.date,
        reference: i.entryNumber,
        particulars: `Income — ${i.source}`,
        debit: 0,
        credit: toNumber(i.amount),
      })),
      ...out.map((t) => ({
        id: t.id,
        date: t.date,
        reference: t.transferNumber,
        particulars: 'Transfer out',
        debit: toNumber(t.amount),
        credit: 0,
      })),
      ...incoming.map((t) => ({
        id: t.id,
        date: t.date,
        reference: t.transferNumber,
        particulars: 'Transfer in',
        debit: 0,
        credit: toNumber(t.amount),
      })),
    ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    res.json({ account: { ...account, openingBalance: toNumber(account.openingBalance) }, data: entries });
  }),
);

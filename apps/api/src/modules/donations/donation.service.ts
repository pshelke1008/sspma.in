import type { Request } from 'express';
import { z } from 'zod';
import { DONATION_MODES } from '@ashram/types';
import type { Tx } from '../../db';
import { badRequest } from '../../lib/errors';
import { decimal, toNumber } from '../../lib/money';
import { nextNumber } from '../../lib/sequence';
import { AUDIT_ACTIONS, recordAudit } from '../../lib/audit';
import { accountByCode, postJournal, SYSTEM_ACCOUNTS } from '../../lib/accounting';
import { assertOwned } from '../../lib/ownership';
import type { AuthContext } from '../../middleware/auth';

export const donationSchema = z.object({
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

export type DonationInput = z.infer<typeof donationSchema>;

/**
 * Records a donation and posts its journal inside the caller's transaction.
 * Shared by the Donations page and the donor form, which saves a new donor and
 * their first donation together so neither exists without the other.
 */
export async function recordDonation(tx: Tx, auth: AuthContext, body: DonationInput) {
  const fund = await tx.fund.findFirst({ where: { id: body.fundId, organizationId: auth.organizationId } });
  if (!fund) throw badRequest('Selected fund is not available in this organization');

  if (body.bankAccountId) {
    const account = await tx.bankAccount.findFirst({
      where: { id: body.bankAccountId, organizationId: auth.organizationId },
    });
    if (!account) throw badRequest('Selected receiving account is not available');
  }
  await assertOwned(auth.organizationId, { donor: body.donorId, department: body.departmentId }, tx);

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
      const bank = await tx.bankAccount.findFirst({
        where: { id: body.bankAccountId, organizationId: auth.organizationId },
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
}

export async function auditDonation(
  auth: AuthContext,
  donation: { id: string; receiptNumber: string; donorName: string; amount: unknown },
  req: Request,
) {
  await recordAudit({
    organizationId: auth.organizationId,
    userId: auth.userId,
    action: AUDIT_ACTIONS.DONATION_CREATED,
    entityType: 'Donation',
    entityId: donation.id,
    entityLabel: donation.receiptNumber,
    newValue: { donor: donation.donorName, amount: toNumber(donation.amount as Parameters<typeof toNumber>[0]) },
    req,
  });
}

import type { Tx } from '../db';
import { currentFinancialYearLabel } from './dates';

type SequenceKey = 'EXPENSE' | 'PAYMENT' | 'DONATION' | 'INCOME' | 'PURCHASE' | 'TRANSFER' | 'VOUCHER';

const PREFIXES: Record<SequenceKey, string> = {
  EXPENSE: 'EXP',
  PAYMENT: 'PAY',
  DONATION: 'DON',
  INCOME: 'INC',
  PURCHASE: 'PO',
  TRANSFER: 'TRF',
  VOUCHER: 'JV',
};

/**
 * Allocates the next document number inside the caller's transaction, so two
 * concurrent creates can never be handed the same number.
 */
export async function nextNumber(
  tx: Tx,
  organizationId: string,
  key: SequenceKey,
  reference: Date = new Date(),
): Promise<string> {
  const fyLabel = currentFinancialYearLabel(reference);
  const year = Number.parseInt(fyLabel.split('-')[0], 10) + 1;
  const prefix = PREFIXES[key];

  const sequence = await tx.numberSequence.upsert({
    where: { organizationId_key_year: { organizationId, key, year } },
    create: { organizationId, key, prefix, year, nextValue: 2, padding: 5 },
    update: { nextValue: { increment: 1 } },
  });

  // Both branches leave nextValue pointing at the *following* number, so the
  // number just allocated is always nextValue - 1.
  const allocated = sequence.nextValue - 1;
  const serial = String(allocated).padStart(sequence.padding, '0');
  return `${prefix}-${year}-${serial}`;
}

/**
 * Non-yearly master codes (donors keep one code for life): DNR-00001.
 * Uses the same row-locked counter as document numbers, with year 0.
 */
export async function nextMasterCode(tx: Tx, organizationId: string, key: 'DONOR', prefix: string): Promise<string> {
  const sequence = await tx.numberSequence.upsert({
    where: { organizationId_key_year: { organizationId, key, year: 0 } },
    create: { organizationId, key, prefix, year: 0, nextValue: 2, padding: 5 },
    update: { nextValue: { increment: 1 } },
  });
  return `${prefix}-${String(sequence.nextValue - 1).padStart(sequence.padding, '0')}`;
}

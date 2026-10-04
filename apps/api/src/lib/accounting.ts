import { Prisma, type TransactionType } from '@prisma/client';
import type { Tx } from '../db';
import { decimal, round2, toNumber } from './money';
import { nextNumber } from './sequence';
import { AppError } from './errors';

/** Well-known account codes created by the seed / organization bootstrap. */
export const SYSTEM_ACCOUNTS = {
  ACCOUNTS_PAYABLE: '2100',
  DEFAULT_EXPENSE: '5199',
  DEFAULT_INCOME: '4199',
  DONATION_INCOME: '4101',
  DEFAULT_BANK: '1101',
  CASH_IN_HAND: '1103',
} as const;

export interface JournalLine {
  accountId: string;
  debit?: number;
  credit?: number;
  description?: string;
  fundId?: string | null;
  departmentId?: string | null;
}

export interface JournalInput {
  organizationId: string;
  date: Date;
  type: TransactionType;
  narration: string;
  lines: JournalLine[];
  sourceType?: string;
  sourceId?: string;
  expenseId?: string;
  createdById?: string | null;
}

/**
 * Posts a balanced double-entry voucher. Refuses to write anything unless the
 * debit and credit totals agree to the paisa.
 */
export async function postJournal(tx: Tx, input: JournalInput) {
  const debit = round2(input.lines.reduce((sum, l) => sum + (l.debit ?? 0), 0));
  const credit = round2(input.lines.reduce((sum, l) => sum + (l.credit ?? 0), 0));

  if (debit !== credit) {
    throw new AppError(
      500,
      'UNBALANCED_JOURNAL',
      `Journal entry does not balance: debit ${debit} vs credit ${credit}`,
    );
  }
  if (debit === 0) {
    throw new AppError(500, 'EMPTY_JOURNAL', 'Journal entry has no value to post');
  }

  const voucherNumber = await nextNumber(tx, input.organizationId, 'VOUCHER', input.date);

  return tx.transaction.create({
    data: {
      organizationId: input.organizationId,
      voucherNumber,
      date: input.date,
      type: input.type,
      narration: input.narration,
      amount: decimal(debit),
      sourceType: input.sourceType ?? null,
      sourceId: input.sourceId ?? null,
      expenseId: input.expenseId ?? null,
      createdById: input.createdById ?? null,
      lines: {
        create: input.lines.map((line) => ({
          accountId: line.accountId,
          debit: decimal(line.debit ?? 0),
          credit: decimal(line.credit ?? 0),
          description: line.description ?? null,
          fundId: line.fundId ?? null,
          departmentId: line.departmentId ?? null,
        })),
      },
    },
    include: { lines: { include: { account: true } } },
  });
}

export async function accountByCode(tx: Tx, organizationId: string, code: string) {
  return tx.account.findUnique({
    where: { organizationId_code: { organizationId, code } },
  });
}

/** Resolves the account to debit for an expense, falling back to misc expense. */
export async function resolveExpenseAccountId(
  tx: Tx,
  organizationId: string,
  categoryId: string,
): Promise<string> {
  const category = await tx.expenseCategory.findFirst({
    where: { id: categoryId, organizationId },
    select: { accountId: true },
  });
  if (category?.accountId) return category.accountId;

  const fallback = await accountByCode(tx, organizationId, SYSTEM_ACCOUNTS.DEFAULT_EXPENSE);
  if (!fallback) {
    throw new AppError(500, 'MISSING_ACCOUNT', 'Chart of accounts is missing a default expense account');
  }
  return fallback.id;
}

/** Resolves the credit side: the bank account's ledger, else accounts payable. */
export async function resolveCreditAccountId(
  tx: Tx,
  organizationId: string,
  bankAccountId: string | null,
): Promise<{ accountId: string; label: string }> {
  if (bankAccountId) {
    const bank = await tx.bankAccount.findFirst({
      where: { id: bankAccountId, organizationId },
      include: { account: true },
    });
    if (bank?.account) return { accountId: bank.account.id, label: bank.account.name };
    if (bank && !bank.account) {
      const fallbackBank = await accountByCode(tx, organizationId, SYSTEM_ACCOUNTS.DEFAULT_BANK);
      if (fallbackBank) return { accountId: fallbackBank.id, label: fallbackBank.name };
    }
  }
  const payable = await accountByCode(tx, organizationId, SYSTEM_ACCOUNTS.ACCOUNTS_PAYABLE);
  if (!payable) {
    throw new AppError(500, 'MISSING_ACCOUNT', 'Chart of accounts is missing the accounts payable account');
  }
  return { accountId: payable.id, label: payable.name };
}

export interface LedgerBalance {
  accountId: string;
  code: string;
  name: string;
  type: string;
  debit: number;
  credit: number;
  balance: number;
}

/**
 * Trial-balance style aggregation used by the balance sheet, trial balance and
 * fund reports. Scoped to one organization and an optional date window.
 */
export async function ledgerBalances(
  client: Tx,
  organizationId: string,
  opts: { from?: Date; to?: Date } = {},
): Promise<LedgerBalance[]> {
  const accounts = await client.account.findMany({
    where: { organizationId },
    orderBy: { code: 'asc' },
  });

  const grouped = await client.transactionLine.groupBy({
    by: ['accountId'],
    where: {
      transaction: {
        organizationId,
        ...(opts.from || opts.to
          ? { date: { ...(opts.from ? { gte: opts.from } : {}), ...(opts.to ? { lte: opts.to } : {}) } }
          : {}),
      },
    },
    _sum: { debit: true, credit: true },
  });

  const byAccount = new Map(grouped.map((g) => [g.accountId, g._sum]));

  return accounts.map((account) => {
    const sums = byAccount.get(account.id);
    const opening = toNumber(account.openingBalance);
    const debit = round2(toNumber(sums?.debit) + (isDebitNatured(account.type) ? opening : 0));
    const credit = round2(toNumber(sums?.credit) + (isDebitNatured(account.type) ? 0 : opening));
    return {
      accountId: account.id,
      code: account.code,
      name: account.name,
      type: account.type,
      debit,
      credit,
      balance: round2(isDebitNatured(account.type) ? debit - credit : credit - debit),
    };
  });
}

export function isDebitNatured(type: string): boolean {
  return type === 'ASSET' || type === 'EXPENSE';
}

export function sumDecimal(values: (Prisma.Decimal | number | string | null)[]): number {
  return round2(values.reduce<number>((acc, v) => acc + toNumber(v), 0));
}

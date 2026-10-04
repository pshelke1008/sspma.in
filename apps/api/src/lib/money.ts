import { Prisma } from '@prisma/client';

export type Decimalish = Prisma.Decimal | number | string | null | undefined;

/** Converts any Prisma Decimal / numeric input into a rounded number of rupees. */
export function toNumber(value: Decimalish): number {
  if (value === null || value === undefined) return 0;
  const n = typeof value === 'number' ? value : Number(value.toString());
  return Number.isFinite(n) ? n : 0;
}

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function decimal(value: number | string): Prisma.Decimal {
  return new Prisma.Decimal(round2(Number(value) || 0));
}

export interface LineInput {
  quantity: number;
  rate: number;
  taxRate: number;
}

export interface LineTotals {
  base: number;
  taxAmount: number;
  amount: number;
}

/**
 * Single source of truth for line arithmetic. The API recomputes every total
 * from the raw quantity/rate/taxRate so a tampered client payload cannot
 * change what the ledger records.
 */
export function computeLine(line: LineInput): LineTotals {
  const base = round2((Number(line.quantity) || 0) * (Number(line.rate) || 0));
  const taxAmount = round2((base * (Number(line.taxRate) || 0)) / 100);
  return { base, taxAmount, amount: round2(base + taxAmount) };
}

export function computeTotals(lines: LineInput[]) {
  let subtotal = 0;
  let tax = 0;
  const computed = lines.map((line) => {
    const totals = computeLine(line);
    subtotal = round2(subtotal + totals.base);
    tax = round2(tax + totals.taxAmount);
    return totals;
  });
  return { lines: computed, subtotal, tax, total: round2(subtotal + tax) };
}

/** ₹12,34,567.00 — Indian digit grouping, used by PDF/Excel exports (Mukta carries the ₹ glyph). */
export function formatINR(value: number, withSymbol = true): string {
  const formatted = new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(round2(value));
  return withSymbol ? `₹${formatted}` : formatted;
}

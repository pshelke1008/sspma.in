import { describe, expect, it } from 'vitest';
import { computeLine, computeTotals, formatINR, round2, toNumber } from '../../src/lib/money';

describe('line arithmetic', () => {
  it('computes the reference Gaushala Feed expense exactly', () => {
    const { subtotal, tax, total } = computeTotals([
      { quantity: 500, rate: 8, taxRate: 0 },
      { quantity: 300, rate: 10, taxRate: 0 },
      { quantity: 60, rate: 300, taxRate: 0 },
    ]);
    expect(subtotal).toBe(25_000);
    expect(tax).toBe(0);
    expect(total).toBe(25_000);
  });

  it('applies tax per line, not on the grand total', () => {
    const result = computeTotals([
      { quantity: 1, rate: 50_000, taxRate: 18 },
      { quantity: 1, rate: 10_000, taxRate: 0 },
    ]);
    expect(result.subtotal).toBe(60_000);
    expect(result.tax).toBe(9_000);
    expect(result.total).toBe(69_000);
  });

  it('rounds to paisa without drifting', () => {
    const line = computeLine({ quantity: 3, rate: 33.33, taxRate: 5 });
    expect(line.base).toBe(99.99);
    expect(line.taxAmount).toBe(5);
    expect(line.amount).toBe(104.99);
  });

  it('treats missing or malformed values as zero', () => {
    expect(computeLine({ quantity: 0, rate: 100, taxRate: 0 }).amount).toBe(0);
    expect(toNumber(null)).toBe(0);
    expect(toNumber(undefined)).toBe(0);
    expect(toNumber('12.5')).toBe(12.5);
  });

  it('keeps totals stable across many lines', () => {
    const lines = Array.from({ length: 100 }, () => ({ quantity: 1, rate: 0.1, taxRate: 0 }));
    expect(computeTotals(lines).total).toBe(10);
  });

  it('rounds half away from zero', () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(2.675)).toBe(2.68);
  });

  it('formats money with Indian digit grouping', () => {
    expect(formatINR(2_450_000, false)).toBe('24,50,000.00');
    expect(formatINR(1234.5)).toBe('₹1,234.50');
  });
});

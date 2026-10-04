import { describe, expect, it } from 'vitest';
import { currentFinancialYearLabel, financialYearRange, monthsBetween } from '../../src/lib/dates';

describe('financial year handling', () => {
  it('starts the Indian financial year in April', () => {
    expect(currentFinancialYearLabel(new Date('2026-04-01'))).toBe('2026-2027');
    expect(currentFinancialYearLabel(new Date('2026-03-31'))).toBe('2025-2026');
    expect(currentFinancialYearLabel(new Date('2026-09-16'))).toBe('2026-2027');
  });

  it('produces an April to March range', () => {
    const { start, end } = financialYearRange('2026-2027');
    expect(start.getMonth()).toBe(3);
    expect(start.getDate()).toBe(1);
    expect(end.getMonth()).toBe(2);
    expect(end.getDate()).toBe(31);
  });

  it('enumerates twelve months across a full year', () => {
    const { start, end } = financialYearRange('2026-2027');
    const months = monthsBetween(start, end);
    expect(months).toHaveLength(12);
    expect(months[0].label).toContain('Apr');
    expect(months[11].label).toContain('Mar');
  });
});

import dayjs from 'dayjs';

export function startOfDay(value: string | Date): Date {
  return dayjs(value).startOf('day').toDate();
}

export function endOfDay(value: string | Date): Date {
  return dayjs(value).endOf('day').toDate();
}

/**
 * Indian financial year runs April → March. `2026-2027` starts 1 Apr 2026.
 */
export function financialYearRange(label: string): { start: Date; end: Date } {
  const [startYear] = label.split('-').map((part) => Number.parseInt(part, 10));
  const year = Number.isFinite(startYear) ? startYear : dayjs().year();
  return {
    start: dayjs(`${year}-04-01`).startOf('day').toDate(),
    end: dayjs(`${year + 1}-03-31`).endOf('day').toDate(),
  };
}

export function currentFinancialYearLabel(reference: Date = new Date()): string {
  const d = dayjs(reference);
  const startYear = d.month() >= 3 ? d.year() : d.year() - 1;
  return `${startYear}-${startYear + 1}`;
}

export function monthRange(year: number, month: number): { start: Date; end: Date } {
  const start = dayjs(`${year}-${String(month).padStart(2, '0')}-01`).startOf('month');
  return { start: start.toDate(), end: start.endOf('month').toDate() };
}

/** Ordered list of months between two dates, for time-series report rows. */
export function monthsBetween(start: Date, end: Date): { key: string; label: string; start: Date; end: Date }[] {
  const out: { key: string; label: string; start: Date; end: Date }[] = [];
  let cursor = dayjs(start).startOf('month');
  const last = dayjs(end).startOf('month');
  let guard = 0;
  while ((cursor.isBefore(last) || cursor.isSame(last)) && guard < 240) {
    out.push({
      key: cursor.format('YYYY-MM'),
      label: cursor.format('MMM YYYY'),
      start: cursor.startOf('month').toDate(),
      end: cursor.endOf('month').toDate(),
    });
    cursor = cursor.add(1, 'month');
    guard += 1;
  }
  return out;
}

export function formatDate(value: Date | string | null | undefined, pattern = 'DD MMM YYYY'): string {
  if (!value) return '—';
  return dayjs(value).format(pattern);
}

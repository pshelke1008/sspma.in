import i18n, { intlLocale } from '@/i18n';

/** Indian-format money and date helpers used across every screen. */

export function formatCurrency(value: number | string | null | undefined, options?: { compact?: boolean; decimals?: boolean }) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) return '₹0';

  if (options?.compact) return `₹${compactNumber(amount)}`;

  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: options?.decimals ? 2 : 0,
    maximumFractionDigits: options?.decimals ? 2 : 0,
  }).format(amount);
}

/** ₹21.90L / ₹1.24Cr — the short form used on mobile cards. */
export function compactNumber(value: number): string {
  const amount = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (amount >= 10_000_000) return `${sign}${(amount / 10_000_000).toFixed(2)}Cr`;
  if (amount >= 100_000) return `${sign}${(amount / 100_000).toFixed(2)}L`;
  if (amount >= 1_000) return `${sign}${(amount / 1_000).toFixed(1)}K`;
  return `${sign}${amount.toFixed(0)}`;
}

export function formatNumber(value: number | string | null | undefined, decimals = 0) {
  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(Number(value ?? 0));
}

export function formatDate(value: string | Date | null | undefined, style: 'short' | 'medium' | 'long' | 'input' = 'medium') {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';

  if (style === 'input') return date.toISOString().slice(0, 10);

  const options: Intl.DateTimeFormatOptions =
    style === 'short'
      ? { day: '2-digit', month: 'short' }
      : style === 'long'
        ? { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }
        : { day: '2-digit', month: 'short', year: 'numeric' };

  return new Intl.DateTimeFormat(intlLocale(), options).format(date);
}

/** Short month name for a "YYYY-MM" key, in the interface language ("Apr", "एप्रि"). */
export function formatMonthKey(key: string): string {
  const [year, month] = key.split('-').map(Number);
  if (!year || !month) return key;
  return new Intl.DateTimeFormat(intlLocale(), { month: 'short' }).format(new Date(year, month - 1, 1));
}

/** "2 hrs ago" — used on approval cards and the activity log. */
export function relativeTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  const minutes = Math.round((Date.now() - date.getTime()) / 60_000);
  const t = i18n.t.bind(i18n);

  if (minutes < 1) return t('time.justNow');
  if (minutes < 60) return t('time.minutes', { count: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t('time.hours', { count: hours });
  const days = Math.round(hours / 24);
  if (days < 30) return t('time.days', { count: days });
  const months = Math.round(days / 30);
  if (months < 12) return t('time.months', { count: months });
  return t('time.years', { count: Math.round(months / 12) });
}

export function initials(name: string | null | undefined): string {
  if (!name) return '?';
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split(/[\s_-]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** Current Indian financial year, e.g. 2026-2027. */
export function currentFinancialYear(reference: Date = new Date()): string {
  const startYear = reference.getMonth() >= 3 ? reference.getFullYear() : reference.getFullYear() - 1;
  return `${startYear}-${startYear + 1}`;
}

export function financialYearOptions(count = 4): string[] {
  const current = currentFinancialYear();
  const startYear = Number.parseInt(current.split('-')[0], 10);
  return Array.from({ length: count }, (_, index) => {
    const year = startYear - index;
    return `${year}-${year + 1}`;
  });
}

/** Month filter options in financial-year order, labelled in the current language. */
export function monthOptions(): { value: string; label: string }[] {
  const t = i18n.t.bind(i18n);
  return [
    { value: 'all', label: t('common.allMonths') },
    ...['4', '5', '6', '7', '8', '9', '10', '11', '12', '1', '2', '3'].map((value) => ({
      value,
      label: t(`months.${value}`),
    })),
  ];
}

export function bytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(2)} MB`;
}

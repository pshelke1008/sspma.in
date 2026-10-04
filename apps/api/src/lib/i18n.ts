/**
 * Server-side language for what the API itself renders: report labels (shown
 * on screen and in exports), PDF chrome and the expense voucher.
 */
import path from 'node:path';
import { DOMAIN_LABELS, type Locale } from '@ashram/types';

export function asLocale(value: unknown): Locale {
  return value === 'mr' ? 'mr' : 'en';
}

/** Mukta covers Devanagari and Latin in one face, so mixed text never falls back to blanks. */
export const PDF_FONTS = {
  regular: path.resolve(__dirname, '../../assets/fonts/Mukta-Regular.ttf'),
  bold: path.resolve(__dirname, '../../assets/fonts/Mukta-SemiBold.ttf'),
};

const MR: Record<string, string> = {
  // Columns, summaries, charts
  '0–30 days': '0–30 दिवस',
  '31–60 days': '31–60 दिवस',
  '61–90 days': '61–90 दिवस',
  '90+ days': '90+ दिवस',
  Account: 'खाते',
  Actual: 'प्रत्यक्ष',
  Amount: 'रक्कम',
  Assets: 'मालमत्ता',
  Balance: 'शिल्लक',
  Bills: 'बिले',
  Budget: 'अंदाजपत्रक',
  'Budget vs Actual': 'अंदाजपत्रक विरुद्ध प्रत्यक्ष',
  'Cash Movement': 'रोख हालचाल',
  Categories: 'वर्ग',
  Category: 'वर्ग',
  Closing: 'अखेरची शिल्लक',
  'Closing Balance': 'अखेरची शिल्लक',
  Code: 'कोड',
  Composition: 'रचना',
  Count: 'संख्या',
  Credit: 'जमा',
  Date: 'दिनांक',
  Debit: 'नावे',
  Department: 'विभाग',
  'Department Income vs Expense': 'विभागीय उत्पन्न विरुद्ध खर्च',
  Difference: 'फरक',
  Donations: 'देणग्या',
  'Donations by Fund': 'निधीनुसार देणग्या',
  Donor: 'देणगीदार',
  Donors: 'देणगीदार',
  Entries: 'नोंदी',
  Expense: 'खर्च',
  'Expense #': 'खर्च क्र.',
  'Expense by Category': 'वर्गनिहाय खर्च',
  Fund: 'निधी',
  'Fund Balances': 'निधी शिल्लक',
  Funds: 'निधी',
  'Funds & Reserves': 'निधी व राखीव',
  'Grouped By': 'गटवारी',
  Income: 'उत्पन्न',
  'Income vs Expense': 'उत्पन्न विरुद्ध खर्च',
  Inflow: 'आवक',
  'Last Donation': 'शेवटची देणगी',
  Liabilities: 'दायित्वे',
  Method: 'पद्धत',
  Mode: 'पद्धत',
  Month: 'महिना',
  Name: 'नाव',
  Net: 'निव्वळ',
  'Net Movement': 'निव्वळ हालचाल',
  'Net Surplus': 'निव्वळ शिल्लक',
  'Open Bills': 'प्रलंबित बिले',
  Opening: 'सुरुवातीची शिल्लक',
  Outflow: 'जावक',
  Outstanding: 'थकबाकी',
  'Outstanding by Supplier': 'पुरवठादारनिहाय थकबाकी',
  Particulars: 'तपशील',
  Payment: 'भरणा',
  'Payment #': 'भरणा क्र.',
  Payments: 'भरणे',
  'Payments by Method': 'पद्धतीनुसार भरणे',
  Receipt: 'जमा',
  Receipts: 'जमा',
  Reference: 'संदर्भ',
  Remaining: 'उर्वरित',
  Section: 'गट',
  Share: 'वाटा',
  Supplier: 'पुरवठादार',
  Suppliers: 'पुरवठादार',
  'Top Donors': 'प्रमुख देणगीदार',
  'Total Amount': 'एकूण रक्कम',
  'Total Assets': 'एकूण मालमत्ता',
  'Total Budget': 'एकूण अंदाजपत्रक',
  'Total Credit': 'एकूण जमा',
  'Total Debit': 'एकूण नावे',
  'Total Donations': 'एकूण देणग्या',
  'Total Expense': 'एकूण खर्च',
  'Total Income': 'एकूण उत्पन्न',
  'Total Inflow': 'एकूण आवक',
  'Total Outflow': 'एकूण जावक',
  'Total Outstanding': 'एकूण थकबाकी',
  'Total Paid': 'एकूण भरणा',
  'Total Received': 'एकूण प्राप्त',
  'Total Spent': 'एकूण वापर',
  Type: 'प्रकार',
  Utilised: 'वापर',
  Variance: 'तफावत',
  Voucher: 'व्हाउचर',
  // Literal cell values
  Total: 'एकूण',
  'Cash in Hand': 'हातातील रोख',
  'Surplus for the period': 'कालावधीतील शिल्लक',
  Uncategorised: 'अवर्गीकृत',
  Unknown: 'अज्ञात',
  'No supplier': 'पुरवठादार नाही',
  'Transfer in': 'हस्तांतरण (आवक)',
  'Transfer out': 'हस्तांतरण (जावक)',
  'Financial Year': 'आर्थिक वर्ष',
  // PDF chrome
  Period: 'कालावधी',
  Generated: 'तयार केले',
  Page: 'पृष्ठ',
  of: '/',
  'EXPENSE VOUCHER': 'खर्च व्हाउचर',
  Status: 'स्थिती',
  'Cost Center': 'खर्च केंद्र',
  'Requested By': 'विनंतीकर्ता',
  DESCRIPTION: 'तपशील',
  QTY: 'प्रमाण',
  UNIT: 'एकक',
  RATE: 'दर',
  TAX: 'कर',
  AMOUNT: 'रक्कम',
  Subtotal: 'उप-एकूण',
  Tax: 'कर',
  APPROVAL: 'मंजुरी',
  PAYMENT: 'भरणा',
  'Requested by': 'विनंतीकर्ता',
  'Entered by': 'नोंद करणारे',
  Submitted: 'सादर केले',
  'Approved by': 'मंजूर करणारे',
  Approved: 'मंजूर',
  'Paid on': 'भरणा दिनांक',
  'This is a system generated voucher.': 'हे संगणकाद्वारे तयार केलेले व्हाउचर आहे.',
  'Generated on': 'तयार केल्याची तारीख',
};

export function tr(locale: Locale, text: string): string {
  return locale === 'mr' ? (MR[text] ?? text) : text;
}

export function formatDateFor(locale: Locale, value: Date | string | null | undefined, withTime = false): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(locale === 'mr' ? 'mr-IN-u-nu-latn' : 'en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(date);
}

/** "Sep 2026" style month labels used by time-series report rows. */
export function formatMonthFor(locale: Locale, date: Date): string {
  return new Intl.DateTimeFormat(locale === 'mr' ? 'mr-IN-u-nu-latn' : 'en-IN', { month: 'short', year: 'numeric' }).format(date);
}

const ENUM_COLUMNS: Record<string, keyof (typeof DOMAIN_LABELS)['en']> = {
  type: 'accountType',
  method: 'paymentMethod',
};

interface LocalizableReport {
  key: string;
  name: string;
  description: string;
  columns: { key: string; label: string }[];
  rows: Record<string, unknown>[];
  totalsRow?: Record<string, unknown> | null;
  summary: { label: string }[];
  charts: { title: string; data: Record<string, unknown>[]; xKey: string; series: { label: string }[] }[];
  filtersApplied: Record<string, string>;
}

function localizeCell(locale: Locale, columnKey: string, value: unknown, row: Record<string, unknown>): unknown {
  if (typeof value !== 'string' || value === '') return value;

  const labels = DOMAIN_LABELS[locale];
  const enumGroup = ENUM_COLUMNS[columnKey];
  if (enumGroup) {
    const group = labels[enumGroup] as Record<string, string>;
    if (group[value]) return group[value];
  }
  // Donation summary lists modes and funds under one "name" column.
  if (columnKey === 'name' && row.grouping === 'Mode') return labels.donationMode[value] ?? value;
  if (columnKey === 'grouping') return tr(locale, value);

  if (locale !== 'mr') return value;
  if (MR[value]) return MR[value];
  if (value.startsWith('Donation — ')) return `देणगी — ${value.slice('Donation — '.length)}`;
  if (value.startsWith('Income — ')) return `उत्पन्न — ${value.slice('Income — '.length)}`;
  if (value.startsWith('Transfer ')) return `हस्तांतरण ${value.slice('Transfer '.length)}`;
  return value;
}

/**
 * Localizes a finished report in place of re-querying it: labels, the
 * enum-valued cells, and fixed wording such as "Total". User data — fund,
 * donor and supplier names — is left exactly as it was entered.
 */
export function localizeReport<T extends LocalizableReport>(report: T, locale: Locale): T {
  const labels = DOMAIN_LABELS[locale];
  const text = labels.reports[report.key];
  const month = report.columns.some((column) => column.key === 'month');

  const localizeRow = (row: Record<string, unknown>) => {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      out[key] =
        key === 'month' && typeof value === 'string' && /^[A-Z][a-z]{2} \d{4}$/.test(value)
          ? formatMonthFor(locale, new Date(`1 ${value}`))
          : localizeCell(locale, key, value, row);
    }
    return out;
  };

  return {
    ...report,
    name: text?.name ?? report.name,
    description: text?.description ?? report.description,
    columns: report.columns.map((column) => ({ ...column, label: tr(locale, column.label) })),
    rows: month || locale === 'mr' || report.columns.some((c) => ENUM_COLUMNS[c.key] || c.key === 'grouping')
      ? report.rows.map(localizeRow)
      : report.rows,
    totalsRow: report.totalsRow ? localizeRow(report.totalsRow) : report.totalsRow,
    summary: report.summary.map((item) => ({ ...item, label: tr(locale, item.label) })),
    charts: report.charts.map((chart) => ({
      ...chart,
      title: tr(locale, chart.title),
      series: chart.series.map((series) => ({ ...series, label: tr(locale, series.label) })),
      data: chart.data.map((point) => {
        const value = point[chart.xKey];
        if (chart.xKey === 'month' && typeof value === 'string' && /^[A-Z][a-z]{2} \d{4}$/.test(value)) {
          return { ...point, [chart.xKey]: formatMonthFor(locale, new Date(`1 ${value}`)) };
        }
        return { ...point, [chart.xKey]: localizeCell(locale, chart.xKey, value, point) };
      }),
    })),
    filtersApplied: Object.fromEntries(
      Object.entries(report.filtersApplied).map(([label, value]) => [tr(locale, label), value]),
    ),
  };
}

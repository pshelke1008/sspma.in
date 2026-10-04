export type ColumnType = 'text' | 'number' | 'currency' | 'date' | 'percent';

export interface ReportColumn {
  key: string;
  label: string;
  type?: ColumnType;
  align?: 'left' | 'right' | 'center';
  width?: number;
}

export interface ReportSummaryItem {
  label: string;
  value: number;
  type?: ColumnType;
  tone?: 'default' | 'positive' | 'negative' | 'accent';
}

export interface ReportChart {
  type: 'bar' | 'line' | 'donut';
  title: string;
  data: Record<string, unknown>[];
  xKey: string;
  series: { key: string; label: string; color?: string }[];
}

export interface ReportResult {
  key: string;
  name: string;
  description: string;
  generatedAt: string;
  period: { from: string | null; to: string | null; label: string };
  filtersApplied: Record<string, string>;
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
  totalsRow?: Record<string, unknown> | null;
  summary: ReportSummaryItem[];
  charts: ReportChart[];
}

export interface ReportFilters {
  financialYear?: string;
  from?: Date;
  to?: Date;
  departmentId?: string;
  fundId?: string;
  categoryId?: string;
  supplierId?: string;
  accountId?: string;
  donorId?: string;
  status?: string;
}

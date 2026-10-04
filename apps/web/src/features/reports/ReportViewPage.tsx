import { useCallback, useMemo, useState } from 'react';
import { Navigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { FileSpreadsheet, FileText, Filter, RotateCcw, Save } from 'lucide-react';
import { toast } from 'sonner';
import { REPORT_DEFINITIONS } from '@ashram/types';
import { ApiError, api, buildQuery, downloadFile } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/queryClient';
import { useMasters } from '@/lib/api/hooks';
import { useAuth } from '@/lib/auth/AuthProvider';
import { PageHeader } from '@/components/layout/PageHeader';
import { SectionCard } from '@/components/common/SectionCard';
import { ChartSkeleton, EmptyState, ErrorState, TableSkeleton } from '@/components/common/states';
import { Button } from '@/components/ui/button';
import { SimpleSelect } from '@/components/ui/select';
import { DateInput } from '@/components/common/forms';
import { Label } from '@/components/ui/label';
import { BarChart, DonutChart, LineChart } from '@/components/charts';
import { currentFinancialYear, financialYearOptions, formatCurrency, formatDate, formatNumber } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';
import { useTranslation } from 'react-i18next';
import { useLabels } from '@/i18n/useLabels';
import { errorMessage } from '@/i18n/errors';

interface ReportColumn {
  key: string;
  label: string;
  type?: 'text' | 'number' | 'currency' | 'date' | 'percent';
  align?: 'left' | 'right' | 'center';
}

interface ReportSummaryItem {
  label: string;
  value: number;
  type?: string;
  tone?: 'default' | 'positive' | 'negative' | 'accent';
}

interface ReportChart {
  type: 'bar' | 'line' | 'donut';
  title: string;
  data: Record<string, unknown>[];
  xKey: string;
  series: { key: string; label: string; color?: string }[];
}

interface ReportResult {
  key: string;
  name: string;
  description: string;
  generatedAt: string;
  period: { from: string; to: string; label: string };
  filtersApplied: Record<string, string>;
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
  totalsRow: Record<string, unknown> | null;
  summary: ReportSummaryItem[];
  charts: ReportChart[];
}

/** Which filters each report actually uses. */
const FILTERS_BY_REPORT: Record<string, string[]> = {
  'income-expense': ['financialYear', 'from', 'to', 'departmentId', 'fundId'],
  'balance-sheet': ['financialYear', 'to'],
  'trial-balance': ['financialYear', 'from', 'to'],
  'general-ledger': ['financialYear', 'from', 'to', 'accountId'],
  'cash-flow': ['financialYear', 'from', 'to'],
  'cash-book': ['financialYear', 'from', 'to'],
  'fund-report': ['financialYear', 'from', 'to', 'fundId'],
  'department-pl': ['financialYear', 'from', 'to', 'departmentId'],
  'budget-vs-actual': ['financialYear', 'from', 'to', 'departmentId'],
  'expense-analysis': ['financialYear', 'from', 'to', 'departmentId', 'fundId', 'categoryId'],
  'donor-report': ['financialYear', 'from', 'to', 'fundId'],
  'donation-summary': ['financialYear', 'from', 'to', 'fundId'],
  'supplier-outstanding': ['supplierId'],
  'payment-report': ['financialYear', 'from', 'to'],
};

export default function ReportViewPage() {
  const { t } = useTranslation();
  const labels = useLabels();
  const lang = t('language.code');
  const { key = '' } = useParams<{ key: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: masters } = useMasters();
  const { can } = useAuth();
  const [exporting, setExporting] = useState<string | null>(null);

  const definition = REPORT_DEFINITIONS.find((report) => report.key === key);

  // Draft filters are applied only when the user presses Apply.
  const [draft, setDraft] = useState(() => ({
    financialYear: searchParams.get('financialYear') ?? currentFinancialYear(),
    from: searchParams.get('from') ?? '',
    to: searchParams.get('to') ?? '',
    departmentId: searchParams.get('departmentId') ?? '',
    fundId: searchParams.get('fundId') ?? '',
    categoryId: searchParams.get('categoryId') ?? '',
    supplierId: searchParams.get('supplierId') ?? '',
    accountId: searchParams.get('accountId') ?? '',
  }));

  const applied = useMemo(() => {
    const allowed = FILTERS_BY_REPORT[key] ?? ['financialYear'];
    const result: Record<string, string> = {};
    for (const field of allowed) {
      const value = searchParams.get(field);
      if (value) result[field] = value;
    }
    if (!result.financialYear && allowed.includes('financialYear')) {
      result.financialYear = currentFinancialYear();
    }
    return result;
  }, [searchParams, key]);

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    // The API renders labels in the requested language, so the language is part of the key.
    queryKey: queryKeys.report(key, { ...applied, lang }),
    queryFn: () => api.get<ReportResult>(`/reports/${key}/data` + buildQuery({ ...applied, lang })),
    enabled: Boolean(definition),
  });

  const applyFilters = useCallback(() => {
    const allowed = FILTERS_BY_REPORT[key] ?? ['financialYear'];
    const next = new URLSearchParams();
    for (const field of allowed) {
      const value = (draft as Record<string, string>)[field];
      if (value) next.set(field, value);
    }
    setSearchParams(next, { replace: true });
  }, [draft, key, setSearchParams]);

  const resetFilters = useCallback(() => {
    setDraft({
      financialYear: currentFinancialYear(),
      from: '',
      to: '',
      departmentId: '',
      fundId: '',
      categoryId: '',
      supplierId: '',
      accountId: '',
    });
    setSearchParams(new URLSearchParams(), { replace: true });
  }, [setSearchParams]);

  async function handleExport(format: 'pdf' | 'excel' | 'csv') {
    setExporting(format);
    try {
      const extension = format === 'excel' ? 'xlsx' : format;
      await downloadFile(
        `/reports/${key}/export${buildQuery({ ...applied, format, lang })}`,
        `${key}.${extension}`,
      );
      toast.success(t('reports.downloaded', { format: format === 'excel' ? 'Excel' : format.toUpperCase() }), {
        description: t('reports.downloadedText', { count: data?.rows.length ?? 0 }),
      });
    } catch (err) {
      toast.error(t('reports.exportFailed'), { description: errorMessage(t, err) });
    } finally {
      setExporting(null);
    }
  }

  async function saveRun() {
    try {
      await api.post('/reports/generate', { key, ...applied, lang, save: true });
      toast.success(t('reports.saved'), { description: t('reports.savedText') });
    } catch (err) {
      toast.error(t('reports.saveFailed'), { description: errorMessage(t, err) });
    }
  }

  if (!definition) return <Navigate to="/reports" replace />;
  if (error) return <ErrorState message={errorMessage(t, error)} onRetry={() => void refetch()} />;

  const allowedFilters = FILTERS_BY_REPORT[key] ?? ['financialYear'];

  return (
    <>
      <PageHeader
        title={labels.reports[definition.key]?.name ?? definition.name}
        subtitle={labels.reports[definition.key]?.description ?? definition.description}
        breadcrumbs={[{ label: t('reports.title'), to: '/reports' }, { label: labels.reports[definition.key]?.name ?? definition.name }]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {can('report.view') && (
              <Button variant="outline" onClick={() => void saveRun()}>
                <Save className="h-3.5 w-3.5" aria-hidden="true" />
                {t('reports.saveRun')}
              </Button>
            )}
            {can('report.export') && (
              <>
                <Button variant="outline" loading={exporting === 'csv'} onClick={() => void handleExport('csv')}>
                  {t('reports.csv')}
                </Button>
                <Button variant="outline" loading={exporting === 'excel'} onClick={() => void handleExport('excel')}>
                  <FileSpreadsheet className="h-3.5 w-3.5" aria-hidden="true" />
                  {t('reports.exportExcel')}
                </Button>
                <Button loading={exporting === 'pdf'} onClick={() => void handleExport('pdf')}>
                  <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                  {t('reports.exportPdf')}
                </Button>
              </>
            )}
          </div>
        }
      />

      <SectionCard className="mb-4" bodyClassName="p-3 sm:p-4">
        <div className="flex flex-wrap items-end gap-3">
          {allowedFilters.includes('financialYear') && (
            <FilterControl label={t('common.financialYear')}>
              <SimpleSelect
                value={draft.financialYear}
                onValueChange={(value) => setDraft((state) => ({ ...state, financialYear: value }))}
                options={financialYearOptions().map((year) => ({ value: year, label: t('common.financialYearShort', { year }) }))}
                ariaLabel={t('common.financialYear')}
              />
            </FilterControl>
          )}
          {allowedFilters.includes('from') && (
            <FilterControl label={t('common.from')}>
              <DateInput
                value={draft.from}
                onChange={(event) => setDraft((state) => ({ ...state, from: event.target.value }))}
                aria-label={t('common.from')}
              />
            </FilterControl>
          )}
          {allowedFilters.includes('to') && (
            <FilterControl label={key === 'balance-sheet' ? t('reports.asOn') : t('common.to')}>
              <DateInput
                value={draft.to}
                onChange={(event) => setDraft((state) => ({ ...state, to: event.target.value }))}
                aria-label={t('common.to')}
              />
            </FilterControl>
          )}
          {allowedFilters.includes('departmentId') && (
            <FilterControl label={t('common.department')}>
              <SimpleSelect
                value={draft.departmentId || 'all'}
                onValueChange={(value) => setDraft((state) => ({ ...state, departmentId: value === 'all' ? '' : value }))}
                options={[
                  { value: 'all', label: t('common.allDepartments') },
                  ...(masters?.departments ?? []).map((d) => ({ value: d.id, label: d.name })),
                ]}
                ariaLabel={t('common.department')}
              />
            </FilterControl>
          )}
          {allowedFilters.includes('fundId') && (
            <FilterControl label={t('common.fund')}>
              <SimpleSelect
                value={draft.fundId || 'all'}
                onValueChange={(value) => setDraft((state) => ({ ...state, fundId: value === 'all' ? '' : value }))}
                options={[
                  { value: 'all', label: t('common.allFunds') },
                  ...(masters?.funds ?? []).map((f) => ({ value: f.id, label: f.name })),
                ]}
                ariaLabel={t('common.fund')}
              />
            </FilterControl>
          )}
          {allowedFilters.includes('categoryId') && (
            <FilterControl label={t('common.category')}>
              <SimpleSelect
                value={draft.categoryId || 'all'}
                onValueChange={(value) => setDraft((state) => ({ ...state, categoryId: value === 'all' ? '' : value }))}
                options={[
                  { value: 'all', label: t('common.allCategories') },
                  ...(masters?.categories ?? []).map((c) => ({ value: c.id, label: c.name })),
                ]}
                ariaLabel={t('common.category')}
              />
            </FilterControl>
          )}
          {allowedFilters.includes('supplierId') && (
            <FilterControl label={t('common.supplier')}>
              <SimpleSelect
                value={draft.supplierId || 'all'}
                onValueChange={(value) => setDraft((state) => ({ ...state, supplierId: value === 'all' ? '' : value }))}
                options={[
                  { value: 'all', label: t('common.allSuppliers') },
                  ...(masters?.suppliers ?? []).map((v) => ({ value: v.id, label: v.name })),
                ]}
                ariaLabel={t('common.supplier')}
              />
            </FilterControl>
          )}
          {allowedFilters.includes('accountId') && (
            <FilterControl label={t('common.account')}>
              <SimpleSelect
                value={draft.accountId || 'all'}
                onValueChange={(value) => setDraft((state) => ({ ...state, accountId: value === 'all' ? '' : value }))}
                options={[
                  { value: 'all', label: t('common.allAccounts') },
                  ...(masters?.accounts ?? []).map((a) => ({ value: a.id, label: `${a.code} — ${a.name}` })),
                ]}
                ariaLabel={t('common.account')}
              />
            </FilterControl>
          )}

          <div className="flex items-center gap-2">
            <Button onClick={applyFilters} loading={isFetching && !isLoading}>
              <Filter className="h-3.5 w-3.5" aria-hidden="true" />
              {t('reports.applyFilters')}
            </Button>
            <Button variant="outline" onClick={resetFilters}>
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              {t('common.reset')}
            </Button>
          </div>
        </div>
      </SectionCard>

      {isLoading ? (
        <div className="space-y-4">
          <ChartSkeleton height={90} />
          <ChartSkeleton height={260} />
        </div>
      ) : (
        <>
          {data && data.summary.length > 0 && (
            <div
              className={cn(
                'mb-4 grid gap-3',
                data.summary.length === 2 ? 'sm:grid-cols-2' : data.summary.length >= 4 ? 'sm:grid-cols-2 xl:grid-cols-4' : 'sm:grid-cols-3',
              )}
            >
              {data.summary.map((item) => (
                <div key={item.label} className="rounded-card border border-line bg-white p-4 shadow-card">
                  <p className="text-[12px] font-medium text-ink-muted">{item.label}</p>
                  <p
                    className={cn(
                      'mt-1.5 text-[20px] font-semibold tracking-tight tnum',
                      item.tone === 'positive' && 'text-success',
                      item.tone === 'negative' && 'text-accent-ink',
                      item.tone === 'accent' && 'text-brand',
                      (!item.tone || item.tone === 'default') && 'text-ink',
                    )}
                  >
                    {item.type === 'currency' ? formatCurrency(item.value) : formatNumber(item.value)}
                  </p>
                </div>
              ))}
            </div>
          )}

          {data?.charts.map((chart) => (
            <SectionCard key={chart.title} title={chart.title} className="mb-4">
              {chart.type === 'bar' && (
                <BarChart data={chart.data} xKey={chart.xKey} series={chart.series} height={280} />
              )}
              {chart.type === 'line' && (
                <LineChart data={chart.data} xKey={chart.xKey} series={chart.series} height={280} />
              )}
              {chart.type === 'donut' && (
                <DonutChart
                  data={chart.data.map((row) => ({
                    name: String(row[chart.xKey]),
                    value: Number(row[chart.series[0].key] ?? 0),
                  }))}
                />
              )}
            </SectionCard>
          ))}

          <SectionCard
            title={t('reports.data')}
            description={
              data
                ? t('reports.dataSummary', { count: data.rows.length, from: formatDate(data.period.from), to: formatDate(data.period.to) })
                : undefined
            }
            noPadding
          >
            {isFetching && !data ? (
              <TableSkeleton />
            ) : !data?.rows.length ? (
              <EmptyState
                title={t('reports.noData')}
                description={t('reports.noDataText')}
                action={
                  <Button variant="outline" size="sm" onClick={resetFilters}>
                    {t('common.clearFilters')}
                  </Button>
                }
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b border-line bg-canvas/60">
                      {data.columns.map((column) => (
                        <th
                          key={column.key}
                          scope="col"
                          className={cn(
                            'whitespace-nowrap px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted',
                            column.align === 'right' ? 'text-right' : 'text-left',
                          )}
                        >
                          {column.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {data.rows.map((row, index) => (
                      <tr key={index} className="transition-colors hover:bg-canvas/60">
                        {data.columns.map((column) => (
                          <td
                            key={column.key}
                            className={cn(
                              'px-3 py-2.5 text-[12.5px] text-ink',
                              column.align === 'right' ? 'text-right tnum' : 'text-left',
                            )}
                          >
                            {renderCell(column, row[column.key])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                  {data.totalsRow && (
                    <tfoot className="border-t-2 border-brand-primary/30 bg-brand-light/40">
                      <tr>
                        {data.columns.map((column) => (
                          <td
                            key={column.key}
                            className={cn(
                              'px-3 py-2.5 text-[12.5px] font-semibold text-ink',
                              column.align === 'right' ? 'text-right tnum' : 'text-left',
                            )}
                          >
                            {renderCell(column, data.totalsRow![column.key])}
                          </td>
                        ))}
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            )}
          </SectionCard>
        </>
      )}
    </>
  );
}

function FilterControl({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex w-full flex-col gap-1 sm:w-[160px]">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function renderCell(column: ReportColumn, value: unknown): string {
  if (value === null || value === undefined || value === '') return column.align === 'right' ? '—' : '';
  switch (column.type) {
    case 'currency':
      return formatCurrency(Number(value), { decimals: true });
    case 'percent':
      return `${Number(value).toFixed(1)}%`;
    case 'date':
      return formatDate(String(value));
    case 'number':
      return formatNumber(Number(value));
    default:
      return String(value);
  }
}

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  BookOpen,
  Building2,
  Calculator,
  ChevronRight,
  CreditCard,
  FileSearch,
  FileText,
  Gift,
  HeartHandshake,
  PieChart,
  PiggyBank,
  Receipt,
  Scale,
  Target,
  TrendingUp,
  Wallet,
  Waves,
  type LucideIcon,
} from 'lucide-react';
import { REPORT_DEFINITIONS, type ReportDefinition } from '@ashram/types';
import { api } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/queryClient';
import { PageHeader } from '@/components/layout/PageHeader';
import { SearchInput } from '@/components/common/FilterBar';
import { EmptyState } from '@/components/common/states';
import { formatDate } from '@/lib/utils/format';
import { useTranslation } from 'react-i18next';
import { useLabels } from '@/i18n/useLabels';

interface RecentReport {
  id: string;
  key: string;
  name: string;
  rowCount: number;
  createdAt: string;
  generatedBy: { id: string; name: string };
}

const GROUP_ORDER: ReportDefinition['group'][] = ['FINANCIAL', 'MANAGEMENT', 'DONATIONS', 'PAYABLES'];

/**
 * Explicit icon map. Importing the whole lucide namespace to look icons up by
 * name defeats tree-shaking and pulls the entire icon set into this chunk.
 */
const REPORT_ICONS: Record<string, LucideIcon> = {
  TrendingUp,
  Scale,
  Calculator,
  BookOpen,
  Waves,
  Wallet,
  PiggyBank,
  Building2,
  Target,
  PieChart,
  HeartHandshake,
  Gift,
  Receipt,
  CreditCard,
};

export default function ReportsPage() {
  const { t } = useTranslation();
  const labels = useLabels();
  const [search, setSearch] = useState('');

  const { data } = useQuery({
    queryKey: queryKeys.reports,
    queryFn: () => api.get<{ data: ReportDefinition[]; recent: RecentReport[] }>('/reports'),
  });

  const definitions = data?.data ?? REPORT_DEFINITIONS;

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return definitions;
    // Match in both languages, so a Marathi search finds reports whatever is shown.
    return definitions.filter((report) =>
      [report.name, report.description, labels.reports[report.key]?.name, labels.reports[report.key]?.description]
        .filter(Boolean)
        .some((text) => text!.toLowerCase().includes(needle)),
    );
  }, [definitions, search, labels]);

  return (
    <>
      <PageHeader
        title={t('reports.title')}
        subtitle={t('reports.subtitle')}
        actions={
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder={t('reports.searchPlaceholder')}
            className="w-full sm:w-64"
            delay={120}
          />
        }
      />

      {filtered.length === 0 ? (
        <EmptyState
          icon={FileSearch}
          title={t('reports.noMatch')}
          description={t('reports.noMatchText', { term: search })}
        />
      ) : (
        <div className="space-y-6">
          {GROUP_ORDER.map((group) => {
            const reports = filtered.filter((report) => report.group === group);
            if (reports.length === 0) return null;

            return (
              <section key={group}>
                <h2 className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
                  {labels.reportGroups[group]}
                </h2>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {reports.map((report) => (
                    <ReportCard key={report.key} report={report} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {data?.recent && data.recent.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
            {t('reports.recent')}
          </h2>
          <ul className="divide-y divide-line rounded-card border border-line bg-white shadow-card">
            {data.recent.map((report) => (
              <li key={report.id}>
                <Link
                  to={`/reports/${report.key}`}
                  className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-canvas"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-medium text-ink">
                      {labels.reports[report.key]?.name ?? report.name}
                    </span>
                    <span className="block text-[11.5px] text-ink-muted">
                      {t('reports.recentRow', {
                        count: report.rowCount,
                        name: report.generatedBy.name,
                        date: formatDate(report.createdAt, 'long'),
                      })}
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

/** Reusable report card — icon, title, description and a chevron. */
function ReportCard({ report }: { report: ReportDefinition }) {
  const labels = useLabels();
  const Icon = REPORT_ICONS[report.icon] ?? FileText;

  return (
    <Link
      to={report.route}
      className="group flex items-start gap-3 rounded-card border border-line bg-white p-4 shadow-card transition-all hover:border-brand-primary/40 hover:shadow-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/50"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-brand-light text-brand transition-colors group-hover:bg-brand group-hover:text-white">
        <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13.5px] font-semibold text-ink">{labels.reports[report.key]?.name ?? report.name}</span>
        <span className="mt-0.5 block text-[12px] leading-relaxed text-ink-muted">
          {labels.reports[report.key]?.description ?? report.description}
        </span>
      </span>
      <ChevronRight
        className="mt-1 h-4 w-4 shrink-0 text-ink-muted transition-transform group-hover:translate-x-0.5 group-hover:text-brand"
        aria-hidden="true"
      />
    </Link>
  );
}

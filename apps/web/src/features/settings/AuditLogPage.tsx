import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ScrollText } from 'lucide-react';
import { api, buildQuery } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/queryClient';
import { PageHeader } from '@/components/layout/PageHeader';
import { SectionCard } from '@/components/common/SectionCard';
import { FilterBar, FilterField } from '@/components/common/FilterBar';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/common/states';
import { TablePagination } from '@/components/common/DataTable';
import { Timeline, type TimelineEntry } from '@/components/common/Timeline';
import { SimpleSelect } from '@/components/ui/select';
import { DateInput } from '@/components/common/forms';
import { formatDate } from '@/lib/utils/format';
import { useTranslation } from 'react-i18next';
import { errorMessage } from '@/i18n/errors';

interface AuditResponse {
  data: (TimelineEntry & { entityType: string; ipAddress: string | null })[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
  actions: { action: string; count: number }[];
}

export default function AuditLogPage() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const params = useMemo(
    () => ({
      page,
      pageSize: 25,
      search: search || undefined,
      action: action || undefined,
      from: from || undefined,
      to: to || undefined,
    }),
    [page, search, action, from, to],
  );

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: queryKeys.auditLogs(params),
    queryFn: () => api.get<AuditResponse>('/audit-logs' + buildQuery(params)),
    placeholderData: (previous) => previous,
  });

  // Action keys contain dots, so read the whole map rather than key-path lookups.
  const actionLabels = t('timeline.actions', { returnObjects: true }) as Record<string, string>;

  function clear() {
    setSearch('');
    setAction('');
    setFrom('');
    setTo('');
    setPage(1);
  }

  if (error) return <ErrorState message={errorMessage(t, error)} onRetry={() => void refetch()} />;

  return (
    <>
      <PageHeader
        title={t('settings.auditTitle')}
        subtitle={t('audit.subtitle')}
        breadcrumbs={[{ label: t('settings.title'), to: '/settings' }, { label: t('settings.auditTitle') }]}
      />

      <SectionCard noPadding>
        <div className="border-b border-line p-3">
          <FilterBar
            search={search}
            onSearchChange={(value) => {
              setSearch(value);
              setPage(1);
            }}
            searchPlaceholder={t('audit.searchPlaceholder')}
            activeCount={[action, from, to].filter(Boolean).length}
            onClear={clear}
            filters={
              <>
                <FilterField label={t('audit.action')}>
                  <SimpleSelect
                    value={action || 'all'}
                    onValueChange={(value) => {
                      setAction(value === 'all' ? '' : value);
                      setPage(1);
                    }}
                    options={[
                      { value: 'all', label: t('audit.allActions') },
                      ...(data?.actions ?? []).map((item) => ({
                        value: item.action,
                        label: actionLabels[item.action] ?? item.action.replace(/[._]/g, ' '),
                        hint: String(item.count),
                      })),
                    ]}
                    ariaLabel={t('audit.filterAction')}
                  />
                </FilterField>
                <FilterField label={t('common.from')}>
                  <DateInput value={from} onChange={(event) => setFrom(event.target.value)} aria-label={t('audit.fromDate')} />
                </FilterField>
                <FilterField label={t('common.to')}>
                  <DateInput value={to} onChange={(event) => setTo(event.target.value)} aria-label={t('audit.toDate')} />
                </FilterField>
              </>
            }
          />
        </div>

        {isLoading ? (
          <TableSkeleton columns={4} rows={8} />
        ) : !data?.data.length ? (
          <EmptyState
            icon={ScrollText}
            title={t('audit.empty')}
            description={t('audit.emptyText')}
          />
        ) : (
          <>
            <div className="p-4 sm:p-5">
              <Timeline entries={data.data} />
            </div>
            <TablePagination
              page={data.meta.page}
              pageSize={data.meta.pageSize}
              total={data.meta.total}
              totalPages={data.meta.totalPages}
              onPageChange={setPage}
            />
          </>
        )}
      </SectionCard>

      {data?.data.length ? (
        <p className="mt-3 text-center text-[11.5px] text-ink-muted">
          {t('audit.showingUpTo', { date: formatDate(data.data[0].timestamp, 'long') })}
        </p>
      ) : null}
    </>
  );
}

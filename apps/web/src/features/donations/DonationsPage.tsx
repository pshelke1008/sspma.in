import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { HeartHandshake, Plus, Users, Wallet } from 'lucide-react';
import { DONATION_MODES } from '@ashram/types';
import { useTranslation } from 'react-i18next';
import { useLabels } from '@/i18n/useLabels';
import { api, buildQuery } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/queryClient';
import { useMasters } from '@/lib/api/hooks';
import { useAuth } from '@/lib/auth/AuthProvider';
import { fetchAllPages, type ExportColumn } from '@/lib/export';
import { PageHeader } from '@/components/layout/PageHeader';
import { SectionCard } from '@/components/common/SectionCard';
import { StatCard } from '@/components/common/StatCard';
import { FilterBar, FilterField } from '@/components/common/FilterBar';
import { CardGridSkeleton, EmptyState } from '@/components/common/states';
import { DataTable } from '@/components/common/DataTable';
import { ExportMenu } from '@/components/common/ExportMenu';
import { DonationDialog } from './DonationDialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SimpleSelect } from '@/components/ui/select';
import { DonutChart } from '@/components/charts';
import { formatCurrency, formatDate } from '@/lib/utils/format';

interface DonationRow {
  id: string;
  receiptNumber: string;
  date: string;
  donorName: string;
  amount: number;
  mode: string;
  purpose: string | null;
  referenceNumber: string | null;
  is80GEligible: boolean;
  fund: { id: string; name: string };
  department: { id: string; name: string } | null;
  bankAccount: { id: string; name: string } | null;
  donor: { id: string; name: string } | null;
}

interface DonationListResponse {
  data: DonationRow[];
  meta: { page: number; pageSize: number; total: number; totalPages: number; totalAmount: number };
}

export default function DonationsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { can } = useAuth();
  const { data: masters } = useMasters();
  const [dialogOpen, setDialogOpen] = useState(searchParams.get('new') === '1');

  const { t } = useTranslation();
  const labels = useLabels();

  useEffect(() => {
    if (searchParams.get('new') === '1') setDialogOpen(true);
  }, [searchParams]);

  const page = Number(searchParams.get('page') ?? '1');
  const search = searchParams.get('search') ?? '';
  const fundId = searchParams.get('fund') ?? '';
  const mode = searchParams.get('mode') ?? '';
  const activeFilterCount = [fundId, mode].filter(Boolean).length;

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setSearchParams(next, { replace: true });
  }

  const clearFilters = () => setSearchParams(new URLSearchParams(), { replace: true });

  const filters = useMemo(
    () => ({ search: search || undefined, fundId: fundId || undefined, mode: mode || undefined }),
    [search, fundId, mode],
  );
  const params = useMemo(() => ({ page, pageSize: 20, ...filters }), [page, filters]);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: queryKeys.donations(params),
    queryFn: () => api.get<DonationListResponse>('/donations' + buildQuery(params)),
    placeholderData: (previous) => previous,
  });

  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: queryKeys.donationSummary,
    queryFn: () =>
      api.get<{ totalAmount: number; totalCount: number; thisMonth: number; donorCount: number; byFund: { name: string; amount: number }[] }>(
        '/donations/summary',
      ),
  });

  const columns = useMemo<ColumnDef<DonationRow>[]>(
    () => [
      {
        id: 'receiptNumber',
        header: t('donations.receiptNumber'),
        enableHiding: false,
        cell: ({ row }) => <span className="font-medium text-ink">{row.original.receiptNumber}</span>,
      },
      {
        id: 'date',
        header: t('common.date'),
        cell: ({ row }) => <span className="whitespace-nowrap text-ink-muted">{formatDate(row.original.date)}</span>,
      },
      {
        id: 'donor',
        header: t('donations.donor'),
        cell: ({ row }) => (
          <div className="max-w-[260px]">
            {row.original.donor ? (
              <Link to={`/donors/${row.original.donor.id}`} className="font-medium text-brand-primary hover:underline">
                {row.original.donorName}
              </Link>
            ) : (
              <p className="font-medium text-ink">{row.original.donorName}</p>
            )}
            {row.original.purpose && <p className="truncate text-[11.5px] text-ink-muted">{row.original.purpose}</p>}
          </div>
        ),
      },
      {
        id: 'fund',
        header: t('common.fund'),
        cell: ({ row }) => <span className="text-ink-muted">{row.original.fund.name}</span>,
      },
      {
        id: 'mode',
        header: t('donations.mode'),
        cell: ({ row }) => <span className="text-ink-muted">{labels.donationMode[row.original.mode] ?? row.original.mode}</span>,
      },
      {
        id: 'eligible80G',
        header: '80G',
        cell: ({ row }) =>
          row.original.is80GEligible ? <Badge tone="success">80G</Badge> : <span className="text-[12px] text-ink-muted">—</span>,
      },
      {
        id: 'amount',
        header: t('common.amount'),
        enableHiding: false,
        meta: { align: 'right' },
        cell: ({ row }) => <span className="font-semibold text-success">{formatCurrency(row.original.amount)}</span>,
      },
    ],
    [t, labels],
  );

  const exportColumns: ExportColumn<DonationRow>[] = [
    { header: t('donations.receiptNumber'), value: (row) => row.receiptNumber },
    { header: t('common.date'), type: 'date', value: (row) => row.date },
    { header: t('donations.donor'), value: (row) => row.donorName },
    { header: t('donations.purpose'), value: (row) => row.purpose },
    { header: t('common.fund'), value: (row) => row.fund.name },
    { header: t('common.department'), value: (row) => row.department?.name },
    { header: t('donations.mode'), value: (row) => labels.donationMode[row.mode] ?? row.mode },
    { header: t('donations.receivedIn'), value: (row) => row.bankAccount?.name },
    { header: t('common.referenceNumber'), value: (row) => row.referenceNumber },
    { header: t('dataExport.cols.eligible80G'), value: (row) => (row.is80GEligible ? t('common.yes') : t('common.no')) },
    { header: t('common.amount'), type: 'currency', value: (row) => row.amount },
  ];

  const receiveButton = (size?: 'sm') =>
    can('donation.create') && (
      <Button size={size} onClick={() => setDialogOpen(true)}>
        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
        {t('donations.receive')}
      </Button>
    );

  return (
    <>
      <PageHeader
        title={t('donations.title')}
        subtitle={t('donations.subtitle')}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ExportMenu
              fileBase="donations"
              title={t('donations.title')}
              columns={exportColumns}
              fetchRows={() =>
                fetchAllPages((pageNumber, pageSize) =>
                  api.get<DonationListResponse>('/donations' + buildQuery({ ...filters, page: pageNumber, pageSize })),
                )
              }
            />
            {receiveButton()}
          </div>
        }
      />

      {summaryLoading ? (
        <CardGridSkeleton count={3} className="xl:grid-cols-3" />
      ) : (
        <div className="grid gap-3 sm:grid-cols-3">
          <StatCard label={t('donations.totalReceived')} value={summary?.totalAmount ?? 0} icon={HeartHandshake} tone="success" hint={t('donations.receipts', { count: summary?.totalCount ?? 0 })} />
          <StatCard label={t('donations.thisMonth')} value={summary?.thisMonth ?? 0} icon={Wallet} tone="brand" />
          <StatCard label={t('donations.registeredDonors')} value={summary?.donorCount ?? 0} format="number" icon={Users} tone="accent" hint={t('donations.registeredDonorsHint')} />
        </div>
      )}

      {summary && summary.byFund.length > 0 && (
        <SectionCard title={t('donations.byFund')} className="mt-4">
          <DonutChart
            data={summary.byFund.map((item) => ({ name: item.name, value: item.amount }))}
            centerLabel={{ title: t('common.total'), value: formatCurrency(summary.totalAmount, { compact: true }) }}
          />
        </SectionCard>
      )}

      <SectionCard className="mt-4" noPadding>
        <div className="border-b border-line p-3">
          <FilterBar
            search={search}
            onSearchChange={(value) => setParam('search', value)}
            searchPlaceholder={t('donations.searchPlaceholder')}
            activeCount={activeFilterCount}
            onClear={clearFilters}
            filters={
              <>
                <FilterField label={t('common.fund')}>
                  <SimpleSelect
                    value={fundId || 'all'}
                    onValueChange={(value) => setParam('fund', value === 'all' ? '' : value)}
                    options={[
                      { value: 'all', label: t('common.allFunds') },
                      ...(masters?.funds ?? []).map((f) => ({ value: f.id, label: f.name })),
                    ]}
                    ariaLabel={t('expenses.filterFund')}
                  />
                </FilterField>
                <FilterField label={t('donations.mode')}>
                  <SimpleSelect
                    value={mode || 'all'}
                    onValueChange={(value) => setParam('mode', value === 'all' ? '' : value)}
                    options={[
                      { value: 'all', label: t('donations.allModes') },
                      ...DONATION_MODES.map((item) => ({ value: item, label: labels.donationMode[item] })),
                    ]}
                    ariaLabel={t('donations.filterMode')}
                  />
                </FilterField>
              </>
            }
          />
        </div>

        <DataTable
          columns={columns}
          data={data?.data ?? []}
          isLoading={isLoading}
          error={error as Error | null}
          onRetry={() => void refetch()}
          onClearFilters={clearFilters}
          getRowId={(row) => row.id}
          emptyState={
            activeFilterCount || search ? undefined : (
              <EmptyState
                icon={HeartHandshake}
                title={t('donations.emptyTitle')}
                description={t('donations.emptyText')}
                action={receiveButton('sm')}
              />
            )
          }
          footer={
            data
              ? ({ visibleColumnCount }) => (
                  <tr>
                    <td colSpan={visibleColumnCount - 1} className="px-3 py-2.5 text-[12.5px] font-semibold text-ink">
                      {t('donations.totalFiltered')}
                    </td>
                    <td className="px-3 py-2.5 text-right text-[12.5px] font-semibold text-ink tnum">
                      {formatCurrency(data.meta.totalAmount)}
                    </td>
                  </tr>
                )
              : undefined
          }
          mobileCard={(row) => (
            <div className="flex items-start gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-ink">{row.donorName}</p>
                <p className="mt-0.5 truncate text-[11.5px] text-ink-muted">
                  {row.receiptNumber} · {row.fund.name}
                </p>
                <p className="mt-0.5 text-[11.5px] text-ink-muted">
                  {formatDate(row.date)} · {labels.donationMode[row.mode] ?? row.mode}
                </p>
              </div>
              <span className="shrink-0 text-[13px] font-semibold text-success tnum">{formatCurrency(row.amount)}</span>
            </div>
          )}
          pagination={
            data
              ? {
                  page: data.meta.page,
                  pageSize: data.meta.pageSize,
                  total: data.meta.total,
                  totalPages: data.meta.totalPages,
                  onPageChange: (value) => setParam('page', String(value)),
                }
              : undefined
          }
        />
      </SectionCard>

      <DonationDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open && searchParams.get('new')) {
            const next = new URLSearchParams(searchParams);
            next.delete('new');
            setSearchParams(next, { replace: true });
          }
        }}
      />
    </>
  );
}

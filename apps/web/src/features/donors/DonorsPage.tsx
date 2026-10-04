import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { useTranslation } from 'react-i18next';
import { Contact, HeartHandshake, MessageCircle, Plus, Sparkles, Upload, UserCheck } from 'lucide-react';
import { toast } from 'sonner';
import { DONOR_CATEGORIES } from '@ashram/types';
import { api, buildQuery } from '@/lib/api/client';
import { invalidateDonationData, queryKeys } from '@/lib/api/queryClient';
import { useAuth } from '@/lib/auth/AuthProvider';
import { errorMessage } from '@/i18n/errors';
import { useLabels } from '@/i18n/useLabels';
import { PageHeader } from '@/components/layout/PageHeader';
import { SectionCard } from '@/components/common/SectionCard';
import { StatCard } from '@/components/common/StatCard';
import { FilterBar, FilterField } from '@/components/common/FilterBar';
import { CardGridSkeleton, EmptyState } from '@/components/common/states';
import { ConfirmationDialog } from '@/components/common/ConfirmationDialog';
import { DataTable } from '@/components/common/DataTable';
import { ExportMenu } from '@/components/common/ExportMenu';
import { fetchAllPages, type ExportColumn } from '@/lib/export';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SimpleSelect } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatCurrency, formatDate } from '@/lib/utils/format';
import { BroadcastDialog } from '@/features/whatsapp/BroadcastDialog';
import { BroadcastHistory } from '@/features/whatsapp/BroadcastHistory';
import { SendMessageDialog } from '@/features/whatsapp/SendMessageDialog';
import { DonationDialog } from '@/features/donations/DonationDialog';
import { DonorRowActions, type DonorAction } from './DonorRowActions';
import { formatPlace, useDonorLocations } from './useDonorLocations';
import { DonorImportDialog } from './DonorImportDialog';
import { DonorFormDialog } from './DonorFormDialog';
import type { DonorListResponse, DonorRow, DonorSummary } from './types';

const SORTS = {
  name: { sortBy: 'name', sortDir: 'asc' },
  given: { sortBy: 'totalDonated', sortDir: 'desc' },
  recent: { sortBy: 'lastDonation', sortDir: 'desc' },
  newest: { sortBy: 'createdAt', sortDir: 'desc' },
} as const;

type SortKey = keyof typeof SORTS;

export default function DonorsPage() {
  const { t } = useTranslation();
  const labels = useLabels();
  const navigate = useNavigate();
  const { can } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const canMessage = can('whatsapp.send');

  const tab = searchParams.get('tab') === 'broadcasts' && canMessage ? 'broadcasts' : 'donors';
  const page = Number(searchParams.get('page') ?? '1');
  const search = searchParams.get('search') ?? '';
  const category = searchParams.get('category') ?? '';
  const tag = searchParams.get('tag') ?? '';
  const optIn = searchParams.get('optIn') ?? '';
  const status = searchParams.get('status') ?? 'active';
  const state = searchParams.get('state') ?? '';
  const district = searchParams.get('district') ?? '';
  const village = searchParams.get('village') ?? '';
  const sort = (searchParams.get('sort') as SortKey) in SORTS ? (searchParams.get('sort') as SortKey) : 'name';

  const [formOpen, setFormOpen] = useState(searchParams.get('new') === '1');
  const [importOpen, setImportOpen] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectingAll, setSelectingAll] = useState(false);
  const [broadcastIds, setBroadcastIds] = useState<string[] | null>(null);
  const [editing, setEditing] = useState<DonorRow | null>(null);
  const [donatingFor, setDonatingFor] = useState<DonorRow | null>(null);
  const [messaging, setMessaging] = useState<DonorRow | null>(null);
  const [confirming, setConfirming] = useState<{ action: 'deactivate' | 'delete'; donor: DonorRow } | null>(null);

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page' && key !== 'tab') next.delete('page');
    // A district belongs to a state and a village to a district, so narrowing
    // a broader level clears the finer ones beneath it.
    if (key === 'state') {
      next.delete('district');
      next.delete('village');
    }
    if (key === 'district') next.delete('village');
    setSearchParams(next, { replace: true });
  }

  const { data: locations } = useDonorLocations({ state, district }, tab === 'donors');

  const donorAction = useMutation({
    mutationFn: ({ action, donor }: { action: 'deactivate' | 'restore' | 'delete'; donor: DonorRow }) =>
      action === 'delete'
        ? api.delete(`/donors/${donor.id}/permanent`)
        : action === 'restore'
          ? api.post(`/donors/${donor.id}/restore`)
          : api.delete(`/donors/${donor.id}`),
    onSuccess: (_, { action }) => {
      toast.success(
        action === 'delete' ? t('donors.deleted') : action === 'restore' ? t('donors.restored') : t('donors.deactivated'),
      );
      setConfirming(null);
      invalidateDonationData();
    },
    onError: (err, { action }) => {
      setConfirming(null);
      toast.error(action === 'delete' ? t('donors.deleteFailed') : t('donors.saveFailed'), {
        description: errorMessage(t, err),
      });
    },
  });

  function handleAction(action: DonorAction, donor: DonorRow) {
    if (action === 'view') navigate(`/donors/${donor.id}`);
    else if (action === 'edit') setEditing(donor);
    else if (action === 'donation') setDonatingFor(donor);
    else if (action === 'message') setMessaging(donor);
    else if (action === 'restore') donorAction.mutate({ action, donor });
    else setConfirming({ action, donor });
  }

  const filters = useMemo(
    () => ({
      search: search || undefined,
      category: category || undefined,
      tag: tag || undefined,
      optIn: optIn || undefined,
      state: state || undefined,
      district: district || undefined,
      village: village || undefined,
      status,
      ...SORTS[sort],
    }),
    [search, category, tag, optIn, state, district, village, status, sort],
  );
  const params = useMemo(() => ({ ...filters, page, pageSize: 25 }), [filters, page]);

  // A selection belongs to the filters it was made under.
  useEffect(() => {
    setSelected(new Set());
  }, [filters]);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: queryKeys.donors(params),
    queryFn: () => api.get<DonorListResponse>('/donors' + buildQuery(params)),
    placeholderData: (previous) => previous,
    enabled: tab === 'donors',
  });

  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: queryKeys.donorSummary,
    queryFn: () => api.get<DonorSummary>('/donors/summary'),
  });

  const rows = data?.data ?? [];
  const total = data?.meta.total ?? 0;
  const pageIds = rows.map((row) => row.id);
  const pageSelectedCount = pageIds.filter((id) => selected.has(id)).length;
  const allPageSelected = pageIds.length > 0 && pageSelectedCount === pageIds.length;
  const allMatchingSelected = total > 0 && selected.size >= total;
  const activeFilters = [category, tag, optIn, state, district, village, status !== 'active' ? status : ''].filter(Boolean).length;

  function togglePage(checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      for (const id of pageIds) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  function toggleOne(id: string, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function selectAllMatching() {
    setSelectingAll(true);
    try {
      const result = await api.get<{ data: string[] }>('/donors/ids' + buildQuery(filters));
      setSelected(new Set(result.data));
    } catch (err) {
      toast.error(t('donors.selectAllFailed'), { description: errorMessage(t, err) });
    } finally {
      setSelectingAll(false);
    }
  }

  const optInShare = summary?.totalDonors ? Math.round((summary.optedIn / summary.totalDonors) * 100) : 0;
  const clearFilters = () => setSearchParams(new URLSearchParams(), { replace: true });

  const columns = useMemo<ColumnDef<DonorRow>[]>(
    () => [
      {
        id: 'name',
        header: t('donations.donor'),
        enableHiding: false,
        cell: ({ row: { original: row } }) => (
          <>
            <Link
              to={`/donors/${row.id}`}
              onClick={(event) => event.stopPropagation()}
              className="text-[13px] font-medium text-ink hover:text-brand-primary hover:underline"
            >
              {row.name}
            </Link>
            <p className="mt-0.5 flex flex-wrap items-center gap-1 text-[11.5px] text-ink-muted">
              <span>{row.code}</span>
              <span aria-hidden="true">·</span>
              <span>{labels.donorCategory[row.category] ?? row.category}</span>
              {!row.isActive && <Badge tone="neutral">{t('common.inactive')}</Badge>}
              {row.tags.slice(0, 3).map((item) => (
                <Badge key={item} tone="brand">
                  {item}
                </Badge>
              ))}
            </p>
          </>
        ),
      },
      {
        id: 'contact',
        header: t('donors.contact'),
        cell: ({ row: { original: row } }) => (
          <div className="text-ink-muted">
            <p className="text-ink">{row.phone ?? row.whatsappNumber ?? '—'}</p>
            {(row.village || row.district) && <p className="text-[11.5px]">{formatPlace(row)}</p>}
          </div>
        ),
      },
      {
        id: 'whatsapp',
        header: 'WhatsApp',
        cell: ({ row }) => <ConsentBadge row={row.original} />,
      },
      {
        id: 'totalGiven',
        header: t('donors.totalGiven'),
        meta: { align: 'right' },
        cell: ({ row: { original: row } }) => (
          <>
            <p className="font-semibold text-ink tnum">{formatCurrency(row.stats.totalDonated)}</p>
            <p className="text-[11px] text-ink-muted">{t('donors.donationCount', { count: row.stats.donationCount })}</p>
          </>
        ),
      },
      {
        id: 'lastDonation',
        header: t('donors.lastDonation'),
        cell: ({ row }) => <span className="whitespace-nowrap text-ink-muted">{formatDate(row.original.stats.lastDonationAt)}</span>,
      },
      {
        id: 'actions',
        header: () => <span className="sr-only">{t('common.actions')}</span>,
        enableHiding: false,
        size: 56,
        meta: { align: 'right' },
        cell: ({ row }) => <DonorRowActions donor={row.original} onAction={handleAction} />,
      },
    ],
    // handleAction only sets state and navigates, so a stale closure is harmless.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, labels],
  );

  const exportColumns: ExportColumn<DonorRow>[] = [
    { header: t('common.code'), value: (row) => row.code },
    { header: t('common.name'), value: (row) => row.name },
    { header: t('common.category'), value: (row) => labels.donorCategory[row.category] ?? row.category },
    { header: t('common.phone'), value: (row) => row.phone },
    { header: 'WhatsApp', value: (row) => row.whatsappNumber },
    { header: t('common.email'), value: (row) => row.email },
    { header: t('donors.village'), value: (row) => row.village },
    { header: t('donors.district'), value: (row) => row.district },
    { header: t('common.state'), value: (row) => row.state },
    { header: t('dataExport.cols.tags'), value: (row) => row.tags.join(', ') },
    { header: t('donors.whatsappConsent'), value: (row) => (row.whatsappOptIn ? t('donors.consentYes') : t('donors.consentNo')) },
    { header: t('donors.totalGiven'), type: 'currency', value: (row) => row.stats.totalDonated },
    { header: t('dataExport.cols.donationCount'), type: 'number', value: (row) => row.stats.donationCount },
    { header: t('donors.lastDonation'), type: 'date', value: (row) => row.stats.lastDonationAt },
    { header: t('common.status'), value: (row) => (row.isActive ? t('common.active') : t('common.inactive')) },
  ];

  return (
    <>
      <PageHeader
        title={t('donors.title')}
        subtitle={t('donors.subtitle')}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {tab === 'donors' && (
              <ExportMenu
                fileBase="donors"
                title={t('donors.title')}
                columns={exportColumns}
                fetchRows={() =>
                  fetchAllPages(
                    (pageNumber, pageSize) =>
                      api.get<DonorListResponse>('/donors' + buildQuery({ ...filters, page: pageNumber, pageSize })),
                    { pageSize: 200 },
                  )
                }
              />
            )}
            {can('donation.create') && (
              <Button variant="outline" onClick={() => setReceiveOpen(true)}>
                <HeartHandshake className="h-3.5 w-3.5" aria-hidden="true" />
                {t('donations.receive')}
              </Button>
            )}
            {can('donor.manage') && (
              <Button variant="outline" onClick={() => setImportOpen(true)}>
                <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                {t('donorImport.open')}
              </Button>
            )}
            {can('donor.manage') && (
              <Button onClick={() => setFormOpen(true)}>
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                {t('donors.addDonor')}
              </Button>
            )}
          </div>
        }
      />

      {summaryLoading ? (
        <CardGridSkeleton count={4} />
      ) : (
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <StatCard label={t('donors.activeDonors')} value={summary?.totalDonors ?? 0} format="number" icon={Contact} tone="brand" />
          <StatCard
            label={t('donors.optedIn')}
            value={summary?.optedIn ?? 0}
            format="number"
            icon={MessageCircle}
            tone="success"
            hint={t('donors.optedInShare', { percent: optInShare })}
          />
          <StatCard
            label={t('donors.totalGiven')}
            value={summary?.totalDonated ?? 0}
            icon={HeartHandshake}
            tone="accent"
            compact
            hint={t('donors.donorsWhoGave', { count: summary?.donorsWhoGave ?? 0 })}
          />
          <StatCard label={t('donors.newThisMonth')} value={summary?.newThisMonth ?? 0} format="number" icon={Sparkles} tone="info" />
        </div>
      )}

      <Tabs value={tab} onValueChange={(value) => setParam('tab', value === 'donors' ? '' : value)} className="mt-4">
        {canMessage && (
          <TabsList className="w-fit">
            <TabsTrigger value="donors">{t('donors.listTab')}</TabsTrigger>
            <TabsTrigger value="broadcasts">{t('whatsapp.broadcastsTab')}</TabsTrigger>
          </TabsList>
        )}

        <TabsContent value="donors" className={canMessage ? undefined : 'mt-0'}>
          <SectionCard noPadding>
            <div className="border-b border-line p-3">
              <FilterBar
                search={search}
                onSearchChange={(value) => setParam('search', value)}
                searchPlaceholder={t('donors.searchPlaceholder')}
                activeCount={activeFilters}
                onClear={clearFilters}
                filters={
                  <>
                    <FilterField label={t('common.category')}>
                      <SimpleSelect
                        value={category || 'all'}
                        onValueChange={(value) => setParam('category', value === 'all' ? '' : value)}
                        options={[
                          { value: 'all', label: t('common.allCategories') },
                          ...DONOR_CATEGORIES.map((item) => ({ value: item, label: labels.donorCategory[item] })),
                        ]}
                        ariaLabel={t('donors.filterCategory')}
                      />
                    </FilterField>
                    <FilterField label={t('common.state')}>
                      <SimpleSelect
                        value={state || 'all'}
                        onValueChange={(value) => setParam('state', value === 'all' ? '' : value)}
                        options={[
                          { value: 'all', label: t('donors.allStates') },
                          ...withCurrent(locations?.states, state).map((item) => ({ value: item.value, label: item.count ? `${item.value} (${item.count})` : item.value })),
                        ]}
                        ariaLabel={t('donors.filterState')}
                      />
                    </FilterField>
                    <FilterField label={t('donors.district')}>
                      <SimpleSelect
                        value={district || 'all'}
                        onValueChange={(value) => setParam('district', value === 'all' ? '' : value)}
                        options={[
                          { value: 'all', label: t('donors.allDistricts') },
                          ...withCurrent(locations?.districts, district).map((item) => ({ value: item.value, label: item.count ? `${item.value} (${item.count})` : item.value })),
                        ]}
                        ariaLabel={t('donors.filterDistrict')}
                      />
                    </FilterField>
                    <FilterField label={t('donors.village')}>
                      <SimpleSelect
                        value={village || 'all'}
                        onValueChange={(value) => setParam('village', value === 'all' ? '' : value)}
                        options={[
                          { value: 'all', label: t('donors.allVillages') },
                          ...withCurrent(locations?.villages, village).map((item) => ({ value: item.value, label: item.count ? `${item.value} (${item.count})` : item.value })),
                        ]}
                        ariaLabel={t('donors.filterVillage')}
                      />
                    </FilterField>
                    <FilterField label={t('donors.tag')}>
                      <SimpleSelect
                        value={tag || 'all'}
                        onValueChange={(value) => setParam('tag', value === 'all' ? '' : value)}
                        options={[
                          { value: 'all', label: t('donors.allTags') },
                          ...(summary?.tags ?? []).map((item) => ({ value: item, label: item })),
                        ]}
                        ariaLabel={t('donors.filterTag')}
                      />
                    </FilterField>
                    <FilterField label={t('donors.whatsappConsent')}>
                      <SimpleSelect
                        value={optIn || 'all'}
                        onValueChange={(value) => setParam('optIn', value === 'all' ? '' : value)}
                        options={[
                          { value: 'all', label: t('donors.allConsent') },
                          { value: 'yes', label: t('donors.consentYes') },
                          { value: 'no', label: t('donors.consentNo') },
                        ]}
                        ariaLabel={t('donors.whatsappConsent')}
                      />
                    </FilterField>
                    <FilterField label={t('common.status')}>
                      <SimpleSelect
                        value={status}
                        onValueChange={(value) => setParam('status', value === 'active' ? '' : value)}
                        options={[
                          { value: 'active', label: t('common.active') },
                          { value: 'inactive', label: t('common.inactive') },
                          { value: 'all', label: t('common.all') },
                        ]}
                        ariaLabel={t('common.status')}
                      />
                    </FilterField>
                    <FilterField label={t('donors.sortBy')}>
                      <SimpleSelect
                        value={sort}
                        onValueChange={(value) => setParam('sort', value === 'name' ? '' : value)}
                        options={(Object.keys(SORTS) as SortKey[]).map((key) => ({ value: key, label: t(`donors.sort.${key}`) }))}
                        ariaLabel={t('donors.sortBy')}
                      />
                    </FilterField>
                  </>
                }
              />
            </div>

            {canMessage && selected.size > 0 && (
              <div
                className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-brand-primary/20 bg-brand-light/60 px-4 py-2.5"
                aria-live="polite"
              >
                <p className="text-[12.5px] font-medium text-brand">{t('donors.selectedCount', { count: selected.size })}</p>
                {!allMatchingSelected && allPageSelected && total > pageIds.length && (
                  <Button variant="link" size="sm" className="h-auto px-0" loading={selectingAll} onClick={() => void selectAllMatching()}>
                    {t('donors.selectAllMatching', { count: total })}
                  </Button>
                )}
                <Button variant="link" size="sm" className="h-auto px-0 text-ink-muted" onClick={() => setSelected(new Set())}>
                  {t('donors.clearSelection')}
                </Button>
                <Button size="sm" className="ml-auto" onClick={() => setBroadcastIds(Array.from(selected))}>
                  <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />
                  {t('donors.sendWhatsApp')}
                </Button>
              </div>
            )}

            <DataTable
              columns={columns}
              data={rows}
              isLoading={isLoading}
              error={error as Error | null}
              onRetry={() => void refetch()}
              onClearFilters={clearFilters}
              getRowId={(row) => row.id}
              onRowClick={(row) => navigate(`/donors/${row.id}`)}
              showColumnToggle={false}
              tableClassName="min-w-[860px]"
              selection={
                canMessage
                  ? {
                      selectedIds: selected,
                      onToggleRow: toggleOne,
                      onTogglePage: togglePage,
                      rowLabel: (row) => t('donors.selectDonor', { name: row.name }),
                      pageLabel: t('donors.selectPage'),
                    }
                  : undefined
              }
              emptyState={
                search || activeFilters ? undefined : (
                  <EmptyState
                    icon={Contact}
                    title={t('donors.emptyTitle')}
                    description={t('donors.emptyText')}
                    action={
                      can('donor.manage') && (
                        <Button size="sm" onClick={() => setFormOpen(true)}>
                          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                          {t('donors.addDonor')}
                        </Button>
                      )
                    }
                  />
                )
              }
              mobileCard={(row) => (
                <Link
                  to={`/donors/${row.id}`}
                  className={`flex min-w-0 flex-1 items-start gap-3 py-3 pr-4 active:bg-canvas ${canMessage ? 'pl-3' : 'pl-4'}`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-medium text-ink">{row.name}</p>
                    <p className="mt-0.5 truncate text-[11.5px] text-ink-muted">
                      {row.code} · {row.phone ?? row.whatsappNumber ?? '—'}
                    </p>
                    {(row.village || row.district) && (
                      <p className="mt-0.5 truncate text-[11.5px] text-ink-muted">{formatPlace(row)}</p>
                    )}
                    <div className="mt-1.5">
                      <ConsentBadge row={row} />
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-[13px] font-semibold text-ink tnum">{formatCurrency(row.stats.totalDonated)}</p>
                    <p className="text-[11px] text-ink-muted">{formatDate(row.stats.lastDonationAt)}</p>
                  </div>
                </Link>
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
        </TabsContent>

        {canMessage && (
          <TabsContent value="broadcasts">
            <p className="mb-3 text-[12.5px] text-ink-muted">
              {t('whatsapp.campaign.donorsTabHint')}{' '}
              <Link to="/whatsapp/broadcasts" className="font-medium text-brand underline-offset-2 hover:underline">
                {t('whatsapp.campaign.openBroadcasts')}
              </Link>
            </p>
            <BroadcastHistory />
          </TabsContent>
        )}
      </Tabs>

      <DonorImportDialog open={importOpen} onOpenChange={setImportOpen} />

      <DonorFormDialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)} donor={editing} />

      <DonationDialog open={receiveOpen} onOpenChange={setReceiveOpen} />

      {donatingFor && (
        <DonationDialog
          open
          onOpenChange={(open) => !open && setDonatingFor(null)}
          donor={{ id: donatingFor.id, name: donatingFor.name }}
        />
      )}

      {messaging && (
        <SendMessageDialog
          open
          onOpenChange={(open) => !open && setMessaging(null)}
          donor={{ id: messaging.id, name: messaging.name, number: messaging.messaging.number }}
        />
      )}

      <ConfirmationDialog
        open={confirming !== null}
        onOpenChange={(open) => !open && setConfirming(null)}
        title={confirming?.action === 'delete' ? t('donors.deleteTitle') : t('donors.deactivateTitle')}
        description={
          confirming?.action === 'delete'
            ? t('donors.deleteText', { name: confirming.donor.name })
            : t('donors.deactivateText', { name: confirming?.donor.name ?? '' })
        }
        confirmLabel={confirming?.action === 'delete' ? t('donors.deletePermanently') : t('donors.deactivate')}
        tone="danger"
        loading={donorAction.isPending}
        onConfirm={() => confirming && donorAction.mutate(confirming)}
      />

      <DonorFormDialog
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open && searchParams.get('new')) setParam('new', '');
        }}
        onSaved={(donor) => navigate(`/donors/${donor.id}`)}
      />

      <BroadcastDialog
        open={broadcastIds !== null}
        onOpenChange={(open) => !open && setBroadcastIds(null)}
        donorIds={broadcastIds ?? []}
        onStarted={() => setSelected(new Set())}
      />
    </>
  );
}

function ConsentBadge({ row }: { row: DonorRow }) {
  const { t } = useTranslation();
  if (!row.messaging.number) return <Badge tone="neutral">{t('donors.noNumber')}</Badge>;
  if (!row.whatsappOptIn) return <Badge tone="warning">{t('donors.notOptedIn')}</Badge>;
  return (
    <Badge tone="success" className="gap-1">
      <UserCheck className="h-3 w-3" aria-hidden="true" />
      {t('donors.optedInBadge')}
    </Badge>
  );
}

/**
 * Keeps the chosen value in the list even when the narrowed options no longer
 * include it (e.g. a district typed with different spelling), so the select
 * never shows a blank.
 */
function withCurrent(options: { value: string; count: number }[] | undefined, current: string) {
  const list = options ?? [];
  if (!current || list.some((item) => item.value.toLowerCase() === current.toLowerCase())) return list;
  return [{ value: current, count: 0 }, ...list];
}

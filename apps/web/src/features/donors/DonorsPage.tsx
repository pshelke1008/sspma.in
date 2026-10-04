import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Contact, HeartHandshake, MessageCircle, Plus, Sparkles, UserCheck } from 'lucide-react';
import { toast } from 'sonner';
import { DONOR_CATEGORIES } from '@ashram/types';
import { api, buildQuery } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/queryClient';
import { useAuth } from '@/lib/auth/AuthProvider';
import { errorMessage } from '@/i18n/errors';
import { useLabels } from '@/i18n/useLabels';
import { PageHeader } from '@/components/layout/PageHeader';
import { SectionCard } from '@/components/common/SectionCard';
import { StatCard } from '@/components/common/StatCard';
import { FilterBar, FilterField } from '@/components/common/FilterBar';
import { CardGridSkeleton, EmptyState, ErrorState, NoResultsState, TableSkeleton } from '@/components/common/states';
import { TablePagination } from '@/components/common/DataTable';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/misc';
import { SimpleSelect } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatCurrency, formatDate } from '@/lib/utils/format';
import { BroadcastDialog } from '@/features/whatsapp/BroadcastDialog';
import { BroadcastHistory } from '@/features/whatsapp/BroadcastHistory';
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
  const sort = (searchParams.get('sort') as SortKey) in SORTS ? (searchParams.get('sort') as SortKey) : 'name';

  const [formOpen, setFormOpen] = useState(searchParams.get('new') === '1');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectingAll, setSelectingAll] = useState(false);
  const [broadcastIds, setBroadcastIds] = useState<string[] | null>(null);

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page' && key !== 'tab') next.delete('page');
    setSearchParams(next, { replace: true });
  }

  const filters = useMemo(
    () => ({
      search: search || undefined,
      category: category || undefined,
      tag: tag || undefined,
      optIn: optIn || undefined,
      status,
      ...SORTS[sort],
    }),
    [search, category, tag, optIn, status, sort],
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
  const activeFilters = [category, tag, optIn, status !== 'active' ? status : ''].filter(Boolean).length;

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

  return (
    <>
      <PageHeader
        title={t('donors.title')}
        subtitle={t('donors.subtitle')}
        actions={
          can('donor.manage') && (
            <Button onClick={() => setFormOpen(true)}>
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              {t('donors.addDonor')}
            </Button>
          )
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
          {error ? (
            <ErrorState message={errorMessage(t, error)} onRetry={() => void refetch()} />
          ) : (
            <SectionCard noPadding>
              <div className="border-b border-line p-3">
                <FilterBar
                  search={search}
                  onSearchChange={(value) => setParam('search', value)}
                  searchPlaceholder={t('donors.searchPlaceholder')}
                  activeCount={activeFilters}
                  onClear={() => setSearchParams(new URLSearchParams(), { replace: true })}
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

              {isLoading ? (
                <TableSkeleton columns={6} />
              ) : rows.length === 0 ? (
                search || activeFilters ? (
                  <NoResultsState onClear={() => setSearchParams(new URLSearchParams(), { replace: true })} />
                ) : (
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
              ) : (
                <>
                  <div className="hidden overflow-x-auto md:block">
                    <table className="w-full min-w-[860px] border-collapse">
                      <thead>
                        <tr className="border-b border-line bg-canvas/60">
                          {canMessage && (
                            <th scope="col" className="w-10 px-3 py-2.5">
                              <Checkbox
                                checked={allPageSelected ? true : pageSelectedCount > 0 ? 'indeterminate' : false}
                                onCheckedChange={(checked) => togglePage(checked === true)}
                                aria-label={t('donors.selectPage')}
                              />
                            </th>
                          )}
                          {[
                            t('donations.donor'),
                            t('donors.contact'),
                            'WhatsApp',
                            t('donors.totalGiven'),
                            t('donors.lastDonation'),
                          ].map((heading, index) => (
                            <th
                              key={heading}
                              scope="col"
                              className={`px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted ${index === 3 ? 'text-right' : 'text-left'}`}
                            >
                              {heading}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line">
                        {rows.map((row) => (
                          <tr
                            key={row.id}
                            className={`cursor-pointer transition-colors hover:bg-canvas/60 ${selected.has(row.id) ? 'bg-brand-light/40' : ''}`}
                            onClick={() => navigate(`/donors/${row.id}`)}
                          >
                            {canMessage && (
                              <td className="px-3 py-2.5" onClick={(event) => event.stopPropagation()}>
                                <Checkbox
                                  checked={selected.has(row.id)}
                                  onCheckedChange={(checked) => toggleOne(row.id, checked === true)}
                                  aria-label={t('donors.selectDonor', { name: row.name })}
                                />
                              </td>
                            )}
                            <td className="px-3 py-2.5">
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
                            </td>
                            <td className="px-3 py-2.5 text-[12.5px] text-ink-muted">
                              <p className="text-ink">{row.phone ?? row.whatsappNumber ?? '—'}</p>
                              {row.city && <p className="text-[11.5px]">{row.city}</p>}
                            </td>
                            <td className="px-3 py-2.5">
                              <ConsentBadge row={row} />
                            </td>
                            <td className="px-3 py-2.5 text-right">
                              <p className="text-[12.5px] font-semibold text-ink tnum">{formatCurrency(row.stats.totalDonated)}</p>
                              <p className="text-[11px] text-ink-muted">{t('donors.donationCount', { count: row.stats.donationCount })}</p>
                            </td>
                            <td className="whitespace-nowrap px-3 py-2.5 text-[12.5px] text-ink-muted">
                              {formatDate(row.stats.lastDonationAt)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <ul className="divide-y divide-line md:hidden">
                    {canMessage && (
                      <li className="flex items-center gap-3 bg-canvas/60 px-4 py-2">
                        <Checkbox
                          checked={allPageSelected ? true : pageSelectedCount > 0 ? 'indeterminate' : false}
                          onCheckedChange={(checked) => togglePage(checked === true)}
                          aria-label={t('donors.selectPage')}
                        />
                        <span className="text-[12px] text-ink-muted">{t('donors.selectPage')}</span>
                      </li>
                    )}
                    {rows.map((row) => (
                      <li key={row.id} className="flex items-start gap-3 px-4 py-3">
                        {canMessage && (
                          <Checkbox
                            className="mt-1"
                            checked={selected.has(row.id)}
                            onCheckedChange={(checked) => toggleOne(row.id, checked === true)}
                            aria-label={t('donors.selectDonor', { name: row.name })}
                          />
                        )}
                        <Link to={`/donors/${row.id}`} className="flex min-w-0 flex-1 items-start gap-3">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[13.5px] font-medium text-ink">{row.name}</p>
                            <p className="mt-0.5 truncate text-[11.5px] text-ink-muted">
                              {row.code} · {row.phone ?? row.whatsappNumber ?? '—'}
                            </p>
                            <div className="mt-1.5">
                              <ConsentBadge row={row} />
                            </div>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="text-[13px] font-semibold text-ink tnum">{formatCurrency(row.stats.totalDonated)}</p>
                            <p className="text-[11px] text-ink-muted">{formatDate(row.stats.lastDonationAt)}</p>
                          </div>
                        </Link>
                      </li>
                    ))}
                  </ul>

                  <TablePagination
                    page={data!.meta.page}
                    pageSize={data!.meta.pageSize}
                    total={data!.meta.total}
                    totalPages={data!.meta.totalPages}
                    onPageChange={(value) => setParam('page', String(value))}
                  />
                </>
              )}
            </SectionCard>
          )}
        </TabsContent>

        {canMessage && (
          <TabsContent value="broadcasts">
            <BroadcastHistory />
          </TabsContent>
        )}
      </Tabs>

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


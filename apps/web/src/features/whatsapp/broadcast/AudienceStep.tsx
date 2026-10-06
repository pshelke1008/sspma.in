import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Filter, Loader2, Upload, UserCheck, Users } from 'lucide-react';
import { toast } from 'sonner';
import { DONOR_CATEGORIES } from '@ashram/types';
import { ApiError, api, buildQuery, downloadFile } from '@/lib/api/client';
import { errorMessage } from '@/i18n/errors';
import { useLabels } from '@/i18n/useLabels';
import { SearchInput } from '@/components/common/FilterBar';
import { FormField } from '@/components/common/forms';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/misc';
import { SimpleSelect } from '@/components/ui/select';
import { cn } from '@/lib/utils/cn';
import { formatNumber } from '@/lib/utils/format';
import { useDonorLocations, formatPlace } from '@/features/donors/useDonorLocations';
import type { DonorListResponse } from '@/features/donors/types';
import { EMPTY_FILTERS, MAX_RECIPIENTS, hasFilters, type AudienceMode, type DonorFilters, type UploadResult, type WizardState } from './api';

/** Only donors who can actually be messaged are offered: active and opted in. */
const REACHABLE = { status: 'active', optIn: 'yes' } as const;

const MODES = [
  { mode: 'ALL', icon: Users },
  { mode: 'FILTER', icon: Filter },
  { mode: 'SELECT', icon: UserCheck },
  { mode: 'UPLOAD', icon: FileSpreadsheet },
] as const satisfies readonly { mode: AudienceMode; icon: unknown }[];

/**
 * Step 2: who receives it. Nobody is selected until a way of choosing is picked —
 * everyone who agreed, a filtered group, donors picked by hand, or an Excel sheet.
 */
export function AudienceStep({
  state,
  onChange,
  variableCount,
  error,
}: {
  state: WizardState;
  onChange: (next: Partial<WizardState>) => void;
  variableCount: number;
  error?: string;
}) {
  const { t } = useTranslation();

  return (
    <div className="space-y-4">
      <div role="group" aria-label={t('whatsapp.campaign.audience')} className="grid gap-2 sm:grid-cols-2">
        {MODES.map(({ mode, icon: Icon }) => {
          const active = state.audience === mode;
          return (
            <button
              key={mode}
              type="button"
              aria-pressed={active}
              // The ticked donors, the filtered group and the sheet are separate lists; switching never mixes them.
              onClick={() => !active && onChange({ audience: mode, donorIds: [] })}
              className={cn(
                'flex items-start gap-3 rounded-control border px-3 py-3 text-left transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/50',
                active ? 'border-brand-primary bg-brand-light/60' : 'border-line bg-white hover:bg-canvas',
              )}
            >
              <Icon className={cn('mt-0.5 h-5 w-5 shrink-0', active ? 'text-brand' : 'text-ink-muted')} aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium text-ink">{t(`whatsapp.campaign.mode.${mode}.title`)}</span>
                <span className="block text-[11.5px] leading-snug text-ink-muted">{t(`whatsapp.campaign.mode.${mode}.text`)}</span>
              </span>
              {active && <CheckCircle2 className="h-4 w-4 shrink-0 text-brand" aria-hidden="true" />}
            </button>
          );
        })}
      </div>

      {state.audience === null && (
        <p className="rounded-card border border-dashed border-line px-4 py-6 text-center text-[12.5px] text-ink-muted">{t('whatsapp.campaign.chooseAudience')}</p>
      )}
      {state.audience === 'ALL' && <AllAudience count={state.donorIds.length} onChange={(donorIds) => onChange({ donorIds })} />}
      {state.audience === 'FILTER' && <FilterAudience filters={state.filters} count={state.donorIds.length} onChange={onChange} />}
      {state.audience === 'SELECT' && <SelectAudience selected={state.donorIds} onChange={(donorIds) => onChange({ donorIds })} />}
      {state.audience === 'UPLOAD' && <UploadAudience upload={state.upload} variableCount={variableCount} onChange={(upload) => onChange({ upload })} />}

      <p className="flex items-start gap-2 rounded-control border border-info/25 bg-info/5 px-3 py-2 text-[11.5px] leading-relaxed text-info">
        <CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        {t('whatsapp.campaign.consentNote')}
      </p>
      {error && (
        <p role="alert" className="flex items-center gap-1.5 text-[12px] font-medium text-danger">
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
          {t(error, { defaultValue: error })}
        </p>
      )}
    </div>
  );
}

// ----------------------------- Everyone ---------------------------------------

/** Everyone active who opted in. Chosen on purpose, and the number is shown before moving on. */
function AllAudience({ count, onChange }: { count: number; onChange: (ids: string[]) => void }) {
  const { t } = useTranslation();
  const everyone = useQuery({
    queryKey: ['donors', 'ids', 'broadcast', 'all'],
    queryFn: () => api.get<{ data: string[]; total: number }>('/donors/ids' + buildQuery({ ...REACHABLE })),
  });
  const ids = everyone.data?.data;
  useEffect(() => {
    if (ids) onChange(ids);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);
  const total = everyone.data?.total ?? count;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 rounded-control border border-line bg-canvas/50 px-3 py-2.5 text-[13px] text-ink" aria-live="polite">
        {everyone.isFetching ? <Loader2 className="h-4 w-4 animate-spin text-ink-muted" aria-hidden="true" /> : <Users className="h-4 w-4 text-brand" aria-hidden="true" />}
        {t('whatsapp.campaign.matchingDonors', { count: total, formatted: formatNumber(total) })}
      </div>
      {total > MAX_RECIPIENTS && (
        <p role="alert" className="flex items-start gap-1.5 text-[12px] font-medium text-danger">
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {t('whatsapp.campaign.tooMany', { max: formatNumber(MAX_RECIPIENTS) })}
        </p>
      )}
    </div>
  );
}

// ----------------------------- Filter -----------------------------------------

function withCurrent(options: { value: string; count: number }[] | undefined, current: string) {
  const list = options ?? [];
  return current && !list.some((item) => item.value === current) ? [{ value: current, count: 0 }, ...list] : list;
}

function FilterAudience({
  filters,
  count,
  onChange,
}: {
  filters: DonorFilters;
  count: number;
  onChange: (next: Partial<WizardState>) => void;
}) {
  const { t } = useTranslation();
  const labels = useLabels();
  const { data: locations } = useDonorLocations({ state: filters.state, district: filters.district });
  const { data: summary } = useQuery({
    queryKey: ['donors', 'summary'],
    queryFn: () => api.get<{ tags: string[] }>('/donors/summary'),
    staleTime: 5 * 60_000,
  });

  // With no filter chosen nobody is selected: a filter group is never an accidental "everyone".
  const filtered = hasFilters(filters);
  const matching = useQuery({
    queryKey: ['donors', 'ids', 'broadcast', filters],
    queryFn: () => api.get<{ data: string[]; total: number }>('/donors/ids' + buildQuery({ ...REACHABLE, ...filters })),
    placeholderData: (previous) => previous,
    enabled: filtered,
  });
  // The wizard keeps the resolved donors, so later steps and the server use exactly what was counted here.
  const ids = filtered ? matching.data?.data : [];
  useEffect(() => {
    if (ids) onChange({ donorIds: ids });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);

  const set = (key: keyof DonorFilters, value: string) => {
    const next = { ...filters, [key]: value === 'all' ? '' : value };
    // A district belongs to a state and a village to a district, so a parent change clears its children.
    if (key === 'state') Object.assign(next, { district: '', village: '' });
    if (key === 'district') next.village = '';
    onChange({ filters: next });
  };
  const total = filtered ? (matching.data?.total ?? count) : 0;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <FormField label={t('common.category')} htmlFor="aud-category">
          <SimpleSelect
            value={filters.category || 'all'}
            onValueChange={(value) => set('category', value)}
            options={[{ value: 'all', label: t('common.allCategories') }, ...DONOR_CATEGORIES.map((item) => ({ value: item, label: labels.donorCategory[item] }))]}
            ariaLabel={t('donors.filterCategory')}
          />
        </FormField>
        <FormField label={t('donors.tag')} htmlFor="aud-tag">
          <SimpleSelect
            value={filters.tag || 'all'}
            onValueChange={(value) => set('tag', value)}
            options={[{ value: 'all', label: t('donors.allTags') }, ...(summary?.tags ?? []).map((item) => ({ value: item, label: item }))]}
            ariaLabel={t('donors.filterTag')}
          />
        </FormField>
        <FormField label={t('common.state')} htmlFor="aud-state">
          <SimpleSelect
            value={filters.state || 'all'}
            onValueChange={(value) => set('state', value)}
            options={[
              { value: 'all', label: t('donors.allStates') },
              ...withCurrent(locations?.states, filters.state).map((item) => ({ value: item.value, label: item.count ? `${item.value} (${item.count})` : item.value })),
            ]}
            ariaLabel={t('donors.filterState')}
          />
        </FormField>
        <FormField label={t('donors.district')} htmlFor="aud-district">
          <SimpleSelect
            value={filters.district || 'all'}
            onValueChange={(value) => set('district', value)}
            options={[
              { value: 'all', label: t('donors.allDistricts') },
              ...withCurrent(locations?.districts, filters.district).map((item) => ({ value: item.value, label: item.count ? `${item.value} (${item.count})` : item.value })),
            ]}
            ariaLabel={t('donors.filterDistrict')}
          />
        </FormField>
        <FormField label={t('donors.village')} htmlFor="aud-village">
          <SimpleSelect
            value={filters.village || 'all'}
            onValueChange={(value) => set('village', value)}
            options={[
              { value: 'all', label: t('donors.allVillages') },
              ...withCurrent(locations?.villages, filters.village).map((item) => ({ value: item.value, label: item.count ? `${item.value} (${item.count})` : item.value })),
            ]}
            ariaLabel={t('donors.filterVillage')}
          />
        </FormField>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-control border border-line bg-canvas/50 px-3 py-2.5">
        <p className="flex items-center gap-2 text-[13px] text-ink" aria-live="polite">
          {filtered && matching.isFetching ? <Loader2 className="h-4 w-4 animate-spin text-ink-muted" aria-hidden="true" /> : <Users className="h-4 w-4 text-brand" aria-hidden="true" />}
          {filtered ? t('whatsapp.campaign.matchingDonors', { count: total, formatted: formatNumber(total) }) : t('whatsapp.campaign.pickFilter')}
        </p>
        {filtered && (
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange({ filters: EMPTY_FILTERS })}>
            {t('whatsapp.campaign.clearFilters')}
          </Button>
        )}
      </div>
      {total > MAX_RECIPIENTS && (
        <p role="alert" className="flex items-start gap-1.5 text-[12px] font-medium text-danger">
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {t('whatsapp.campaign.tooMany', { max: formatNumber(MAX_RECIPIENTS) })}
        </p>
      )}
    </div>
  );
}

// ----------------------------- Select -----------------------------------------

function SelectAudience({ selected, onChange }: { selected: string[]; onChange: (ids: string[]) => void }) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const chosen = new Set(selected);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['donors', 'broadcast-picker', search, page],
    queryFn: () => api.get<DonorListResponse>('/donors' + buildQuery({ ...REACHABLE, search, page, pageSize: 10, sortBy: 'name', sortDir: 'asc' })),
    placeholderData: (previous) => previous,
  });
  const rows = data?.data ?? [];
  const pageIds = rows.map((row) => row.id);
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => chosen.has(id));

  const toggle = (id: string) => onChange(chosen.has(id) ? selected.filter((item) => item !== id) : [...selected, id]);

  const selectAllMatching = useMutation({
    mutationFn: () => api.get<{ data: string[] }>('/donors/ids' + buildQuery({ ...REACHABLE, search })),
    onSuccess: ({ data: ids }) => onChange([...new Set([...selected, ...ids])].slice(0, MAX_RECIPIENTS)),
    onError: (error) => toast.error(t('whatsapp.campaign.selectFailed'), { description: errorMessage(t, error) }),
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          value={search}
          onChange={(value) => {
            setSearch(value);
            setPage(1);
          }}
          placeholder={t('whatsapp.campaign.searchDonors')}
          className="min-w-[200px] flex-1"
        />
        <Badge tone={selected.length ? 'brand' : 'neutral'} aria-live="polite">
          {t('whatsapp.campaign.selectedCount', { count: selected.length })}
        </Badge>
        {selected.length > 0 && (
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange([])}>
            {t('whatsapp.campaign.clearSelection')}
          </Button>
        )}
      </div>

      <div className="overflow-hidden rounded-control border border-line">
        <label className="flex items-center gap-3 border-b border-line bg-canvas/60 px-3 py-2 text-[12px] font-medium text-ink-muted">
          <Checkbox
            checked={allOnPage}
            onCheckedChange={() => onChange(allOnPage ? selected.filter((id) => !pageIds.includes(id)) : [...new Set([...selected, ...pageIds])])}
            aria-label={t('whatsapp.campaign.selectPage')}
          />
          {t('whatsapp.campaign.selectPage')}
          {data && data.meta.total > rows.length && (
            <button
              type="button"
              onClick={() => selectAllMatching.mutate()}
              disabled={selectAllMatching.isPending}
              className="ml-auto rounded font-medium text-brand underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/50"
            >
              {t('whatsapp.campaign.selectAllMatching', { count: data.meta.total, formatted: formatNumber(data.meta.total) })}
            </button>
          )}
        </label>
        {isLoading ? (
          <p className="px-3 py-8 text-center text-[12.5px] text-ink-muted">{t('common.loading')}</p>
        ) : rows.length === 0 ? (
          <p className="px-3 py-8 text-center text-[12.5px] text-ink-muted">{t('whatsapp.campaign.noDonorsFound')}</p>
        ) : (
          <ul className={isFetching ? 'divide-y divide-line opacity-70 transition-opacity' : 'divide-y divide-line transition-opacity'}>
            {rows.map((row) => (
              <li key={row.id}>
                <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-canvas/60">
                  <Checkbox checked={chosen.has(row.id)} onCheckedChange={() => toggle(row.id)} aria-label={row.name} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-ink">{row.name}</span>
                    <span className="block truncate text-[11.5px] text-ink-muted">
                      {row.code}
                      {formatPlace(row) ? ` · ${formatPlace(row)}` : ''}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>

      {data && data.meta.totalPages > 1 && (
        <div className="flex items-center justify-between text-[12px] text-ink-muted">
          <Button type="button" variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            {t('table.previous')}
          </Button>
          <span>{t('whatsapp.campaign.pageOf', { page, total: data.meta.totalPages })}</span>
          <Button type="button" variant="outline" size="sm" disabled={page >= data.meta.totalPages} onClick={() => setPage(page + 1)}>
            {t('table.next')}
          </Button>
        </div>
      )}
    </div>
  );
}

// ----------------------------- Upload -----------------------------------------

function UploadAudience({
  upload,
  variableCount,
  onChange,
}: {
  upload: UploadResult | null;
  variableCount: number;
  onChange: (upload: UploadResult | null) => void;
}) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const send = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return api.post<UploadResult>('/whatsapp/campaigns/recipients', form);
    },
    onSuccess: (result) => {
      setProblem(null);
      onChange(result);
    },
    onError: (error) => {
      onChange(null);
      setProblem(errorMessage(t, error) ?? (error instanceof ApiError ? error.message : t('errors.INTERNAL_ERROR')));
    },
  });

  const downloadExample = () =>
    downloadFile(`/whatsapp/campaigns/recipients/template${buildQuery({ variables: variableCount })}`, 'broadcast-recipients.xlsx').catch((error) =>
      toast.error(t('whatsapp.campaign.downloadFailed'), { description: errorMessage(t, error) }),
    );

  return (
    <div className="space-y-3">
      <div className="rounded-card border border-dashed border-line p-5 text-center">
        <FileSpreadsheet className="mx-auto h-8 w-8 text-brand" aria-hidden="true" />
        <p className="mt-2 text-[13px] font-medium text-ink">{t('whatsapp.campaign.uploadTitle')}</p>
        <p className="mx-auto mt-1 max-w-md text-[12px] leading-relaxed text-ink-muted">{t('whatsapp.campaign.uploadText')}</p>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          <input
            ref={input}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="sr-only"
            aria-label={t('whatsapp.campaign.uploadTitle')}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) send.mutate(file);
              event.target.value = '';
            }}
          />
          <Button type="button" size="sm" onClick={() => input.current?.click()} loading={send.isPending}>
            <Upload className="h-3.5 w-3.5" aria-hidden="true" />
            {upload ? t('whatsapp.campaign.replaceSheet') : t('whatsapp.campaign.chooseSheet')}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => void downloadExample()}>
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            {t('whatsapp.campaign.downloadExample')}
          </Button>
        </div>
      </div>

      {problem && (
        <p role="alert" className="flex items-start gap-1.5 text-[12px] font-medium text-danger">
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {problem}
        </p>
      )}

      {upload && (
        <div className="space-y-3" aria-live="polite">
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label={t('whatsapp.campaign.sheetRows')} value={upload.stats.rows} />
            <Stat label={t('whatsapp.campaign.sheetMatched')} value={upload.stats.matched} tone="text-success" />
            <Stat label={t('whatsapp.campaign.sheetUnmatched')} value={upload.stats.unmatched} tone={upload.stats.unmatched ? 'text-[#986812]' : undefined} />
            <Stat label={t('whatsapp.campaign.sheetInvalid')} value={upload.stats.invalid + upload.stats.duplicates} tone={upload.stats.invalid ? 'text-danger' : undefined} />
          </dl>
          {upload.stats.unmatched > 0 && (
            <div className="rounded-control border border-warning/30 bg-warning/5 px-3 py-2 text-[12px] leading-relaxed text-ink">
              <p className="flex items-start gap-1.5 font-medium">
                <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0 text-[#986812]" aria-hidden="true" />
                {t('whatsapp.campaign.unmatchedNote', { count: upload.stats.unmatched })}
              </p>
              <p className="mt-1 text-ink-muted">
                {upload.unmatched.map((item) => t('whatsapp.campaign.unmatchedRow', { row: item.rowNumber, phone: item.phone })).join(' · ')}
                {upload.stats.unmatched > upload.unmatched.length ? ' …' : ''}
              </p>
            </div>
          )}
          {upload.stats.notOptedIn > 0 && (
            <p className="text-[12px] text-ink-muted">{t('whatsapp.campaign.sheetNotOptedIn', { count: upload.stats.notOptedIn })}</p>
          )}
          <p className="text-[11.5px] text-ink-muted">{t('whatsapp.campaign.sheetColumns', { columns: upload.columns.join(', ') })}</p>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-control border border-line bg-white px-3 py-2 text-center">
      <dt className="text-[10.5px] uppercase tracking-wide text-ink-muted">{label}</dt>
      <dd className={`tnum text-[16px] font-semibold text-ink ${tone ?? ''}`}>{formatNumber(value)}</dd>
    </div>
  );
}

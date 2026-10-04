import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, FileText, Loader2, Search, UserRound } from 'lucide-react';
import { REPORT_DEFINITIONS } from '@ashram/types';
import { api, buildQuery } from '@/lib/api/client';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { formatCurrency, formatDate } from '@/lib/utils/format';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/lib/auth/AuthProvider';
import { useTranslation } from 'react-i18next';
import { useLabels } from '@/i18n/useLabels';
import { cn } from '@/lib/utils/cn';

interface ExpenseHit {
  id: string;
  expenseNumber: string;
  title: string;
  total: number;
  status: string;
  date: string;
  department: { name: string };
}

interface DonorHit {
  id: string;
  name: string;
  code: string;
  phone: string | null;
  whatsappNumber: string | null;
  village: string | null;
  district: string | null;
  isActive: boolean;
}

/**
 * Command-palette style search across donors, expenses and the report
 * catalog. ↑/↓ move through every result group in order, Enter opens one.
 */
export function GlobalSearch({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  const labels = useLabels();
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  const navigate = useNavigate();
  const { can } = useAuth();

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(term.trim()), 280);
    return () => clearTimeout(timer);
  }, [term]);

  // "/" opens search from anywhere that is not a text field.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing = target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
      if (event.key === '/' && !typing && !open) {
        event.preventDefault();
        onOpenChange(true);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (!open) {
      setTerm('');
      setDebounced('');
    }
  }, [open]);

  const { data, isFetching: fetchingExpenses } = useQuery({
    queryKey: ['global-search', debounced],
    queryFn: () =>
      api.get<{ data: ExpenseHit[] }>('/expenses' + buildQuery({ search: debounced, pageSize: 6 })),
    enabled: open && debounced.length >= 2 && can('expense.view'),
  });

  const canSeeDonors = can('donor.view');
  const { data: donorData, isFetching: fetchingDonors } = useQuery({
    queryKey: ['donors', 'global-search', debounced],
    queryFn: () =>
      api.get<{ data: DonorHit[] }>('/donors' + buildQuery({ search: debounced, pageSize: 5, status: 'all' })),
    enabled: open && debounced.length >= 2 && canSeeDonors,
  });
  const isFetching = fetchingExpenses || fetchingDonors;
  const donorHits = canSeeDonors && debounced.length >= 2 ? donorData?.data ?? [] : [];
  const expenseHits = debounced.length >= 2 ? data?.data ?? [] : [];

  const reportHits = useMemo(() => {
    if (debounced.length < 2) return [];
    const needle = debounced.toLowerCase();
    return REPORT_DEFINITIONS.filter((report) =>
      `${report.name} ${labels.reports[report.key]?.name ?? ''}`.toLowerCase().includes(needle),
    ).slice(0, 4);
  }, [debounced, labels]);

  function go(path: string) {
    onOpenChange(false);
    navigate(path);
  }

  // Every result in display order, so the arrow keys can cross group boundaries.
  const paths = [
    ...donorHits.map((hit) => `/donors/${hit.id}`),
    ...expenseHits.map((hit) => `/expenses/${hit.id}`),
    ...reportHits.map((report) => report.route),
  ];
  const pathsKey = paths.join('|');
  const [active, setActive] = useState(-1);
  const listId = useId();
  const optionId = (index: number) => `${listId}-option-${index}`;
  const listRef = useRef<HTMLDivElement>(null);

  // A new result set starts the highlight on its first entry.
  useEffect(() => {
    setActive(pathsKey ? 0 : -1);
  }, [pathsKey]);

  useEffect(() => {
    if (active < 0) return;
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!paths.length) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((index) => (index + 1) % paths.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => (index <= 0 ? paths.length - 1 : index - 1));
    } else if (event.key === 'Enter' && active >= 0 && paths[active]) {
      event.preventDefault();
      go(paths[active]);
    }
  }

  /** Props shared by every result row; `index` is its position across all groups. */
  function optionProps(index: number, path: string) {
    return {
      id: optionId(index),
      role: 'option' as const,
      'aria-selected': index === active,
      'data-index': index,
      tabIndex: -1,
      type: 'button' as const,
      onClick: () => go(path),
      onMouseMove: () => index !== active && setActive(index),
      className: cn(
        'flex w-full items-center gap-3 rounded-control px-3 py-2 text-left transition-colors hover:bg-canvas focus-visible:outline-none',
        index === active && 'bg-canvas',
      ),
    };
  }
  const expenseOffset = donorHits.length;
  const reportOffset = donorHits.length + expenseHits.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" className="top-[12%] translate-y-0 sm:top-[14%]">
        <DialogTitle className="sr-only">{t('search.title')}</DialogTitle>
        <DialogDescription className="sr-only">{t('search.description')}</DialogDescription>

        <div className="flex items-center gap-2 border-b border-line px-4 py-3 pr-12">
          <Search className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
          <Input
            autoFocus
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t('header.searchPlaceholder')}
            aria-label={t('search.title')}
            role="combobox"
            aria-expanded={paths.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={active >= 0 && paths[active] ? optionId(active) : undefined}
            className="h-8 border-0 px-0 shadow-none focus:ring-0"
          />
          {isFetching && <Loader2 className="h-3.5 w-3.5 animate-spin text-ink-muted" aria-hidden="true" />}
        </div>

        <div ref={listRef} id={listId} role="listbox" aria-label={t('search.title')} className="max-h-[52vh] overflow-y-auto p-2">
          {debounced.length < 2 ? (
            <p className="px-3 py-8 text-center text-[12.5px] text-ink-muted">{t('search.minChars')}</p>
          ) : (
            <>
              {donorHits.length > 0 && (
                <section className="mb-2" role="group" aria-labelledby={`${listId}-donors`}>
                  <h3
                    id={`${listId}-donors`}
                    className="px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-ink-muted"
                  >
                    {t('donorPicker.searchGroup')}
                  </h3>
                  {donorHits.map((hit, index) => {
                    const phone = hit.phone ?? hit.whatsappNumber;
                    return (
                      <button key={hit.id} {...optionProps(index, `/donors/${hit.id}`)}>
                        <UserRound className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-medium text-ink">{hit.name}</span>
                          <span className="block truncate text-[11.5px] text-ink-muted">
                            <span className="tnum">{hit.code}</span>
                            {phone && <> · <span className="tnum">{phone}</span></>}
                            {(hit.village || hit.district) && <> · {[hit.village, hit.district].filter(Boolean).join(', ')}</>}
                          </span>
                        </span>
                        {!hit.isActive && <Badge tone="neutral">{t('donorPicker.inactive')}</Badge>}
                        <ArrowRight className="h-3.5 w-3.5 shrink-0 text-ink-muted" aria-hidden="true" />
                      </button>
                    );
                  })}
                </section>
              )}

              {expenseHits.length > 0 && (
                <section className="mb-2" role="group" aria-labelledby={`${listId}-expenses`}>
                  <h3
                    id={`${listId}-expenses`}
                    className="px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-ink-muted"
                  >
                    {t('search.expenses')}
                  </h3>
                  {expenseHits.map((hit, index) => (
                    <button key={hit.id} {...optionProps(expenseOffset + index, `/expenses/${hit.id}`)}>
                      <FileText className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-ink">{hit.title}</span>
                        <span className="block truncate text-[11.5px] text-ink-muted">
                          {hit.expenseNumber} · {hit.department.name} · {formatDate(hit.date)}
                        </span>
                      </span>
                      <span className="shrink-0 text-[12.5px] font-semibold text-ink tnum">
                        {formatCurrency(hit.total)}
                      </span>
                      <StatusBadge status={hit.status} />
                    </button>
                  ))}
                </section>
              )}

              {reportHits.length > 0 && (
                <section role="group" aria-labelledby={`${listId}-reports`}>
                  <h3
                    id={`${listId}-reports`}
                    className="px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-ink-muted"
                  >
                    {t('search.reports')}
                  </h3>
                  {reportHits.map((report, index) => (
                    <button key={report.key} {...optionProps(reportOffset + index, report.route)}>
                      <FileText className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-ink">
                          {labels.reports[report.key]?.name ?? report.name}
                        </span>
                        <span className="block truncate text-[11.5px] text-ink-muted">
                          {labels.reports[report.key]?.description ?? report.description}
                        </span>
                      </span>
                      <ArrowRight className="h-3.5 w-3.5 shrink-0 text-ink-muted" aria-hidden="true" />
                    </button>
                  ))}
                </section>
              )}

              {!isFetching && paths.length === 0 && (
                <p className="px-3 py-8 text-center text-[12.5px] text-ink-muted">
                  {t('search.nothing', { term: debounced })}
                </p>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

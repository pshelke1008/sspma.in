import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, FileText, Loader2, Search } from 'lucide-react';
import { REPORT_DEFINITIONS } from '@ashram/types';
import { api, buildQuery } from '@/lib/api/client';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { formatCurrency, formatDate } from '@/lib/utils/format';
import { StatusBadge } from '@/components/common/StatusBadge';
import { useAuth } from '@/lib/auth/AuthProvider';
import { useTranslation } from 'react-i18next';
import { useLabels } from '@/i18n/useLabels';

interface ExpenseHit {
  id: string;
  expenseNumber: string;
  title: string;
  total: number;
  status: string;
  date: string;
  department: { name: string };
}

/** Command-palette style search across expenses and the report catalog. */
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

  const { data, isFetching } = useQuery({
    queryKey: ['global-search', debounced],
    queryFn: () =>
      api.get<{ data: ExpenseHit[] }>('/expenses' + buildQuery({ search: debounced, pageSize: 6 })),
    enabled: open && debounced.length >= 2 && can('expense.view'),
  });

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
            placeholder={t('header.searchPlaceholder')}
            aria-label={t('search.title')}
            className="h-8 border-0 px-0 shadow-none focus:ring-0"
          />
          {isFetching && <Loader2 className="h-3.5 w-3.5 animate-spin text-ink-muted" aria-hidden="true" />}
        </div>

        <div className="max-h-[52vh] overflow-y-auto p-2">
          {debounced.length < 2 ? (
            <p className="px-3 py-8 text-center text-[12.5px] text-ink-muted">{t('search.minChars')}</p>
          ) : (
            <>
              {data?.data.length ? (
                <section className="mb-2">
                  <h3 className="px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-ink-muted">
                    {t('search.expenses')}
                  </h3>
                  <ul>
                    {data.data.map((hit) => (
                      <li key={hit.id}>
                        <button
                          type="button"
                          onClick={() => go(`/expenses/${hit.id}`)}
                          className="flex w-full items-center gap-3 rounded-control px-3 py-2 text-left transition-colors hover:bg-canvas focus-visible:bg-canvas focus-visible:outline-none"
                        >
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
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {reportHits.length > 0 && (
                <section>
                  <h3 className="px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-ink-muted">
                    {t('search.reports')}
                  </h3>
                  <ul>
                    {reportHits.map((report) => (
                      <li key={report.key}>
                        <button
                          type="button"
                          onClick={() => go(report.route)}
                          className="flex w-full items-center gap-3 rounded-control px-3 py-2 text-left transition-colors hover:bg-canvas focus-visible:bg-canvas focus-visible:outline-none"
                        >
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
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {!isFetching && !data?.data.length && reportHits.length === 0 && (
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

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetBody, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils/cn';

/** Debounced search box — keystrokes never hit the API one-for-one. */
export function SearchInput({
  value,
  onChange,
  placeholder,
  className,
  delay = 350,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  delay?: number;
  ariaLabel?: string;
}) {
  const { t } = useTranslation();
  const [local, setLocal] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  // Keep in sync when the caller resets the value (e.g. "Clear filters").
  useEffect(() => {
    setLocal(value);
  }, [value]);

  useEffect(() => () => clearTimeout(timer.current), []);

  function handleChange(next: string) {
    setLocal(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => onChange(next), delay);
  }

  return (
    <div className={cn('relative', className)}>
      <Search
        className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-muted"
        aria-hidden="true"
      />
      <Input
        type="search"
        value={local}
        onChange={(event) => handleChange(event.target.value)}
        placeholder={placeholder ?? `${t('common.search')}…`}
        aria-label={ariaLabel ?? placeholder}
        className="pl-8 pr-8"
      />
      {local && (
        <button
          type="button"
          onClick={() => {
            setLocal('');
            clearTimeout(timer.current);
            onChange('');
          }}
          aria-label={t('forms.clearSearch')}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-ink-muted hover:text-ink focus-visible:ring-2 focus-visible:ring-brand-primary/50"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

/**
 * Filters sit inline on desktop and collapse into a drawer on small screens so
 * the toolbar never wraps into an unusable stack.
 */
export function FilterBar({
  search,
  onSearchChange,
  searchPlaceholder,
  filters,
  activeCount,
  onClear,
  actions,
  className,
}: {
  search?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  filters?: ReactNode;
  activeCount?: number;
  onClear?: () => void;
  actions?: ReactNode;
  className?: string;
}) {
  const { t } = useTranslation();
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      {onSearchChange && (
        <SearchInput
          value={search ?? ''}
          onChange={onSearchChange}
          placeholder={searchPlaceholder}
          className="min-w-[180px] flex-1 sm:max-w-xs"
        />
      )}

      {filters && <div className="hidden flex-wrap items-center gap-2 lg:flex">{filters}</div>}

      {filters && (
        <Button variant="outline" size="md" className="lg:hidden" onClick={() => setDrawerOpen(true)}>
          <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
          {t('common.filters')}
          {activeCount ? (
            <Badge tone="brand" className="ml-0.5 px-1.5">
              {activeCount}
            </Badge>
          ) : null}
        </Button>
      )}

      {onClear && activeCount ? (
        <Button variant="ghost" size="sm" onClick={onClear} className="hidden lg:inline-flex">
          <X className="h-3.5 w-3.5" aria-hidden="true" />
          {t('common.clear')}
        </Button>
      ) : null}

      {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}

      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent side="bottom" className="lg:hidden">
          <SheetHeader>
            <SheetTitle className="text-[15px] font-semibold text-ink">{t('common.filters')}</SheetTitle>
          </SheetHeader>
          <SheetBody>
            <div className="grid gap-3">{filters}</div>
          </SheetBody>
          <SheetFooter>
            {onClear && (
              <Button
                variant="outline"
                block
                onClick={() => {
                  onClear();
                  setDrawerOpen(false);
                }}
              >
                {t('common.clearAll')}
              </Button>
            )}
            <Button block onClick={() => setDrawerOpen(false)}>
              {t('common.showResults')}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}

export function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex w-full flex-col gap-1 lg:w-auto">
      <span className="text-[11px] font-medium text-ink-muted lg:sr-only">{label}</span>
      <div className="lg:w-[150px]">{children}</div>
    </label>
  );
}

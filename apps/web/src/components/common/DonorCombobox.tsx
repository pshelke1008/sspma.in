import { useEffect, useId, useRef, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronsUpDown, Loader2, Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api, buildQuery } from '@/lib/api/client';
import { cn } from '@/lib/utils/cn';

/** The fields a picker needs; a full donor row satisfies it. */
export interface PickedDonor {
  id: string;
  name: string;
  code?: string;
  phone?: string | null;
}

interface DonorHit {
  id: string;
  name: string;
  code: string;
  phone: string | null;
  whatsappNumber: string | null;
  panNumber: string | null;
  village: string | null;
  district: string | null;
}

const PAGE_SIZE = 10;
const DEBOUNCE_MS = 250;

/**
 * Typeahead donor picker (WAI-ARIA combobox with a listbox popup). Searches
 * the server by name, mobile, donor code or PAN, so it scales past the
 * handful of donors a plain select can hold.
 *
 * Keyboard: ↓/↑ move through results (↓ opens), Enter picks, Escape closes
 * and restores the current choice, Tab leaves.
 */
export function DonorCombobox({
  value,
  onChange,
  id,
  placeholder,
  ariaLabel,
  invalid,
  disabled,
  status = 'active',
  className,
}: {
  value: PickedDonor | null;
  onChange: (donor: PickedDonor | null) => void;
  id?: string;
  placeholder?: string;
  ariaLabel?: string;
  invalid?: boolean;
  disabled?: boolean;
  /** Which donors are offered; receipts should go to active donors. */
  status?: 'active' | 'all';
  className?: string;
}) {
  const { t } = useTranslation();
  const autoId = useId();
  const inputId = id ?? `donor-combobox-${autoId}`;
  const listboxId = `${inputId}-listbox`;
  const optionId = (index: number) => `${inputId}-option-${index}`;

  const inputRef = useRef<HTMLInputElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const [open, setOpen] = useState(false);
  const [text, setText] = useState(value?.name ?? '');
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  const [active, setActive] = useState(-1);

  // Show the chosen donor whenever the choice changes from outside.
  useEffect(() => {
    setText(value?.name ?? '');
  }, [value?.id, value?.name]);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(term.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [term]);

  const { data, isFetching, isError } = useQuery({
    queryKey: ['donors', 'picker', { search: debounced, status }],
    queryFn: () =>
      api.get<{ data: DonorHit[] }>(
        '/donors' + buildQuery({ search: debounced || undefined, pageSize: PAGE_SIZE, status, sortBy: 'name' }),
      ),
    enabled: open && !disabled,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
  const hits = data?.data ?? [];

  // Keep the highlighted option in range and in view.
  useEffect(() => {
    if (active >= hits.length) setActive(hits.length ? 0 : -1);
  }, [hits.length, active]);
  useEffect(() => {
    if (active < 0) return;
    listRef.current?.querySelector<HTMLElement>(`#${CSS.escape(optionId(active))}`)?.scrollIntoView({ block: 'nearest' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  function close(restore = true) {
    setOpen(false);
    setActive(-1);
    if (restore) setText(value?.name ?? '');
  }

  function openList() {
    if (disabled) return;
    setOpen(true);
  }

  function pick(hit: DonorHit) {
    onChange({ id: hit.id, name: hit.name, code: hit.code, phone: hit.phone ?? hit.whatsappNumber });
    setText(hit.name);
    setTerm('');
    close(false);
  }

  function clear() {
    onChange(null);
    setText('');
    setTerm('');
    setActive(-1);
    inputRef.current?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (!open) {
          openList();
          setActive(0);
        } else if (hits.length) {
          setActive((index) => (index + 1) % hits.length);
        }
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (!open) {
          openList();
          setActive(hits.length ? hits.length - 1 : 0);
        } else if (hits.length) {
          setActive((index) => (index <= 0 ? hits.length - 1 : index - 1));
        }
        break;
      case 'Enter':
        // Never let Enter in an open picker submit the surrounding form.
        if (open) {
          event.preventDefault();
          if (active >= 0 && hits[active]) pick(hits[active]);
        }
        break;
      case 'Escape':
        if (open) {
          // The popover's own layer swallows Escape so an enclosing dialog stays open.
          close();
        } else {
          setText(value?.name ?? '');
        }
        break;
      case 'Tab':
        if (open) close();
        break;
      default:
        break;
    }
  }

  const showClear = !disabled && Boolean(value || text);

  return (
    <Popover.Root open={open} onOpenChange={(next) => (next ? openList() : close())}>
      <Popover.Anchor asChild>
        <div ref={anchorRef} className={cn('relative', className)}>
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-muted"
            aria-hidden="true"
          />
          <input
            ref={inputRef}
            id={inputId}
            type="text"
            role="combobox"
            aria-label={ariaLabel ?? t('donorPicker.label')}
            aria-expanded={open}
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-haspopup="listbox"
            aria-activedescendant={open && active >= 0 && hits[active] ? optionId(active) : undefined}
            aria-invalid={invalid || undefined}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            enterKeyHint="search"
            disabled={disabled}
            value={text}
            placeholder={placeholder ?? t('donorPicker.placeholder')}
            onChange={(event) => {
              setText(event.target.value);
              setTerm(event.target.value);
              setActive(0);
              openList();
            }}
            onClick={() => (open ? undefined : openList())}
            onKeyDown={onKeyDown}
            onBlur={() => {
              if (!open) setText(value?.name ?? '');
            }}
            className={cn(
              'flex h-9 w-full rounded-control border bg-white py-1.5 pl-8 text-[13px] text-ink transition-colors',
              'placeholder:text-ink-muted/70 disabled:cursor-not-allowed disabled:bg-canvas disabled:text-ink-muted',
              'focus:outline-none focus:ring-2 focus:ring-brand-primary/50 focus:border-brand-primary',
              invalid ? 'border-danger focus:ring-danger/40 focus:border-danger' : 'border-line',
              value?.code ? 'pr-[6.5rem]' : 'pr-14',
            )}
          />
          <div className="absolute inset-y-0 right-1 flex items-center gap-0.5">
            {value?.code && text === value.name && (
              <span className="mr-1 hidden rounded bg-canvas px-1.5 py-0.5 text-[10.5px] font-medium text-ink-muted tnum min-[360px]:inline">
                {value.code}
              </span>
            )}
            {showClear ? (
              <button
                type="button"
                onClick={clear}
                aria-label={t('donorPicker.clear')}
                className="flex h-7 w-7 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-canvas hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/50"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            ) : (
              <ChevronsUpDown className="mr-2 h-3.5 w-3.5 text-ink-muted" aria-hidden="true" />
            )}
          </div>
        </div>
      </Popover.Anchor>

      <Popover.Portal>
        <Popover.Content
          align="start"
          side="bottom"
          sideOffset={4}
          collisionPadding={8}
          // Focus stays in the input; the list is driven by aria-activedescendant.
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onInteractOutside={(event) => {
            if (anchorRef.current?.contains(event.target as Node)) event.preventDefault();
          }}
          className="relative z-[60] w-[var(--radix-popover-trigger-width)] min-w-[240px] overflow-hidden rounded-control border border-line bg-white shadow-pop"
        >
          <ul
            ref={listRef}
            id={listboxId}
            role="listbox"
            aria-label={t('donorPicker.listLabel')}
            className="max-h-[min(18rem,45vh)] overflow-y-auto overscroll-contain py-1"
          >
            {hits.map((hit, index) => {
              const phone = hit.phone ?? hit.whatsappNumber;
              const selected = value?.id === hit.id;
              return (
                <li
                  key={hit.id}
                  id={optionId(index)}
                  role="option"
                  aria-selected={index === active}
                  data-current={selected || undefined}
                  // Keep focus in the input so the click lands before any blur.
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseMove={() => index !== active && setActive(index)}
                  onClick={() => pick(hit)}
                  className={cn(
                    'flex cursor-pointer items-center gap-2 px-3 py-2 text-left',
                    index === active ? 'bg-brand-light' : 'hover:bg-canvas',
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className={cn('block truncate text-[13px] text-ink', selected ? 'font-semibold' : 'font-medium')}>
                      {hit.name}
                    </span>
                    <span className="block truncate text-[11.5px] text-ink-muted">
                      <span className="tnum">{hit.code}</span>
                      {phone && <> · <span className="tnum">{phone}</span></>}
                      {(hit.village || hit.district) && <> · {[hit.village, hit.district].filter(Boolean).join(', ')}</>}
                    </span>
                  </span>
                  {selected && <span className="sr-only">{t('donorPicker.current')}</span>}
                </li>
              );
            })}
          </ul>

          {hits.length === 0 && (
            <p className="flex items-center gap-2 px-3 py-3 text-[12.5px] text-ink-muted">
              {isFetching ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  {t('donorPicker.loading')}
                </>
              ) : isError ? (
                t('donorPicker.failed')
              ) : debounced ? (
                t('donorPicker.noResults', { term: debounced })
              ) : (
                t('donorPicker.empty')
              )}
            </p>
          )}
          {hits.length > 0 && isFetching && (
            <Loader2 className="absolute right-2 top-2 h-3 w-3 animate-spin text-ink-muted" aria-hidden="true" />
          )}
        </Popover.Content>
      </Popover.Portal>

      <span className="sr-only" aria-live="polite" role="status">
        {open && !isFetching && data ? t('donorPicker.results', { count: hits.length }) : ''}
      </span>
    </Popover.Root>
  );
}

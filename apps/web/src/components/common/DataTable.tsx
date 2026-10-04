import { useState, type ReactNode } from 'react';
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
  type VisibilityState,
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Checkbox } from '@/components/ui/misc';
import { ErrorState, NoResultsState, TableSkeleton } from './states';
import { useTranslation } from 'react-i18next';
import { errorMessage } from '@/i18n/errors';
import { cn } from '@/lib/utils/cn';

export interface DataTableProps<T> {
  columns: ColumnDef<T, any>[];
  data: T[];
  isLoading?: boolean;
  error?: Error | null;
  onRetry?: () => void;
  onClearFilters?: () => void;
  emptyState?: ReactNode;
  /** Card renderer used below the `md` breakpoint instead of a cramped table. */
  mobileCard?: (row: T) => ReactNode;
  sorting?: SortingState;
  onSortingChange?: (sorting: SortingState) => void;
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    onPageChange: (page: number) => void;
    onPageSizeChange?: (size: number) => void;
  };
  showColumnToggle?: boolean;
  onRowClick?: (row: T) => void;
  getRowId?: (row: T) => string;
  /**
   * `<tr>` content for a totals row. A function receives the visible column
   * count (including the selection column) so `colSpan` stays correct when
   * columns are hidden.
   */
  footer?: ReactNode | ((context: { visibleColumnCount: number }) => ReactNode);
  /**
   * Opt-in row selection. Selection state lives with the caller (so it can
   * span pages); the table renders a checkbox column and a page-level toggle.
   * Requires `getRowId`.
   */
  selection?: DataTableSelection<T>;
  /** Extra classes for a row, e.g. to tint flagged rows. */
  rowClassName?: (row: T) => string | undefined;
  /** Breakpoint at which `mobileCard` gives way to the table. Defaults to `md`. */
  mobileBreakpoint?: 'sm' | 'md';
  /** Overrides the table's minimum width class (default `min-w-[720px]`). */
  tableClassName?: string;
}

export interface DataTableSelection<T> {
  selectedIds: ReadonlySet<string>;
  onToggleRow: (id: string, checked: boolean) => void;
  /** Selects or clears every row on the current page. */
  onTogglePage: (checked: boolean) => void;
  /** Accessible label for a row's checkbox. */
  rowLabel?: (row: T) => string;
  /** Accessible label (and mobile caption) for the page toggle. */
  pageLabel?: string;
}

export function DataTable<T>({
  columns,
  data,
  isLoading,
  error,
  onRetry,
  onClearFilters,
  emptyState,
  mobileCard,
  sorting = [],
  onSortingChange,
  pagination,
  showColumnToggle = true,
  onRowClick,
  getRowId,
  footer,
  selection,
  rowClassName,
  mobileBreakpoint = 'md',
  tableClassName,
}: DataTableProps<T>) {
  const { t } = useTranslation();
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const rowKey = (row: T, index: number) => getRowId?.(row) ?? String(index);
  const pageIds = selection ? data.map(rowKey) : [];
  const pageSelectedCount = selection ? pageIds.filter((id) => selection.selectedIds.has(id)).length : 0;
  const pageChecked: boolean | 'indeterminate' =
    pageIds.length > 0 && pageSelectedCount === pageIds.length ? true : pageSelectedCount > 0 ? 'indeterminate' : false;
  const pageLabel = selection?.pageLabel ?? t('dataTable.selectPage');
  const showTableFrom = mobileBreakpoint === 'sm' ? 'hidden sm:block' : 'hidden md:block';
  const showCardsUntil = mobileBreakpoint === 'sm' ? 'sm:hidden' : 'md:hidden';

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
    manualPagination: true,
    // Without a sort handler there is nothing to sort by, so headers stay plain.
    enableSorting: Boolean(onSortingChange),
    state: { sorting, columnVisibility },
    onSortingChange: (updater) => {
      const next = typeof updater === 'function' ? updater(sorting) : updater;
      onSortingChange?.(next);
    },
    onColumnVisibilityChange: setColumnVisibility,
    getRowId: getRowId ? (row) => getRowId(row) : undefined,
  });

  if (error) {
    return <ErrorState message={errorMessage(t, error)} onRetry={onRetry} />;
  }

  return (
    <div className="flex flex-col">
      {showColumnToggle && (
        <div className="hidden items-center justify-end border-b border-line px-3 py-1.5 md:flex">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" aria-label={t('table.toggleColumns')}>
                <Settings2 className="h-3.5 w-3.5" aria-hidden="true" />
                {t('common.columns')}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel>{t('common.visibleColumns')}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {table
                .getAllLeafColumns()
                .filter((column) => column.getCanHide() && column.id !== 'actions')
                .map((column) => (
                  <DropdownMenuCheckboxItem
                    key={column.id}
                    checked={column.getIsVisible()}
                    onCheckedChange={(checked) => column.toggleVisibility(Boolean(checked))}
                    onSelect={(event) => event.preventDefault()}
                  >
                    {typeof column.columnDef.header === 'string' ? column.columnDef.header : column.id}
                  </DropdownMenuCheckboxItem>
                ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      {/* Desktop / tablet table */}
      <div className={cn('overflow-x-auto', mobileCard && showTableFrom)}>
        {isLoading ? (
          <TableSkeleton columns={columns.length + (selection ? 1 : 0)} />
        ) : data.length === 0 ? (
          (emptyState ?? <NoResultsState onClear={onClearFilters} />)
        ) : (
          <table className={cn('w-full border-collapse', tableClassName ?? 'min-w-[720px]')}>
            <thead>
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id} className="border-b border-line bg-canvas/60">
                  {selection && (
                    <th
                      scope="col"
                      className="w-10 cursor-pointer px-3 py-2.5 hover:bg-brand-light/50"
                      onClick={() => selection.onTogglePage(pageChecked !== true)}
                    >
                      <Checkbox
                        checked={pageChecked}
                        onCheckedChange={(checked) => selection.onTogglePage(checked === true)}
                        onClick={(event) => event.stopPropagation()}
                        aria-label={pageLabel}
                      />
                    </th>
                  )}
                  {headerGroup.headers.map((header) => {
                    const canSort = header.column.getCanSort();
                    const sorted = header.column.getIsSorted();
                    const align = (header.column.columnDef.meta as { align?: string } | undefined)?.align;
                    return (
                      <th
                        key={header.id}
                        scope="col"
                        style={{ width: header.getSize() === 150 ? undefined : header.getSize() }}
                        className={cn(
                          'px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted',
                          align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left',
                        )}
                        aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : undefined}
                      >
                        {header.isPlaceholder ? null : canSort ? (
                          <button
                            type="button"
                            onClick={header.column.getToggleSortingHandler()}
                            className={cn(
                              'inline-flex items-center gap-1 rounded transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-brand-primary/50',
                              align === 'right' && 'flex-row-reverse',
                            )}
                          >
                            {flexRender(header.column.columnDef.header, header.getContext())}
                            {sorted === 'asc' ? (
                              <ArrowUp className="h-3 w-3" aria-hidden="true" />
                            ) : sorted === 'desc' ? (
                              <ArrowDown className="h-3 w-3" aria-hidden="true" />
                            ) : (
                              <ArrowUp className="h-3 w-3 opacity-25" aria-hidden="true" />
                            )}
                          </button>
                        ) : (
                          flexRender(header.column.columnDef.header, header.getContext())
                        )}
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>
            <tbody className="divide-y divide-line">
              {table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  className={cn(
                    'transition-colors hover:bg-canvas/70',
                    onRowClick && 'cursor-pointer',
                    selection?.selectedIds.has(row.id) && 'bg-brand-light/40',
                    rowClassName?.(row.original),
                  )}
                  onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                  tabIndex={onRowClick ? 0 : undefined}
                  onKeyDown={
                    onRowClick
                      ? (event) => {
                          if (event.key === 'Enter') onRowClick(row.original);
                        }
                      : undefined
                  }
                >
                  {selection && (
                    // The whole cell is the hit area — a 16px box is easy to miss, and a
                    // near-miss would otherwise fall through to the row click.
                    <td
                      className="cursor-pointer px-3 py-2.5 hover:bg-brand-light/50"
                      onClick={(event) => {
                        event.stopPropagation();
                        selection.onToggleRow(row.id, !selection.selectedIds.has(row.id));
                      }}
                      onKeyDown={(event) => event.stopPropagation()}
                    >
                      <Checkbox
                        checked={selection.selectedIds.has(row.id)}
                        onCheckedChange={(checked) => selection.onToggleRow(row.id, checked === true)}
                        onClick={(event) => event.stopPropagation()}
                        aria-label={selection.rowLabel?.(row.original) ?? t('dataTable.selectRow')}
                      />
                    </td>
                  )}
                  {row.getVisibleCells().map((cell) => {
                    const align = (cell.column.columnDef.meta as { align?: string } | undefined)?.align;
                    return (
                      <td
                        key={cell.id}
                        className={cn(
                          'px-3 py-2.5 text-[12.5px] text-ink',
                          align === 'right' ? 'text-right tnum' : align === 'center' ? 'text-center' : 'text-left',
                        )}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
            {footer && (
              <tfoot className="border-t-2 border-brand-primary/30 bg-brand-light/40">
                {typeof footer === 'function'
                  ? footer({ visibleColumnCount: table.getVisibleLeafColumns().length + (selection ? 1 : 0) })
                  : footer}
              </tfoot>
            )}
          </table>
        )}
      </div>

      {/* Mobile cards */}
      {mobileCard && (
        <div className={showCardsUntil}>
          {isLoading ? (
            <div className="space-y-2 p-3">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="skeleton h-24 rounded-card" />
              ))}
            </div>
          ) : data.length === 0 ? (
            (emptyState ?? <NoResultsState onClear={onClearFilters} />)
          ) : (
            <ul className="divide-y divide-line">
              {selection && (
                <li
                  className="flex cursor-pointer items-center gap-3 bg-canvas/60 px-4 py-2"
                  onClick={() => selection.onTogglePage(pageChecked !== true)}
                >
                  <Checkbox
                    checked={pageChecked}
                    onCheckedChange={(checked) => selection.onTogglePage(checked === true)}
                    onClick={(event) => event.stopPropagation()}
                    aria-label={pageLabel}
                  />
                  <span className="text-[12px] text-ink-muted">{pageLabel}</span>
                </li>
              )}
              {data.map((row, index) => {
                const id = rowKey(row, index);
                if (!selection) return <li key={id}>{mobileCard(row)}</li>;
                return (
                  <li key={id} className={cn('flex items-start', selection.selectedIds.has(id) && 'bg-brand-light/40')}>
                    <div
                      className="shrink-0 cursor-pointer self-stretch pl-4 pr-1 pt-3.5"
                      onClick={() => selection.onToggleRow(id, !selection.selectedIds.has(id))}
                    >
                      <Checkbox
                        checked={selection.selectedIds.has(id)}
                        onCheckedChange={(checked) => selection.onToggleRow(id, checked === true)}
                        onClick={(event) => event.stopPropagation()}
                        aria-label={selection.rowLabel?.(row) ?? t('dataTable.selectRow')}
                      />
                    </div>
                    <div className="min-w-0 flex-1">{mobileCard(row)}</div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {pagination && pagination.total > 0 && (
        <TablePagination {...pagination} />
      )}
    </div>
  );
}

export function TablePagination({
  page,
  pageSize,
  total,
  totalPages,
  onPageChange,
  onPageSizeChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
}) {
  const { t } = useTranslation();
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  return (
    <nav
      className="flex flex-col items-center justify-between gap-3 border-t border-line px-4 py-3 sm:flex-row"
      aria-label={t('table.pagination')}
    >
      <p className="text-[12px] text-ink-muted tnum">{t('table.showing', { first, last, total })}</p>

      <div className="flex items-center gap-2">
        {onPageSizeChange && (
          <select
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
            aria-label={t('table.rowsPerPage')}
            className="h-8 rounded-control border border-line bg-white px-2 text-[12px] text-ink focus:outline-none focus:ring-2 focus:ring-brand-primary/50"
          >
            {[10, 20, 50, 100].map((size) => (
              <option key={size} value={size}>
                {t('table.perPage', { size })}
              </option>
            ))}
          </select>
        )}
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon-sm"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
            aria-label={t('table.previous')}
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </Button>
          <span className="px-2 text-[12px] text-ink-muted tnum">
            {page} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="icon-sm"
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
            aria-label={t('table.next')}
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </div>
    </nav>
  );
}

import { useCallback, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { ColumnDef, SortingState } from '@tanstack/react-table';
import {
  Copy,
  Download,
  Eye,
  FileText,
  MoreHorizontal,
  Pencil,
  Plus,
  Printer,
  Send,
  Trash2,
  Wallet,
} from 'lucide-react';
import { toast } from 'sonner';
import { EXPENSE_STATUSES } from '@ashram/types';
import { ApiError, api, buildQuery, downloadFile, fileUrl } from '@/lib/api/client';
import { invalidateFinancialData, queryKeys } from '@/lib/api/queryClient';
import { useMasters } from '@/lib/api/hooks';
import { useAuth } from '@/lib/auth/AuthProvider';
import { PageHeader } from '@/components/layout/PageHeader';
import { SectionCard } from '@/components/common/SectionCard';
import { DataTable } from '@/components/common/DataTable';
import { FilterBar, FilterField } from '@/components/common/FilterBar';
import { StatusBadge } from '@/components/common/StatusBadge';
import { EmptyState } from '@/components/common/states';
import { ConfirmationDialog } from '@/components/common/ConfirmationDialog';
import { ExportMenu } from '@/components/common/ExportMenu';
import { fetchAllPages, type ExportColumn } from '@/lib/export';
import { Button } from '@/components/ui/button';
import { SimpleSelect } from '@/components/ui/select';
import { DateInput } from '@/components/common/forms';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { formatCurrency, formatDate } from '@/lib/utils/format';
import { RecordPaymentDialog } from './RecordPaymentDialog';
import { useTranslation } from 'react-i18next';
import { useLabels } from '@/i18n/useLabels';
import { errorMessage } from '@/i18n/errors';
import type { ExpenseListResponse, ExpenseListRow } from './types';

const SORT_MAP: Record<string, string> = {
  date: 'date',
  total: 'total',
  expenseNumber: 'expenseNumber',
  status: 'status',
};

export default function ExpenseListPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const labels = useLabels();
  const { can } = useAuth();
  const { data: masters } = useMasters();

  const [deleteTarget, setDeleteTarget] = useState<ExpenseListRow | null>(null);
  const [payTarget, setPayTarget] = useState<ExpenseListRow | null>(null);
  const [submitTarget, setSubmitTarget] = useState<ExpenseListRow | null>(null);

  // Filters live in the URL so a filtered view is shareable and survives reload.
  const filters = useMemo(
    () => ({
      page: Number(searchParams.get('page') ?? '1'),
      pageSize: Number(searchParams.get('pageSize') ?? '20'),
      search: searchParams.get('search') ?? '',
      status: searchParams.get('status') ?? '',
      departmentId: searchParams.get('department') ?? '',
      fundId: searchParams.get('fund') ?? '',
      categoryId: searchParams.get('category') ?? '',
      paymentStatus: searchParams.get('paymentStatus') ?? '',
      from: searchParams.get('from') ?? '',
      to: searchParams.get('to') ?? '',
      sortBy: searchParams.get('sortBy') ?? 'date',
      sortDir: (searchParams.get('sortDir') ?? 'desc') as 'asc' | 'desc',
    }),
    [searchParams],
  );

  const setFilter = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(searchParams);
      if (value) next.set(key, value);
      else next.delete(key);
      if (key !== 'page') next.delete('page');
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const clearFilters = useCallback(() => setSearchParams(new URLSearchParams(), { replace: true }), [setSearchParams]);

  const activeFilterCount = [
    filters.status,
    filters.departmentId,
    filters.fundId,
    filters.categoryId,
    filters.paymentStatus,
    filters.from,
    filters.to,
  ].filter(Boolean).length;

  const queryParams = useMemo(
    () => ({
      page: filters.page,
      pageSize: filters.pageSize,
      search: filters.search || undefined,
      status: filters.status || undefined,
      departmentId: filters.departmentId || undefined,
      fundId: filters.fundId || undefined,
      categoryId: filters.categoryId || undefined,
      paymentStatus: filters.paymentStatus || undefined,
      from: filters.from || undefined,
      to: filters.to || undefined,
      sortBy: SORT_MAP[filters.sortBy] ?? 'date',
      sortDir: filters.sortDir,
    }),
    [filters],
  );

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: queryKeys.expenses(queryParams),
    queryFn: () => api.get<ExpenseListResponse>('/expenses' + buildQuery(queryParams)),
    placeholderData: (previous) => previous,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/expenses/${id}`),
    onSuccess: () => {
      toast.success(t('expenses.deleted'));
      invalidateFinancialData();
      setDeleteTarget(null);
    },
    onError: (err) => toast.error(t('expenses.deleteFailed'), { description: errorMessage(t, err) }),
  });

  const submitMutation = useMutation({
    mutationFn: (id: string) => api.post(`/expenses/${id}/submit`, {}),
    onSuccess: () => {
      toast.success(t('expenses.submitted'), { description: t('expenses.submittedText') });
      invalidateFinancialData();
      setSubmitTarget(null);
    },
    onError: (err) => toast.error(t('expenses.submitFailed'), { description: errorMessage(t, err) }),
  });

  const duplicateMutation = useMutation({
    mutationFn: (id: string) => api.post<{ id: string }>(`/expenses/${id}/duplicate`, {}),
    onSuccess: (result) => {
      toast.success(t('expenses.duplicated'));
      invalidateFinancialData();
      navigate(`/expenses/${result.id}`);
    },
    onError: (err) => toast.error(t('expenses.duplicateFailed'), { description: errorMessage(t, err) }),
  });

  const columns = useMemo<ColumnDef<ExpenseListRow>[]>(
    () => [
      {
        id: 'expenseNumber',
        accessorKey: 'expenseNumber',
        header: t('expenses.number'),
        enableSorting: true,
        cell: ({ row }) => (
          <Link
            to={`/expenses/${row.original.id}`}
            className="font-medium text-brand-primary hover:underline"
            onClick={(event) => event.stopPropagation()}
          >
            {row.original.expenseNumber}
          </Link>
        ),
      },
      {
        id: 'date',
        accessorKey: 'date',
        header: t('common.date'),
        enableSorting: true,
        cell: ({ row }) => <span className="whitespace-nowrap text-ink-muted">{formatDate(row.original.date, 'short')}</span>,
      },
      {
        id: 'title',
        accessorKey: 'title',
        header: t('expenses.expense'),
        enableSorting: false,
        cell: ({ row }) => (
          <div className="max-w-[240px]">
            <p className="truncate font-medium text-ink">{row.original.title}</p>
            {row.original.onBehalfOf ? (
              <p className="truncate text-[11.5px] text-brand">{t('expenses.forPerson', { name: row.original.onBehalfOf.name })}</p>
            ) : (
              row.original.supplier && <p className="truncate text-[11.5px] text-ink-muted">{row.original.supplier.name}</p>
            )}
          </div>
        ),
      },
      {
        id: 'department',
        header: t('common.department'),
        enableSorting: false,
        cell: ({ row }) => <span className="text-ink-muted">{row.original.department.name}</span>,
      },
      {
        id: 'fund',
        header: t('common.fund'),
        enableSorting: false,
        cell: ({ row }) => <span className="text-ink-muted">{row.original.fund.name}</span>,
      },
      {
        id: 'total',
        accessorKey: 'total',
        header: t('common.amount'),
        enableSorting: true,
        meta: { align: 'right' },
        cell: ({ row }) => <span className="font-semibold text-ink">{formatCurrency(row.original.total)}</span>,
      },
      {
        id: 'status',
        accessorKey: 'status',
        header: t('common.status'),
        enableSorting: true,
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        id: 'actions',
        header: '',
        enableSorting: false,
        enableHiding: false,
        meta: { align: 'right' },
        cell: ({ row }) => <RowActions row={row.original} />,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [can, t],
  );

  function RowActions({ row }: { row: ExpenseListRow }) {
    const editable = row.status === 'DRAFT' || row.status === 'REJECTED';
    const payable = (row.status === 'APPROVED' || row.status === 'PAYMENT_PENDING') && row.paymentStatus !== 'PAID';

    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild onClick={(event) => event.stopPropagation()}>
          <Button variant="ghost" size="icon-sm" aria-label={t('expenses.actionsFor', { number: row.expenseNumber })}>
            <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent onClick={(event) => event.stopPropagation()}>
          <DropdownMenuItem asChild>
            <Link to={`/expenses/${row.id}`}>
              <Eye className="h-3.5 w-3.5" aria-hidden="true" />
              {t('common.view')}
            </Link>
          </DropdownMenuItem>

          {can('expense.edit') && editable && (
            <DropdownMenuItem asChild>
              <Link to={`/expenses/${row.id}/edit`}>
                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                {t('common.edit')}
              </Link>
            </DropdownMenuItem>
          )}

          {can('expense.submit') && row.status === 'DRAFT' && (
            <DropdownMenuItem onSelect={() => setSubmitTarget(row)}>
              <Send className="h-3.5 w-3.5" aria-hidden="true" />
              {t('expenses.submit')}
            </DropdownMenuItem>
          )}

          {can('expense.pay') && payable && (
            <DropdownMenuItem onSelect={() => setPayTarget(row)}>
              <Wallet className="h-3.5 w-3.5" aria-hidden="true" />
              {t('expenses.recordPayment')}
            </DropdownMenuItem>
          )}

          {can('expense.create') && (
            <DropdownMenuItem onSelect={() => duplicateMutation.mutate(row.id)}>
              <Copy className="h-3.5 w-3.5" aria-hidden="true" />
              {t('common.duplicate')}
            </DropdownMenuItem>
          )}

          <DropdownMenuSeparator />

          <DropdownMenuItem onSelect={() => window.open(fileUrl(`/expenses/${row.id}/pdf?lang=${t('language.code')}`), '_blank', 'noopener')}>
            <Printer className="h-3.5 w-3.5" aria-hidden="true" />
            {t('common.print')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() =>
              void downloadFile(`/expenses/${row.id}/pdf?download=1&lang=${t('language.code')}`, `${row.expenseNumber}.pdf`).catch(() =>
                toast.error(t('expenses.downloadFailed')),
              )
            }
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            {t('common.downloadPdf')}
          </DropdownMenuItem>

          {can('expense.delete') && editable && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem tone="danger" onSelect={() => setDeleteTarget(row)}>
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                {t('common.delete')}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  const sorting: SortingState = [{ id: filters.sortBy, desc: filters.sortDir === 'desc' }];

  const exportColumns: ExportColumn<ExpenseListRow>[] = [
    { header: t('expenses.number'), value: (row) => row.expenseNumber },
    { header: t('common.date'), type: 'date', value: (row) => row.date },
    { header: t('expenses.expense'), value: (row) => row.title },
    { header: t('common.department'), value: (row) => row.department.name },
    { header: t('common.fund'), value: (row) => row.fund.name },
    { header: t('common.category'), value: (row) => row.category.name },
    { header: t('common.supplier'), value: (row) => row.supplier?.name },
    { header: t('dataExport.cols.onBehalfOf'), value: (row) => row.onBehalfOf?.name },
    { header: t('dataExport.cols.createdBy'), value: (row) => row.createdBy.name },
    { header: t('common.amount'), type: 'currency', value: (row) => row.total },
    { header: t('dataExport.cols.paidAmount'), type: 'currency', value: (row) => row.paidAmount },
    { header: t('common.status'), value: (row) => labels.expenseStatus[row.status] ?? row.status },
    { header: t('dataExport.cols.paymentStatus'), value: (row) => labels.paymentStatus[row.paymentStatus] ?? row.paymentStatus },
  ];

  const fetchExportRows = () =>
    fetchAllPages((page, pageSize) =>
      api.get<ExpenseListResponse>('/expenses' + buildQuery({ ...queryParams, page, pageSize })),
    );

  return (
    <>
      <PageHeader
        title={t('expenses.title')}
        subtitle={
          data
            ? t('expenses.subtitleCount', { count: data.meta.total, amount: formatCurrency(data.meta.totalAmount) })
            : t('expenses.subtitle')
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ExportMenu fileBase="expenses" title={t('expenses.title')} columns={exportColumns} fetchRows={fetchExportRows} />
            {can('expense.create') && (
              <Button asChild>
                <Link to="/expenses/new">
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  {t('expenses.add')}
                </Link>
              </Button>
            )}
          </div>
        }
      />

      <SectionCard noPadding>
        <div className="border-b border-line p-3">
          <FilterBar
            search={filters.search}
            onSearchChange={(value) => setFilter('search', value)}
            searchPlaceholder={t('expenses.searchPlaceholder')}
            activeCount={activeFilterCount}
            onClear={clearFilters}
            filters={
              <>
                <FilterField label={t('common.department')}>
                  <SimpleSelect
                    value={filters.departmentId || 'all'}
                    onValueChange={(value) => setFilter('department', value === 'all' ? '' : value)}
                    options={[
                      { value: 'all', label: t('common.allDepartments') },
                      ...(masters?.departments ?? []).map((d) => ({ value: d.id, label: d.name })),
                    ]}
                    ariaLabel={t('expenses.filterDepartment')}
                  />
                </FilterField>
                <FilterField label={t('common.fund')}>
                  <SimpleSelect
                    value={filters.fundId || 'all'}
                    onValueChange={(value) => setFilter('fund', value === 'all' ? '' : value)}
                    options={[
                      { value: 'all', label: t('common.allFunds') },
                      ...(masters?.funds ?? []).map((f) => ({ value: f.id, label: f.name })),
                    ]}
                    ariaLabel={t('expenses.filterFund')}
                  />
                </FilterField>
                <FilterField label={t('common.status')}>
                  <SimpleSelect
                    value={filters.status || 'all'}
                    onValueChange={(value) => setFilter('status', value === 'all' ? '' : value)}
                    options={[
                      { value: 'all', label: t('common.allStatuses') },
                      ...EXPENSE_STATUSES.map((status) => ({ value: status, label: labels.expenseStatus[status] })),
                    ]}
                    ariaLabel={t('expenses.filterStatus')}
                  />
                </FilterField>
                <FilterField label={t('common.category')}>
                  <SimpleSelect
                    value={filters.categoryId || 'all'}
                    onValueChange={(value) => setFilter('category', value === 'all' ? '' : value)}
                    options={[
                      { value: 'all', label: t('common.allCategories') },
                      ...(masters?.categories ?? []).map((c) => ({ value: c.id, label: c.name })),
                    ]}
                    ariaLabel={t('expenses.filterCategory')}
                  />
                </FilterField>
                <FilterField label={t('common.from')}>
                  <DateInput
                    value={filters.from}
                    onChange={(event) => setFilter('from', event.target.value)}
                    aria-label={t('common.from')}
                  />
                </FilterField>
                <FilterField label={t('common.to')}>
                  <DateInput
                    value={filters.to}
                    onChange={(event) => setFilter('to', event.target.value)}
                    aria-label={t('common.to')}
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
          sorting={sorting}
          onSortingChange={(next) => {
            const first = next[0];
            if (!first) return;
            setFilter('sortBy', first.id);
            setFilter('sortDir', first.desc ? 'desc' : 'asc');
          }}
          onRowClick={(row) => navigate(`/expenses/${row.id}`)}
          emptyState={
            activeFilterCount || filters.search ? undefined : (
              <EmptyState
                icon={FileText}
                title={t('expenses.emptyTitle')}
                description={t('expenses.emptyText')}
                action={
                  can('expense.create') && (
                    <Button asChild size="sm">
                      <Link to="/expenses/new">
                        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                        {t('expenses.add')}
                      </Link>
                    </Button>
                  )
                }
              />
            )
          }
          mobileCard={(row) => (
            <Link to={`/expenses/${row.id}`} className="flex items-start gap-3 px-4 py-3 active:bg-canvas">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-ink">{row.title}</p>
                <p className="mt-0.5 truncate text-[11.5px] text-ink-muted">
                  {row.expenseNumber} · {row.department.name}
                </p>
                <p className="mt-0.5 truncate text-[11.5px] text-ink-muted">
                  {row.fund.name} · {formatDate(row.date)}
                </p>
                {row.onBehalfOf && (
                  <p className="mt-0.5 truncate text-[11.5px] text-brand">{t('expenses.forPerson', { name: row.onBehalfOf.name })}</p>
                )}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                <span className="text-[13px] font-semibold text-ink tnum">{formatCurrency(row.total)}</span>
                <StatusBadge status={row.status} />
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
                  onPageChange: (page) => setFilter('page', String(page)),
                  onPageSizeChange: (size) => setFilter('pageSize', String(size)),
                }
              : undefined
          }
        />
      </SectionCard>

      <ConfirmationDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t('expenses.deleteTitle')}
        description={
          deleteTarget ? t('expenses.deleteText', { number: deleteTarget.expenseNumber, title: deleteTarget.title }) : undefined
        }
        confirmLabel={t('common.delete')}
        tone="danger"
        loading={deleteMutation.isPending}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
      />

      <ConfirmationDialog
        open={Boolean(submitTarget)}
        onOpenChange={(open) => !open && setSubmitTarget(null)}
        title={t('expenses.submitTitle')}
        description={
          submitTarget
            ? t('expenses.submitText', { number: submitTarget.expenseNumber, amount: formatCurrency(submitTarget.total) })
            : undefined
        }
        confirmLabel={t('expenses.submit')}
        loading={submitMutation.isPending}
        onConfirm={() => submitTarget && submitMutation.mutate(submitTarget.id)}
      />

      {payTarget && (
        <RecordPaymentDialog
          open={Boolean(payTarget)}
          onOpenChange={(open) => !open && setPayTarget(null)}
          expense={{
            id: payTarget.id,
            expenseNumber: payTarget.expenseNumber,
            title: payTarget.title,
            total: payTarget.total,
            balanceDue: payTarget.total - payTarget.paidAmount,
          }}
          onSuccess={() => setPayTarget(null)}
        />
      )}
    </>
  );
}

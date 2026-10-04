import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { MoreHorizontal, Plus, ShoppingCart, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { PURCHASE_STATUSES, UNITS } from '@ashram/types';
import { useTranslation } from 'react-i18next';
import { useLabels } from '@/i18n/useLabels';
import { errorMessage } from '@/i18n/errors';
import { ApiError, api, buildQuery } from '@/lib/api/client';
import { queryClient, queryKeys } from '@/lib/api/queryClient';
import { useMasters } from '@/lib/api/hooks';
import { useAuth } from '@/lib/auth/AuthProvider';
import { PageHeader } from '@/components/layout/PageHeader';
import { SectionCard } from '@/components/common/SectionCard';
import { FilterBar, FilterField } from '@/components/common/FilterBar';
import { EmptyState } from '@/components/common/states';
import { PurchaseStatusBadge } from '@/components/common/StatusBadge';
import { DataTable } from '@/components/common/DataTable';
import { ExportMenu } from '@/components/common/ExportMenu';
import { fetchAllPages, type ExportColumn } from '@/lib/export';
import { FormField, DateInput, MoneyInput } from '@/components/common/forms';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { SimpleSelect } from '@/components/ui/select';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { formatCurrency, formatDate, todayLocal } from '@/lib/utils/format';
import { computeTotals } from '@/features/expenses/expenseSchema';

interface PurchaseListResponse {
  data: PurchaseRow[];
  meta: { page: number; pageSize: number; total: number; totalPages: number; totalAmount: number };
}

interface PurchaseRow {
  id: string;
  orderNumber: string;
  date: string;
  expectedDate: string | null;
  status: string;
  subtotal: number;
  tax: number;
  total: number;
  supplier: { id: string; name: string };
  department: { id: string; name: string };
  fund: { id: string; name: string };
  _count: { items: number };
}

const NEXT_STATUS: Record<string, string[]> = {
  DRAFT: ['ORDERED', 'CANCELLED'],
  ORDERED: ['PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'],
  PARTIALLY_RECEIVED: ['RECEIVED', 'CANCELLED'],
  RECEIVED: [],
  CANCELLED: [],
};

export default function PurchasesPage() {
  const { t } = useTranslation();
  const labels = useLabels();
  const [searchParams, setSearchParams] = useSearchParams();
  const { can } = useAuth();
  const [dialogOpen, setDialogOpen] = useState(searchParams.get('new') === '1');

  useEffect(() => {
    if (searchParams.get('new') === '1') setDialogOpen(true);
  }, [searchParams]);

  const page = Number(searchParams.get('page') ?? '1');
  const search = searchParams.get('search') ?? '';
  const status = searchParams.get('status') ?? '';

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setSearchParams(next, { replace: true });
  }

  const clearFilters = () => setSearchParams(new URLSearchParams(), { replace: true });

  const filters = useMemo(() => ({ search: search || undefined, status: status || undefined }), [search, status]);
  const params = useMemo(() => ({ page, pageSize: 20, ...filters }), [page, filters]);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: queryKeys.purchases(params),
    queryFn: () => api.get<PurchaseListResponse>('/purchases' + buildQuery(params)),
    placeholderData: (previous) => previous,
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, next }: { id: string; next: string }) => api.post(`/purchases/${id}/status`, { status: next }),
    onSuccess: () => {
      toast.success(t('purchases.updated'));
      queryClient.invalidateQueries({ queryKey: ['purchases'] });
    },
    onError: (err) => toast.error(t('purchases.updateFailed'), { description: errorMessage(t, err) }),
  });

  const canAdvance = (row: PurchaseRow) => can('purchase.create') && (NEXT_STATUS[row.status]?.length ?? 0) > 0;

  const columns: ColumnDef<PurchaseRow>[] = [
    {
      id: 'orderNumber',
      header: t('purchases.orderNumber'),
      enableHiding: false,
      cell: ({ row }) => <span className="font-medium text-ink">{row.original.orderNumber}</span>,
    },
    {
      id: 'date',
      header: t('common.date'),
      cell: ({ row }) => <span className="whitespace-nowrap text-ink-muted">{formatDate(row.original.date)}</span>,
    },
    { id: 'supplier', header: t('common.supplier'), cell: ({ row }) => row.original.supplier.name },
    {
      id: 'department',
      header: t('common.department'),
      cell: ({ row }) => <span className="text-ink-muted">{row.original.department.name}</span>,
    },
    {
      id: 'items',
      header: t('purchases.items'),
      cell: ({ row }) => <span className="text-ink-muted tnum">{row.original._count.items}</span>,
    },
    { id: 'status', header: t('common.status'), cell: ({ row }) => <PurchaseStatusBadge status={row.original.status} /> },
    {
      id: 'total',
      header: t('common.total'),
      enableHiding: false,
      meta: { align: 'right' },
      cell: ({ row }) => <span className="font-semibold text-ink">{formatCurrency(row.original.total)}</span>,
    },
    {
      id: 'actions',
      header: '',
      enableHiding: false,
      meta: { align: 'right' },
      cell: ({ row: { original: row } }) =>
        canAdvance(row) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={t('purchases.actionsFor', { number: row.orderNumber })}>
                <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {NEXT_STATUS[row.status].map((next) => (
                <DropdownMenuItem
                  key={next}
                  tone={next === 'CANCELLED' ? 'danger' : 'default'}
                  onSelect={() => statusMutation.mutate({ id: row.id, next })}
                >
                  {t('purchases.markAs', { status: labels.purchaseStatus[next] })}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ),
    },
  ];

  const exportColumns: ExportColumn<PurchaseRow>[] = [
    { header: t('purchases.orderNumber'), value: (row) => row.orderNumber },
    { header: t('common.date'), type: 'date', value: (row) => row.date },
    { header: t('purchases.expectedDelivery'), type: 'date', value: (row) => row.expectedDate },
    { header: t('common.supplier'), value: (row) => row.supplier.name },
    { header: t('common.department'), value: (row) => row.department.name },
    { header: t('common.fund'), value: (row) => row.fund.name },
    { header: t('purchases.items'), type: 'number', value: (row) => row._count.items },
    { header: t('common.subtotal'), type: 'currency', value: (row) => row.subtotal },
    { header: t('common.tax'), type: 'currency', value: (row) => row.tax },
    { header: t('common.total'), type: 'currency', value: (row) => row.total },
    { header: t('common.status'), value: (row) => labels.purchaseStatus[row.status] ?? row.status },
  ];

  const createButton = (size?: 'sm') =>
    can('purchase.create') && (
      <Button size={size} onClick={() => setDialogOpen(true)}>
        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
        {t('purchases.create')}
      </Button>
    );

  return (
    <>
      <PageHeader
        title={t('purchases.title')}
        subtitle={t('purchases.subtitle')}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ExportMenu
              fileBase="purchases"
              title={t('purchases.title')}
              columns={exportColumns}
              fetchRows={() =>
                fetchAllPages((pageNumber, pageSize) =>
                  api.get<PurchaseListResponse>('/purchases' + buildQuery({ ...filters, page: pageNumber, pageSize })),
                )
              }
            />
            {createButton()}
          </div>
        }
      />

      <SectionCard noPadding>
        <div className="border-b border-line p-3">
          <FilterBar
            search={search}
            onSearchChange={(value) => setParam('search', value)}
            searchPlaceholder={t('purchases.searchPlaceholder')}
            activeCount={status ? 1 : 0}
            onClear={clearFilters}
            filters={
              <FilterField label={t('common.status')}>
                <SimpleSelect
                  value={status || 'all'}
                  onValueChange={(value) => setParam('status', value === 'all' ? '' : value)}
                  options={[
                    { value: 'all', label: t('common.allStatuses') },
                    ...PURCHASE_STATUSES.map((item) => ({ value: item, label: labels.purchaseStatus[item] })),
                  ]}
                  ariaLabel={t('expenses.filterStatus')}
                />
              </FilterField>
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
          tableClassName="min-w-[760px]"
          emptyState={
            search || status ? undefined : (
              <EmptyState
                icon={ShoppingCart}
                title={t('purchases.emptyTitle')}
                description={t('purchases.emptyText')}
                action={createButton('sm')}
              />
            )
          }
          mobileCard={(row) => (
            <div className="px-4 py-3">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-ink">{row.supplier.name}</p>
                  <p className="mt-0.5 truncate text-[11.5px] text-ink-muted">
                    {row.orderNumber} · {row.department.name}
                  </p>
                  <p className="mt-0.5 text-[11.5px] text-ink-muted">
                    {formatDate(row.date)} · {t('purchases.itemCount', { count: row._count.items })}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  <span className="text-[13px] font-semibold text-ink tnum">{formatCurrency(row.total)}</span>
                  <PurchaseStatusBadge status={row.status} />
                </div>
              </div>
              {canAdvance(row) && (
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {NEXT_STATUS[row.status].map((next) => (
                    <Button
                      key={next}
                      size="sm"
                      variant={next === 'CANCELLED' ? 'danger-outline' : 'outline'}
                      onClick={() => statusMutation.mutate({ id: row.id, next })}
                    >
                      {labels.purchaseStatus[next]}
                    </Button>
                  ))}
                </div>
              )}
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

      <PurchaseDialog
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

const schema = z.object({
  date: z.string().min(1, 'validation.selectDate'),
  expectedDate: z.string().optional(),
  supplierId: z.string().min(1, 'validation.selectSupplier'),
  departmentId: z.string().min(1, 'validation.selectDepartment'),
  fundId: z.string().min(1, 'validation.selectFund'),
  categoryId: z.string().optional(),
  notes: z.string().optional(),
  items: z
    .array(
      z.object({
        description: z.string().trim().min(1, 'validation.descriptionRequired'),
        quantity: z.coerce.number().gt(0, 'validation.positive'),
        unit: z.enum(UNITS),
        rate: z.coerce.number().min(0),
        taxRate: z.coerce.number().min(0).max(100),
      }),
    )
    .min(1, 'purchases.itemsRequired'),
});

type PurchaseValues = z.infer<typeof schema>;

function PurchaseDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  const { data: masters } = useMasters();

  const {
    register,
    handleSubmit,
    control,
    watch,
    setValue,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<PurchaseValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      date: todayLocal(),
      supplierId: '',
      departmentId: '',
      fundId: '',
      items: [{ description: '', quantity: 1, unit: 'NOS', rate: 0, taxRate: 0 }],
    },
  });

  const { fields, append, remove } = useFieldArray({ control, name: 'items' });
  const items = watch('items') ?? [];
  const totals = computeTotals(items);

  const mutation = useMutation({
    mutationFn: (values: PurchaseValues) =>
      api.post('/purchases', { ...values, expectedDate: values.expectedDate || null, categoryId: values.categoryId || null }),
    onSuccess: () => {
      toast.success(t('purchases.created'));
      queryClient.invalidateQueries({ queryKey: ['purchases'] });
      reset();
      onOpenChange(false);
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        const fieldErrors = error.fieldErrors;
        for (const [field, message] of Object.entries(fieldErrors)) {
          setError(field.split('.')[0] as keyof PurchaseValues, { message });
        }
        toast.error(t('purchases.createFailed'), { description: errorMessage(t, error) });
      } else {
        toast.error(t('purchases.createFailed'));
      }
    },
  });

  const itemErrors = errors.items as unknown as { description?: { message?: string } }[] | undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle>{t('purchases.dialogTitle')}</DialogTitle>
          <DialogDescription>{t('purchases.dialogText')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit((values) => mutation.mutate(values))} noValidate className="flex min-h-0 flex-1 flex-col">
          <DialogBody>
            <div className="grid gap-3 sm:grid-cols-3">
              <FormField label={t('purchases.orderDate')} htmlFor="po-date" required error={errors.date?.message}>
                <DateInput id="po-date" invalid={Boolean(errors.date)} {...register('date')} />
              </FormField>
              <FormField label={t('purchases.expectedDelivery')} htmlFor="po-expected">
                <DateInput id="po-expected" {...register('expectedDate')} />
              </FormField>
              <FormField label={t('common.supplier')} htmlFor="po-supplier" required error={errors.supplierId?.message}>
                <SimpleSelect
                  value={watch('supplierId')}
                  onValueChange={(value) => setValue('supplierId', value, { shouldValidate: true })}
                  options={(masters?.suppliers ?? []).map((v) => ({ value: v.id, label: v.name }))}
                  placeholder={t('purchases.selectSupplier')}
                  invalid={Boolean(errors.supplierId)}
                  ariaLabel={t('common.supplier')}
                />
              </FormField>
              <FormField label={t('common.department')} htmlFor="po-department" required error={errors.departmentId?.message}>
                <SimpleSelect
                  value={watch('departmentId')}
                  onValueChange={(value) => setValue('departmentId', value, { shouldValidate: true })}
                  options={(masters?.departments ?? []).map((d) => ({ value: d.id, label: d.name }))}
                  placeholder={t('wizard.selectDepartment')}
                  invalid={Boolean(errors.departmentId)}
                  ariaLabel={t('common.department')}
                />
              </FormField>
              <FormField label={t('common.fund')} htmlFor="po-fund" required error={errors.fundId?.message}>
                <SimpleSelect
                  value={watch('fundId')}
                  onValueChange={(value) => setValue('fundId', value, { shouldValidate: true })}
                  options={(masters?.funds ?? []).map((f) => ({ value: f.id, label: f.name }))}
                  placeholder={t('wizard.selectFund')}
                  invalid={Boolean(errors.fundId)}
                  ariaLabel={t('common.fund')}
                />
              </FormField>
              <FormField label={t('common.category')} htmlFor="po-category">
                <SimpleSelect
                  value={watch('categoryId')}
                  onValueChange={(value) => setValue('categoryId', value)}
                  options={(masters?.categories ?? []).map((c) => ({ value: c.id, label: c.name }))}
                  placeholder={t('common.optional')}
                  ariaLabel={t('common.category')}
                />
              </FormField>
            </div>

            <h3 className="mb-2 mt-5 text-[13px] font-semibold text-ink">{t('purchases.items')}</h3>
            <div className="space-y-2">
              {fields.map((field, index) => (
                <div key={field.id} className="grid gap-2 rounded-control border border-line p-2.5 sm:grid-cols-[1fr_80px_86px_110px_80px_40px] sm:items-start">
                  <div>
                    <Input
                      placeholder={t('purchases.itemDescription')}
                      aria-label={t('wizard.itemDescription', { n: index + 1 })}
                      {...register(`items.${index}.description` as const)}
                    />
                    {itemErrors?.[index]?.description?.message && (
                      <p role="alert" className="mt-1 text-[11px] text-danger">
                        {itemErrors[index]?.description?.message}
                      </p>
                    )}
                  </div>
                  <Input
                    type="number"
                    step="0.001"
                    min="0"
                    className="text-right tnum"
                    aria-label={t('wizard.itemQuantity', { n: index + 1 })}
                    {...register(`items.${index}.quantity` as const)}
                  />
                  <SimpleSelect
                    value={items[index]?.unit ?? 'NOS'}
                    onValueChange={(value) => setValue(`items.${index}.unit`, value as never)}
                    options={UNITS.map((unit) => ({ value: unit, label: unit }))}
                    ariaLabel={t('wizard.itemUnit', { n: index + 1 })}
                  />
                  <MoneyInput aria-label={t('wizard.itemRate', { n: index + 1 })} {...register(`items.${index}.rate` as const)} />
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    className="text-right tnum"
                    aria-label={t('wizard.itemTax', { n: index + 1 })}
                    {...register(`items.${index}.taxRate` as const)}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={fields.length === 1}
                    onClick={() => remove(index)}
                    aria-label={t('wizard.removeItem', { n: index + 1 })}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-danger" aria-hidden="true" />
                  </Button>
                </div>
              ))}
            </div>

            <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => append({ description: '', quantity: 1, unit: 'NOS', rate: 0, taxRate: 0 })}
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                {t('wizard.addItem')}
              </Button>
              <dl className="w-full space-y-1 rounded-control border border-line bg-canvas/60 p-3 sm:w-[240px]">
                <div className="flex justify-between">
                  <dt className="text-[12px] text-ink-muted">{t('common.subtotal')}</dt>
                  <dd className="text-[12.5px] text-ink tnum">{formatCurrency(totals.subtotal, { decimals: true })}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-[12px] text-ink-muted">{t('common.tax')}</dt>
                  <dd className="text-[12.5px] text-ink tnum">{formatCurrency(totals.tax, { decimals: true })}</dd>
                </div>
                <div className="flex justify-between border-t border-line pt-1">
                  <dt className="text-[12.5px] font-semibold text-ink">{t('common.total')}</dt>
                  <dd className="text-[15px] font-semibold text-brand tnum">{formatCurrency(totals.total, { decimals: true })}</dd>
                </div>
              </dl>
            </div>

            <FormField label={t('common.notes')} htmlFor="po-notes" className="mt-3">
              <Textarea id="po-notes" rows={2} {...register('notes')} />
            </FormField>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" loading={isSubmitting || mutation.isPending}>
              {t('purchases.createOrder')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

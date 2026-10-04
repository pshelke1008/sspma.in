import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { HeartHandshake, Plus, Users, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { DONATION_MODES } from '@ashram/types';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useLabels } from '@/i18n/useLabels';
import { errorMessage } from '@/i18n/errors';
import { ApiError, api, buildQuery } from '@/lib/api/client';
import { invalidateFinancialData, queryClient, queryKeys } from '@/lib/api/queryClient';
import { useMasters } from '@/lib/api/hooks';
import { useAuth } from '@/lib/auth/AuthProvider';
import { PageHeader } from '@/components/layout/PageHeader';
import { SectionCard } from '@/components/common/SectionCard';
import { StatCard } from '@/components/common/StatCard';
import { FilterBar, FilterField } from '@/components/common/FilterBar';
import { CardGridSkeleton, EmptyState, ErrorState, TableSkeleton } from '@/components/common/states';
import { FormField, DateInput, MoneyInput } from '@/components/common/forms';
import { TablePagination } from '@/components/common/DataTable';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input, Textarea } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/misc';
import { SimpleSelect } from '@/components/ui/select';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DonutChart } from '@/components/charts';
import { formatCurrency, formatDate } from '@/lib/utils/format';

interface DonationRow {
  id: string;
  receiptNumber: string;
  date: string;
  donorName: string;
  amount: number;
  mode: string;
  purpose: string | null;
  referenceNumber: string | null;
  is80GEligible: boolean;
  fund: { id: string; name: string };
  department: { id: string; name: string } | null;
  bankAccount: { id: string; name: string } | null;
  donor: { id: string; name: string } | null;
}

export default function DonationsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { can } = useAuth();
  const { data: masters } = useMasters();
  const [dialogOpen, setDialogOpen] = useState(searchParams.get('new') === '1');

  const { t } = useTranslation();
  const labels = useLabels();

  useEffect(() => {
    if (searchParams.get('new') === '1') setDialogOpen(true);
  }, [searchParams]);

  const page = Number(searchParams.get('page') ?? '1');
  const search = searchParams.get('search') ?? '';
  const fundId = searchParams.get('fund') ?? '';
  const mode = searchParams.get('mode') ?? '';

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setSearchParams(next, { replace: true });
  }

  const params = useMemo(
    () => ({ page, pageSize: 20, search: search || undefined, fundId: fundId || undefined, mode: mode || undefined }),
    [page, search, fundId, mode],
  );

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: queryKeys.donations(params),
    queryFn: () =>
      api.get<{ data: DonationRow[]; meta: { page: number; pageSize: number; total: number; totalPages: number; totalAmount: number } }>(
        '/donations' + buildQuery(params),
      ),
    placeholderData: (previous) => previous,
  });

  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: queryKeys.donationSummary,
    queryFn: () =>
      api.get<{ totalAmount: number; totalCount: number; thisMonth: number; donorCount: number; byFund: { name: string; amount: number }[] }>(
        '/donations/summary',
      ),
  });

  if (error) return <ErrorState message={errorMessage(t, error)} onRetry={() => void refetch()} />;

  return (
    <>
      <PageHeader
        title={t('donations.title')}
        subtitle={t('donations.subtitle')}
        actions={
          can('donation.create') && (
            <Button onClick={() => setDialogOpen(true)}>
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              {t('donations.receive')}
            </Button>
          )
        }
      />

      {summaryLoading ? (
        <CardGridSkeleton count={3} className="xl:grid-cols-3" />
      ) : (
        <div className="grid gap-3 sm:grid-cols-3">
          <StatCard label={t('donations.totalReceived')} value={summary?.totalAmount ?? 0} icon={HeartHandshake} tone="success" hint={t('donations.receipts', { count: summary?.totalCount ?? 0 })} />
          <StatCard label={t('donations.thisMonth')} value={summary?.thisMonth ?? 0} icon={Wallet} tone="brand" />
          <StatCard label={t('donations.registeredDonors')} value={summary?.donorCount ?? 0} format="number" icon={Users} tone="accent" hint={t('donations.registeredDonorsHint')} />
        </div>
      )}

      {summary && summary.byFund.length > 0 && (
        <SectionCard title={t('donations.byFund')} className="mt-4">
          <DonutChart
            data={summary.byFund.map((item) => ({ name: item.name, value: item.amount }))}
            centerLabel={{ title: t('common.total'), value: formatCurrency(summary.totalAmount, { compact: true }) }}
          />
        </SectionCard>
      )}

      <SectionCard className="mt-4" noPadding>
        <div className="border-b border-line p-3">
          <FilterBar
            search={search}
            onSearchChange={(value) => setParam('search', value)}
            searchPlaceholder={t('donations.searchPlaceholder')}
            activeCount={[fundId, mode].filter(Boolean).length}
            onClear={() => setSearchParams(new URLSearchParams(), { replace: true })}
            filters={
              <>
                <FilterField label={t('common.fund')}>
                  <SimpleSelect
                    value={fundId || 'all'}
                    onValueChange={(value) => setParam('fund', value === 'all' ? '' : value)}
                    options={[
                      { value: 'all', label: t('common.allFunds') },
                      ...(masters?.funds ?? []).map((f) => ({ value: f.id, label: f.name })),
                    ]}
                    ariaLabel={t('expenses.filterFund')}
                  />
                </FilterField>
                <FilterField label={t('donations.mode')}>
                  <SimpleSelect
                    value={mode || 'all'}
                    onValueChange={(value) => setParam('mode', value === 'all' ? '' : value)}
                    options={[
                      { value: 'all', label: t('donations.allModes') },
                      ...DONATION_MODES.map((item) => ({ value: item, label: labels.donationMode[item] })),
                    ]}
                    ariaLabel={t('donations.filterMode')}
                  />
                </FilterField>
              </>
            }
          />
        </div>

        {isLoading ? (
          <TableSkeleton columns={6} />
        ) : !data?.data.length ? (
          <EmptyState
            icon={HeartHandshake}
            title={t('donations.emptyTitle')}
            description={t('donations.emptyText')}
            action={
              can('donation.create') && (
                <Button size="sm" onClick={() => setDialogOpen(true)}>
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  {t('donations.receive')}
                </Button>
              )
            }
          />
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[720px] border-collapse">
                <thead>
                  <tr className="border-b border-line bg-canvas/60">
                    {[t('donations.receiptNumber'), t('common.date'), t('donations.donor'), t('common.fund'), t('donations.mode'), '80G', t('common.amount')].map((heading, index) => (
                      <th
                        key={heading}
                        scope="col"
                        className={`px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted ${index === 6 ? 'text-right' : 'text-left'}`}
                      >
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {data.data.map((row) => (
                    <tr key={row.id} className="transition-colors hover:bg-canvas/60">
                      <td className="px-3 py-2.5 text-[12.5px] font-medium text-ink">{row.receiptNumber}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-[12.5px] text-ink-muted">{formatDate(row.date)}</td>
                      <td className="px-3 py-2.5">
                        {row.donor ? (
                          <Link to={`/donors/${row.donor.id}`} className="text-[12.5px] font-medium text-brand-primary hover:underline">
                            {row.donorName}
                          </Link>
                        ) : (
                          <p className="text-[12.5px] font-medium text-ink">{row.donorName}</p>
                        )}
                        {row.purpose && <p className="truncate text-[11.5px] text-ink-muted">{row.purpose}</p>}
                      </td>
                      <td className="px-3 py-2.5 text-[12.5px] text-ink-muted">{row.fund.name}</td>
                      <td className="px-3 py-2.5 text-[12.5px] text-ink-muted">
                        {labels.donationMode[row.mode] ?? row.mode}
                      </td>
                      <td className="px-3 py-2.5">
                        {row.is80GEligible ? <Badge tone="success">80G</Badge> : <span className="text-[12px] text-ink-muted">—</span>}
                      </td>
                      <td className="px-3 py-2.5 text-right text-[12.5px] font-semibold text-success tnum">
                        {formatCurrency(row.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 border-brand-primary/25 bg-brand-light/40">
                  <tr>
                    <td colSpan={6} className="px-3 py-2.5 text-[12.5px] font-semibold text-ink">
                      {t('donations.totalFiltered')}
                    </td>
                    <td className="px-3 py-2.5 text-right text-[12.5px] font-semibold text-ink tnum">
                      {formatCurrency(data.meta.totalAmount)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <ul className="divide-y divide-line md:hidden">
              {data.data.map((row) => (
                <li key={row.id} className="flex items-start gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-ink">{row.donorName}</p>
                    <p className="mt-0.5 truncate text-[11.5px] text-ink-muted">
                      {row.receiptNumber} · {row.fund.name}
                    </p>
                    <p className="mt-0.5 text-[11.5px] text-ink-muted">
                      {formatDate(row.date)} · {labels.donationMode[row.mode] ?? row.mode}
                    </p>
                  </div>
                  <span className="shrink-0 text-[13px] font-semibold text-success tnum">{formatCurrency(row.amount)}</span>
                </li>
              ))}
            </ul>

            <TablePagination
              page={data.meta.page}
              pageSize={data.meta.pageSize}
              total={data.meta.total}
              totalPages={data.meta.totalPages}
              onPageChange={(value) => setParam('page', String(value))}
            />
          </>
        )}
      </SectionCard>

      <DonationDialog
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
  donorName: z.string().trim().min(2, 'donations.donorNameRequired'),
  donorId: z.string().optional(),
  amount: z.coerce.number().gt(0, 'validation.amountPositive'),
  mode: z.enum(DONATION_MODES),
  fundId: z.string().min(1, 'validation.selectFund'),
  departmentId: z.string().optional(),
  bankAccountId: z.string().optional(),
  purpose: z.string().optional(),
  referenceNumber: z.string().optional(),
  is80GEligible: z.boolean(),
  notes: z.string().optional(),
});

type DonationValues = z.infer<typeof schema>;

export function DonationDialog({
  open,
  onOpenChange,
  donor,
  onRecorded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-selects a donor when opened from their profile. */
  donor?: { id: string; name: string };
  onRecorded?: () => void;
}) {
  const { t } = useTranslation();
  const labels = useLabels();
  const { data: masters } = useMasters();

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<DonationValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      date: new Date().toISOString().slice(0, 10),
      donorName: donor?.name ?? '',
      donorId: donor?.id,
      amount: 0,
      mode: 'BANK_TRANSFER',
      fundId: '',
      is80GEligible: true,
    },
  });

  const mutation = useMutation({
    mutationFn: (values: DonationValues) => api.post('/donations', values),
    onSuccess: () => {
      toast.success(t('donations.recorded'), { description: t('donations.recordedText') });
      onRecorded?.();
      invalidateFinancialData();
      queryClient.invalidateQueries({ queryKey: queryKeys.donationSummary });
      reset();
      onOpenChange(false);
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        const fieldErrors = error.fieldErrors;
        for (const [field, message] of Object.entries(fieldErrors)) setError(field as keyof DonationValues, { message });
        if (Object.keys(fieldErrors).length === 0) toast.error(t('donations.failed'), { description: errorMessage(t, error) });
      } else {
        toast.error(t('donations.failed'));
      }
    },
  });

  const donorId = watch('donorId');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{t('donations.receive')}</DialogTitle>
          <DialogDescription>{t('donations.dialogText')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit((values) => mutation.mutate(values))} noValidate className="flex min-h-0 flex-1 flex-col">
          <DialogBody>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label={t('common.date')} htmlFor="don-date" required error={errors.date?.message}>
                <DateInput id="don-date" max={new Date().toISOString().slice(0, 10)} invalid={Boolean(errors.date)} {...register('date')} />
              </FormField>

              <FormField label={t('common.amount')} htmlFor="don-amount" required error={errors.amount?.message}>
                <MoneyInput id="don-amount" invalid={Boolean(errors.amount)} {...register('amount')} />
              </FormField>

              <FormField label={t('donations.existingDonor')} htmlFor="don-donor">
                <SimpleSelect
                  value={donorId}
                  onValueChange={(value) => {
                    setValue('donorId', value);
                    const donor = masters?.donors.find((item) => item.id === value);
                    if (donor) setValue('donorName', donor.name, { shouldValidate: true });
                  }}
                  options={(masters?.donors ?? []).map((donor) => ({ value: donor.id, label: donor.name }))}
                  placeholder={t('donations.existingPlaceholder')}
                  ariaLabel={t('donations.existingDonor')}
                />
              </FormField>

              <FormField label={t('donations.donorName')} htmlFor="don-name" required error={errors.donorName?.message}>
                <Input id="don-name" invalid={Boolean(errors.donorName)} {...register('donorName')} />
              </FormField>

              <FormField label={t('common.fund')} htmlFor="don-fund" required error={errors.fundId?.message}>
                <SimpleSelect
                  value={watch('fundId')}
                  onValueChange={(value) => setValue('fundId', value, { shouldValidate: true })}
                  options={(masters?.funds ?? []).map((fund) => ({ value: fund.id, label: fund.name }))}
                  placeholder={t('wizard.selectFund')}
                  invalid={Boolean(errors.fundId)}
                  ariaLabel={t('common.fund')}
                />
              </FormField>

              <FormField label={t('common.department')} htmlFor="don-department">
                <SimpleSelect
                  value={watch('departmentId')}
                  onValueChange={(value) => setValue('departmentId', value)}
                  options={(masters?.departments ?? []).map((item) => ({ value: item.id, label: item.name }))}
                  placeholder={t('common.optional')}
                  ariaLabel={t('common.department')}
                />
              </FormField>

              <FormField label={t('donations.mode')} htmlFor="don-mode" required error={errors.mode?.message}>
                <SimpleSelect
                  value={watch('mode')}
                  onValueChange={(value) => setValue('mode', value as DonationValues['mode'], { shouldValidate: true })}
                  options={DONATION_MODES.map((item) => ({ value: item, label: labels.donationMode[item] }))}
                  ariaLabel={t('donations.mode')}
                />
              </FormField>

              <FormField label={t('donations.receivedIn')} htmlFor="don-account">
                <SimpleSelect
                  value={watch('bankAccountId')}
                  onValueChange={(value) => setValue('bankAccountId', value)}
                  options={(masters?.bankAccounts ?? []).map((account) => ({ value: account.id, label: account.name }))}
                  placeholder={t('common.cashInHand')}
                  ariaLabel={t('donations.receivedIn')}
                />
              </FormField>

              <FormField label={t('donations.purpose')} htmlFor="don-purpose" className="sm:col-span-2">
                <Input id="don-purpose" placeholder={t('donations.purposePlaceholder')} {...register('purpose')} />
              </FormField>

              <FormField label={t('common.referenceNumber')} htmlFor="don-reference">
                <Input id="don-reference" placeholder={t('finance.referencePlaceholder')} {...register('referenceNumber')} />
              </FormField>

              <div className="flex items-end pb-1.5">
                <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-ink">
                  <Checkbox
                    checked={watch('is80GEligible')}
                    onCheckedChange={(checked) => setValue('is80GEligible', Boolean(checked))}
                  />
                  {t('donations.eligible80G')}
                </label>
              </div>

              <FormField label={t('common.notes')} htmlFor="don-notes" className="sm:col-span-2">
                <Textarea id="don-notes" rows={2} {...register('notes')} />
              </FormField>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" loading={isSubmitting || mutation.isPending}>
              {t('donations.record')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowDownRight, ArrowUpRight, Download, Plus, TrendingDown, TrendingUp, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, api, buildQuery, downloadFile } from '@/lib/api/client';
import { invalidateFinancialData, queryKeys } from '@/lib/api/queryClient';
import { useMasters } from '@/lib/api/hooks';
import { useAuth } from '@/lib/auth/AuthProvider';
import { PageHeader } from '@/components/layout/PageHeader';
import { StatCard } from '@/components/common/StatCard';
import { SectionCard } from '@/components/common/SectionCard';
import { CardGridSkeleton, ChartSkeleton, EmptyState, ErrorState } from '@/components/common/states';
import { StatusBadge } from '@/components/common/StatusBadge';
import { DataTable } from '@/components/common/DataTable';
import { ExportMenu } from '@/components/common/ExportMenu';
import type { ExportColumn } from '@/lib/export';
import { FormField, DateInput, MoneyInput } from '@/components/common/forms';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { SimpleSelect } from '@/components/ui/select';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { BarChart, DonutChart } from '@/components/charts';
import { currentFinancialYear, financialYearOptions, formatCurrency, formatDate, monthOptions, todayLocal } from '@/lib/utils/format';
import { useTranslation } from 'react-i18next';
import { errorMessage } from '@/i18n/errors';
import { useLabels } from '@/i18n/useLabels';

type FinanceTransaction = FinanceData['transactions'][number];

interface FinanceData {
  period: { financialYear: string; month: string; start: string; end: string };
  stats: { income: number; expense: number; netSurplus: number };
  charts: {
    incomeBySource: { name: string; amount: number }[];
    expensesByDepartment: { name: string; amount: number }[];
    expensesByCategory: { name: string; amount: number }[];
  };
  transactions: {
    id: string;
    reference: string;
    date: string;
    particulars: string;
    amount: number;
    direction: 'IN' | 'OUT';
    status: string;
    link: string;
  }[];
}

export default function FinancePage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [financialYear, setFinancialYear] = useState(currentFinancialYear());
  const [month, setMonth] = useState('all');
  const [incomeOpen, setIncomeOpen] = useState(searchParams.get('income') === '1');
  const { can } = useAuth();
  const labels = useLabels();

  useEffect(() => {
    if (searchParams.get('income') === '1') setIncomeOpen(true);
  }, [searchParams]);

  const params = useMemo(() => ({ financialYear, month }), [financialYear, month]);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: queryKeys.finance(params),
    queryFn: () => api.get<FinanceData>('/finance/overview' + buildQuery(params)),
  });

  async function handleExport() {
    try {
      await downloadFile(
        `/reports/income-expense/export${buildQuery({ format: 'excel', financialYear, lang: t('language.code') })}`,
        'income-expense.xlsx',
      );
      toast.success(t('finance.exportDone'));
    } catch (err) {
      toast.error(t('finance.exportFailed'), { description: errorMessage(t, err) });
    }
  }

  const transactionColumns: ColumnDef<FinanceTransaction>[] = [
    {
      id: 'date',
      header: t('common.date'),
      cell: ({ row }) => <span className="whitespace-nowrap text-ink-muted">{formatDate(row.original.date)}</span>,
    },
    {
      id: 'particulars',
      header: t('finance.particulars'),
      cell: ({ row }) => (
        <Link to={row.original.link} className="font-medium text-ink hover:text-brand hover:underline">
          {row.original.particulars}
        </Link>
      ),
    },
    {
      id: 'reference',
      header: t('common.reference'),
      cell: ({ row }) => <span className="text-[12px] text-ink-muted">{row.original.reference}</span>,
    },
    {
      id: 'amount',
      header: t('common.amount'),
      meta: { align: 'right' },
      cell: ({ row: { original: transaction } }) => (
        <span
          className={`inline-flex items-center gap-1 font-semibold tnum ${
            transaction.direction === 'IN' ? 'text-success' : 'text-ink'
          }`}
        >
          {transaction.direction === 'IN' ? (
            <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
          ) : (
            <ArrowDownRight className="h-3 w-3 text-accent" aria-hidden="true" />
          )}
          {formatCurrency(transaction.amount)}
        </span>
      ),
    },
    {
      id: 'status',
      header: t('common.status'),
      cell: ({ row }) =>
        row.original.direction === 'IN' ? (
          <span className="text-[12px] text-success">{t('finance.received')}</span>
        ) : (
          <StatusBadge status={row.original.status} />
        ),
    },
  ];

  const transactionExportColumns: ExportColumn<FinanceTransaction>[] = [
    { header: t('common.date'), type: 'date', value: (row) => row.date },
    { header: t('finance.particulars'), value: (row) => row.particulars },
    { header: t('common.reference'), value: (row) => row.reference },
    {
      header: t('dataExport.cols.direction'),
      value: (row) => (row.direction === 'IN' ? t('dataExport.cols.moneyIn') : t('dataExport.cols.moneyOut')),
    },
    { header: t('common.amount'), type: 'currency', value: (row) => row.amount },
    {
      header: t('common.status'),
      value: (row) => (row.direction === 'IN' ? t('finance.received') : (labels.expenseStatus[row.status] ?? row.status)),
    },
  ];

  if (error) return <ErrorState message={errorMessage(t, error)} onRetry={() => void refetch()} />;

  return (
    <>
      <PageHeader
        title={t('finance.title')}
        subtitle={t('finance.subtitle')}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <SimpleSelect
              value={financialYear}
              onValueChange={setFinancialYear}
              options={financialYearOptions().map((year) => ({ value: year, label: t('common.financialYearShort', { year }) }))}
              className="w-[136px]"
              ariaLabel={t('common.financialYear')}
            />
            <SimpleSelect
              value={month}
              onValueChange={setMonth}
              options={monthOptions()}
              className="w-[134px]"
              ariaLabel={t('common.month')}
            />
            {can('finance.view') && (
              <Button variant="outline" onClick={() => setIncomeOpen(true)}>
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                {t('finance.recordIncome')}
              </Button>
            )}
            {can('report.export') && (
              <Button variant="outline" onClick={() => void handleExport()}>
                <Download className="h-3.5 w-3.5" aria-hidden="true" />
                {t('common.export')}
              </Button>
            )}
          </div>
        }
      />

      {isLoading ? (
        <CardGridSkeleton count={3} className="xl:grid-cols-3" />
      ) : (
        <div className="grid gap-3 sm:grid-cols-3">
          <StatCard label={t('finance.income')} value={data?.stats.income ?? 0} icon={TrendingUp} tone="success" />
          <StatCard label={t('finance.expense')} value={data?.stats.expense ?? 0} icon={TrendingDown} tone="accent" />
          <StatCard label={t('finance.netSurplus')} value={data?.stats.netSurplus ?? 0} icon={Wallet} tone="brand" />
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <SectionCard title={t('finance.incomeBySource')}>
          {isLoading ? (
            <ChartSkeleton height={240} />
          ) : (
            <DonutChart
              data={(data?.charts.incomeBySource ?? []).map((item) => ({ name: item.name, value: item.amount }))}
              centerLabel={{ title: t('finance.income'), value: formatCurrency(data?.stats.income ?? 0, { compact: true }) }}
            />
          )}
        </SectionCard>

        <SectionCard title={t('finance.expensesByDepartment')}>
          {isLoading ? (
            <ChartSkeleton height={240} />
          ) : (
            <BarChart
              data={data?.charts.expensesByDepartment ?? []}
              xKey="name"
              horizontal
              height={240}
              series={[{ key: 'amount', label: t('finance.expense'), color: '#0866FF' }]}
            />
          )}
        </SectionCard>
      </div>

      <SectionCard
        title={t('finance.recentTransactions')}
        className="mt-4"
        noPadding
        action={
          Boolean(data?.transactions.length) && (
            <ExportMenu
              size="sm"
              fileBase="finance-transactions"
              title={t('finance.recentTransactions')}
              subtitle={`${t('common.financialYearShort', { year: financialYear })}${
                month !== 'all' ? ` · ${monthOptions().find((option) => option.value === month)?.label ?? month}` : ''
              }`}
              columns={transactionExportColumns}
              rows={data?.transactions ?? []}
            />
          )
        }
      >
        <DataTable
          columns={transactionColumns}
          data={data?.transactions ?? []}
          isLoading={isLoading}
          getRowId={(row) => `${row.direction}-${row.id}`}
          showColumnToggle={false}
          mobileBreakpoint="sm"
          tableClassName="min-w-[640px]"
          emptyState={<EmptyState title={t('finance.noTransactions')} description={t('finance.noTransactionsHint')} />}
          mobileCard={(transaction) => (
            <Link to={transaction.link} className="flex items-center gap-3 px-4 py-3 active:bg-canvas">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-ink">{transaction.particulars}</span>
                <span className="mt-0.5 block text-[11.5px] text-ink-muted">
                  {transaction.reference} · {formatDate(transaction.date)}
                </span>
              </span>
              <span
                className={`shrink-0 text-[13px] font-semibold tnum ${transaction.direction === 'IN' ? 'text-success' : 'text-ink'}`}
              >
                {transaction.direction === 'IN' ? '+' : '−'}
                {formatCurrency(transaction.amount)}
              </span>
            </Link>
          )}
        />
      </SectionCard>

      <RecordIncomeDialog
        open={incomeOpen}
        onOpenChange={(open) => {
          setIncomeOpen(open);
          if (!open && searchParams.get('income')) {
            searchParams.delete('income');
            setSearchParams(searchParams, { replace: true });
          }
        }}
      />
    </>
  );
}

const incomeSchema = z.object({
  date: z.string().min(1, 'validation.selectDate'),
  source: z.string().trim().min(2, 'finance.sourceRequired'),
  amount: z.coerce.number().gt(0, 'validation.amountPositive'),
  fundId: z.string().min(1, 'validation.selectFund'),
  departmentId: z.string().optional(),
  bankAccountId: z.string().optional(),
  method: z.enum(['CASH', 'BANK_TRANSFER', 'UPI', 'CHEQUE', 'OTHER']),
  referenceNumber: z.string().optional(),
  notes: z.string().optional(),
});

type IncomeValues = z.infer<typeof incomeSchema>;

function RecordIncomeDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
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
  } = useForm<IncomeValues>({
    resolver: zodResolver(incomeSchema),
    defaultValues: {
      date: todayLocal(),
      source: '',
      amount: 0,
      fundId: '',
      method: 'BANK_TRANSFER',
    },
  });

  const mutation = useMutation({
    mutationFn: (values: IncomeValues) => api.post('/income', values),
    onSuccess: () => {
      toast.success(t('finance.incomeRecorded'), { description: t('finance.incomeRecordedText') });
      invalidateFinancialData();
      reset();
      onOpenChange(false);
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        const fieldErrors = error.fieldErrors;
        for (const [field, message] of Object.entries(fieldErrors)) {
          setError(field as keyof IncomeValues, { message });
        }
        if (Object.keys(fieldErrors).length === 0) toast.error(t('finance.incomeFailed'), { description: errorMessage(t, error) });
      } else {
        toast.error(t('finance.incomeFailed'));
      }
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{t('finance.incomeDialogTitle')}</DialogTitle>
          <DialogDescription>{t('finance.incomeDialogText')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit((values) => mutation.mutate(values))} noValidate className="flex min-h-0 flex-1 flex-col">
          <DialogBody>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label={t('common.date')} htmlFor="income-date" required error={errors.date?.message}>
                <DateInput id="income-date" max={todayLocal()} invalid={Boolean(errors.date)} {...register('date')} />
              </FormField>

              <FormField label={t('common.amount')} htmlFor="income-amount" required error={errors.amount?.message}>
                <MoneyInput id="income-amount" invalid={Boolean(errors.amount)} {...register('amount')} />
              </FormField>

              <FormField label={t('finance.source')} htmlFor="income-source" required error={errors.source?.message} className="sm:col-span-2">
                <Input id="income-source" placeholder={t('finance.sourcePlaceholder')} invalid={Boolean(errors.source)} {...register('source')} />
              </FormField>

              <FormField label={t('common.fund')} htmlFor="income-fund" required error={errors.fundId?.message}>
                <SimpleSelect
                  value={watch('fundId')}
                  onValueChange={(value) => setValue('fundId', value, { shouldValidate: true })}
                  options={(masters?.funds ?? []).map((fund) => ({ value: fund.id, label: fund.name }))}
                  placeholder={t('validation.selectFund')}
                  invalid={Boolean(errors.fundId)}
                  ariaLabel={t('common.fund')}
                />
              </FormField>

              <FormField label={t('common.department')} htmlFor="income-department" error={errors.departmentId?.message}>
                <SimpleSelect
                  value={watch('departmentId')}
                  onValueChange={(value) => setValue('departmentId', value)}
                  options={(masters?.departments ?? []).map((department) => ({ value: department.id, label: department.name }))}
                  placeholder={t('common.optional')}
                  ariaLabel={t('common.department')}
                />
              </FormField>

              <FormField label={t('finance.receivedIn')} htmlFor="income-account" error={errors.bankAccountId?.message}>
                <SimpleSelect
                  value={watch('bankAccountId')}
                  onValueChange={(value) => setValue('bankAccountId', value)}
                  options={(masters?.bankAccounts ?? []).map((account) => ({ value: account.id, label: account.name }))}
                  placeholder={t('finance.selectAccount')}
                  ariaLabel={t('finance.receivedIn')}
                />
              </FormField>

              <FormField label={t('common.method')} htmlFor="income-method" error={errors.method?.message}>
                <SimpleSelect
                  value={watch('method')}
                  onValueChange={(value) => setValue('method', value as IncomeValues['method'])}
                  options={['BANK_TRANSFER', 'CASH', 'UPI', 'CHEQUE', 'OTHER'].map((value) => ({
                    value,
                    label: labels.paymentMethod[value],
                  }))}
                  ariaLabel={t('common.method')}
                />
              </FormField>

              <FormField label={t('common.referenceNumber')} htmlFor="income-reference" error={errors.referenceNumber?.message}>
                <Input id="income-reference" placeholder={t('finance.referencePlaceholder')} {...register('referenceNumber')} />
              </FormField>

              <FormField label={t('common.notes')} htmlFor="income-notes" className="sm:col-span-2">
                <Textarea id="income-notes" rows={2} placeholder={t('finance.optionalNote')} {...register('notes')} />
              </FormField>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" loading={isSubmitting || mutation.isPending}>
              {t('finance.recordIncome')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

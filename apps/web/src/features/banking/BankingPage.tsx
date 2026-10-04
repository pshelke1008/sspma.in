import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowLeftRight, Banknote, Landmark, Plus, Smartphone, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, api } from '@/lib/api/client';
import { invalidateFinancialData, queryClient, queryKeys } from '@/lib/api/queryClient';
import { useAuth } from '@/lib/auth/AuthProvider';
import { PageHeader } from '@/components/layout/PageHeader';
import { SectionCard } from '@/components/common/SectionCard';
import { StatCard } from '@/components/common/StatCard';
import { CardGridSkeleton, EmptyState, ErrorState } from '@/components/common/states';
import { DataTable } from '@/components/common/DataTable';
import { ExportMenu } from '@/components/common/ExportMenu';
import type { ExportColumn } from '@/lib/export';
import { FormField, DateInput, MoneyInput } from '@/components/common/forms';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { SimpleSelect } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatCurrency, formatDate, todayLocal } from '@/lib/utils/format';
import { useTranslation } from 'react-i18next';
import { errorMessage } from '@/i18n/errors';

interface BankAccountRow {
  id: string;
  name: string;
  accountType: 'BANK' | 'CASH' | 'UPI_WALLET';
  bankName: string | null;
  accountNumber: string | null;
  ifsc: string | null;
  branch: string | null;
  upiId: string | null;
  openingBalance: number;
  credits: number;
  debits: number;
  balance: number;
}

interface TransferRow {
  id: string;
  transferNumber: string;
  date: string;
  amount: number;
  referenceNumber: string | null;
  notes: string | null;
  fromAccount: { id: string; name: string };
  toAccount: { id: string; name: string };
  createdBy: { id: string; name: string } | null;
}

const ACCOUNT_ICONS = { BANK: Landmark, CASH: Wallet, UPI_WALLET: Smartphone };

export default function BankingPage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { can } = useAuth();
  const [transferOpen, setTransferOpen] = useState(searchParams.get('transfer') === '1');
  const [accountOpen, setAccountOpen] = useState(false);

  useEffect(() => {
    if (searchParams.get('transfer') === '1') setTransferOpen(true);
  }, [searchParams]);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: queryKeys.banking,
    queryFn: () =>
      api.get<{ data: BankAccountRow[]; totals: { balance: number; credits: number; debits: number } }>(
        '/banking/accounts',
      ),
  });

  const {
    data: transfers,
    isLoading: transfersLoading,
    error: transfersError,
    refetch: refetchTransfers,
  } = useQuery({
    queryKey: queryKeys.bankTransfers,
    queryFn: () => api.get<{ data: TransferRow[] }>('/banking/transfers'),
  });

  const transferColumns: ColumnDef<TransferRow>[] = [
    {
      id: 'transferNumber',
      header: t('banking.transferNumber'),
      cell: ({ row }) => <span className="font-medium text-ink">{row.original.transferNumber}</span>,
    },
    {
      id: 'date',
      header: t('common.date'),
      cell: ({ row }) => <span className="whitespace-nowrap text-ink-muted">{formatDate(row.original.date)}</span>,
    },
    { id: 'from', header: t('common.from'), cell: ({ row }) => row.original.fromAccount.name },
    { id: 'to', header: t('common.to'), cell: ({ row }) => row.original.toAccount.name },
    {
      id: 'reference',
      header: t('common.reference'),
      cell: ({ row }) => <span className="text-ink-muted">{row.original.referenceNumber ?? '—'}</span>,
    },
    {
      id: 'amount',
      header: t('common.amount'),
      meta: { align: 'right' },
      cell: ({ row }) => <span className="font-semibold text-ink">{formatCurrency(row.original.amount)}</span>,
    },
  ];

  const transferExportColumns: ExportColumn<TransferRow>[] = [
    { header: t('banking.transferNumber'), value: (row) => row.transferNumber },
    { header: t('common.date'), type: 'date', value: (row) => row.date },
    { header: t('banking.fromAccount'), value: (row) => row.fromAccount.name },
    { header: t('banking.toAccount'), value: (row) => row.toAccount.name },
    { header: t('common.reference'), value: (row) => row.referenceNumber },
    { header: t('common.notes'), value: (row) => row.notes },
    { header: t('dataExport.cols.createdBy'), value: (row) => row.createdBy?.name },
    { header: t('common.amount'), type: 'currency', value: (row) => row.amount },
  ];

  if (error) return <ErrorState message={errorMessage(t, error)} onRetry={() => void refetch()} />;

  function closeTransfer(open: boolean) {
    setTransferOpen(open);
    if (!open && searchParams.get('transfer')) {
      const next = new URLSearchParams(searchParams);
      next.delete('transfer');
      setSearchParams(next, { replace: true });
    }
  }

  return (
    <>
      <PageHeader
        title={t('banking.title')}
        subtitle={t('banking.subtitle')}
        actions={
          can('banking.manage') && (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" onClick={() => setAccountOpen(true)}>
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                {t('banking.addAccount')}
              </Button>
              <Button onClick={() => setTransferOpen(true)}>
                <ArrowLeftRight className="h-3.5 w-3.5" aria-hidden="true" />
                {t('banking.transferMoney')}
              </Button>
            </div>
          )
        }
      />

      {isLoading ? (
        <CardGridSkeleton count={3} className="xl:grid-cols-3" />
      ) : (
        <div className="grid gap-3 sm:grid-cols-3">
          <StatCard label={t('banking.totalBalance')} value={data?.totals.balance ?? 0} icon={Banknote} tone="brand" hint={t('banking.accountsCount', { count: data?.data.length ?? 0 })} />
          <StatCard label={t('banking.moneyIn')} value={data?.totals.credits ?? 0} icon={Wallet} tone="success" />
          <StatCard label={t('banking.moneyOut')} value={data?.totals.debits ?? 0} icon={ArrowLeftRight} tone="accent" />
        </div>
      )}

      <Tabs defaultValue="accounts" className="mt-4">
        <TabsList>
          <TabsTrigger value="accounts">{t('banking.accounts')}</TabsTrigger>
          <TabsTrigger value="transfers">{t('banking.transfers')}</TabsTrigger>
        </TabsList>

        <TabsContent value="accounts">
          {isLoading ? (
            <CardGridSkeleton count={4} />
          ) : !data?.data.length ? (
            <SectionCard noPadding>
              <EmptyState
                icon={Landmark}
                title={t('banking.noAccounts')}
                description={t('banking.noAccountsText')}
              />
            </SectionCard>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {data.data.map((account) => {
                const Icon = ACCOUNT_ICONS[account.accountType] ?? Landmark;
                return (
                  <article key={account.id} className="rounded-card border border-line bg-white p-4 shadow-card">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-brand-light">
                          <Icon className="h-[18px] w-[18px] text-brand" aria-hidden="true" />
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-[13.5px] font-semibold text-ink">{account.name}</p>
                          <p className="truncate text-[11.5px] text-ink-muted">
                            {account.bankName ?? (account.accountType === 'CASH' ? t('common.cashInHand') : t('banking.wallet'))}
                          </p>
                        </div>
                      </div>
                      <Badge tone={account.accountType === 'BANK' ? 'brand' : account.accountType === 'CASH' ? 'accent' : 'info'}>
                        {t(`banking.type${account.accountType}`)}
                      </Badge>
                    </div>

                    <p className="mt-3 text-[22px] font-semibold tracking-tight text-ink tnum">
                      {formatCurrency(account.balance)}
                    </p>

                    <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-line pt-3">
                      <div>
                        <dt className="text-[10.5px] uppercase tracking-wide text-ink-muted">{t('banking.opening')}</dt>
                        <dd className="text-[12px] font-medium text-ink tnum">{formatCurrency(account.openingBalance, { compact: true })}</dd>
                      </div>
                      <div>
                        <dt className="text-[10.5px] uppercase tracking-wide text-ink-muted">{t('banking.in')}</dt>
                        <dd className="text-[12px] font-medium text-success tnum">{formatCurrency(account.credits, { compact: true })}</dd>
                      </div>
                      <div>
                        <dt className="text-[10.5px] uppercase tracking-wide text-ink-muted">{t('banking.out')}</dt>
                        <dd className="text-[12px] font-medium text-accent-ink tnum">{formatCurrency(account.debits, { compact: true })}</dd>
                      </div>
                    </dl>

                    {account.accountNumber && (
                      <p className="mt-2.5 text-[11px] text-ink-muted">
                        {t('banking.accountShort')} ••••{account.accountNumber.slice(-4)}
                        {account.ifsc ? ` · ${account.ifsc}` : ''}
                      </p>
                    )}
                    {account.upiId && <p className="mt-2.5 text-[11px] text-ink-muted">{account.upiId}</p>}
                  </article>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="transfers">
          <SectionCard noPadding>
            {Boolean(transfers?.data.length) && (
              <div className="flex items-center justify-end border-b border-line px-3 py-2">
                <ExportMenu
                  size="sm"
                  fileBase="bank-transfers"
                  title={t('banking.transfers')}
                  columns={transferExportColumns}
                  rows={transfers?.data ?? []}
                />
              </div>
            )}
            <DataTable
              columns={transferColumns}
              data={transfers?.data ?? []}
              isLoading={transfersLoading}
              error={transfersError as Error | null}
              onRetry={() => void refetchTransfers()}
              getRowId={(row) => row.id}
              showColumnToggle={false}
              tableClassName="min-w-[680px]"
              emptyState={
                <EmptyState
                  icon={ArrowLeftRight}
                  title={t('banking.noTransfers')}
                  description={t('banking.noTransfersText')}
                  action={
                    can('banking.manage') && (
                      <Button size="sm" onClick={() => setTransferOpen(true)}>
                        {t('banking.transferMoney')}
                      </Button>
                    )
                  }
                />
              }
              mobileCard={(row) => (
                <div className="flex items-start gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-ink">
                      {row.fromAccount.name} → {row.toAccount.name}
                    </p>
                    <p className="mt-0.5 truncate text-[11.5px] text-ink-muted">
                      {row.transferNumber} · {formatDate(row.date)}
                    </p>
                    {row.referenceNumber && (
                      <p className="mt-0.5 truncate text-[11.5px] text-ink-muted">{row.referenceNumber}</p>
                    )}
                  </div>
                  <span className="shrink-0 text-[13px] font-semibold text-ink tnum">{formatCurrency(row.amount)}</span>
                </div>
              )}
            />
          </SectionCard>
        </TabsContent>
      </Tabs>

      <TransferDialog open={transferOpen} onOpenChange={closeTransfer} accounts={data?.data ?? []} />
      <AccountDialog open={accountOpen} onOpenChange={setAccountOpen} />
    </>
  );
}

const transferSchema = z
  .object({
    date: z.string().min(1, 'validation.selectDate'),
    fromAccountId: z.string().min(1, 'banking.sourceRequired'),
    toAccountId: z.string().min(1, 'banking.destinationRequired'),
    amount: z.coerce.number().gt(0, 'validation.amountPositive'),
    referenceNumber: z.string().optional(),
    notes: z.string().optional(),
  })
  .refine((data) => data.fromAccountId !== data.toAccountId, {
    path: ['toAccountId'],
    message: 'validation.differentAccount',
  });

type TransferValues = z.infer<typeof transferSchema>;

function TransferDialog({
  open,
  onOpenChange,
  accounts,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: BankAccountRow[];
}) {
  const { t } = useTranslation();
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<TransferValues>({
    resolver: zodResolver(transferSchema),
    defaultValues: { date: todayLocal(), fromAccountId: '', toAccountId: '', amount: 0 },
  });

  const fromAccount = accounts.find((account) => account.id === watch('fromAccountId'));

  const mutation = useMutation({
    mutationFn: (values: TransferValues) => api.post('/banking/transfers', values),
    onSuccess: () => {
      toast.success(t('banking.recorded'));
      invalidateFinancialData();
      queryClient.invalidateQueries({ queryKey: queryKeys.bankTransfers });
      reset();
      onOpenChange(false);
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        const fieldErrors = error.fieldErrors;
        for (const [field, message] of Object.entries(fieldErrors)) setError(field as keyof TransferValues, { message });
        if (Object.keys(fieldErrors).length === 0) toast.error(t('banking.failed'), { description: errorMessage(t, error) });
      } else {
        toast.error(t('banking.failed'));
      }
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('banking.transferMoney')}</DialogTitle>
          <DialogDescription>{t('banking.transferText')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit((values) => mutation.mutate(values))} noValidate className="flex min-h-0 flex-1 flex-col">
          <DialogBody>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label={t('common.date')} htmlFor="tr-date" required error={errors.date?.message}>
                <DateInput id="tr-date" invalid={Boolean(errors.date)} {...register('date')} />
              </FormField>
              <FormField label={t('common.amount')} htmlFor="tr-amount" required error={errors.amount?.message}>
                <MoneyInput id="tr-amount" invalid={Boolean(errors.amount)} {...register('amount')} />
              </FormField>
              <FormField
                label={t('banking.fromAccount')}
                htmlFor="tr-from"
                required
                error={errors.fromAccountId?.message}
                hint={fromAccount ? t('banking.available', { amount: formatCurrency(fromAccount.balance) }) : undefined}
              >
                <SimpleSelect
                  value={watch('fromAccountId')}
                  onValueChange={(value) => setValue('fromAccountId', value, { shouldValidate: true })}
                  options={accounts.map((account) => ({
                    value: account.id,
                    label: account.name,
                    hint: formatCurrency(account.balance, { compact: true }),
                  }))}
                  placeholder={t('finance.selectAccount')}
                  invalid={Boolean(errors.fromAccountId)}
                  ariaLabel={t('banking.fromAccount')}
                />
              </FormField>
              <FormField label={t('banking.toAccount')} htmlFor="tr-to" required error={errors.toAccountId?.message}>
                <SimpleSelect
                  value={watch('toAccountId')}
                  onValueChange={(value) => setValue('toAccountId', value, { shouldValidate: true })}
                  options={accounts.map((account) => ({ value: account.id, label: account.name }))}
                  placeholder={t('finance.selectAccount')}
                  invalid={Boolean(errors.toAccountId)}
                  ariaLabel={t('banking.toAccount')}
                />
              </FormField>
              <FormField label={t('common.reference')} htmlFor="tr-reference" className="sm:col-span-2">
                <Input id="tr-reference" placeholder={t('banking.referencePlaceholder')} {...register('referenceNumber')} />
              </FormField>
              <FormField label={t('common.notes')} htmlFor="tr-notes" className="sm:col-span-2">
                <Textarea id="tr-notes" rows={2} {...register('notes')} />
              </FormField>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" loading={isSubmitting || mutation.isPending}>
              {t('banking.transfer')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const accountSchema = z.object({
  name: z.string().trim().min(2, 'banking.accountNameRequired'),
  accountType: z.enum(['BANK', 'CASH', 'UPI_WALLET']),
  bankName: z.string().optional(),
  accountNumber: z.string().optional(),
  ifsc: z.string().optional(),
  branch: z.string().optional(),
  upiId: z.string().optional(),
  openingBalance: z.coerce.number().min(0),
});

type AccountValues = z.infer<typeof accountSchema>;

function AccountDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<AccountValues>({
    resolver: zodResolver(accountSchema),
    defaultValues: { name: '', accountType: 'BANK', openingBalance: 0 },
  });

  const accountType = watch('accountType');

  const mutation = useMutation({
    mutationFn: (values: AccountValues) => api.post('/banking/accounts', values),
    onSuccess: () => {
      toast.success(t('banking.accountAdded'));
      queryClient.invalidateQueries({ queryKey: queryKeys.banking });
      queryClient.invalidateQueries({ queryKey: queryKeys.masters });
      reset();
      onOpenChange(false);
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        const fieldErrors = error.fieldErrors;
        for (const [field, message] of Object.entries(fieldErrors)) setError(field as keyof AccountValues, { message });
        if (Object.keys(fieldErrors).length === 0) toast.error(t('banking.accountFailed'), { description: errorMessage(t, error) });
      } else {
        toast.error(t('banking.accountFailed'));
      }
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('banking.addAccount')}</DialogTitle>
          <DialogDescription>{t('banking.accountText')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit((values) => mutation.mutate(values))} noValidate className="flex min-h-0 flex-1 flex-col">
          <DialogBody>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label={t('banking.accountName')} htmlFor="acc-name" required error={errors.name?.message}>
                <Input id="acc-name" invalid={Boolean(errors.name)} {...register('name')} />
              </FormField>
              <FormField label={t('common.type')} htmlFor="acc-type" required>
                <SimpleSelect
                  value={accountType}
                  onValueChange={(value) => setValue('accountType', value as AccountValues['accountType'])}
                  options={[
                    { value: 'BANK', label: t('banking.bankAccount') },
                    { value: 'CASH', label: t('banking.typeCASH') },
                    { value: 'UPI_WALLET', label: t('banking.upiWallet') },
                  ]}
                  ariaLabel={t('common.type')}
                />
              </FormField>

              {accountType === 'BANK' && (
                <>
                  <FormField label={t('banking.bankName')} htmlFor="acc-bank">
                    <Input id="acc-bank" {...register('bankName')} />
                  </FormField>
                  <FormField label={t('banking.accountNumber')} htmlFor="acc-number">
                    <Input id="acc-number" {...register('accountNumber')} />
                  </FormField>
                  <FormField label={t('banking.ifsc')} htmlFor="acc-ifsc" error={errors.ifsc?.message}>
                    <Input id="acc-ifsc" placeholder="SBIN0001234" {...register('ifsc')} />
                  </FormField>
                  <FormField label={t('banking.branch')} htmlFor="acc-branch">
                    <Input id="acc-branch" {...register('branch')} />
                  </FormField>
                </>
              )}

              {accountType === 'UPI_WALLET' && (
                <FormField label={t('banking.upiId')} htmlFor="acc-upi" className="sm:col-span-2">
                  <Input id="acc-upi" placeholder="organization@upi" {...register('upiId')} />
                </FormField>
              )}

              <FormField label={t('banking.openingBalance')} htmlFor="acc-opening" error={errors.openingBalance?.message}>
                <MoneyInput id="acc-opening" {...register('openingBalance')} />
              </FormField>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" loading={isSubmitting || mutation.isPending}>
              {t('banking.addAccount')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ListTree, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, api } from '@/lib/api/client';
import { queryClient, queryKeys } from '@/lib/api/queryClient';
import { useAuth } from '@/lib/auth/AuthProvider';
import { PageHeader } from '@/components/layout/PageHeader';
import { SectionCard } from '@/components/common/SectionCard';
import { SearchInput } from '@/components/common/FilterBar';
import { EmptyState } from '@/components/common/states';
import { DataTable } from '@/components/common/DataTable';
import { FormField, MoneyInput } from '@/components/common/forms';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { SimpleSelect } from '@/components/ui/select';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { formatCurrency } from '@/lib/utils/format';
import { useLabels } from '@/i18n/useLabels';
import { useTranslation } from 'react-i18next';
import { errorMessage } from '@/i18n/errors';

interface Account {
  id: string;
  code: string;
  name: string;
  type: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE';
  openingBalance: number;
  isBankAccount: boolean;
  isActive: boolean;
}

const TYPE_TONES: Record<Account['type'], 'brand' | 'danger' | 'info' | 'success' | 'accent'> = {
  ASSET: 'brand',
  LIABILITY: 'danger',
  EQUITY: 'info',
  INCOME: 'success',
  EXPENSE: 'accent',
};

export default function ChartOfAccountsPage() {
  const { t } = useTranslation();
  const labels = useLabels();
  const { can } = useAuth();
  const editable = can('settings.manage');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [open, setOpen] = useState(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: queryKeys.settings,
    queryFn: () => api.get<{ accounts: Account[] }>('/settings'),
  });

  const columns = useMemo<ColumnDef<Account>[]>(
    () => [
      {
        id: 'code',
        header: t('common.code'),
        cell: ({ row }) => <span className="font-medium text-ink tnum">{row.original.code}</span>,
      },
      {
        id: 'name',
        header: t('common.account'),
        cell: ({ row }) => (
          <>
            <span className="text-ink">{row.original.name}</span>
            {row.original.isBankAccount && (
              <Badge tone="neutral" className="ml-2">
                {t('coa.bank')}
              </Badge>
            )}
          </>
        ),
      },
      {
        id: 'type',
        header: t('common.type'),
        cell: ({ row }) => <Badge tone={TYPE_TONES[row.original.type]}>{labels.accountType[row.original.type]}</Badge>,
      },
      {
        id: 'openingBalance',
        header: t('banking.openingBalance'),
        meta: { align: 'right' },
        cell: ({ row }) => (row.original.openingBalance > 0 ? formatCurrency(row.original.openingBalance) : '—'),
      },
    ],
    [t, labels],
  );

  const filtered = useMemo(() => {
    const accounts = data?.accounts ?? [];
    const needle = search.trim().toLowerCase();
    return accounts.filter((account) => {
      if (typeFilter !== 'all' && account.type !== typeFilter) return false;
      if (!needle) return true;
      return account.name.toLowerCase().includes(needle) || account.code.includes(needle);
    });
  }, [data?.accounts, search, typeFilter]);

  return (
    <>
      <PageHeader
        title={t('settings.coaTitle')}
        subtitle={t('coa.subtitle')}
        breadcrumbs={[{ label: t('settings.title'), to: '/settings' }, { label: t('settings.coaTitle') }]}
        actions={
          editable && (
            <Button onClick={() => setOpen(true)}>
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              {t('coa.addAccount')}
            </Button>
          )
        }
      />

      <SectionCard noPadding>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <SearchInput value={search} onChange={setSearch} placeholder={t('coa.searchPlaceholder')} className="flex-1 sm:max-w-xs" delay={120} />
          <SimpleSelect
            value={typeFilter}
            onValueChange={setTypeFilter}
            options={[
              { value: 'all', label: t('coa.allTypes') },
              { value: 'ASSET', label: t('coa.ASSET') },
              { value: 'LIABILITY', label: t('coa.LIABILITY') },
              { value: 'EQUITY', label: t('coa.EQUITY') },
              { value: 'INCOME', label: t('coa.INCOME') },
              { value: 'EXPENSE', label: t('coa.EXPENSE') },
            ]}
            className="w-[170px]"
            ariaLabel={t('coa.filterType')}
          />
        </div>

        <DataTable
          columns={columns}
          data={filtered}
          isLoading={isLoading}
          error={error as Error | null}
          onRetry={() => void refetch()}
          getRowId={(account) => account.id}
          showColumnToggle={false}
          tableClassName="min-w-[560px]"
          emptyState={<EmptyState icon={ListTree} title={t('coa.noMatch')} description={t('coa.noMatchText')} />}
          mobileCard={(account) => (
            <div className="flex items-start gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-ink">
                  <span className="tnum">{account.code}</span> · {account.name}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <Badge tone={TYPE_TONES[account.type]}>{labels.accountType[account.type]}</Badge>
                  {account.isBankAccount && <Badge tone="neutral">{t('coa.bank')}</Badge>}
                </div>
              </div>
              <span className="shrink-0 text-[12.5px] text-ink tnum">
                {account.openingBalance > 0 ? formatCurrency(account.openingBalance) : '—'}
              </span>
            </div>
          )}
        />
      </SectionCard>

      <AccountDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

const schema = z.object({
  code: z.string().regex(/^\d{3,6}$/, 'validation.accountCode'),
  name: z.string().trim().min(2, 'banking.accountNameRequired'),
  type: z.enum(['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE']),
  openingBalance: z.coerce.number().min(0),
  isBankAccount: z.boolean(),
});

type AccountValues = z.infer<typeof schema>;

function AccountDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  const labels = useLabels();
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<AccountValues>({
    resolver: zodResolver(schema),
    defaultValues: { code: '', name: '', type: 'EXPENSE', openingBalance: 0, isBankAccount: false },
  });

  const mutation = useMutation({
    mutationFn: (values: AccountValues) => api.post('/settings/accounts', values),
    onSuccess: () => {
      toast.success(t('coa.added'));
      queryClient.invalidateQueries({ queryKey: queryKeys.settings });
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
          <DialogTitle>{t('coa.dialogTitle')}</DialogTitle>
          <DialogDescription>{t('coa.dialogText')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit((values) => mutation.mutate(values))} noValidate className="flex min-h-0 flex-1 flex-col">
          <DialogBody>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label={t('common.code')} htmlFor="acc-code" required error={errors.code?.message}>
                <Input id="acc-code" placeholder="5110" invalid={Boolean(errors.code)} {...register('code')} />
              </FormField>
              <FormField label={t('common.type')} htmlFor="acc-type" required>
                <SimpleSelect
                  value={watch('type')}
                  onValueChange={(value) => setValue('type', value as AccountValues['type'])}
                  options={[
                    { value: 'ASSET', label: labels.accountType.ASSET },
                    { value: 'LIABILITY', label: labels.accountType.LIABILITY },
                    { value: 'EQUITY', label: labels.accountType.EQUITY },
                    { value: 'INCOME', label: labels.accountType.INCOME },
                    { value: 'EXPENSE', label: labels.accountType.EXPENSE },
                  ]}
                  ariaLabel={t('common.type')}
                />
              </FormField>
              <FormField label={t('banking.accountName')} htmlFor="acc-name" required error={errors.name?.message} className="sm:col-span-2">
                <Input id="acc-name" invalid={Boolean(errors.name)} {...register('name')} />
              </FormField>
              <FormField label={t('banking.openingBalance')} htmlFor="acc-opening">
                <MoneyInput id="acc-opening" {...register('openingBalance')} />
              </FormField>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" loading={isSubmitting || mutation.isPending}>
              {t('coa.addAccount')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

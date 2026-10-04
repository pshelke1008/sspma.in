import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CalendarRange, CheckCircle2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, api } from '@/lib/api/client';
import { queryClient, queryKeys } from '@/lib/api/queryClient';
import { useAuth } from '@/lib/auth/AuthProvider';
import { PageHeader } from '@/components/layout/PageHeader';
import { SectionCard } from '@/components/common/SectionCard';
import { EmptyState, TableSkeleton } from '@/components/common/states';
import { FormField, DateInput } from '@/components/common/forms';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/misc';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { formatDate } from '@/lib/utils/format';
import { useTranslation } from 'react-i18next';
import { errorMessage } from '@/i18n/errors';

interface FinancialYear {
  id: string;
  label: string;
  startDate: string;
  endDate: string;
  isActive: boolean;
  isClosed: boolean;
}

export default function FinancialYearPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const editable = can('settings.manage');
  const [open, setOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.settings,
    queryFn: () => api.get<{ financialYears: FinancialYear[] }>('/settings'),
  });

  const activate = useMutation({
    mutationFn: (id: string) => api.post(`/settings/financial-years/${id}/activate`),
    onSuccess: () => {
      toast.success(t('fySettings.activated'));
      queryClient.invalidateQueries({ queryKey: queryKeys.settings });
      queryClient.invalidateQueries({ queryKey: queryKeys.masters });
    },
    onError: (error) => toast.error(t('fySettings.activateFailed'), { description: errorMessage(t, error) }),
  });

  return (
    <>
      <PageHeader
        title={t('settings.fyTitle')}
        subtitle={t('fySettings.subtitle')}
        breadcrumbs={[{ label: t('settings.title'), to: '/settings' }, { label: t('settings.fyTitle') }]}
        actions={
          editable && (
            <Button onClick={() => setOpen(true)}>
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              {t('fySettings.addYear')}
            </Button>
          )
        }
      />

      <SectionCard noPadding>
        {isLoading ? (
          <TableSkeleton columns={4} rows={3} />
        ) : !data?.financialYears.length ? (
          <EmptyState icon={CalendarRange} title={t('fySettings.empty')} description={t('fySettings.emptyText')} />
        ) : (
          <ul className="divide-y divide-line">
            {data.financialYears.map((year) => (
              <li key={year.id} className="flex flex-wrap items-center gap-3 px-4 py-3.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-brand-light">
                  <CalendarRange className="h-[18px] w-[18px] text-brand" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[13.5px] font-semibold text-ink">{t('common.financialYearShort', { year: year.label })}</p>
                    {year.isActive && <Badge tone="success">{t('common.active')}</Badge>}
                    {year.isClosed && <Badge tone="neutral">{t('fySettings.closed')}</Badge>}
                  </div>
                  <p className="mt-0.5 text-[12px] text-ink-muted">
                    {formatDate(year.startDate)} — {formatDate(year.endDate)}
                  </p>
                </div>
                {editable && !year.isActive && (
                  <Button
                    variant="outline"
                    size="sm"
                    loading={activate.isPending && activate.variables === year.id}
                    onClick={() => activate.mutate(year.id)}
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                    {t('fySettings.makeActive')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <AddYearDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

const schema = z.object({
  label: z.string().regex(/^\d{4}-\d{4}$/, 'validation.fyLabel'),
  startDate: z.string().min(1, 'fySettings.startRequired'),
  endDate: z.string().min(1, 'fySettings.endRequired'),
  isActive: z.boolean(),
});

type YearValues = z.infer<typeof schema>;

function AddYearDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<YearValues>({
    resolver: zodResolver(schema),
    defaultValues: { label: '', startDate: '', endDate: '', isActive: false },
  });

  const mutation = useMutation({
    mutationFn: (values: YearValues) => api.post('/settings/financial-years', values),
    onSuccess: () => {
      toast.success(t('fySettings.added'));
      queryClient.invalidateQueries({ queryKey: queryKeys.settings });
      reset();
      onOpenChange(false);
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        const fieldErrors = error.fieldErrors;
        for (const [field, message] of Object.entries(fieldErrors)) setError(field as keyof YearValues, { message });
        if (Object.keys(fieldErrors).length === 0) toast.error(t('fySettings.addFailed'), { description: errorMessage(t, error) });
      } else {
        toast.error(t('fySettings.addFailed'));
      }
    },
  });

  // Filling the label auto-fills the standard April–March range.
  function onLabelChange(value: string) {
    const match = /^(\d{4})-(\d{4})$/.exec(value);
    if (match) {
      setValue('startDate', `${match[1]}-04-01`);
      setValue('endDate', `${match[2]}-03-31`);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('fySettings.dialogTitle')}</DialogTitle>
          <DialogDescription>{t('fySettings.dialogText')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit((values) => mutation.mutate(values))} noValidate className="flex min-h-0 flex-1 flex-col">
          <DialogBody>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label={t('fySettings.label')} htmlFor="fy-label" required error={errors.label?.message} className="sm:col-span-2">
                <Input
                  id="fy-label"
                  placeholder="2026-2027"
                  invalid={Boolean(errors.label)}
                  {...register('label', { onChange: (event) => onLabelChange(event.target.value) })}
                />
              </FormField>
              <FormField label={t('fySettings.startDate')} htmlFor="fy-start" required error={errors.startDate?.message}>
                <DateInput id="fy-start" invalid={Boolean(errors.startDate)} {...register('startDate')} />
              </FormField>
              <FormField label={t('fySettings.endDate')} htmlFor="fy-end" required error={errors.endDate?.message}>
                <DateInput id="fy-end" invalid={Boolean(errors.endDate)} {...register('endDate')} />
              </FormField>
              <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-ink sm:col-span-2">
                <Checkbox checked={watch('isActive')} onCheckedChange={(checked) => setValue('isActive', Boolean(checked))} />
                {t('fySettings.makeActiveCheck')}
              </label>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" loading={isSubmitting || mutation.isPending}>
              {t('fySettings.addYear')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

import { useMemo } from 'react';
import { useFormContext } from 'react-hook-form';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import { api } from '@/lib/api/client';
import { useMasters } from '@/lib/api/hooks';
import { useAuth } from '@/lib/auth/AuthProvider';
import { useLabels } from '@/i18n/useLabels';
import { FormField, DateInput } from '@/components/common/forms';
import { Input, Textarea } from '@/components/ui/input';
import { SimpleSelect } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import type { ExpenseFormValues } from '../expenseSchema';
import { todayLocal } from '@/lib/utils/format';

interface UserOption {
  id: string;
  name: string;
  designation: string | null;
  role: { key: string; name: string };
}

export function StepBasicInfo({ onAddSupplier }: { onAddSupplier: () => void }) {
  const { t } = useTranslation();
  const labels = useLabels();
  const { data: masters, isLoading } = useMasters();
  const { can, user } = useAuth();
  const {
    register,
    watch,
    setValue,
    formState: { errors },
  } = useFormContext<ExpenseFormValues>();

  const departmentId = watch('departmentId');
  const canRaiseForOthers = can('expense.create_on_behalf');

  const { data: userOptions } = useQuery({
    queryKey: ['users', 'options'],
    queryFn: () => api.get<{ data: UserOption[] }>('/users/options'),
    enabled: canRaiseForOthers,
    staleTime: 5 * 60_000,
  });

  // Cost centers are scoped to the chosen department.
  const costCenters = useMemo(() => {
    const all = masters?.costCenters ?? [];
    if (!departmentId) return all;
    const scoped = all.filter((center) => center.departmentId === departmentId);
    return scoped.length ? scoped : all;
  }, [masters?.costCenters, departmentId]);

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {canRaiseForOthers && (
        <FormField
          label={t('wizard.onBehalfOf')}
          htmlFor="onBehalfOfId"
          hint={t('wizard.onBehalfOfHint')}
          className="rounded-control border border-brand-light bg-brand-light/40 p-3 sm:col-span-2"
        >
          <SimpleSelect
            value={watch('onBehalfOfId') || user?.id}
            onValueChange={(value) => setValue('onBehalfOfId', value === user?.id ? '' : value, { shouldDirty: true })}
            options={(userOptions?.data ?? []).map((option) => ({
              value: option.id,
              label: option.id === user?.id ? t('wizard.myself', { name: option.name }) : option.name,
              hint: labels.roles[option.role.key] ?? option.role.name,
            }))}
            ariaLabel={t('wizard.onBehalfOf')}
          />
        </FormField>
      )}

      <FormField label={t('wizard.expenseDate')} htmlFor="date" required error={errors.date?.message}>
        <DateInput id="date" max={todayLocal()} invalid={Boolean(errors.date)} {...register('date')} />
      </FormField>

      <FormField
        label={t('wizard.expenseTitle')}
        htmlFor="title"
        required
        error={errors.title?.message}
        hint={t('wizard.titleHint')}
      >
        <Input id="title" placeholder={t('wizard.titlePlaceholder')} invalid={Boolean(errors.title)} {...register('title')} />
      </FormField>

      <FormField label={t('common.department')} htmlFor="departmentId" required error={errors.departmentId?.message}>
        <SimpleSelect
          value={watch('departmentId')}
          onValueChange={(value) => {
            setValue('departmentId', value, { shouldValidate: true });
            setValue('costCenterId', '');
          }}
          options={(masters?.departments ?? []).map((item) => ({ value: item.id, label: item.name }))}
          placeholder={isLoading ? t('common.loading') : t('wizard.selectDepartment')}
          invalid={Boolean(errors.departmentId)}
          ariaLabel={t('common.department')}
        />
      </FormField>

      <FormField label={t('common.fund')} htmlFor="fundId" required error={errors.fundId?.message}>
        <SimpleSelect
          value={watch('fundId')}
          onValueChange={(value) => setValue('fundId', value, { shouldValidate: true })}
          options={(masters?.funds ?? []).map((item) => ({
            value: item.id,
            label: item.name,
            hint: item.isRestricted ? t('wizard.restricted') : undefined,
          }))}
          placeholder={isLoading ? t('common.loading') : t('wizard.selectFund')}
          invalid={Boolean(errors.fundId)}
          ariaLabel={t('common.fund')}
        />
      </FormField>

      <FormField label={t('common.costCenter')} htmlFor="costCenterId" error={errors.costCenterId?.message}>
        <SimpleSelect
          value={watch('costCenterId')}
          onValueChange={(value) => setValue('costCenterId', value)}
          options={costCenters.map((item) => ({ value: item.id, label: item.name }))}
          placeholder={t('common.optional')}
          ariaLabel={t('common.costCenter')}
        />
      </FormField>

      <FormField label={t('wizard.expenseCategory')} htmlFor="categoryId" required error={errors.categoryId?.message}>
        <SimpleSelect
          value={watch('categoryId')}
          onValueChange={(value) => setValue('categoryId', value, { shouldValidate: true })}
          options={(masters?.categories ?? []).map((item) => ({ value: item.id, label: item.name }))}
          placeholder={isLoading ? t('common.loading') : t('wizard.selectCategory')}
          invalid={Boolean(errors.categoryId)}
          ariaLabel={t('wizard.expenseCategory')}
        />
      </FormField>

      <FormField label={t('common.supplier')} htmlFor="supplierId" error={errors.supplierId?.message} className="sm:col-span-2">
        <div className="flex gap-2">
          <SimpleSelect
            value={watch('supplierId')}
            onValueChange={(value) => setValue('supplierId', value)}
            options={(masters?.suppliers ?? []).map((item) => ({
              value: item.id,
              label: item.name,
              hint: item.city ?? undefined,
            }))}
            placeholder={t('wizard.supplierPlaceholder')}
            className="flex-1"
            ariaLabel={t('common.supplier')}
          />
          {can('expense.create') && (
            <Button type="button" variant="outline" onClick={onAddSupplier}>
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              {t('common.new')}
            </Button>
          )}
        </div>
      </FormField>

      <FormField label={t('common.description')} htmlFor="description" className="sm:col-span-2">
        <Textarea id="description" rows={3} placeholder={t('wizard.descriptionPlaceholder')} {...register('description')} />
      </FormField>
    </div>
  );
}

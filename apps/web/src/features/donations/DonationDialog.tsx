import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { DONATION_MODES } from '@ashram/types';
import { useTranslation } from 'react-i18next';
import { useLabels } from '@/i18n/useLabels';
import { errorMessage } from '@/i18n/errors';
import { ApiError, api } from '@/lib/api/client';
import { invalidateDonationData } from '@/lib/api/queryClient';
import { useMasters } from '@/lib/api/hooks';
import { FormField, DateInput, MoneyInput } from '@/components/common/forms';
import { DonorCombobox, type PickedDonor } from '@/components/common/DonorCombobox';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/misc';
import { SimpleSelect } from '@/components/ui/select';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { todayLocal } from '@/lib/utils/format';

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
  // The picked donor's display details; the form itself only stores the id.
  const [pickedDonor, setPickedDonor] = useState<PickedDonor | null>(donor ?? null);

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
      date: todayLocal(),
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
      invalidateDonationData();
      reset();
      setPickedDonor(donor ?? null);
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
                <DateInput id="don-date" max={todayLocal()} invalid={Boolean(errors.date)} {...register('date')} />
              </FormField>

              <FormField label={t('common.amount')} htmlFor="don-amount" required error={errors.amount?.message}>
                <MoneyInput id="don-amount" invalid={Boolean(errors.amount)} {...register('amount')} />
              </FormField>

              <FormField label={t('donations.existingDonor')} htmlFor="don-donor">
                <DonorCombobox
                  id="don-donor"
                  value={donorId && pickedDonor?.id === donorId ? pickedDonor : null}
                  onChange={(picked) => {
                    setPickedDonor(picked);
                    if (picked) {
                      setValue('donorId', picked.id);
                      setValue('donorName', picked.name, { shouldValidate: true });
                    } else {
                      setValue('donorId', undefined);
                    }
                  }}
                  placeholder={t('donorPicker.placeholder')}
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

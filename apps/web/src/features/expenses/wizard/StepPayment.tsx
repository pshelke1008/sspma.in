import { useFormContext } from 'react-hook-form';
import { PAYMENT_METHODS } from '@ashram/types';
import { useMasters } from '@/lib/api/hooks';
import { FormField, DateInput } from '@/components/common/forms';
import { Input, Textarea } from '@/components/ui/input';
import { SimpleSelect } from '@/components/ui/select';
import { FileUpload, type PendingFile } from '@/components/common/FileUpload';
import { cn } from '@/lib/utils/cn';
import { useTranslation } from 'react-i18next';
import { useLabels } from '@/i18n/useLabels';
import type { ExpenseFormValues } from '../expenseSchema';

export function StepPayment({
  files,
  onAddFiles,
  onRemoveFile,
  isMobile,
}: {
  files: PendingFile[];
  onAddFiles: (files: File[]) => void;
  onRemoveFile: (id: string) => void;
  isMobile?: boolean;
}) {
  const { t } = useTranslation();
  const labels = useLabels();
  const { data: masters } = useMasters();
  const {
    register,
    watch,
    setValue,
    formState: { errors },
  } = useFormContext<ExpenseFormValues>();

  const payImmediately = watch('payImmediately');
  const method = watch('paymentMethod');

  return (
    <div className="space-y-5">
      <fieldset>
        <legend className="mb-2 text-[12px] font-medium text-ink-muted">{t('wizard.paymentStatus')}</legend>
        <div className="grid grid-cols-2 gap-2 sm:max-w-sm">
          {[
            { value: false, label: t('wizard.unpaid'), hint: t('wizard.unpaidHint') },
            { value: true, label: t('wizard.paid'), hint: t('wizard.paidHint') },
          ].map((option) => (
            <button
              key={String(option.value)}
              type="button"
              onClick={() => setValue('payImmediately', option.value, { shouldValidate: true })}
              aria-pressed={payImmediately === option.value}
              className={cn(
                'rounded-control border px-3 py-2.5 text-left transition-colors',
                payImmediately === option.value
                  ? 'border-brand-primary bg-brand-light'
                  : 'border-line bg-white hover:bg-canvas',
              )}
            >
              <span
                className={cn(
                  'block text-[13px] font-medium',
                  payImmediately === option.value ? 'text-brand' : 'text-ink',
                )}
              >
                {option.label}
              </span>
              <span className="block text-[11.5px] text-ink-muted">{option.hint}</span>
            </button>
          ))}
        </div>
      </fieldset>

      {payImmediately && (
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={t('wizard.paymentMethod')} htmlFor="paymentMethod" required error={errors.paymentMethod?.message}>
            <SimpleSelect
              value={method}
              onValueChange={(value) => setValue('paymentMethod', value as never, { shouldValidate: true })}
              options={PAYMENT_METHODS.map((item) => ({ value: item, label: labels.paymentMethod[item] }))}
              placeholder={t('wizard.selectMethod')}
              invalid={Boolean(errors.paymentMethod)}
              ariaLabel={t('wizard.paymentMethod')}
            />
          </FormField>

          <FormField
            label={t('wizard.paymentAccount')}
            htmlFor="paymentAccountId"
            required={method !== 'CASH'}
            error={errors.paymentAccountId?.message}
          >
            <SimpleSelect
              value={watch('paymentAccountId')}
              onValueChange={(value) => setValue('paymentAccountId', value, { shouldValidate: true })}
              options={(masters?.bankAccounts ?? []).map((account) => ({ value: account.id, label: account.name }))}
              placeholder={method === 'CASH' ? t('common.cashInHand') : t('wizard.selectAccount')}
              invalid={Boolean(errors.paymentAccountId)}
              ariaLabel={t('wizard.paymentAccount')}
            />
          </FormField>

          <FormField
            label={t('common.referenceNumber')}
            htmlFor="referenceNumber"
            required={method === 'CHEQUE' || method === 'BANK_TRANSFER'}
            error={errors.referenceNumber?.message}
          >
            <Input
              id="referenceNumber"
              placeholder={t('wizard.referencePlaceholder')}
              invalid={Boolean(errors.referenceNumber)}
              {...register('referenceNumber')}
            />
          </FormField>

          <FormField label={t('wizard.paymentDate')} htmlFor="paymentDate" required error={errors.paymentDate?.message}>
            <DateInput id="paymentDate" invalid={Boolean(errors.paymentDate)} {...register('paymentDate')} />
          </FormField>

          <p className="rounded-control border border-info/25 bg-info/5 px-3 py-2 text-[12px] text-info sm:col-span-2">
            {t('wizard.autoPayNote')}
          </p>
        </div>
      )}

      <FormField label={t('common.notes')} htmlFor="notes">
        <Textarea id="notes" rows={2} placeholder={t('wizard.notesPlaceholder')} {...register('notes')} />
      </FormField>

      <div>
        <h3 className="mb-2 text-[13px] font-semibold text-ink">{t('wizard.attachments')}</h3>
        <FileUpload
          files={files}
          onAdd={onAddFiles}
          onRemove={onRemoveFile}
          capture={isMobile}
          label={isMobile ? t('forms.uploadPhotoLabel') : t('forms.uploadLabel')}
        />
      </div>
    </div>
  );
}

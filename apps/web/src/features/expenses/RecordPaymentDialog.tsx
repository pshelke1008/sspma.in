import { useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS } from '@ashram/types';
import { ApiError, api } from '@/lib/api/client';
import { invalidateFinancialData } from '@/lib/api/queryClient';
import { useMasters } from '@/lib/api/hooks';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { SimpleSelect } from '@/components/ui/select';
import { DateInput, FormField, MoneyInput } from '@/components/common/forms';
import { formatCurrency, todayLocal } from '@/lib/utils/format';
import { useTranslation } from 'react-i18next';
import { useLabels } from '@/i18n/useLabels';
import { errorMessage } from '@/i18n/errors';

const schema = z
  .object({
    amount: z.coerce.number().gt(0, 'validation.amountPositive'),
    method: z.enum(PAYMENT_METHODS),
    bankAccountId: z.string().optional(),
    referenceNumber: z.string().optional(),
    paymentDate: z.string().min(1, 'validation.paymentDate'),
    notes: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.method !== 'CASH' && !data.bankAccountId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['bankAccountId'], message: 'validation.selectAccount' });
    }
    if ((data.method === 'CHEQUE' || data.method === 'BANK_TRANSFER') && !data.referenceNumber?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['referenceNumber'],
        message: 'validation.referenceRequired',
      });
    }
  });

type PaymentValues = z.infer<typeof schema>;

export function RecordPaymentDialog({
  open,
  onOpenChange,
  expense,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  expense: { id: string; expenseNumber: string; title: string; total: number; balanceDue: number };
  onSuccess?: () => void;
}) {
  const { t } = useTranslation();
  const labels = useLabels();
  const { data: masters } = useMasters();

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<PaymentValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      amount: expense.balanceDue,
      method: 'BANK_TRANSFER',
      paymentDate: todayLocal(),
      bankAccountId: '',
      referenceNumber: '',
      notes: '',
    },
  });

  const method = watch('method');
  const amount = Number(watch('amount') || 0);

  const mutation = useMutation({
    mutationFn: (values: PaymentValues) =>
      api.post(`/expenses/${expense.id}/pay`, {
        ...values,
        bankAccountId: values.bankAccountId || null,
        referenceNumber: values.referenceNumber || null,
        notes: values.notes || null,
      }),
    onSuccess: () => {
      toast.success(t('payment.success'), { description: t('payment.successText') });
      invalidateFinancialData();
      onOpenChange(false);
      onSuccess?.();
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        const fieldErrors = error.fieldErrors;
        for (const [field, message] of Object.entries(fieldErrors)) {
          setError(field as keyof PaymentValues, { message });
        }
        if (Object.keys(fieldErrors).length === 0) {
          toast.error(t('payment.failed'), { description: errorMessage(t, error) });
        }
      } else {
        toast.error(t('payment.failed'));
      }
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('payment.title')}</DialogTitle>
          <DialogDescription>
            {expense.expenseNumber} — {expense.title}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit((values) => mutation.mutate(values))} noValidate className="flex min-h-0 flex-1 flex-col">
          <DialogBody>
            <div className="mb-4 flex items-center justify-between rounded-control bg-canvas px-3 py-2.5">
              <div>
                <p className="text-[11.5px] text-ink-muted">{t('payment.expenseTotal')}</p>
                <p className="text-[14px] font-semibold text-ink tnum">{formatCurrency(expense.total)}</p>
              </div>
              <div className="text-right">
                <p className="text-[11.5px] text-ink-muted">{t('payment.outstanding')}</p>
                <p className="text-[14px] font-semibold text-accent-ink tnum">{formatCurrency(expense.balanceDue)}</p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label={t('payment.amount')} htmlFor="pay-amount" required error={errors.amount?.message}>
                <MoneyInput
                  id="pay-amount"
                  max={expense.balanceDue}
                  invalid={Boolean(errors.amount)}
                  {...register('amount')}
                />
              </FormField>

              <FormField label={t('payment.date')} htmlFor="pay-date" required error={errors.paymentDate?.message}>
                <DateInput id="pay-date" invalid={Boolean(errors.paymentDate)} {...register('paymentDate')} />
              </FormField>

              <FormField label={t('payment.method')} htmlFor="pay-method" required error={errors.method?.message}>
                <SimpleSelect
                  value={method}
                  onValueChange={(value) => setValue('method', value as PaymentValues['method'], { shouldValidate: true })}
                  options={PAYMENT_METHODS.map((item) => ({ value: item, label: labels.paymentMethod[item] }))}
                  ariaLabel={t('payment.method')}
                />
              </FormField>

              <FormField
                label={t('payment.account')}
                htmlFor="pay-account"
                required={method !== 'CASH'}
                error={errors.bankAccountId?.message}
              >
                <SimpleSelect
                  value={watch('bankAccountId')}
                  onValueChange={(value) => setValue('bankAccountId', value, { shouldValidate: true })}
                  options={(masters?.bankAccounts ?? []).map((account) => ({
                    value: account.id,
                    label: account.name,
                  }))}
                  placeholder={method === 'CASH' ? t('common.cashInHand') : t('payment.selectAccount')}
                  invalid={Boolean(errors.bankAccountId)}
                  ariaLabel={t('payment.account')}
                />
              </FormField>

              <FormField
                label={t('common.referenceNumber')}
                htmlFor="pay-reference"
                required={method === 'CHEQUE' || method === 'BANK_TRANSFER'}
                error={errors.referenceNumber?.message}
                hint={method === 'CHEQUE' ? t('payment.hintCheque') : method === 'UPI' ? t('payment.hintUpi') : t('payment.hintUtr')}
                className="sm:col-span-2"
              >
                <Input
                  id="pay-reference"
                  placeholder={t('payment.referencePlaceholder')}
                  invalid={Boolean(errors.referenceNumber)}
                  {...register('referenceNumber')}
                />
              </FormField>

              <FormField label={t('common.notes')} htmlFor="pay-notes" className="sm:col-span-2">
                <Textarea id="pay-notes" rows={2} placeholder={t('payment.notesPlaceholder')} {...register('notes')} />
              </FormField>
            </div>

            {amount > 0 && amount < expense.balanceDue && (
              <p className="mt-3 rounded-control border border-warning/25 bg-warning/5 px-3 py-2 text-[12px] text-[#986812]">
                {t('payment.partial', { amount: formatCurrency(expense.balanceDue - amount) })}
              </p>
            )}
          </DialogBody>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" loading={isSubmitting || mutation.isPending}>
              {t('payment.title')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

import { useFieldArray, useFormContext, useWatch } from 'react-hook-form';
import { Plus, Trash2 } from 'lucide-react';
import { UNITS } from '@ashram/types';
import { MoneyInput } from '@/components/common/forms';
import { Input } from '@/components/ui/input';
import { SimpleSelect } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { formatCurrency } from '@/lib/utils/format';
import { useTranslation } from 'react-i18next';
import { computeLine, computeTotals, emptyItem, type ExpenseFormValues } from '../expenseSchema';

/**
 * Line items. Every field is rendered exactly once and the layout alone
 * changes across breakpoints — a compact row on tablet and up, a stacked card
 * on phones. Rendering two copies would register the same field twice with
 * react-hook-form and the second, hidden input would win.
 */
const ROW_GRID =
  'grid gap-x-2 gap-y-2 sm:grid-cols-[minmax(0,1fr)_84px_90px_116px_78px_116px_40px] sm:items-start';

export function StepItems() {
  const { t } = useTranslation();
  const {
    control,
    register,
    setValue,
    formState: { errors },
  } = useFormContext<ExpenseFormValues>();

  const { fields, append, remove } = useFieldArray({ control, name: 'items' });
  const items = useWatch({ control, name: 'items' }) ?? [];
  const totals = computeTotals(items as ExpenseFormValues['items']);

  const itemErrors = errors.items as unknown as
    | {
        description?: { message?: string };
        quantity?: { message?: string };
        rate?: { message?: string };
        taxRate?: { message?: string };
      }[]
    | undefined;
  const rootError = (errors.items as unknown as { message?: string } | undefined)?.message;

  return (
    <div>
      {/* Column headings, shown only where the row layout is tabular. */}
      <div className={`${ROW_GRID} hidden border-b border-line px-2 pb-2 sm:grid`}>
        {[t('common.description'), t('wizard.qty'), t('wizard.unit'), t('wizard.rate'), t('wizard.taxPct'), t('common.amount'), ''].map((heading, index) => (
          <span
            key={heading || index}
            className={`text-[11px] font-semibold uppercase tracking-wide text-ink-muted ${
              index >= 1 && index <= 5 ? 'text-right' : 'text-left'
            }`}
          >
            {heading}
          </span>
        ))}
      </div>

      <ul className="space-y-2 sm:space-y-0 sm:divide-y sm:divide-line">
        {fields.map((field, index) => {
          const line = computeLine((items[index] ?? emptyItem) as ExpenseFormValues['items'][number]);
          const rowErrors = itemErrors?.[index];

          return (
            <li
              key={field.id}
              className={`${ROW_GRID} rounded-card border border-line p-3 sm:rounded-none sm:border-0 sm:p-2 sm:py-2.5`}
            >
              {/* Item number — a card heading on phones only. */}
              <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted sm:hidden">
                {t('wizard.item', { n: index + 1 })}
              </span>

              <div className="min-w-0">
                <Label text={t('common.description')} />
                <Input
                  aria-label={t('wizard.itemDescription', { n: index + 1 })}
                  placeholder={t('wizard.itemPlaceholder')}
                  invalid={Boolean(rowErrors?.description)}
                  {...register(`items.${index}.description` as const)}
                />
                <FieldError message={rowErrors?.description?.message} />
              </div>

              <div className="grid grid-cols-2 gap-2 sm:contents">
                <div>
                  <Label text={t('wizard.qty')} />
                  <Input
                    type="number"
                    step="0.001"
                    min="0"
                    inputMode="decimal"
                    className="text-right tnum"
                    aria-label={t('wizard.itemQuantity', { n: index + 1 })}
                    invalid={Boolean(rowErrors?.quantity)}
                    {...register(`items.${index}.quantity` as const)}
                  />
                  <FieldError message={rowErrors?.quantity?.message} />
                </div>

                <div>
                  <Label text={t('wizard.unit')} />
                  <SimpleSelect
                    value={(items[index]?.unit as string) ?? 'NOS'}
                    onValueChange={(value) => setValue(`items.${index}.unit`, value as never, { shouldValidate: true })}
                    options={UNITS.map((unit) => ({ value: unit, label: unit }))}
                    ariaLabel={t('wizard.itemUnit', { n: index + 1 })}
                  />
                </div>

                <div>
                  <Label text={t('wizard.rate')} />
                  <MoneyInput
                    aria-label={t('wizard.itemRate', { n: index + 1 })}
                    invalid={Boolean(rowErrors?.rate)}
                    {...register(`items.${index}.rate` as const)}
                  />
                  <FieldError message={rowErrors?.rate?.message} />
                </div>

                <div>
                  <Label text={t('wizard.taxPct')} />
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    inputMode="decimal"
                    className="text-right tnum"
                    aria-label={t('wizard.itemTax', { n: index + 1 })}
                    invalid={Boolean(rowErrors?.taxRate)}
                    {...register(`items.${index}.taxRate` as const)}
                  />
                  <FieldError message={rowErrors?.taxRate?.message} />
                </div>
              </div>

              {/* Computed amount: a summary strip on phones, a cell on desktop. */}
              <div className="flex items-center justify-between rounded-control bg-canvas px-3 py-2 sm:block sm:bg-transparent sm:px-0 sm:py-0 sm:pt-[7px] sm:text-right">
                <span className="text-[12px] text-ink-muted sm:hidden">{t('wizard.lineAmount')}</span>
                <span className="text-[13px] font-semibold text-ink tnum">
                  {formatCurrency(line.amount, { decimals: true })}
                </span>
              </div>

              <div className="flex justify-end sm:pt-0.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={fields.length === 1}
                  onClick={() => remove(index)}
                  aria-label={t('wizard.removeItem', { n: index + 1 })}
                >
                  <Trash2 className="h-3.5 w-3.5 text-danger" aria-hidden="true" />
                  <span className="ml-1 text-[12px] text-danger sm:hidden">{t('common.remove')}</span>
                </Button>
              </div>
            </li>
          );
        })}
      </ul>

      {rootError && (
        <p role="alert" className="mt-2 text-[12px] font-medium text-danger">
          {t(rootError, { defaultValue: rootError })}
        </p>
      )}

      <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <Button type="button" variant="outline" onClick={() => append(emptyItem)} disabled={fields.length >= 100}>
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          {t('wizard.addItem')}
        </Button>

        <dl className="w-full space-y-1.5 rounded-control border border-line bg-canvas/60 p-3 sm:w-[260px]">
          <div className="flex items-center justify-between">
            <dt className="text-[12.5px] text-ink-muted">{t('common.subtotal')}</dt>
            <dd className="text-[13px] font-medium text-ink tnum">{formatCurrency(totals.subtotal, { decimals: true })}</dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-[12.5px] text-ink-muted">{t('common.tax')}</dt>
            <dd className="text-[13px] font-medium text-ink tnum">{formatCurrency(totals.tax, { decimals: true })}</dd>
          </div>
          <div className="flex items-center justify-between border-t border-line pt-1.5">
            <dt className="text-[13px] font-semibold text-ink">{t('common.total')}</dt>
            <dd className="text-[16px] font-semibold text-brand tnum">{formatCurrency(totals.total, { decimals: true })}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

/** Field labels are only needed where the column headings are hidden. */
function Label({ text }: { text: string }) {
  return <span className="mb-1 block text-[11px] font-medium text-ink-muted sm:hidden">{text}</span>;
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="mt-1 text-[11px] text-danger">
      {message}
    </p>
  );
}

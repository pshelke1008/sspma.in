import { useFormContext } from 'react-hook-form';
import { FileText, Image as ImageIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { useLabels } from '@/i18n/useLabels';
import { useAuth } from '@/lib/auth/AuthProvider';
import { useMasters } from '@/lib/api/hooks';
import { computeLine, computeTotals, type ExpenseFormValues } from '../expenseSchema';
import { bytes, formatCurrency, formatDate } from '@/lib/utils/format';
import type { PendingFile } from '@/components/common/FileUpload';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">{label}</dt>
      <dd className="mt-0.5 text-[13px] font-medium text-ink">{value}</dd>
    </div>
  );
}

export function StepReview({ files }: { files: PendingFile[] }) {
  const { t } = useTranslation();
  const labels = useLabels();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { getValues } = useFormContext<ExpenseFormValues>();
  const { data: masters } = useMasters();
  const values = getValues();
  const totals = computeTotals(values.items);

  const nameOf = (list: { id: string; name: string }[] | undefined, id?: string) =>
    list?.find((item) => item.id === id)?.name ?? '—';
  const userOptions = queryClient.getQueryData<{ data: { id: string; name: string }[] }>(['users', 'options']);
  const requester = values.onBehalfOfId ? nameOf(userOptions?.data, values.onBehalfOfId) : user?.name ?? '—';

  return (
    <div className="space-y-5">
      <section>
        <h3 className="mb-2.5 text-[13px] font-semibold text-ink">{t('wizard.basicInformation')}</h3>
        <dl className="grid gap-3 rounded-control border border-line bg-canvas/40 p-4 sm:grid-cols-3">
          <Row label={t('wizard.expenseDate')} value={formatDate(values.date)} />
          <Row label={t('wizard.expenseTitle')} value={values.title || '—'} />
          <Row label={t('expenseDetail.requestedFor')} value={requester} />
          <Row label={t('common.department')} value={nameOf(masters?.departments, values.departmentId)} />
          <Row label={t('common.fund')} value={nameOf(masters?.funds, values.fundId)} />
          <Row label={t('common.costCenter')} value={nameOf(masters?.costCenters, values.costCenterId)} />
          <Row label={t('common.category')} value={nameOf(masters?.categories, values.categoryId)} />
          <Row label={t('common.supplier')} value={nameOf(masters?.suppliers, values.supplierId)} />
        </dl>
        {values.description && (
          <p className="mt-2 rounded-control bg-canvas/60 px-3 py-2 text-[12.5px] text-ink-muted">{values.description}</p>
        )}
      </section>

      <section>
        <h3 className="mb-2.5 text-[13px] font-semibold text-ink">{t('wizard.stepItems')}</h3>
        <div className="overflow-x-auto rounded-control border border-line">
          <table className="w-full min-w-[560px] border-collapse">
            <thead>
              <tr className="border-b border-line bg-canvas/70">
                {[t('common.description'), t('wizard.qty'), t('wizard.unit'), t('wizard.rate'), t('common.tax'), t('common.amount')].map((heading, index) => (
                  <th
                    key={heading}
                    scope="col"
                    className={`px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-ink-muted ${
                      index >= 1 ? 'text-right' : 'text-left'
                    }`}
                  >
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {values.items.map((item, index) => {
                const line = computeLine(item);
                return (
                  <tr key={index}>
                    <td className="px-3 py-2 text-[12.5px] text-ink">{item.description}</td>
                    <td className="px-3 py-2 text-right text-[12.5px] text-ink tnum">{item.quantity}</td>
                    <td className="px-3 py-2 text-right text-[12.5px] text-ink-muted">{item.unit}</td>
                    <td className="px-3 py-2 text-right text-[12.5px] text-ink tnum">
                      {formatCurrency(item.rate, { decimals: true })}
                    </td>
                    <td className="px-3 py-2 text-right text-[12.5px] text-ink-muted tnum">{item.taxRate}%</td>
                    <td className="px-3 py-2 text-right text-[12.5px] font-semibold text-ink tnum">
                      {formatCurrency(line.amount, { decimals: true })}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="flex justify-end">
        <dl className="w-full space-y-1.5 rounded-control border border-line bg-canvas/60 p-3 sm:w-[280px]">
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
            <dd className="text-[17px] font-semibold text-brand tnum">{formatCurrency(totals.total, { decimals: true })}</dd>
          </div>
        </dl>
      </section>

      <section>
        <h3 className="mb-2.5 text-[13px] font-semibold text-ink">{t('wizard.stepPayment')}</h3>
        <dl className="grid gap-3 rounded-control border border-line bg-canvas/40 p-4 sm:grid-cols-3">
          <Row label={t('common.status')} value={values.payImmediately ? t('wizard.paid') : t('wizard.unpaid')} />
          {values.payImmediately && (
            <>
              <Row label={t('common.method')} value={values.paymentMethod ? labels.paymentMethod[values.paymentMethod] : '—'} />
              <Row label={t('common.account')} value={nameOf(masters?.bankAccounts, values.paymentAccountId)} />
              <Row label={t('common.reference')} value={values.referenceNumber || '—'} />
              <Row label={t('wizard.paymentDate')} value={values.paymentDate ? formatDate(values.paymentDate) : '—'} />
            </>
          )}
        </dl>
      </section>

      <section>
        <h3 className="mb-2.5 text-[13px] font-semibold text-ink">
          {t('wizard.attachments')} {files.length > 0 && <span className="font-normal text-ink-muted">({files.length})</span>}
        </h3>
        {files.length === 0 ? (
          <p className="rounded-control border border-dashed border-line px-4 py-4 text-center text-[12.5px] text-ink-muted">
            {t('wizard.noFiles')}
          </p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {files.map((file) => (
              <li key={file.id} className="flex items-center gap-3 rounded-control border border-line px-3 py-2">
                {file.previewUrl ? (
                  <img src={file.previewUrl} alt="" className="h-9 w-9 rounded object-cover ring-1 ring-line" />
                ) : (
                  <span className="flex h-9 w-9 items-center justify-center rounded bg-brand-light">
                    {file.file.type.startsWith('image/') ? (
                      <ImageIcon className="h-4 w-4 text-brand" aria-hidden="true" />
                    ) : (
                      <FileText className="h-4 w-4 text-brand" aria-hidden="true" />
                    )}
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-medium text-ink">{file.file.name}</span>
                  <span className="block text-[11px] text-ink-muted">{bytes(file.file.size)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

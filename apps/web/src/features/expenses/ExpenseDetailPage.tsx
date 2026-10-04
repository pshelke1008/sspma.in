import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  BookCheck,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  MoreHorizontal,
  Pencil,
  Printer,
  RotateCcw,
  Send,
  Trash2,
  Undo2,
  Wallet,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, downloadFile, fileUrl } from '@/lib/api/client';
import { invalidateFinancialData, queryKeys } from '@/lib/api/queryClient';
import { useLabels } from '@/i18n/useLabels';
import { errorMessage } from '@/i18n/errors';
import { PageHeader } from '@/components/layout/PageHeader';
import { SectionCard } from '@/components/common/SectionCard';
import { StatusBadge, PaymentStatusBadge } from '@/components/common/StatusBadge';
import { ErrorState } from '@/components/common/states';
import { ConfirmationDialog } from '@/components/common/ConfirmationDialog';
import { Timeline, type TimelineEntry } from '@/components/common/Timeline';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/misc';
import { Textarea } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { bytes, formatCurrency, formatDate } from '@/lib/utils/format';
import { RecordPaymentDialog } from './RecordPaymentDialog';
import type { ExpenseDetail } from './types';

type ActionKind = 'approve' | 'reject' | 'submit' | 'recall' | 'delete' | 'revise' | 'post' | null;

export default function ExpenseDetailPage() {
  const { t } = useTranslation();
  const labels = useLabels();
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [action, setAction] = useState<ActionKind>(null);
  const [reason, setReason] = useState('');
  const [payOpen, setPayOpen] = useState(false);
  const lang = t('language.code');

  const { data: expense, isLoading, error, refetch } = useQuery({
    queryKey: queryKeys.expense(id),
    queryFn: () => api.get<ExpenseDetail>(`/expenses/${id}`),
    enabled: Boolean(id),
  });

  const { data: activity } = useQuery({
    queryKey: queryKeys.expenseActivity(id),
    queryFn: () => api.get<{ data: TimelineEntry[] }>(`/expenses/${id}/activity`),
    enabled: Boolean(id),
  });

  function runAction(path: string, body: unknown, successMessage: string, after?: (result: ExpenseDetail) => void) {
    return api.post<ExpenseDetail>(path, body).then((result) => {
      toast.success(successMessage);
      invalidateFinancialData();
      setAction(null);
      setReason('');
      after?.(result);
      return result;
    });
  }

  const mutation = useMutation({
    mutationFn: async (kind: Exclude<ActionKind, null>) => {
      switch (kind) {
        case 'submit':
          return runAction(`/expenses/${id}/submit`, {}, t('expenses.submitted'));
        case 'approve':
          return runAction(`/expenses/${id}/approve`, { comments: reason || undefined }, t('expenseDetail.approved'));
        case 'reject':
          return runAction(`/expenses/${id}/reject`, { reason }, t('expenseDetail.rejectedToast'));
        case 'recall':
          return runAction(`/expenses/${id}/recall`, {}, t('expenseDetail.recalled'));
        case 'post':
          return runAction(`/expenses/${id}/post-accounting`, {}, t('expenseDetail.posted'));
        case 'revise':
          return runAction(`/expenses/${id}/revise`, { reason }, t('expenseDetail.revised'), (result) =>
            navigate(`/expenses/${result.id}`),
          );
        case 'delete':
          return api.delete(`/expenses/${id}`).then(() => {
            toast.success(t('expenses.deleted'));
            invalidateFinancialData();
            navigate('/expenses');
          });
        default:
          throw new Error('Unknown action');
      }
    },
    onError: (err) => toast.error(t('expenseDetail.actionFailed'), { description: errorMessage(t, err) }),
  });

  const duplicate = useMutation({
    mutationFn: () => api.post<ExpenseDetail>(`/expenses/${id}/duplicate`, {}),
    onSuccess: (result) => {
      toast.success(t('expenses.duplicated'));
      invalidateFinancialData();
      navigate(`/expenses/${result.id}`);
    },
    onError: (err) => toast.error(t('expenses.duplicateFailed'), { description: errorMessage(t, err) }),
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-28 rounded-card" />
        <Skeleton className="h-96 rounded-card" />
      </div>
    );
  }

  if (error || !expense) {
    return <ErrorState message={error ? errorMessage(t, error) : t('expenseDetail.notFound')} onRetry={() => void refetch()} />;
  }

  const can = expense.abilities;
  const requester = expense.onBehalfOf ?? expense.createdBy;

  return (
    <>
      <PageHeader
        title={t('expenseDetail.title', { number: expense.expenseNumber })}
        subtitle={expense.title}
        breadcrumbs={[{ label: t('expenses.title'), to: '/expenses' }, { label: expense.expenseNumber }]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {can.canSubmit && (
              <Button onClick={() => setAction('submit')}>
                <Send className="h-3.5 w-3.5" aria-hidden="true" />
                {t('expenses.submit')}
              </Button>
            )}
            {can.canApprove && (
              <Button variant="success" onClick={() => setAction('approve')}>
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                {t('expenseDetail.approve')}
              </Button>
            )}
            {can.canReject && (
              <Button variant="danger-outline" onClick={() => setAction('reject')}>
                <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                {t('expenseDetail.reject')}
              </Button>
            )}
            {can.canPay && (
              <Button onClick={() => setPayOpen(true)}>
                <Wallet className="h-3.5 w-3.5" aria-hidden="true" />
                {t('expenses.recordPayment')}
              </Button>
            )}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label={t('common.moreActions')}>
                  <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {can.canEdit && (
                  <DropdownMenuItem asChild>
                    <Link to={`/expenses/${expense.id}/edit`}>
                      <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                      {t('common.edit')}
                    </Link>
                  </DropdownMenuItem>
                )}
                {can.canRecall && (
                  <DropdownMenuItem onSelect={() => setAction('recall')}>
                    <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
                    {t('expenseDetail.recall')}
                  </DropdownMenuItem>
                )}
                {can.canPostAccounting && (
                  <DropdownMenuItem onSelect={() => setAction('post')}>
                    <BookCheck className="h-3.5 w-3.5" aria-hidden="true" />
                    {t('expenseDetail.postAccounting')}
                  </DropdownMenuItem>
                )}
                {can.canRevise && (
                  <DropdownMenuItem onSelect={() => setAction('revise')}>
                    <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                    {t('expenseDetail.revise')}
                  </DropdownMenuItem>
                )}
                {can.canDuplicate && (
                  <DropdownMenuItem onSelect={() => duplicate.mutate()}>
                    <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                    {t('common.duplicate')}
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => window.open(fileUrl(`/expenses/${expense.id}/pdf?lang=${lang}`), '_blank', 'noopener')}
                >
                  <Printer className="h-3.5 w-3.5" aria-hidden="true" />
                  {t('common.print')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() =>
                    void downloadFile(
                      `/expenses/${expense.id}/pdf?download=1&lang=${lang}`,
                      `${expense.expenseNumber}.pdf`,
                    ).catch(() => toast.error(t('expenses.downloadFailed')))
                  }
                >
                  <Download className="h-3.5 w-3.5" aria-hidden="true" />
                  {t('common.downloadPdf')}
                </DropdownMenuItem>
                {can.canDelete && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem tone="danger" onSelect={() => setAction('delete')}>
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      {t('common.delete')}
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryTile label={t('common.status')}>
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusBadge status={expense.status} />
            <PaymentStatusBadge status={expense.paymentStatus} />
          </div>
        </SummaryTile>
        <SummaryTile label={t('expenseDetail.requestedFor')}>
          <p className="truncate text-[14px] font-semibold text-ink">{requester.name}</p>
          {expense.onBehalfOf && (
            <p className="truncate text-[11.5px] text-ink-muted">
              {t('expenseDetail.enteredBy')}: {expense.createdBy.name}
            </p>
          )}
        </SummaryTile>
        <SummaryTile label={t('common.amount')}>
          <p className="text-[18px] font-semibold text-ink tnum">{formatCurrency(expense.total, { decimals: true })}</p>
        </SummaryTile>
        <SummaryTile label={t('expenseDetail.balanceDue')}>
          <p className={`text-[18px] font-semibold tnum ${expense.balanceDue > 0 ? 'text-accent-ink' : 'text-success'}`}>
            {formatCurrency(expense.balanceDue, { decimals: true })}
          </p>
        </SummaryTile>
      </div>

      {expense.rejectionReason && (
        <div role="alert" className="mb-4 rounded-card border border-danger/25 bg-danger/5 px-4 py-3">
          <p className="text-[12.5px] font-semibold text-danger">{t('expenseDetail.rejected')}</p>
          <p className="mt-0.5 text-[12.5px] text-ink">{expense.rejectionReason}</p>
        </div>
      )}

      <SectionCard noPadding>
        <Tabs defaultValue="overview">
          <div className="border-b border-line px-3 sm:px-4">
            <TabsList variant="underline" className="gap-4">
              {[
                ['overview', t('expenseDetail.overview')],
                ['items', t('expenseDetail.itemsTab', { count: expense.items.length })],
                ['approval', t('expenseDetail.approval')],
                ['payment', t('expenseDetail.payment')],
                ['accounting', t('expenseDetail.accounting')],
                ['attachments', t('expenseDetail.attachmentsTab', { count: expense.attachments.length })],
                ['activity', t('expenseDetail.activity')],
              ].map(([value, label]) => (
                <TabsTrigger key={value} value={value} variant="underline">
                  {label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          <div className="p-4 sm:p-5">
            <TabsContent value="overview" className="mt-0">
              <dl className="grid gap-4 sm:grid-cols-3">
                <Field label={t('common.date')} value={formatDate(expense.date)} />
                <Field label={t('common.department')} value={expense.department.name} />
                <Field label={t('common.fund')} value={expense.fund.name} />
                <Field label={t('common.costCenter')} value={expense.costCenter?.name ?? '—'} />
                <Field label={t('common.category')} value={expense.category.name} />
                <Field label={t('common.supplier')} value={expense.supplier?.name ?? '—'} />
                <Field label={t('expenseDetail.requestedFor')} value={requester.name} />
                <Field label={t('expenseDetail.raisedBy')} value={expense.createdBy.name} />
                <Field label={t('expenseDetail.created')} value={formatDate(expense.createdAt, 'long')} />
                <Field
                  label={t('expenseDetail.revision')}
                  value={
                    expense.revisionNumber > 1
                      ? t('expenseDetail.revisionN', { n: expense.revisionNumber })
                      : t('expenseDetail.original')
                  }
                />
              </dl>
              {expense.description && (
                <div className="mt-4 rounded-control bg-canvas/60 px-3 py-2.5">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">{t('common.description')}</p>
                  <p className="mt-1 text-[12.5px] leading-relaxed text-ink">{expense.description}</p>
                </div>
              )}
              {expense.notes && (
                <div className="mt-2 rounded-control bg-canvas/60 px-3 py-2.5">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">{t('common.notes')}</p>
                  <p className="mt-1 text-[12.5px] leading-relaxed text-ink">{expense.notes}</p>
                </div>
              )}
            </TabsContent>

            <TabsContent value="items" className="mt-0">
              <div className="overflow-x-auto rounded-control border border-line">
                <table className="w-full min-w-[560px] border-collapse">
                  <thead>
                    <tr className="border-b border-line bg-canvas/70">
                      {[t('common.description'), t('wizard.qty'), t('wizard.unit'), t('wizard.rate'), t('common.tax'), t('common.amount')].map(
                        (heading, index) => (
                          <th
                            key={heading}
                            scope="col"
                            className={`px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-ink-muted ${index >= 1 ? 'text-right' : 'text-left'}`}
                          >
                            {heading}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {expense.items.map((item) => (
                      <tr key={item.id}>
                        <td className="px-3 py-2.5 text-[12.5px] text-ink">{item.description}</td>
                        <td className="px-3 py-2.5 text-right text-[12.5px] text-ink tnum">{item.quantity}</td>
                        <td className="px-3 py-2.5 text-right text-[12.5px] text-ink-muted">{item.unit}</td>
                        <td className="px-3 py-2.5 text-right text-[12.5px] text-ink tnum">
                          {formatCurrency(item.rate, { decimals: true })}
                        </td>
                        <td className="px-3 py-2.5 text-right text-[12.5px] text-ink-muted tnum">{item.taxRate}%</td>
                        <td className="px-3 py-2.5 text-right text-[12.5px] font-semibold text-ink tnum">
                          {formatCurrency(item.amount, { decimals: true })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-3 flex justify-end">
                <dl className="w-full space-y-1.5 rounded-control border border-line bg-canvas/60 p-3 sm:w-[280px]">
                  <div className="flex justify-between">
                    <dt className="text-[12.5px] text-ink-muted">{t('common.subtotal')}</dt>
                    <dd className="text-[13px] font-medium text-ink tnum">{formatCurrency(expense.subtotal, { decimals: true })}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-[12.5px] text-ink-muted">{t('common.tax')}</dt>
                    <dd className="text-[13px] font-medium text-ink tnum">{formatCurrency(expense.tax, { decimals: true })}</dd>
                  </div>
                  <div className="flex justify-between border-t border-line pt-1.5">
                    <dt className="text-[13px] font-semibold text-ink">{t('common.total')}</dt>
                    <dd className="text-[16px] font-semibold text-brand tnum">{formatCurrency(expense.total, { decimals: true })}</dd>
                  </div>
                </dl>
              </div>
            </TabsContent>

            <TabsContent value="approval" className="mt-0">
              <dl className="grid gap-4 sm:grid-cols-3">
                <Field label={t('expenseDetail.requestedBy')} value={requester.name} />
                <Field label={t('expenseDetail.submittedAt')} value={formatDate(expense.submittedAt, 'long')} />
                <Field label={t('expenseDetail.approvedBy')} value={expense.approvedBy?.name ?? '—'} />
                <Field label={t('expenseDetail.approvedAt')} value={formatDate(expense.approvedAt, 'long')} />
                {expense.onBehalfOf && <Field label={t('expenseDetail.enteredBy')} value={expense.createdBy.name} />}
              </dl>

              {expense.approvals.length > 0 && (
                <div className="mt-5">
                  <h3 className="mb-2 text-[13px] font-semibold text-ink">{t('expenseDetail.history')}</h3>
                  <ul className="divide-y divide-line rounded-control border border-line">
                    {expense.approvals.map((approval) => (
                      <li key={approval.id} className="flex flex-wrap items-start gap-3 px-3 py-2.5">
                        <span className="min-w-0 flex-1">
                          <span className="block text-[12.5px] font-medium text-ink">
                            {t('expenseDetail.level', {
                              level: approval.level,
                              decision: t(`expenseDetail.decision${approval.decision}`, { defaultValue: approval.decision }),
                            })}
                          </span>
                          <span className="mt-0.5 block text-[11.5px] text-ink-muted">
                            {t('expenseDetail.requestedByOn', {
                              name: approval.requestedBy.name,
                              date: formatDate(approval.requestedAt, 'long'),
                            })}
                            {approval.actor ? t('expenseDetail.decidedBy', { name: approval.actor.name }) : ''}
                            {approval.decidedAt ? t('expenseDetail.decidedOn', { date: formatDate(approval.decidedAt, 'long') }) : ''}
                          </span>
                          {approval.comments && (
                            <span className="mt-1.5 block rounded-control bg-canvas px-2 py-1 text-[12px] text-ink">
                              {approval.comments}
                            </span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </TabsContent>

            <TabsContent value="payment" className="mt-0">
              <dl className="grid gap-4 sm:grid-cols-3">
                <Field label={t('common.status')} value={labels.paymentStatus[expense.paymentStatus] ?? expense.paymentStatus} />
                <Field label={t('common.method')} value={expense.paymentMethod ? labels.paymentMethod[expense.paymentMethod] : '—'} />
                <Field label={t('common.reference')} value={expense.referenceNumber ?? '—'} />
                <Field label={t('wizard.paymentDate')} value={formatDate(expense.paymentDate)} />
                <Field label={t('expenseDetail.paid')} value={formatCurrency(expense.paidAmount, { decimals: true })} />
                <Field label={t('expenseDetail.outstanding')} value={formatCurrency(expense.balanceDue, { decimals: true })} />
              </dl>

              {expense.payments.length > 0 ? (
                <div className="mt-5 overflow-x-auto rounded-control border border-line">
                  <table className="w-full min-w-[560px] border-collapse">
                    <thead>
                      <tr className="border-b border-line bg-canvas/70">
                        {[
                          t('expenseDetail.paymentNumber'),
                          t('common.date'),
                          t('common.account'),
                          t('common.method'),
                          t('common.reference'),
                          t('common.amount'),
                        ].map((heading, index) => (
                          <th
                            key={heading}
                            scope="col"
                            className={`px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-ink-muted ${index === 5 ? 'text-right' : 'text-left'}`}
                          >
                            {heading}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {expense.payments.map((payment) => (
                        <tr key={payment.id}>
                          <td className="px-3 py-2.5 text-[12.5px] font-medium text-ink">{payment.paymentNumber}</td>
                          <td className="px-3 py-2.5 text-[12.5px] text-ink-muted">{formatDate(payment.date)}</td>
                          <td className="px-3 py-2.5 text-[12.5px] text-ink">{payment.bankAccount?.name ?? t('common.cashInHand')}</td>
                          <td className="px-3 py-2.5 text-[12.5px] text-ink-muted">{labels.paymentMethod[payment.method] ?? payment.method}</td>
                          <td className="px-3 py-2.5 text-[12.5px] text-ink-muted">{payment.referenceNumber ?? '—'}</td>
                          <td className="px-3 py-2.5 text-right text-[12.5px] font-semibold text-ink tnum">
                            {formatCurrency(payment.amount, { decimals: true })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="mt-5 rounded-control border border-dashed border-line px-4 py-6 text-center text-[12.5px] text-ink-muted">
                  {t('expenseDetail.noPayments')}
                </p>
              )}
            </TabsContent>

            <TabsContent value="accounting" className="mt-0">
              {expense.transactions.length === 0 ? (
                <p className="rounded-control border border-dashed border-line px-4 py-8 text-center text-[12.5px] text-ink-muted">
                  {t('expenseDetail.noJournal')}
                </p>
              ) : (
                <div className="space-y-4">
                  {expense.transactions.map((transaction) => (
                    <div key={transaction.id} className="overflow-hidden rounded-control border border-line">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-canvas/60 px-3 py-2">
                        <div>
                          <p className="text-[12.5px] font-semibold text-ink">
                            {transaction.voucherNumber}
                            {transaction.isReversal && <span className="ml-2 text-[11px] text-danger">{t('expenseDetail.reversal')}</span>}
                          </p>
                          <p className="text-[11.5px] text-ink-muted">
                            {formatDate(transaction.date)} · {transaction.narration}
                          </p>
                        </div>
                        <p className="text-[13px] font-semibold text-ink tnum">{formatCurrency(transaction.amount, { decimals: true })}</p>
                      </div>
                      <table className="w-full border-collapse">
                        <thead>
                          <tr className="border-b border-line">
                            <th scope="col" className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                              {t('common.account')}
                            </th>
                            <th scope="col" className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                              {t('expenseDetail.debit')}
                            </th>
                            <th scope="col" className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                              {t('expenseDetail.credit')}
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-line">
                          {transaction.lines.map((line) => (
                            <tr key={line.id}>
                              <td className="px-3 py-2.5">
                                <p className="text-[12.5px] font-medium text-ink">
                                  {line.account.code} — {line.account.name}
                                </p>
                                {line.description && <p className="text-[11.5px] text-ink-muted">{line.description}</p>}
                              </td>
                              <td className="px-3 py-2.5 text-right text-[12.5px] text-ink tnum">
                                {line.debit > 0 ? formatCurrency(line.debit, { decimals: true }) : '—'}
                              </td>
                              <td className="px-3 py-2.5 text-right text-[12.5px] text-ink tnum">
                                {line.credit > 0 ? formatCurrency(line.credit, { decimals: true }) : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="attachments" className="mt-0">
              {expense.attachments.length === 0 ? (
                <p className="rounded-control border border-dashed border-line px-4 py-8 text-center text-[12.5px] text-ink-muted">
                  {t('expenseDetail.noAttachments')}
                </p>
              ) : (
                <ul className="grid gap-2 sm:grid-cols-2">
                  {expense.attachments.map((attachment) => (
                    <li key={attachment.id} className="flex items-center gap-3 rounded-control border border-line px-3 py-2.5">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-brand-light">
                        {attachment.mimeType.startsWith('image/') ? (
                          <ImageIcon className="h-4 w-4 text-brand" aria-hidden="true" />
                        ) : (
                          <FileText className="h-4 w-4 text-brand" aria-hidden="true" />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12.5px] font-medium text-ink">{attachment.fileName}</span>
                        <span className="block text-[11px] text-ink-muted">
                          {bytes(attachment.size)} · {attachment.uploadedBy.name} · {formatDate(attachment.createdAt)}
                        </span>
                      </span>
                      <a
                        href={fileUrl(`/expenses/${expense.id}/attachments/${attachment.id}`)}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={t('expenseDetail.openFile', { name: attachment.fileName })}
                        className="rounded p-1.5 text-ink-muted transition-colors hover:bg-canvas hover:text-brand focus-visible:ring-2 focus-visible:ring-brand-primary/50"
                      >
                        <ExternalLink className="h-4 w-4" aria-hidden="true" />
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </TabsContent>

            <TabsContent value="activity" className="mt-0">
              <Timeline entries={activity?.data ?? []} />
            </TabsContent>
          </div>
        </Tabs>
      </SectionCard>

      <RecordPaymentDialog
        open={payOpen}
        onOpenChange={setPayOpen}
        expense={{
          id: expense.id,
          expenseNumber: expense.expenseNumber,
          title: expense.title,
          total: expense.total,
          balanceDue: expense.balanceDue,
        }}
      />

      <ConfirmationDialog
        open={action === 'submit'}
        onOpenChange={(open) => !open && setAction(null)}
        title={t('expenses.submitTitle')}
        description={t('expenseDetail.submitText', { number: expense.expenseNumber, amount: formatCurrency(expense.total) })}
        confirmLabel={t('expenses.submit')}
        loading={mutation.isPending}
        onConfirm={() => mutation.mutate('submit')}
      />

      <ConfirmationDialog
        open={action === 'approve'}
        onOpenChange={(open) => !open && setAction(null)}
        title={t('expenseDetail.approveTitle')}
        description={t('expenseDetail.approveText', { number: expense.expenseNumber, amount: formatCurrency(expense.total) })}
        confirmLabel={t('expenseDetail.approve')}
        tone="success"
        loading={mutation.isPending}
        onConfirm={() => mutation.mutate('approve')}
      >
        <Textarea
          rows={2}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder={t('expenseDetail.commentPlaceholder')}
          aria-label={t('expenseDetail.comment')}
        />
      </ConfirmationDialog>

      <ConfirmationDialog
        open={action === 'reject'}
        onOpenChange={(open) => !open && setAction(null)}
        title={t('expenseDetail.rejectTitle')}
        description={t('expenseDetail.rejectText')}
        confirmLabel={t('expenseDetail.reject')}
        tone="danger"
        loading={mutation.isPending}
        disabled={reason.trim().length < 5}
        onConfirm={() => mutation.mutate('reject')}
      >
        <div>
          <label htmlFor="reject-reason" className="text-[12px] font-medium text-ink-muted">
            {t('expenseDetail.reason')} <span className="text-danger">*</span>
          </label>
          <Textarea
            id="reject-reason"
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={t('expenseDetail.reasonPlaceholder')}
            className="mt-1"
          />
        </div>
      </ConfirmationDialog>

      <ConfirmationDialog
        open={action === 'revise'}
        onOpenChange={(open) => !open && setAction(null)}
        title={t('expenseDetail.reviseTitle')}
        description={t('expenseDetail.reviseText')}
        confirmLabel={t('expenseDetail.createRevision')}
        loading={mutation.isPending}
        disabled={reason.trim().length < 5}
        onConfirm={() => mutation.mutate('revise')}
      >
        <Textarea
          rows={3}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder={t('expenseDetail.revisePlaceholder')}
          aria-label={t('expenseDetail.reviseReason')}
        />
      </ConfirmationDialog>

      <ConfirmationDialog
        open={action === 'recall'}
        onOpenChange={(open) => !open && setAction(null)}
        title={t('expenseDetail.recallTitle')}
        description={t('expenseDetail.recallText')}
        confirmLabel={t('expenseDetail.recallButton')}
        loading={mutation.isPending}
        onConfirm={() => mutation.mutate('recall')}
      />

      <ConfirmationDialog
        open={action === 'post'}
        onOpenChange={(open) => !open && setAction(null)}
        title={t('expenseDetail.postTitle')}
        description={t('expenseDetail.postText')}
        confirmLabel={t('expenseDetail.postButton')}
        loading={mutation.isPending}
        onConfirm={() => mutation.mutate('post')}
      />

      <ConfirmationDialog
        open={action === 'delete'}
        onOpenChange={(open) => !open && setAction(null)}
        title={t('expenses.deleteTitle')}
        description={t('expenseDetail.deleteText', { number: expense.expenseNumber })}
        confirmLabel={t('common.delete')}
        tone="danger"
        loading={mutation.isPending}
        onConfirm={() => mutation.mutate('delete')}
      />
    </>
  );
}

function SummaryTile({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-card border border-line bg-white px-4 py-3 shadow-card">
      <p className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">{label}</p>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">{label}</dt>
      <dd className="mt-0.5 text-[13px] font-medium text-ink">{value}</dd>
    </div>
  );
}

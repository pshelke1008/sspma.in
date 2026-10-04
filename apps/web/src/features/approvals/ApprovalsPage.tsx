import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCircle2, ClipboardCheck, Eye, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, api, buildQuery } from '@/lib/api/client';
import { invalidateFinancialData, queryKeys } from '@/lib/api/queryClient';
import { useMasters } from '@/lib/api/hooks';
import { PageHeader } from '@/components/layout/PageHeader';
import { SectionCard } from '@/components/common/SectionCard';
import { FilterBar, FilterField } from '@/components/common/FilterBar';
import { StatusBadge } from '@/components/common/StatusBadge';
import { EmptyState, ErrorState } from '@/components/common/states';
import { ConfirmationDialog } from '@/components/common/ConfirmationDialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton, Progress } from '@/components/ui/misc';
import { SimpleSelect } from '@/components/ui/select';
import { Textarea } from '@/components/ui/input';
import { SegmentedControl } from '@/components/common/SegmentedControl';
import { useTranslation } from 'react-i18next';
import { errorMessage } from '@/i18n/errors';
import { formatCurrency, formatDate, relativeTime } from '@/lib/utils/format';

interface ApprovalRow {
  id: string;
  expenseNumber: string;
  title: string;
  date: string;
  total: number;
  status: string;
  submittedAt: string | null;
  approvedAt: string | null;
  rejectionReason: string | null;
  isOwnRequest: boolean;
  canAct: boolean;
  department: { id: string; name: string };
  fund: { id: string; name: string };
  category: { id: string; name: string };
  supplier: { id: string; name: string } | null;
  createdBy: { id: string; name: string; designation: string | null };
  onBehalfOf: { id: string; name: string; designation: string | null } | null;
  approvedBy: { id: string; name: string } | null;
  budget: { allocated: number; spent: number; remaining: number };
}

interface ApprovalsResponse {
  data: ApprovalRow[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
  counts: { pending: number; approved: number; rejected: number; all: number };
}

const TABS = [
  { value: 'pending', labelKey: 'approvals.tabPending' },
  { value: 'approved', labelKey: 'approvals.tabApproved' },
  { value: 'rejected', labelKey: 'approvals.tabRejected' },
  { value: 'all', labelKey: 'approvals.tabAll' },
] as const;

export default function ApprovalsPage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: masters } = useMasters();

  const tab = searchParams.get('tab') ?? 'pending';
  const search = searchParams.get('search') ?? '';
  const departmentId = searchParams.get('department') ?? '';

  const [target, setTarget] = useState<{ row: ApprovalRow; kind: 'approve' | 'reject' } | null>(null);
  const [reason, setReason] = useState('');

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next, { replace: true });
  }

  const params = useMemo(
    () => ({ tab, search: search || undefined, departmentId: departmentId || undefined, pageSize: 50 }),
    [tab, search, departmentId],
  );

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: queryKeys.approvals(params),
    queryFn: () => api.get<ApprovalsResponse>('/approvals' + buildQuery(params)),
    placeholderData: (previous) => previous,
  });

  const decision = useMutation({
    mutationFn: ({ row, kind }: { row: ApprovalRow; kind: 'approve' | 'reject' }) =>
      kind === 'approve'
        ? api.post(`/expenses/${row.id}/approve`, { comments: reason || undefined })
        : api.post(`/expenses/${row.id}/reject`, { reason }),
    onSuccess: (_result, variables) => {
      toast.success(variables.kind === 'approve' ? t('expenseDetail.approved') : t('expenseDetail.rejectedToast'), {
        description: `${variables.row.expenseNumber} — ${variables.row.title}`,
      });
      invalidateFinancialData();
      setTarget(null);
      setReason('');
    },
    onError: (err) => toast.error(t('expenseDetail.actionFailed'), { description: errorMessage(t, err) }),
  });

  if (error) return <ErrorState message={errorMessage(t, error)} onRetry={() => void refetch()} />;

  return (
    <>
      <PageHeader
        title={t('approvals.title')}
        subtitle={t('approvals.subtitle')}
      />

      <SectionCard noPadding>
        <div className="flex flex-col gap-3 border-b border-line p-3">
          <SegmentedControl
            label={t('approvals.filterLabel')}
            value={tab}
            onChange={(value) => setParam('tab', value)}
            segments={TABS.map((item) => ({
              value: item.value,
              label: t(item.labelKey),
              count: data?.counts[item.value],
            }))}
            className="self-start"
          />

          <FilterBar
            search={search}
            onSearchChange={(value) => setParam('search', value)}
            searchPlaceholder={t('approvals.searchPlaceholder')}
            activeCount={departmentId ? 1 : 0}
            onClear={() => setSearchParams(new URLSearchParams({ tab }), { replace: true })}
            filters={
              <FilterField label={t('common.department')}>
                <SimpleSelect
                  value={departmentId || 'all'}
                  onValueChange={(value) => setParam('department', value === 'all' ? '' : value)}
                  options={[
                    { value: 'all', label: t('common.allDepartments') },
                    ...(masters?.departments ?? []).map((d) => ({ value: d.id, label: d.name })),
                  ]}
                  ariaLabel={t('expenses.filterDepartment')}
                />
              </FilterField>
            }
          />
        </div>

        {isLoading ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-36 rounded-card" />
            ))}
          </div>
        ) : !data?.data.length ? (
          <EmptyState
            icon={ClipboardCheck}
            title={tab === 'pending' ? t('approvals.emptyPending') : t('approvals.emptyOther')}
            description={tab === 'pending' ? t('approvals.emptyPendingText') : t('approvals.emptyOtherText')}
          />
        ) : (
          <ul className="divide-y divide-line">
            {data.data.map((row) => (
              <li key={row.id}>
                <ApprovalCard
                  row={row}
                  onApprove={() => {
                    setReason('');
                    setTarget({ row, kind: 'approve' });
                  }}
                  onReject={() => {
                    setReason('');
                    setTarget({ row, kind: 'reject' });
                  }}
                />
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <ConfirmationDialog
        open={target?.kind === 'approve'}
        onOpenChange={(open) => !open && setTarget(null)}
        title={t('expenseDetail.approveTitle')}
        description={
          target
            ? t('approvals.approveText', {
                number: target.row.expenseNumber,
                title: target.row.title,
                amount: formatCurrency(target.row.total),
              })
            : undefined
        }
        confirmLabel={t('expenseDetail.approve')}
        tone="success"
        loading={decision.isPending}
        onConfirm={() => target && decision.mutate(target)}
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
        open={target?.kind === 'reject'}
        onOpenChange={(open) => !open && setTarget(null)}
        title={t('expenseDetail.rejectTitle')}
        description={t('approvals.rejectText')}
        confirmLabel={t('expenseDetail.reject')}
        tone="danger"
        loading={decision.isPending}
        disabled={reason.trim().length < 5}
        onConfirm={() => target && decision.mutate(target)}
      >
        <div>
          <label htmlFor="approval-reject-reason" className="text-[12px] font-medium text-ink-muted">
            {t('expenseDetail.reason')} <span className="text-danger">*</span>
          </label>
          <Textarea
            id="approval-reject-reason"
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={t('expenseDetail.reasonPlaceholder')}
            className="mt-1"
          />
        </div>
      </ConfirmationDialog>
    </>
  );
}

/**
 * One card per request — the same component on desktop and phone, with large
 * touch targets for the two decision buttons.
 */
function ApprovalCard({
  row,
  onApprove,
  onReject,
}: {
  row: ApprovalRow;
  onApprove: () => void;
  onReject: () => void;
}) {
  const { t } = useTranslation();
  const utilisation = row.budget.allocated > 0 ? (row.budget.spent / row.budget.allocated) * 100 : 0;
  const requester = row.onBehalfOf ?? row.createdBy;

  return (
    <article className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link to={`/expenses/${row.id}`} className="text-[14px] font-semibold text-ink hover:text-brand hover:underline">
              {row.title}
            </Link>
            <StatusBadge status={row.status} />
            {row.isOwnRequest && <Badge tone="info">{t('approvals.yourRequest')}</Badge>}
          </div>
          <p className="mt-1 text-[12px] text-ink-muted">
            {row.expenseNumber} · {row.department.name} · {row.category.name}
            {row.supplier ? ` · ${row.supplier.name}` : ''}
          </p>
          <p className="mt-0.5 text-[12px] text-ink-muted">
            {t('approvals.requestedBy')} <span className="font-medium text-ink">{requester.name}</span>
            {requester.designation ? ` (${requester.designation})` : ''}
            {row.onBehalfOf ? ` · ${t('approvals.enteredBy', { name: row.createdBy.name })}` : ''}
            {row.submittedAt ? ` · ${relativeTime(row.submittedAt)}` : ` · ${formatDate(row.date)}`}
          </p>
          {row.rejectionReason && (
            <p className="mt-2 rounded-control bg-danger/5 px-2.5 py-1.5 text-[12px] text-danger">
              {row.rejectionReason}
            </p>
          )}
        </div>

        <div className="text-right">
          <p className="text-[19px] font-semibold text-ink tnum">{formatCurrency(row.total)}</p>
          <p className="text-[11.5px] text-ink-muted">{row.fund.name}</p>
        </div>
      </div>

      {row.budget.allocated > 0 && (
        <div className="mt-3 rounded-control bg-canvas/70 px-3 py-2">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[11.5px] text-ink-muted">{t('approvals.budgetRemaining', { department: row.department.name })}</span>
            <span
              className={`text-[12.5px] font-semibold tnum ${row.budget.remaining < 0 ? 'text-danger' : 'text-ink'}`}
            >
              {formatCurrency(row.budget.remaining)}
            </span>
          </div>
          <Progress
            value={utilisation}
            className="mt-1.5"
            label={t('approvals.budgetUsedLabel', { department: row.department.name, percent: utilisation.toFixed(0) })}
            tone={utilisation > 100 ? 'danger' : utilisation > 80 ? 'accent' : 'brand'}
          />
          <p className="mt-1 text-[11px] text-ink-muted tnum">
            {t('approvals.budgetUsed', { spent: formatCurrency(row.budget.spent), allocated: formatCurrency(row.budget.allocated) })}
          </p>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button asChild variant="outline" size="sm">
          <Link to={`/expenses/${row.id}`}>
            <Eye className="h-3.5 w-3.5" aria-hidden="true" />
            {t('common.open')}
          </Link>
        </Button>

        {row.canAct ? (
          <div className="ml-auto flex flex-1 gap-2 sm:flex-none">
            <Button variant="danger-outline" size="md" className="flex-1 sm:flex-none" onClick={onReject}>
              <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
              {t('expenseDetail.reject')}
            </Button>
            <Button variant="success" size="md" className="flex-1 sm:flex-none" onClick={onApprove}>
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
              {t('expenseDetail.approve')}
            </Button>
          </div>
        ) : row.status === 'PENDING_APPROVAL' ? (
          <p className="ml-auto text-[11.5px] text-ink-muted">
            {row.isOwnRequest ? t('approvals.ownRequest') : t('approvals.awaiting')}
          </p>
        ) : (
          <p className="ml-auto text-[11.5px] text-ink-muted">
            {row.approvedBy ? t('approvals.decidedBy', { name: row.approvedBy.name }) : t('approvals.decided')}
            {row.approvedAt ? ` · ${formatDate(row.approvedAt)}` : ''}
          </p>
        )}
      </div>
    </article>
  );
}

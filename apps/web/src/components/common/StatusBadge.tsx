import type { ExpenseStatus, PaymentStatusKey, PurchaseStatusKey } from '@ashram/types';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { useLabels } from '@/i18n/useLabels';

type Tone = NonNullable<BadgeProps['tone']>;

const EXPENSE_TONES: Record<ExpenseStatus, Tone> = {
  DRAFT: 'neutral',
  SUBMITTED: 'info',
  PENDING_APPROVAL: 'accent',
  APPROVED: 'success',
  REJECTED: 'danger',
  PAYMENT_PENDING: 'warning',
  PAID: 'brand',
  ACCOUNTING_POSTED: 'brand',
  CANCELLED: 'neutral',
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const labels = useLabels();
  return (
    <Badge tone={EXPENSE_TONES[status as ExpenseStatus] ?? 'neutral'} className={className}>
      {labels.expenseStatus[status] ?? status}
    </Badge>
  );
}

const PAYMENT_TONES: Record<PaymentStatusKey, Tone> = { UNPAID: 'danger', PARTIAL: 'warning', PAID: 'success' };

export function PaymentStatusBadge({ status }: { status: string }) {
  const labels = useLabels();
  return (
    <Badge tone={PAYMENT_TONES[status as PaymentStatusKey] ?? 'neutral'}>{labels.paymentStatus[status] ?? status}</Badge>
  );
}

const PURCHASE_TONES: Record<PurchaseStatusKey, Tone> = {
  DRAFT: 'neutral',
  ORDERED: 'info',
  PARTIALLY_RECEIVED: 'warning',
  RECEIVED: 'success',
  CANCELLED: 'danger',
};

export function PurchaseStatusBadge({ status }: { status: string }) {
  const labels = useLabels();
  return (
    <Badge tone={PURCHASE_TONES[status as PurchaseStatusKey] ?? 'neutral'}>{labels.purchaseStatus[status] ?? status}</Badge>
  );
}

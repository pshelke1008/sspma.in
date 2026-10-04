import {
  EXPENSE_STATUS_LABELS,
  EXPENSE_TRANSITIONS,
  LOCKED_EXPENSE_STATUSES,
  canTransition,
  type ExpenseStatus,
} from '@ashram/types';
import type { Permission } from '@ashram/types';
import { WorkflowError, forbidden } from '../../lib/errors';

export { canTransition, EXPENSE_TRANSITIONS, LOCKED_EXPENSE_STATUSES };

/** Permission required to drive each transition, enforced server-side. */
const TRANSITION_PERMISSION: Partial<Record<`${ExpenseStatus}->${ExpenseStatus}`, Permission>> = {
  'DRAFT->SUBMITTED': 'expense.submit',
  'SUBMITTED->PENDING_APPROVAL': 'expense.submit',
  'PENDING_APPROVAL->APPROVED': 'expense.approve',
  'PENDING_APPROVAL->REJECTED': 'expense.reject',
  'REJECTED->DRAFT': 'expense.edit',
  'APPROVED->PAYMENT_PENDING': 'expense.pay',
  'APPROVED->PAID': 'expense.pay',
  'PAYMENT_PENDING->PAID': 'expense.pay',
  'PAID->ACCOUNTING_POSTED': 'expense.pay',
};

/**
 * Guards a status change. Invalid moves (PAID → DRAFT, approving an already
 * approved expense, and so on) are rejected before any write happens.
 */
export function assertTransition(from: ExpenseStatus, to: ExpenseStatus): void {
  if (from === to) {
    throw new WorkflowError(`This expense is already ${EXPENSE_STATUS_LABELS[to]}.`);
  }
  if (!canTransition(from, to)) {
    const allowed = EXPENSE_TRANSITIONS[from] ?? [];
    throw new WorkflowError(
      `Cannot move an expense from ${EXPENSE_STATUS_LABELS[from]} to ${EXPENSE_STATUS_LABELS[to]}.`,
      {
        from,
        to,
        allowed: allowed.map((status) => ({ status, label: EXPENSE_STATUS_LABELS[status] })),
      },
    );
  }
}

export function assertTransitionPermission(
  from: ExpenseStatus,
  to: ExpenseStatus,
  permissions: Set<string>,
): void {
  const required = TRANSITION_PERMISSION[`${from}->${to}`];
  if (required && !permissions.has(required)) {
    throw forbidden(`You need the "${required}" permission to perform this action.`);
  }
}

/** Financially locked records may not be edited in place. */
/**
 * The people an expense belongs to: whoever keyed it in and, when it was raised
 * for someone else, that person too. Both are barred from deciding on it.
 */
export function isExpenseOwner(
  expense: { createdById: string; onBehalfOfId: string | null },
  userId: string,
): boolean {
  return expense.createdById === userId || expense.onBehalfOfId === userId;
}

export function assertMayDecide(
  expense: { createdById: string; onBehalfOfId: string | null },
  userId: string,
  permissions: Set<string>,
): void {
  if (isExpenseOwner(expense, userId) && !permissions.has('expense.approve_own')) {
    throw forbidden('You cannot approve or reject an expense raised by you or on your behalf.');
  }
}

export function isLocked(status: ExpenseStatus): boolean {
  return LOCKED_EXPENSE_STATUSES.includes(status);
}

export function assertEditable(status: ExpenseStatus): void {
  if (isLocked(status)) {
    throw new WorkflowError(
      `A ${EXPENSE_STATUS_LABELS[status]} expense cannot be edited directly. Create a revision or reopen it instead.`,
      { status },
    );
  }
  if (status === 'PENDING_APPROVAL' || status === 'SUBMITTED') {
    throw new WorkflowError(
      'This expense is awaiting approval. Recall it to draft before making changes.',
      { status },
    );
  }
}

export function assertDeletable(status: ExpenseStatus): void {
  if (status !== 'DRAFT' && status !== 'REJECTED') {
    throw new WorkflowError(
      `Only draft or rejected expenses can be deleted. This one is ${EXPENSE_STATUS_LABELS[status]}.`,
      { status },
    );
  }
}

export interface ExpenseAbility {
  canView: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canSubmit: boolean;
  canApprove: boolean;
  canReject: boolean;
  canPay: boolean;
  canRecall: boolean;
  canRevise: boolean;
  canDuplicate: boolean;
  canPostAccounting: boolean;
}

/**
 * The single place that decides which actions a user may take on an expense.
 * The UI renders from this, and every route re-checks it independently.
 */
export function abilitiesFor(
  status: ExpenseStatus,
  permissions: Set<string>,
  opts: { isOwner: boolean; paymentStatus: string },
): ExpenseAbility {
  const has = (p: Permission) => permissions.has(p);
  const editableStatus = status === 'DRAFT' || status === 'REJECTED';
  // Separation of duties: nobody decides on their own request unless their
  // role explicitly grants it (the Admin role does, by default).
  const mayDecide = !opts.isOwner || has('expense.approve_own');

  return {
    canView: has('expense.view'),
    canEdit: editableStatus && has('expense.edit'),
    canDelete: editableStatus && has('expense.delete'),
    canSubmit: status === 'DRAFT' && has('expense.submit'),
    canApprove: status === 'PENDING_APPROVAL' && has('expense.approve') && mayDecide,
    canReject: status === 'PENDING_APPROVAL' && has('expense.reject') && mayDecide,
    canPay:
      (status === 'APPROVED' || status === 'PAYMENT_PENDING') &&
      opts.paymentStatus !== 'PAID' &&
      has('expense.pay'),
    canRecall: (status === 'PENDING_APPROVAL' || status === 'SUBMITTED') && (opts.isOwner || has('expense.approve')),
    canRevise: isLocked(status) && status !== 'CANCELLED' && has('expense.edit') && has('expense.approve'),
    canDuplicate: has('expense.create'),
    canPostAccounting: status === 'PAID' && has('expense.pay'),
  };
}

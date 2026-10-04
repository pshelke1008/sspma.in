import { describe, expect, it } from 'vitest';
import { EXPENSE_TRANSITIONS, canTransition, type ExpenseStatus } from '@ashram/types';
import {
  abilitiesFor,
  assertMayDecide,
  isExpenseOwner,
  assertDeletable,
  assertEditable,
  assertTransition,
  assertTransitionPermission,
  isLocked,
} from '../../src/modules/expenses/expense.workflow';

const ALL: ExpenseStatus[] = [
  'DRAFT',
  'SUBMITTED',
  'PENDING_APPROVAL',
  'APPROVED',
  'REJECTED',
  'PAYMENT_PENDING',
  'PAID',
  'ACCOUNTING_POSTED',
  'CANCELLED',
];

describe('expense state machine', () => {
  it('walks the happy path end to end', () => {
    const path: ExpenseStatus[] = [
      'DRAFT',
      'SUBMITTED',
      'PENDING_APPROVAL',
      'APPROVED',
      'PAYMENT_PENDING',
      'PAID',
      'ACCOUNTING_POSTED',
    ];
    for (let i = 0; i < path.length - 1; i += 1) {
      expect(canTransition(path[i], path[i + 1])).toBe(true);
    }
  });

  it('refuses to send a paid expense back to draft', () => {
    expect(canTransition('PAID', 'DRAFT')).toBe(false);
    expect(() => assertTransition('PAID', 'DRAFT')).toThrow(/cannot move/i);
  });

  it('refuses to move out of terminal states', () => {
    expect(EXPENSE_TRANSITIONS.ACCOUNTING_POSTED).toHaveLength(0);
    expect(EXPENSE_TRANSITIONS.CANCELLED).toHaveLength(0);
    for (const target of ALL) {
      expect(canTransition('ACCOUNTING_POSTED', target)).toBe(false);
      expect(canTransition('CANCELLED', target)).toBe(false);
    }
  });

  it('rejects a no-op transition', () => {
    expect(() => assertTransition('APPROVED', 'APPROVED')).toThrow(/already/i);
  });

  it('allows a rejected expense to return to draft for correction', () => {
    expect(canTransition('REJECTED', 'DRAFT')).toBe(true);
  });

  it('never allows skipping approval on the way to payment', () => {
    expect(canTransition('DRAFT', 'PAID')).toBe(false);
    expect(canTransition('DRAFT', 'APPROVED')).toBe(false);
    expect(canTransition('PENDING_APPROVAL', 'PAID')).toBe(false);
  });

  it('lists every status in the transition table', () => {
    for (const status of ALL) {
      expect(EXPENSE_TRANSITIONS[status]).toBeDefined();
    }
  });
});

describe('transition permissions', () => {
  it('requires expense.approve to approve', () => {
    expect(() =>
      assertTransitionPermission('PENDING_APPROVAL', 'APPROVED', new Set(['expense.view'])),
    ).toThrow(/permission/i);

    expect(() =>
      assertTransitionPermission('PENDING_APPROVAL', 'APPROVED', new Set(['expense.approve'])),
    ).not.toThrow();
  });

  it('requires expense.pay to record a payment', () => {
    expect(() => assertTransitionPermission('APPROVED', 'PAID', new Set(['expense.approve']))).toThrow();
    expect(() => assertTransitionPermission('APPROVED', 'PAID', new Set(['expense.pay']))).not.toThrow();
  });
});

describe('edit and delete guards', () => {
  it('locks approved and settled records against in-place edits', () => {
    for (const status of ['APPROVED', 'PAYMENT_PENDING', 'PAID', 'ACCOUNTING_POSTED'] as ExpenseStatus[]) {
      expect(isLocked(status)).toBe(true);
      expect(() => assertEditable(status)).toThrow(/revision|reopen/i);
    }
  });

  it('blocks edits while an approval is pending', () => {
    expect(() => assertEditable('PENDING_APPROVAL')).toThrow(/recall/i);
  });

  it('allows editing drafts and rejected records', () => {
    expect(() => assertEditable('DRAFT')).not.toThrow();
    expect(() => assertEditable('REJECTED')).not.toThrow();
  });

  it('only allows deleting drafts and rejected records', () => {
    expect(() => assertDeletable('DRAFT')).not.toThrow();
    expect(() => assertDeletable('REJECTED')).not.toThrow();
    expect(() => assertDeletable('APPROVED')).toThrow();
    expect(() => assertDeletable('PAID')).toThrow();
  });
});

describe('abilities', () => {
  const approverPermissions = new Set(['expense.view', 'expense.approve', 'expense.reject']);

  it('stops a user approving their own request', () => {
    const own = abilitiesFor('PENDING_APPROVAL', approverPermissions, { isOwner: true, paymentStatus: 'UNPAID' });
    expect(own.canApprove).toBe(false);
    expect(own.canReject).toBe(false);

    const other = abilitiesFor('PENDING_APPROVAL', approverPermissions, { isOwner: false, paymentStatus: 'UNPAID' });
    expect(other.canApprove).toBe(true);
    expect(other.canReject).toBe(true);
  });

  it('lets a role holding expense.approve_own decide on its own request', () => {
    const admin = new Set(['expense.view', 'expense.approve', 'expense.reject', 'expense.approve_own']);
    const own = abilitiesFor('PENDING_APPROVAL', admin, { isOwner: true, paymentStatus: 'UNPAID' });
    expect(own.canApprove).toBe(true);
    expect(own.canReject).toBe(true);
  });

  it('hides the pay action once the expense is fully paid', () => {
    const paid = abilitiesFor('APPROVED', new Set(['expense.pay']), { isOwner: false, paymentStatus: 'PAID' });
    expect(paid.canPay).toBe(false);

    const unpaid = abilitiesFor('APPROVED', new Set(['expense.pay']), { isOwner: false, paymentStatus: 'UNPAID' });
    expect(unpaid.canPay).toBe(true);
  });

  it('offers a revision instead of an edit on locked records', () => {
    const abilities = abilitiesFor('ACCOUNTING_POSTED', new Set(['expense.edit', 'expense.approve']), {
      isOwner: false,
      paymentStatus: 'PAID',
    });
    expect(abilities.canEdit).toBe(false);
    expect(abilities.canRevise).toBe(true);
  });
});

describe('separation of duties', () => {
  const raisedByAdminForAccountant = { createdById: 'admin', onBehalfOfId: 'accountant' };

  it('treats both the person who keyed it in and the person it was raised for as owners', () => {
    expect(isExpenseOwner(raisedByAdminForAccountant, 'admin')).toBe(true);
    expect(isExpenseOwner(raisedByAdminForAccountant, 'accountant')).toBe(true);
    expect(isExpenseOwner(raisedByAdminForAccountant, 'approver')).toBe(false);
  });

  it('refuses an owner without expense.approve_own', () => {
    const approver = new Set(['expense.approve', 'expense.reject']);
    expect(() => assertMayDecide(raisedByAdminForAccountant, 'accountant', approver)).toThrow(/raised by you/i);
    expect(() => assertMayDecide(raisedByAdminForAccountant, 'admin', approver)).toThrow();
    expect(() => assertMayDecide(raisedByAdminForAccountant, 'approver', approver)).not.toThrow();
  });

  it('allows an owner holding expense.approve_own', () => {
    const admin = new Set(['expense.approve', 'expense.approve_own']);
    expect(() => assertMayDecide(raisedByAdminForAccountant, 'admin', admin)).not.toThrow();
  });
});

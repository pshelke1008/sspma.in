import { Prisma, type ExpenseStatus as PrismaExpenseStatus } from '@prisma/client';
import type { Request } from 'express';
import type { ExpenseStatus } from '@ashram/types';
import { prisma, type Tx } from '../../db';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { AUDIT_ACTIONS, recordAudit } from '../../lib/audit';
import { notify, usersWithPermission } from '../../lib/notifications';
import { computeTotals, decimal, round2, toNumber } from '../../lib/money';
import { nextNumber } from '../../lib/sequence';
import { postJournal, resolveCreditAccountId, resolveExpenseAccountId } from '../../lib/accounting';
import type { AuthContext } from '../../middleware/auth';
import { forbidden } from '../../lib/errors';
import {
  abilitiesFor,
  assertMayDecide,
  isExpenseOwner,
  assertDeletable,
  assertEditable,
  assertTransition,
  assertTransitionPermission,
} from './expense.workflow';
import type { CreateExpenseInput, ListExpensesQuery } from './expense.schema';

const detailInclude = {
  department: true,
  fund: true,
  costCenter: true,
  category: { include: { account: true } },
  supplier: true,
  createdBy: { select: { id: true, name: true, email: true, designation: true } },
  onBehalfOf: { select: { id: true, name: true, email: true, designation: true } },
  approvedBy: { select: { id: true, name: true, email: true, designation: true } },
  items: { orderBy: { sortOrder: 'asc' } },
  payments: {
    orderBy: { date: 'desc' },
    include: {
      bankAccount: true,
      createdBy: { select: { id: true, name: true } },
    },
  },
  attachments: {
    orderBy: { createdAt: 'desc' },
    include: { uploadedBy: { select: { id: true, name: true } } },
  },
  approvals: {
    orderBy: { requestedAt: 'desc' },
    include: {
      requestedBy: { select: { id: true, name: true, designation: true } },
      actor: { select: { id: true, name: true, designation: true } },
    },
  },
  transactions: { include: { lines: { include: { account: true } } }, orderBy: { date: 'desc' } },
} satisfies Prisma.ExpenseInclude;

const listSelect = {
  id: true,
  expenseNumber: true,
  date: true,
  title: true,
  total: true,
  paidAmount: true,
  status: true,
  paymentStatus: true,
  createdAt: true,
  department: { select: { id: true, name: true, code: true } },
  fund: { select: { id: true, name: true, code: true } },
  category: { select: { id: true, name: true } },
  supplier: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  onBehalfOf: { select: { id: true, name: true } },
} satisfies Prisma.ExpenseSelect;

/** Every read and write starts from the caller's organizationId. */
function scope(organizationId: string) {
  return { organizationId };
}

/**
 * Raising an expense for someone else needs its own permission, and the person
 * named must be an active user in the same organization.
 */
async function resolveOnBehalfOf(
  tx: Tx,
  auth: AuthContext,
  onBehalfOfId: string | null | undefined,
): Promise<string | null> {
  if (!onBehalfOfId || onBehalfOfId === auth.userId) return null;
  if (!auth.permissions.has('expense.create_on_behalf')) {
    throw forbidden('You do not have permission to raise expenses on behalf of other users.');
  }
  const user = await tx.user.findFirst({
    where: { id: onBehalfOfId, organizationId: auth.organizationId, isActive: true },
    select: { id: true },
  });
  if (!user) throw badRequest('The selected user is not an active member of this organization.');
  return user.id;
}

async function assertMastersBelongToOrg(tx: Tx, organizationId: string, input: CreateExpenseInput) {
  const [department, fund, category, costCenter, supplier, bankAccount] = await Promise.all([
    tx.department.findFirst({ where: { id: input.departmentId, organizationId }, select: { id: true } }),
    tx.fund.findFirst({ where: { id: input.fundId, organizationId }, select: { id: true } }),
    tx.expenseCategory.findFirst({ where: { id: input.categoryId, organizationId }, select: { id: true } }),
    input.costCenterId
      ? tx.costCenter.findFirst({ where: { id: input.costCenterId, organizationId }, select: { id: true } })
      : Promise.resolve(null),
    input.supplierId
      ? tx.supplier.findFirst({ where: { id: input.supplierId, organizationId }, select: { id: true } })
      : Promise.resolve(null),
    input.paymentAccountId
      ? tx.bankAccount.findFirst({ where: { id: input.paymentAccountId, organizationId }, select: { id: true } })
      : Promise.resolve(null),
  ]);

  if (!department) throw badRequest('Selected department is not available in this organization');
  if (!fund) throw badRequest('Selected fund is not available in this organization');
  if (!category) throw badRequest('Selected expense category is not available in this organization');
  if (input.costCenterId && !costCenter) throw badRequest('Selected cost center is not available');
  if (input.supplierId && !supplier) throw badRequest('Selected supplier is not available');
  if (input.paymentAccountId && !bankAccount) throw badRequest('Selected payment account is not available');
}

function itemRows(items: CreateExpenseInput['items']) {
  const totals = computeTotals(items);
  return {
    totals,
    rows: items.map((item, index) => ({
      description: item.description,
      quantity: new Prisma.Decimal(item.quantity),
      unit: item.unit,
      rate: decimal(item.rate),
      taxRate: new Prisma.Decimal(item.taxRate),
      taxAmount: decimal(totals.lines[index].taxAmount),
      amount: decimal(totals.lines[index].amount),
      sortOrder: index,
    })),
  };
}

// ----------------------------- Queries -------------------------------------

export async function listExpenses(organizationId: string, query: ListExpensesQuery, userId: string) {
  const where: Prisma.ExpenseWhereInput = {
    ...scope(organizationId),
    ...(query.status?.length ? { status: { in: query.status as PrismaExpenseStatus[] } } : {}),
    ...(query.departmentId ? { departmentId: query.departmentId } : {}),
    ...(query.fundId ? { fundId: query.fundId } : {}),
    ...(query.categoryId ? { categoryId: query.categoryId } : {}),
    ...(query.supplierId ? { supplierId: query.supplierId } : {}),
    ...(query.paymentStatus ? { paymentStatus: query.paymentStatus } : {}),
    ...(query.mine ? { OR: [{ createdById: userId }, { onBehalfOfId: userId }] } : {}),
    ...(query.from || query.to
      ? { date: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } }
      : {}),
    ...(query.minAmount !== undefined || query.maxAmount !== undefined
      ? {
          total: {
            ...(query.minAmount !== undefined ? { gte: decimal(query.minAmount) } : {}),
            ...(query.maxAmount !== undefined ? { lte: decimal(query.maxAmount) } : {}),
          },
        }
      : {}),
    ...(query.search
      ? {
          OR: [
            { expenseNumber: { contains: query.search, mode: 'insensitive' } },
            { title: { contains: query.search, mode: 'insensitive' } },
            { description: { contains: query.search, mode: 'insensitive' } },
            { referenceNumber: { contains: query.search, mode: 'insensitive' } },
            { supplier: { name: { contains: query.search, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };

  const skip = (query.page - 1) * query.pageSize;

  const [rows, total, aggregate] = await Promise.all([
    prisma.expense.findMany({
      where,
      select: listSelect,
      orderBy: { [query.sortBy]: query.sortDir },
      skip,
      take: query.pageSize,
    }),
    prisma.expense.count({ where }),
    prisma.expense.aggregate({ where, _sum: { total: true, paidAmount: true } }),
  ]);

  return {
    data: rows.map((row) => ({
      ...row,
      total: toNumber(row.total),
      paidAmount: toNumber(row.paidAmount),
    })),
    meta: {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      totalAmount: toNumber(aggregate._sum.total),
      paidAmount: toNumber(aggregate._sum.paidAmount),
    },
  };
}

export async function getExpense(organizationId: string, id: string, auth: AuthContext) {
  const expense = await prisma.expense.findFirst({
    where: { id, ...scope(organizationId) },
    include: detailInclude,
  });
  if (!expense) throw notFound('Expense not found');
  return serializeExpense(expense, auth);
}

export function serializeExpense(
  expense: Prisma.ExpenseGetPayload<{ include: typeof detailInclude }>,
  auth: AuthContext,
) {
  return {
    ...expense,
    subtotal: toNumber(expense.subtotal),
    tax: toNumber(expense.tax),
    total: toNumber(expense.total),
    paidAmount: toNumber(expense.paidAmount),
    balanceDue: round2(toNumber(expense.total) - toNumber(expense.paidAmount)),
    items: expense.items.map((item) => ({
      ...item,
      quantity: toNumber(item.quantity),
      rate: toNumber(item.rate),
      taxRate: toNumber(item.taxRate),
      taxAmount: toNumber(item.taxAmount),
      amount: toNumber(item.amount),
    })),
    payments: expense.payments.map((payment) => ({ ...payment, amount: toNumber(payment.amount) })),
    transactions: expense.transactions.map((transaction) => ({
      ...transaction,
      amount: toNumber(transaction.amount),
      lines: transaction.lines.map((line) => ({
        ...line,
        debit: toNumber(line.debit),
        credit: toNumber(line.credit),
      })),
    })),
    abilities: abilitiesFor(expense.status as ExpenseStatus, auth.permissions, {
      isOwner: isExpenseOwner(expense, auth.userId),
      paymentStatus: expense.paymentStatus,
    }),
  };
}

export async function getActivity(organizationId: string, expenseId: string) {
  const expense = await prisma.expense.findFirst({
    where: { id: expenseId, ...scope(organizationId) },
    select: { id: true },
  });
  if (!expense) throw notFound('Expense not found');

  return prisma.auditLog.findMany({
    where: { organizationId, entityType: 'Expense', entityId: expenseId },
    orderBy: { timestamp: 'desc' },
    include: { user: { select: { id: true, name: true, designation: true } } },
    take: 100,
  });
}

// ----------------------------- Commands ------------------------------------

export async function createExpense(auth: AuthContext, input: CreateExpenseInput, req: Request) {
  const { organizationId, userId } = auth;

  const expense = await prisma.$transaction(async (tx) => {
    await assertMastersBelongToOrg(tx, organizationId, input);
    const onBehalfOfId = await resolveOnBehalfOf(tx, auth, input.onBehalfOfId);
    const { totals, rows } = itemRows(input.items);
    const expenseNumber = await nextNumber(tx, organizationId, 'EXPENSE', input.date);

    return tx.expense.create({
      data: {
        organizationId,
        expenseNumber,
        date: input.date,
        title: input.title,
        departmentId: input.departmentId,
        fundId: input.fundId,
        costCenterId: input.costCenterId ?? null,
        categoryId: input.categoryId,
        supplierId: input.supplierId ?? null,
        subtotal: decimal(totals.subtotal),
        tax: decimal(totals.tax),
        total: decimal(totals.total),
        status: 'DRAFT',
        paymentStatus: 'UNPAID',
        payImmediately: input.payImmediately,
        paymentMethod: input.payImmediately ? input.paymentMethod ?? null : null,
        paymentAccountId: input.payImmediately ? input.paymentAccountId ?? null : null,
        referenceNumber: input.payImmediately ? input.referenceNumber ?? null : null,
        paymentDate: input.payImmediately ? input.paymentDate ?? input.date : null,
        description: input.description ?? null,
        notes: input.notes ?? null,
        createdById: userId,
        onBehalfOfId,
        items: { create: rows },
      },
      include: detailInclude,
    });
  });

  await recordAudit({
    organizationId,
    userId,
    action: AUDIT_ACTIONS.EXPENSE_CREATED,
    entityType: 'Expense',
    entityId: expense.id,
    entityLabel: expense.expenseNumber,
    newValue: {
      status: expense.status,
      total: toNumber(expense.total),
      title: expense.title,
      onBehalfOf: expense.onBehalfOf?.name ?? null,
    },
    req,
  });

  if (expense.onBehalfOfId) {
    await notify({
      organizationId,
      userIds: [expense.onBehalfOfId],
      type: 'SYSTEM',
      title: 'Expense raised on your behalf',
      message: `${auth.name} raised ${expense.expenseNumber} — ${expense.title} for you.`,
      link: `/expenses/${expense.id}`,
      entityType: 'Expense',
      entityId: expense.id,
    });
  }

  return serializeExpense(expense, auth);
}

export async function updateExpense(auth: AuthContext, id: string, input: CreateExpenseInput, req: Request) {
  const { organizationId, userId } = auth;

  const existing = await prisma.expense.findFirst({
    where: { id, ...scope(organizationId) },
    include: { items: true },
  });
  if (!existing) throw notFound('Expense not found');
  assertEditable(existing.status as ExpenseStatus);

  const updated = await prisma.$transaction(async (tx) => {
    await assertMastersBelongToOrg(tx, organizationId, input);
    // Keep the existing assignment unless the caller explicitly changes it.
    const onBehalfOfId =
      input.onBehalfOfId === undefined
        ? existing.onBehalfOfId
        : await resolveOnBehalfOf(tx, auth, input.onBehalfOfId);
    const { totals, rows } = itemRows(input.items);

    await tx.expenseItem.deleteMany({ where: { expenseId: id } });

    return tx.expense.update({
      where: { id },
      data: {
        date: input.date,
        title: input.title,
        departmentId: input.departmentId,
        fundId: input.fundId,
        costCenterId: input.costCenterId ?? null,
        categoryId: input.categoryId,
        supplierId: input.supplierId ?? null,
        subtotal: decimal(totals.subtotal),
        tax: decimal(totals.tax),
        total: decimal(totals.total),
        payImmediately: input.payImmediately,
        paymentMethod: input.payImmediately ? input.paymentMethod ?? null : null,
        paymentAccountId: input.payImmediately ? input.paymentAccountId ?? null : null,
        referenceNumber: input.payImmediately ? input.referenceNumber ?? null : null,
        paymentDate: input.payImmediately ? input.paymentDate ?? input.date : null,
        description: input.description ?? null,
        notes: input.notes ?? null,
        onBehalfOfId,
        // A rejected expense returns to draft the moment it is corrected.
        status: existing.status === 'REJECTED' ? 'DRAFT' : existing.status,
        rejectionReason: existing.status === 'REJECTED' ? null : existing.rejectionReason,
        items: { create: rows },
      },
      include: detailInclude,
    });
  });

  await recordAudit({
    organizationId,
    userId,
    action: AUDIT_ACTIONS.EXPENSE_UPDATED,
    entityType: 'Expense',
    entityId: id,
    entityLabel: updated.expenseNumber,
    oldValue: { total: toNumber(existing.total), title: existing.title, status: existing.status },
    newValue: { total: toNumber(updated.total), title: updated.title, status: updated.status },
    req,
  });

  return serializeExpense(updated, auth);
}

export async function deleteExpense(auth: AuthContext, id: string, req: Request) {
  const expense = await prisma.expense.findFirst({ where: { id, ...scope(auth.organizationId) } });
  if (!expense) throw notFound('Expense not found');
  assertDeletable(expense.status as ExpenseStatus);

  await prisma.expense.delete({ where: { id } });

  await recordAudit({
    organizationId: auth.organizationId,
    userId: auth.userId,
    action: AUDIT_ACTIONS.EXPENSE_DELETED,
    entityType: 'Expense',
    entityId: id,
    entityLabel: expense.expenseNumber,
    oldValue: { status: expense.status, total: toNumber(expense.total) },
    req,
  });

  return { success: true };
}

export async function submitExpense(auth: AuthContext, id: string, comments: string | undefined, req: Request) {
  const { organizationId, userId } = auth;

  const result = await prisma.$transaction(async (tx) => {
    const expense = await tx.expense.findFirst({
      where: { id, ...scope(organizationId) },
      include: { items: true },
    });
    if (!expense) throw notFound('Expense not found');
    if (expense.items.length === 0) throw badRequest('Add at least one line item before submitting');
    if (toNumber(expense.total) <= 0) throw badRequest('Expense total must be greater than zero');

    const from = expense.status as ExpenseStatus;
    // Two real hops: DRAFT → SUBMITTED, then SUBMITTED → PENDING_APPROVAL as
    // the approval request is raised.
    assertTransition(from, 'SUBMITTED');
    assertTransitionPermission(from, 'SUBMITTED', auth.permissions);
    assertTransition('SUBMITTED', 'PENDING_APPROVAL');

    const submittedAt = new Date();
    const updated = await tx.expense.update({
      where: { id },
      data: { status: 'PENDING_APPROVAL', submittedAt, rejectionReason: null },
      include: detailInclude,
    });

    await tx.approval.create({
      data: {
        organizationId,
        expenseId: id,
        level: 1,
        decision: 'PENDING',
        requestedById: userId,
        comments: comments ?? null,
      },
    });

    return updated;
  });

  const approvers = await usersWithPermission(organizationId, 'expense.approve');
  await notify({
    organizationId,
    userIds: approvers.filter((approverId) => approverId !== userId && approverId !== result.onBehalfOfId),
    type: 'EXPENSE_SUBMITTED',
    title: 'Expense submitted for approval',
    message: `${result.expenseNumber} — ${result.title} for ₹${toNumber(result.total).toLocaleString('en-IN')} needs your approval.`,
    link: `/expenses/${result.id}`,
    entityType: 'Expense',
    entityId: result.id,
  });

  await recordAudit({
    organizationId,
    userId,
    action: AUDIT_ACTIONS.EXPENSE_SUBMITTED,
    entityType: 'Expense',
    entityId: id,
    entityLabel: result.expenseNumber,
    newValue: { status: 'PENDING_APPROVAL', comments: comments ?? null },
    req,
  });

  return serializeExpense(result, auth);
}

export async function recallExpense(auth: AuthContext, id: string, req: Request) {
  const { organizationId, userId } = auth;

  const result = await prisma.$transaction(async (tx) => {
    const expense = await tx.expense.findFirst({ where: { id, ...scope(organizationId) } });
    if (!expense) throw notFound('Expense not found');

    const isOwner = isExpenseOwner(expense, userId);
    if (!isOwner && !auth.permissions.has('expense.approve')) {
      throw conflict('Only the person who raised this expense can recall it');
    }
    assertTransition(expense.status as ExpenseStatus, 'DRAFT');

    await tx.approval.updateMany({
      where: { expenseId: id, decision: 'PENDING' },
      data: { decision: 'REJECTED', comments: 'Recalled by requester', decidedAt: new Date(), actorId: userId },
    });

    return tx.expense.update({
      where: { id },
      data: { status: 'DRAFT', submittedAt: null },
      include: detailInclude,
    });
  });

  await recordAudit({
    organizationId,
    userId,
    action: AUDIT_ACTIONS.EXPENSE_UPDATED,
    entityType: 'Expense',
    entityId: id,
    entityLabel: result.expenseNumber,
    newValue: { status: 'DRAFT', reason: 'recalled' },
    req,
  });

  return serializeExpense(result, auth);
}

export async function approveExpense(auth: AuthContext, id: string, comments: string | undefined, req: Request) {
  const { organizationId, userId } = auth;

  const result = await prisma.$transaction(async (tx) => {
    const expense = await tx.expense.findFirst({ where: { id, ...scope(organizationId) } });
    if (!expense) throw notFound('Expense not found');

    // Separation of duties, unless the role is explicitly trusted to approve its own.
    assertMayDecide(expense, userId, auth.permissions);

    const from = expense.status as ExpenseStatus;
    assertTransition(from, 'APPROVED');
    assertTransitionPermission(from, 'APPROVED', auth.permissions);

    const approvedAt = new Date();

    await tx.approval.updateMany({
      where: { expenseId: id, decision: 'PENDING' },
      data: { decision: 'APPROVED', actorId: userId, comments: comments ?? null, decidedAt: approvedAt },
    });

    return tx.expense.update({
      where: { id },
      data: {
        status: 'APPROVED',
        approvedById: userId,
        approvedAt,
        rejectionReason: null,
      },
      include: detailInclude,
    });
  });

  await notify({
    organizationId,
    userIds: [result.createdById, result.onBehalfOfId].filter((id): id is string => Boolean(id) && id !== userId),
    type: 'EXPENSE_APPROVED',
    title: 'Expense approved',
    message: `${result.expenseNumber} — ${result.title} was approved by ${auth.name}.`,
    link: `/expenses/${result.id}`,
    entityType: 'Expense',
    entityId: result.id,
  });

  await recordAudit({
    organizationId,
    userId,
    action: AUDIT_ACTIONS.EXPENSE_APPROVED,
    entityType: 'Expense',
    entityId: id,
    entityLabel: result.expenseNumber,
    oldValue: { status: 'PENDING_APPROVAL' },
    newValue: { status: 'APPROVED', comments: comments ?? null },
    req,
  });

  // An entry captured as "already paid" settles itself the moment it clears
  // approval, provided the approver may record payments.
  if (result.payImmediately && result.paymentMethod && auth.permissions.has('expense.pay')) {
    return recordPayment(
      auth,
      id,
      {
        amount: toNumber(result.total),
        method: result.paymentMethod,
        bankAccountId: result.paymentAccountId,
        referenceNumber: result.referenceNumber,
        paymentDate: result.paymentDate ?? new Date(),
        notes: 'Auto-settled: expense was recorded as already paid.',
      },
      req,
    );
  }

  return serializeExpense(result, auth);
}

export async function rejectExpense(auth: AuthContext, id: string, reason: string, req: Request) {
  const { organizationId, userId } = auth;

  const result = await prisma.$transaction(async (tx) => {
    const expense = await tx.expense.findFirst({ where: { id, ...scope(organizationId) } });
    if (!expense) throw notFound('Expense not found');

    assertMayDecide(expense, userId, auth.permissions);

    const from = expense.status as ExpenseStatus;
    assertTransition(from, 'REJECTED');
    assertTransitionPermission(from, 'REJECTED', auth.permissions);

    const decidedAt = new Date();
    await tx.approval.updateMany({
      where: { expenseId: id, decision: 'PENDING' },
      data: { decision: 'REJECTED', actorId: userId, comments: reason, decidedAt },
    });

    return tx.expense.update({
      where: { id },
      data: { status: 'REJECTED', rejectionReason: reason },
      include: detailInclude,
    });
  });

  await notify({
    organizationId,
    userIds: [result.createdById, result.onBehalfOfId].filter((id): id is string => Boolean(id) && id !== userId),
    type: 'EXPENSE_REJECTED',
    title: 'Expense rejected',
    message: `${result.expenseNumber} — ${result.title} was rejected: ${reason}`,
    link: `/expenses/${result.id}`,
    entityType: 'Expense',
    entityId: result.id,
  });

  await recordAudit({
    organizationId,
    userId,
    action: AUDIT_ACTIONS.EXPENSE_REJECTED,
    entityType: 'Expense',
    entityId: id,
    entityLabel: result.expenseNumber,
    oldValue: { status: 'PENDING_APPROVAL' },
    newValue: { status: 'REJECTED', reason },
    req,
  });

  return serializeExpense(result, auth);
}

export interface PayInput {
  amount: number;
  method: 'CASH' | 'BANK_TRANSFER' | 'UPI' | 'CHEQUE' | 'OTHER';
  bankAccountId?: string | null;
  referenceNumber?: string | null;
  paymentDate: Date;
  notes?: string | null;
}

export async function recordPayment(auth: AuthContext, id: string, input: PayInput, req: Request) {
  const { organizationId, userId } = auth;

  const result = await prisma.$transaction(async (tx) => {
    const expense = await tx.expense.findFirst({
      where: { id, ...scope(organizationId) },
      include: { category: true },
    });
    if (!expense) throw notFound('Expense not found');

    const from = expense.status as ExpenseStatus;
    if (from !== 'APPROVED' && from !== 'PAYMENT_PENDING') {
      assertTransition(from, 'PAID');
    }
    assertTransitionPermission(from, 'PAID', auth.permissions);

    const total = toNumber(expense.total);
    const alreadyPaid = toNumber(expense.paidAmount);
    const balance = round2(total - alreadyPaid);

    if (balance <= 0) throw conflict('This expense is already fully paid');
    if (input.amount > balance + 0.009) {
      throw badRequest(`Payment of ₹${input.amount} exceeds the outstanding balance of ₹${balance}`);
    }

    if (input.bankAccountId) {
      const account = await tx.bankAccount.findFirst({
        where: { id: input.bankAccountId, organizationId },
        select: { id: true },
      });
      if (!account) throw badRequest('Selected payment account is not available in this organization');
    }

    const paymentNumber = await nextNumber(tx, organizationId, 'PAYMENT', input.paymentDate);
    await tx.payment.create({
      data: {
        organizationId,
        paymentNumber,
        expenseId: id,
        date: input.paymentDate,
        amount: decimal(input.amount),
        method: input.method,
        bankAccountId: input.bankAccountId ?? null,
        referenceNumber: input.referenceNumber ?? null,
        notes: input.notes ?? null,
        createdById: userId,
      },
    });

    const paidAmount = round2(alreadyPaid + input.amount);
    const fullyPaid = paidAmount >= total - 0.009;

    const updated = await tx.expense.update({
      where: { id },
      data: {
        paidAmount: decimal(paidAmount),
        paymentStatus: fullyPaid ? 'PAID' : 'PARTIAL',
        status: fullyPaid ? 'PAID' : 'PAYMENT_PENDING',
        paymentMethod: input.method,
        paymentAccountId: input.bankAccountId ?? null,
        referenceNumber: input.referenceNumber ?? expense.referenceNumber,
        paymentDate: input.paymentDate,
      },
      include: detailInclude,
    });

    // Fully settled expenses post to the ledger straight away.
    if (fullyPaid) {
      await postExpenseJournal(tx, updated.id, organizationId, userId);
      return tx.expense.update({
        where: { id },
        data: { status: 'ACCOUNTING_POSTED' },
        include: detailInclude,
      });
    }

    return updated;
  });

  await notify({
    organizationId,
    userIds: [result.createdById, result.onBehalfOfId, result.approvedById].filter(
      (id): id is string => Boolean(id) && id !== userId,
    ),
    type: 'PAYMENT_RECORDED',
    title: 'Payment recorded',
    message: `₹${input.amount.toLocaleString('en-IN')} paid against ${result.expenseNumber} — ${result.title}.`,
    link: `/expenses/${result.id}`,
    entityType: 'Expense',
    entityId: result.id,
  });

  await recordAudit({
    organizationId,
    userId,
    action: AUDIT_ACTIONS.PAYMENT_RECORDED,
    entityType: 'Expense',
    entityId: id,
    entityLabel: result.expenseNumber,
    newValue: {
      amount: input.amount,
      method: input.method,
      reference: input.referenceNumber ?? null,
      paymentStatus: result.paymentStatus,
      status: result.status,
    },
    req,
  });

  if (result.status === 'ACCOUNTING_POSTED') {
    await recordAudit({
      organizationId,
      userId,
      action: AUDIT_ACTIONS.ACCOUNTING_POSTED,
      entityType: 'Expense',
      entityId: id,
      entityLabel: result.expenseNumber,
      newValue: { status: 'ACCOUNTING_POSTED' },
      req,
    });
  }

  return serializeExpense(result, auth);
}

/** Dr expense ledger / Cr the account the money actually left. */
async function postExpenseJournal(tx: Tx, expenseId: string, organizationId: string, userId: string) {
  const expense = await tx.expense.findFirstOrThrow({
    where: { id: expenseId, organizationId },
    include: { category: true, department: true, fund: true, payments: true },
  });

  const existing = await tx.transaction.findFirst({
    where: { organizationId, sourceType: 'Expense', sourceId: expenseId, isReversal: false },
  });
  if (existing) return existing;

  const debitAccountId = await resolveExpenseAccountId(tx, organizationId, expense.categoryId);
  const lastPayment = expense.payments[expense.payments.length - 1];
  const credit = await resolveCreditAccountId(tx, organizationId, lastPayment?.bankAccountId ?? null);
  const amount = toNumber(expense.total);

  return postJournal(tx, {
    organizationId,
    date: expense.paymentDate ?? expense.date,
    type: 'EXPENSE',
    narration: `${expense.expenseNumber} — ${expense.title}`,
    sourceType: 'Expense',
    sourceId: expense.id,
    expenseId: expense.id,
    createdById: userId,
    lines: [
      {
        accountId: debitAccountId,
        debit: amount,
        description: `${expense.category.name} — ${expense.department.name}`,
        fundId: expense.fundId,
        departmentId: expense.departmentId,
      },
      {
        accountId: credit.accountId,
        credit: amount,
        description: `Paid for ${expense.expenseNumber}`,
        fundId: expense.fundId,
        departmentId: expense.departmentId,
      },
    ],
  });
}

export async function postAccounting(auth: AuthContext, id: string, req: Request) {
  const { organizationId, userId } = auth;

  const result = await prisma.$transaction(async (tx) => {
    const expense = await tx.expense.findFirst({ where: { id, ...scope(organizationId) } });
    if (!expense) throw notFound('Expense not found');

    const from = expense.status as ExpenseStatus;
    assertTransition(from, 'ACCOUNTING_POSTED');
    assertTransitionPermission(from, 'ACCOUNTING_POSTED', auth.permissions);

    await postExpenseJournal(tx, id, organizationId, userId);
    return tx.expense.update({ where: { id }, data: { status: 'ACCOUNTING_POSTED' }, include: detailInclude });
  });

  await recordAudit({
    organizationId,
    userId,
    action: AUDIT_ACTIONS.ACCOUNTING_POSTED,
    entityType: 'Expense',
    entityId: id,
    entityLabel: result.expenseNumber,
    newValue: { status: 'ACCOUNTING_POSTED' },
    req,
  });

  return serializeExpense(result, auth);
}

/**
 * Approved and posted records are never edited in place. Reopening reverses the
 * ledger entry and opens a numbered revision that goes through approval again.
 */
export async function reviseExpense(auth: AuthContext, id: string, reason: string, req: Request) {
  const { organizationId, userId } = auth;

  const result = await prisma.$transaction(async (tx) => {
    const expense = await tx.expense.findFirst({
      where: { id, ...scope(organizationId) },
      include: { items: true, transactions: { include: { lines: true } } },
    });
    if (!expense) throw notFound('Expense not found');

    if (!['APPROVED', 'PAYMENT_PENDING', 'PAID', 'ACCOUNTING_POSTED'].includes(expense.status)) {
      throw conflict('Only approved or settled expenses need a revision — edit this one directly.');
    }

    // Reverse every posted voucher so the ledger stays balanced.
    for (const transaction of expense.transactions) {
      if (transaction.isReversal) continue;
      const alreadyReversed = await tx.transaction.findFirst({
        where: { organizationId, reversedFromId: transaction.id },
      });
      if (alreadyReversed) continue;

      const voucherNumber = await nextNumber(tx, organizationId, 'VOUCHER', new Date());
      await tx.transaction.create({
        data: {
          organizationId,
          voucherNumber,
          date: new Date(),
          type: 'JOURNAL',
          narration: `Reversal of ${transaction.voucherNumber} — ${reason}`,
          amount: transaction.amount,
          sourceType: 'Expense',
          sourceId: expense.id,
          // Linked to the same expense so the Accounting tab shows the original
          // voucher and its reversal side by side.
          expenseId: expense.id,
          isReversal: true,
          reversedFromId: transaction.id,
          createdById: userId,
          lines: {
            create: transaction.lines.map((line) => ({
              accountId: line.accountId,
              debit: line.credit,
              credit: line.debit,
              description: `Reversal — ${line.description ?? ''}`.trim(),
              fundId: line.fundId,
              departmentId: line.departmentId,
            })),
          },
        },
      });
    }

    const expenseNumber = await nextNumber(tx, organizationId, 'EXPENSE', new Date());

    return tx.expense.create({
      data: {
        organizationId,
        expenseNumber,
        date: expense.date,
        title: expense.title,
        departmentId: expense.departmentId,
        fundId: expense.fundId,
        costCenterId: expense.costCenterId,
        categoryId: expense.categoryId,
        supplierId: expense.supplierId,
        subtotal: expense.subtotal,
        tax: expense.tax,
        total: expense.total,
        status: 'DRAFT',
        paymentStatus: 'UNPAID',
        description: expense.description,
        notes: `Revision of ${expense.expenseNumber}. Reason: ${reason}`,
        revisionOf: expense.id,
        revisionNumber: expense.revisionNumber + 1,
        createdById: userId,
        onBehalfOfId: expense.onBehalfOfId,
        items: {
          create: expense.items.map((item, index) => ({
            description: item.description,
            quantity: item.quantity,
            unit: item.unit,
            rate: item.rate,
            taxRate: item.taxRate,
            taxAmount: item.taxAmount,
            amount: item.amount,
            sortOrder: index,
          })),
        },
      },
      include: detailInclude,
    });
  });

  await recordAudit({
    organizationId,
    userId,
    action: AUDIT_ACTIONS.EXPENSE_REVISED,
    entityType: 'Expense',
    entityId: id,
    entityLabel: result.expenseNumber,
    newValue: { revisionOf: id, revisionNumber: result.revisionNumber, reason },
    req,
  });

  return serializeExpense(result, auth);
}

export async function duplicateExpense(auth: AuthContext, id: string, req: Request) {
  const { organizationId, userId } = auth;

  const result = await prisma.$transaction(async (tx) => {
    const source = await tx.expense.findFirst({
      where: { id, ...scope(organizationId) },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!source) throw notFound('Expense not found');

    const expenseNumber = await nextNumber(tx, organizationId, 'EXPENSE', new Date());
    return tx.expense.create({
      data: {
        organizationId,
        expenseNumber,
        date: new Date(),
        title: source.title,
        departmentId: source.departmentId,
        fundId: source.fundId,
        costCenterId: source.costCenterId,
        categoryId: source.categoryId,
        supplierId: source.supplierId,
        subtotal: source.subtotal,
        tax: source.tax,
        total: source.total,
        status: 'DRAFT',
        paymentStatus: 'UNPAID',
        description: source.description,
        notes: source.notes,
        createdById: userId,
        onBehalfOfId: source.onBehalfOfId,
        items: {
          create: source.items.map((item, index) => ({
            description: item.description,
            quantity: item.quantity,
            unit: item.unit,
            rate: item.rate,
            taxRate: item.taxRate,
            taxAmount: item.taxAmount,
            amount: item.amount,
            sortOrder: index,
          })),
        },
      },
      include: detailInclude,
    });
  });

  await recordAudit({
    organizationId,
    userId,
    action: AUDIT_ACTIONS.EXPENSE_CREATED,
    entityType: 'Expense',
    entityId: result.id,
    entityLabel: result.expenseNumber,
    newValue: { duplicatedFrom: id },
    req,
  });

  return serializeExpense(result, auth);
}

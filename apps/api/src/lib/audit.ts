import type { Request } from 'express';
import { prisma } from '../db';
import type { Tx } from '../db';

export const AUDIT_ACTIONS = {
  LOGIN: 'user.login',
  LOGOUT: 'user.logout',
  LOGIN_FAILED: 'user.login_failed',
  EXPENSE_CREATED: 'expense.created',
  EXPENSE_UPDATED: 'expense.updated',
  EXPENSE_DELETED: 'expense.deleted',
  EXPENSE_SUBMITTED: 'expense.submitted',
  EXPENSE_APPROVED: 'expense.approved',
  EXPENSE_REJECTED: 'expense.rejected',
  EXPENSE_REVISED: 'expense.revised',
  EXPENSE_REOPENED: 'expense.reopened',
  PAYMENT_RECORDED: 'payment.recorded',
  ACCOUNTING_POSTED: 'accounting.posted',
  SUPPLIER_CREATED: 'supplier.created',
  SUPPLIER_UPDATED: 'supplier.updated',
  DONATION_CREATED: 'donation.created',
  DONOR_CREATED: 'donor.created',
  DONOR_UPDATED: 'donor.updated',
  DONOR_DEACTIVATED: 'donor.deactivated',
  WHATSAPP_CONNECTED: 'whatsapp.connected',
  WHATSAPP_DISCONNECTED: 'whatsapp.disconnected',
  WHATSAPP_MESSAGE_SENT: 'whatsapp.message_sent',
  WHATSAPP_BROADCAST_CREATED: 'whatsapp.broadcast_created',
  INCOME_CREATED: 'income.created',
  PURCHASE_CREATED: 'purchase.created',
  TRANSFER_CREATED: 'transfer.created',
  USER_CREATED: 'user.created',
  USER_UPDATED: 'user.updated',
  USER_DEACTIVATED: 'user.deactivated',
  PERMISSION_CHANGED: 'role.permissions_changed',
  SETTINGS_CHANGED: 'settings.changed',
  REPORT_GENERATED: 'report.generated',
  REPORT_EXPORTED: 'report.exported',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

export interface AuditInput {
  organizationId: string;
  userId?: string | null;
  action: AuditAction | string;
  entityType: string;
  entityId?: string | null;
  entityLabel?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  req?: Request;
}

function requestMeta(req?: Request) {
  if (!req) return {};
  return {
    ipAddress: (req.headers['x-forwarded-for'] as string) ?? req.socket.remoteAddress ?? null,
    userAgent: req.headers['user-agent'] ?? null,
  };
}

/** Writes an audit row. Never throws — auditing must not break the request. */
export async function recordAudit(input: AuditInput, client: Tx | typeof prisma = prisma) {
  try {
    await client.auditLog.create({
      data: {
        organizationId: input.organizationId,
        userId: input.userId ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        entityLabel: input.entityLabel ?? null,
        oldValue: (input.oldValue ?? undefined) as never,
        newValue: (input.newValue ?? undefined) as never,
        ...requestMeta(input.req),
      },
    });
  } catch (error) {
    console.error('[audit] failed to record', input.action, error);
  }
}

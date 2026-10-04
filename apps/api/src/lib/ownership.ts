import type { Tx } from '../db';
import { prisma } from '../db';
import { badRequest } from './errors';

/** Organization-scoped models a request may reference by id. */
const LOOKUPS = {
  donor: (db: Tx, id: string, organizationId: string) => db.donor.findFirst({ where: { id, organizationId }, select: { id: true } }),
  department: (db: Tx, id: string, organizationId: string) =>
    db.department.findFirst({ where: { id, organizationId }, select: { id: true } }),
  fund: (db: Tx, id: string, organizationId: string) => db.fund.findFirst({ where: { id, organizationId }, select: { id: true } }),
  bankAccount: (db: Tx, id: string, organizationId: string) =>
    db.bankAccount.findFirst({ where: { id, organizationId }, select: { id: true } }),
  account: (db: Tx, id: string, organizationId: string) => db.account.findFirst({ where: { id, organizationId }, select: { id: true } }),
  expenseCategory: (db: Tx, id: string, organizationId: string) =>
    db.expenseCategory.findFirst({ where: { id, organizationId }, select: { id: true } }),
} as const;

export type OwnedModel = keyof typeof LOOKUPS;

/**
 * Rejects an id the client sent unless it belongs to the caller's organization.
 * Foreign keys alone don't stop one tenant referencing another tenant's row,
 * so every client-supplied id is checked before it is written. Empty values
 * pass through — optional references are validated by the request schema.
 */
export async function assertOwned(
  organizationId: string,
  refs: Partial<Record<OwnedModel, string | null | undefined>>,
  db: Tx = prisma as unknown as Tx,
): Promise<void> {
  for (const [model, id] of Object.entries(refs) as [OwnedModel, string | null | undefined][]) {
    if (!id) continue;
    const found = await LOOKUPS[model](db, id, organizationId);
    if (!found) throw badRequest(`Selected ${LABELS[model]} is not available in this organization`);
  }
}

const LABELS: Record<OwnedModel, string> = {
  donor: 'donor',
  department: 'department',
  fund: 'fund',
  bankAccount: 'account',
  account: 'parent account',
  expenseCategory: 'category',
};

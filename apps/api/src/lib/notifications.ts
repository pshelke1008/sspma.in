import type { NotificationType } from '@prisma/client';
import { prisma } from '../db';
import type { Tx } from '../db';

export interface NotifyInput {
  organizationId: string;
  userIds: string[];
  type: NotificationType;
  title: string;
  message: string;
  link?: string;
  entityType?: string;
  entityId?: string;
}

export async function notify(input: NotifyInput, client: Tx | typeof prisma = prisma) {
  const recipients = Array.from(new Set(input.userIds.filter(Boolean)));
  if (recipients.length === 0) return;
  try {
    await client.notification.createMany({
      data: recipients.map((userId) => ({
        organizationId: input.organizationId,
        userId,
        type: input.type,
        title: input.title,
        message: input.message,
        link: input.link ?? null,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
      })),
    });
  } catch (error) {
    console.error('[notify] failed', input.type, error);
  }
}

/** Users in the organization holding a given permission — the approval inbox. */
export async function usersWithPermission(
  organizationId: string,
  permissionKey: string,
  client: Tx | typeof prisma = prisma,
): Promise<string[]> {
  const users = await client.user.findMany({
    where: {
      organizationId,
      isActive: true,
      role: { permissions: { some: { permission: { key: permissionKey } } } },
    },
    select: { id: true },
  });
  return users.map((u) => u.id);
}

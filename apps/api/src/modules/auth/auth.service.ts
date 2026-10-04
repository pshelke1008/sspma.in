import bcrypt from 'bcryptjs';
import type { Request } from 'express';
import type { SessionUser } from '@ashram/types';
import { prisma } from '../../db';
import { env } from '../../env';
import { unauthorized } from '../../lib/errors';
import { AUDIT_ACTIONS, recordAudit } from '../../lib/audit';
import { createSessionToken, hashToken } from '../../middleware/auth';
import type { LoginInput } from './auth.schema';

const userInclude = {
  role: { include: { permissions: { include: { permission: true } } } },
  organization: true,
} as const;

type UserWithRole = Awaited<ReturnType<typeof findUser>>;

async function findUser(identifier: string, organizationSlug?: string) {
  const normalized = identifier.trim().toLowerCase();
  return prisma.user.findFirst({
    where: {
      isActive: true,
      ...(organizationSlug ? { organization: { slug: organizationSlug } } : {}),
      OR: [{ email: normalized }, { mobile: identifier.trim() }],
    },
    include: userInclude,
  });
}

export function toSessionUser(user: NonNullable<UserWithRole>): SessionUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    locale: (user.locale === 'mr' ? 'mr' : 'en') as SessionUser['locale'],
    mobile: user.mobile,
    avatarUrl: user.avatarUrl,
    designation: user.designation,
    role: { id: user.role.id, key: user.role.key, name: user.role.name },
    permissions: user.role.permissions.map((rp) => rp.permission.key) as SessionUser['permissions'],
    organization: {
      id: user.organization.id,
      name: user.organization.name,
      slug: user.organization.slug,
      currency: user.organization.currency,
      tagline: user.organization.tagline,
    },
  };
}

export async function login(input: LoginInput, req: Request) {
  const user = await findUser(input.identifier, input.organizationSlug);

  // Always run a hash comparison so a missing user and a wrong password take
  // the same amount of time, and never reveal which of the two failed.
  const hash = user?.passwordHash ?? '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin';
  const valid = await bcrypt.compare(input.password, hash);

  if (!user || !valid) {
    if (user) {
      await recordAudit({
        organizationId: user.organizationId,
        userId: user.id,
        action: AUDIT_ACTIONS.LOGIN_FAILED,
        entityType: 'User',
        entityId: user.id,
        entityLabel: user.email,
        req,
      });
    }
    throw unauthorized('Invalid credentials. Please check your email/mobile and password.');
  }

  const token = createSessionToken();
  const ttlHours = input.rememberMe ? Math.max(env.sessionTtlHours, 24 * 14) : env.sessionTtlHours;
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);

  await prisma.session.create({
    data: {
      organizationId: user.organizationId,
      userId: user.id,
      tokenHash: hashToken(token),
      expiresAt,
      userAgent: req.headers['user-agent'] ?? null,
      ipAddress: (req.headers['x-forwarded-for'] as string) ?? req.socket.remoteAddress ?? null,
    },
  });

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  await recordAudit({
    organizationId: user.organizationId,
    userId: user.id,
    action: AUDIT_ACTIONS.LOGIN,
    entityType: 'User',
    entityId: user.id,
    entityLabel: user.name,
    req,
  });

  return { token, expiresAt, user: toSessionUser(user) };
}

export async function logout(sessionId: string, organizationId: string, userId: string, req: Request) {
  await prisma.session.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
  await recordAudit({
    organizationId,
    userId,
    action: AUDIT_ACTIONS.LOGOUT,
    entityType: 'User',
    entityId: userId,
    req,
  });
}

export async function currentUser(userId: string): Promise<SessionUser> {
  const user = await prisma.user.findUnique({ where: { id: userId }, include: userInclude });
  if (!user || !user.isActive) throw unauthorized('Session is no longer valid');
  return toSessionUser(user);
}

export async function changePassword(userId: string, currentPassword: string, newPassword: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw unauthorized();
  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) throw unauthorized('Current password is incorrect');
  const passwordHash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash } });
  // Force re-authentication everywhere else.
  await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function purgeExpiredSessions() {
  await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
}

export async function updatePreferences(userId: string, prefs: { locale?: 'en' | 'mr' }) {
  if (prefs.locale) {
    await prisma.user.update({ where: { id: userId }, data: { locale: prefs.locale } });
  }
  return currentUser(userId);
}

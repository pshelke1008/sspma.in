import crypto from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { Permission } from '@ashram/types';
import { prisma } from '../db';
import { env } from '../env';
import { forbidden, unauthorized } from '../lib/errors';

export interface AuthContext {
  userId: string;
  organizationId: string;
  roleKey: string;
  roleId: string;
  roleName: string;
  name: string;
  email: string;
  permissions: Set<string>;
  sessionId: string;
  locale: 'en' | 'mr';
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

/** Session tokens are random; only their HMAC is stored, never the token. */
export function hashToken(token: string): string {
  return crypto.createHmac('sha256', env.sessionSecret).update(token).digest('hex');
}

export function createSessionToken(): string {
  return crypto.randomBytes(48).toString('base64url');
}

async function loadContext(token: string): Promise<AuthContext | null> {
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: {
      user: {
        include: {
          role: { include: { permissions: { include: { permission: true } } } },
        },
      },
    },
  });

  if (!session || session.revokedAt || session.expiresAt < new Date()) return null;
  if (!session.user.isActive) return null;

  return {
    userId: session.userId,
    organizationId: session.organizationId,
    roleKey: session.user.role.key,
    roleId: session.user.roleId,
    roleName: session.user.role.name,
    name: session.user.name,
    email: session.user.email,
    permissions: new Set(session.user.role.permissions.map((rp) => rp.permission.key)),
    sessionId: session.id,
    locale: session.user.locale === 'mr' ? 'mr' : 'en',
  };
}

/** Populates req.auth when a valid session cookie or bearer token is present. */
export const attachAuth: RequestHandler = (req, _res, next) => {
  const bearer = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : undefined;
  const token = (req.cookies?.[env.cookieName] as string | undefined) ?? bearer;
  if (!token) return next();

  loadContext(token)
    .then((context) => {
      if (context) req.auth = context;
      next();
    })
    .catch(next);
};

export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.auth) return next(unauthorized());
  next();
};

/**
 * Server-side authorization. Hiding a button in the UI is never the control —
 * every protected route passes through this check.
 */
export function requirePermission(...permissions: Permission[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) return next(unauthorized());
    const granted = permissions.some((permission) => req.auth!.permissions.has(permission));
    if (!granted) {
      return next(forbidden(`Missing required permission: ${permissions.join(' or ')}`));
    }
    next();
  };
}

/**
 * The tenant boundary. Every query in the service layer derives its
 * organizationId from here — never from a client-supplied value.
 */
export function getCurrentOrganization(req: Request): string {
  if (!req.auth) throw unauthorized();
  return req.auth.organizationId;
}

export function getCurrentUser(req: Request): AuthContext {
  if (!req.auth) throw unauthorized();
  return req.auth;
}

export function hasPermission(req: Request, permission: Permission): boolean {
  return Boolean(req.auth?.permissions.has(permission));
}

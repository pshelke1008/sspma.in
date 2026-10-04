import { Router } from 'express';
import { z } from 'zod';
import { SUPPORTED_LOCALES } from '@ashram/types';
import { env } from '../../env';
import { asyncHandler } from '../../lib/http';
import { validate } from '../../middleware/validate';
import { getCurrentUser, requireAuth } from '../../middleware/auth';
import { loginLimiter } from '../../middleware/rateLimit';
import { changePasswordSchema, loginSchema } from './auth.schema';
import * as service from './auth.service';

export const authRouter = Router();

function cookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: 'lax' as const,
    domain: env.cookieDomain,
    path: '/',
    expires: expiresAt,
  };
}

authRouter.post(
  '/login',
  loginLimiter,
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const { token, expiresAt, user } = await service.login(req.body, req);
    res.cookie(env.cookieName, token, cookieOptions(expiresAt));
    res.json({ user, token, expiresAt });
  }),
);

authRouter.post(
  '/logout',
  asyncHandler(async (req, res) => {
    if (req.auth) {
      await service.logout(req.auth.sessionId, req.auth.organizationId, req.auth.userId, req);
    }
    res.clearCookie(env.cookieName, { path: '/', domain: env.cookieDomain });
    res.json({ success: true });
  }),
);

/**
 * Answers "who is signed in?" without requiring a session — a signed-out
 * visitor gets `user: null` rather than an error, so the login screen does not
 * have to provoke a 401 just to find out nobody is signed in.
 */
authRouter.get(
  '/me',
  asyncHandler(async (req, res) => {
    if (!req.auth) return res.json({ user: null });
    res.json({ user: await service.currentUser(req.auth.userId) });
  }),
);

/** Per-user preferences — currently the interface language. */
authRouter.put(
  '/me/preferences',
  requireAuth,
  validate(z.object({ locale: z.enum(SUPPORTED_LOCALES).optional() })),
  asyncHandler(async (req, res) => {
    res.json({ user: await service.updatePreferences(getCurrentUser(req).userId, req.body) });
  }),
);

authRouter.post(
  '/change-password',
  requireAuth,
  validate(changePasswordSchema),
  asyncHandler(async (req, res) => {
    await service.changePassword(getCurrentUser(req).userId, req.body.currentPassword, req.body.newPassword);
    res.clearCookie(env.cookieName, { path: '/', domain: env.cookieDomain });
    res.json({ success: true, message: 'Password updated. Please sign in again.' });
  }),
);

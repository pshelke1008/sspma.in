import { Router } from 'express';
import { prisma } from '../../db';
import { asyncHandler } from '../../lib/http';
import * as channel from './channel.service';
import * as oauth from './oauth.service';
import { WhatsAppError, WhatsAppErrorCode } from './errors';

/**
 * GET /api/whatsapp/oauth/callback — where Meta sends the browser back.
 *
 * Public, because the redirect may arrive without our session cookie; it is
 * authenticated instead by the signed, 15-minute `state` this server issued.
 * The user named in the state must still be active and allowed to manage
 * WhatsApp, and if a session is present it must be that same user.
 */
export const whatsappOAuthCallbackRouter = Router();

whatsappOAuthCallbackRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { state, outcome } = await oauth.handleCallback(req.query as Record<string, unknown>);
    const fail = (code: string) => res.redirect(302, oauth.settingsRedirect({ whatsapp_error: code }));

    if (!state || outcome.kind === 'error') return fail(outcome.kind === 'error' ? outcome.code : WhatsAppErrorCode.OAUTH_EXPIRED);

    const user = await prisma.user.findFirst({
      where: { id: state.u, organizationId: state.o, isActive: true },
      select: { id: true, role: { select: { permissions: { select: { permission: { select: { key: true } } } } } } },
    });
    const allowed = user?.role.permissions.some((item) => item.permission.key === 'whatsapp.manage');
    if (!allowed || (req.auth && (req.auth.userId !== state.u || req.auth.organizationId !== state.o))) {
      await oauth.discardPending(outcome.pendingId);
      return fail(WhatsAppErrorCode.OAUTH_EXPIRED);
    }

    // One number shared: connect it straight away instead of asking.
    if (outcome.onlyChoice) {
      try {
        const choice = await oauth.takePendingChoice(state.o, outcome.pendingId, outcome.onlyChoice);
        await channel.connectCloud({ organizationId: state.o, userId: state.u }, choice.credentials, req, {
          method: 'OAUTH',
          tokenExpiresAt: choice.tokenExpiresAt,
        });
        await oauth.discardPending(outcome.pendingId);
        return res.redirect(302, oauth.settingsRedirect({ whatsapp: 'connected' }));
      } catch (error) {
        await oauth.discardPending(outcome.pendingId);
        return fail(error instanceof WhatsAppError ? error.whatsappCode : WhatsAppErrorCode.OAUTH_FAILED);
      }
    }

    return res.redirect(302, oauth.settingsRedirect({ whatsapp_pending: outcome.pendingId }));
  }),
);

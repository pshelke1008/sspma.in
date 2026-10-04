/**
 * The organization's WhatsApp channel: both providers side by side, and which
 * one is currently used to send.
 *
 *  - CLOUD_API — Meta's official API. Needs a business phone number ID and an
 *    access token; bulk messages outside the 24h window must use templates.
 *  - WEB_QR — links an ordinary WhatsApp account by scanning a QR code, the way
 *    WhatsApp Web does. Automating a personal account is against WhatsApp's
 *    terms and the number can be banned, so sends are paced and capped.
 *
 * Sockets for WEB_QR live in this process. Single-instance deployment is
 * assumed until socket ownership is made explicit.
 */
import type { Request } from 'express';
import type { WhatsAppProvider } from '@prisma/client';
import { prisma } from '../../db';
import { env } from '../../env';
import { AUDIT_ACTIONS, recordAudit } from '../../lib/audit';
import type { AuthContext } from '../../middleware/auth';
import * as cloud from './cloudApi';
import * as manager from './connectionManager';
import { hasEncryptionKey } from './crypto';
import { WhatsAppError, WhatsAppErrorCode } from './errors';
import { oauthAvailable } from './oauth.service';
import * as numbers from './numbers.service';

const currentMonth = () => new Date().toISOString().slice(0, 7);

export async function getOrCreateChannel(organizationId: string) {
  return prisma.whatsAppChannel.upsert({
    where: { organizationId },
    create: { organizationId, monthlyLimit: env.whatsapp.monthlyLimit },
    update: {},
  });
}

function assertConfigured() {
  if (!hasEncryptionKey()) throw new WhatsAppError(WhatsAppErrorCode.NOT_CONFIGURED);
}

function assertWebEnabled() {
  assertConfigured();
  if (!env.whatsapp.webEnabled) throw new WhatsAppError(WhatsAppErrorCode.WEB_DISABLED);
}

export async function getStatus(organizationId: string) {
  const channel = await getOrCreateChannel(organizationId);
  const connectedNumbers = await numbers.listNumbers(organizationId);
  const primary = connectedNumbers[0] ?? null;
  const cloudStatus = connectedNumbers.length ? 'CONNECTED' : channel.cloudLastError ? 'FAILED' : 'DISCONNECTED';
  const configured = hasEncryptionKey();

  // The socket is the truth for QR-linking; the row outlives crashes.
  let webStatus = channel.webStatus;
  if (configured && env.whatsapp.webEnabled) {
    const transient = webStatus === 'QR_REQUIRED' || webStatus === 'CONNECTED';
    if (transient && !manager.isLive(organizationId)) {
      webStatus = 'DISCONNECTED';
      await prisma.whatsAppChannel.update({ where: { organizationId }, data: { webStatus } });
    }
  } else if (webStatus !== 'DISCONNECTED') {
    webStatus = 'DISCONNECTED';
  }

  const messagesSent = channel.countedMonth === currentMonth() ? channel.messagesSent : 0;

  // A first successful QR link becomes the sending channel without an extra click.
  let activeProvider = channel.activeProvider;
  if (!activeProvider && webStatus === 'CONNECTED') {
    activeProvider = 'WEB_QR';
    await prisma.whatsAppChannel.update({ where: { organizationId }, data: { activeProvider } });
  }

  return {
    configured,
    activeProvider,
    cloud: {
      status: cloudStatus as 'CONNECTED' | 'FAILED' | 'DISCONNECTED',
      /** Every connected number; the first is the default for broadcasts and new chats. */
      numbers: connectedNumbers,
      // The default number's details, for callers that show a single number.
      phoneNumberId: primary?.phoneNumberId ?? null,
      businessAccountId: primary?.businessAccountId ?? null,
      displayNumber: primary?.displayNumber ?? null,
      verifiedName: primary?.verifiedName ?? null,
      connectedAt: primary?.connectedAt ?? null,
      lastError: cloudStatus === 'FAILED' ? channel.cloudLastError : null,
      webhookPath: '/api/webhooks/whatsapp',
      webhookReady: Boolean(env.whatsapp.webhookVerifyToken && env.whatsapp.appSecret),
      oauthAvailable: oauthAvailable(),
      connectMethod: primary?.connectMethod ?? null,
      accessExpiresAt: primary?.accessExpiresAt ?? null,
      qualityRating: primary?.qualityRating ?? null,
      webhookSubscribed: primary?.webhookSubscribed ?? false,
    },
    web: {
      enabled: env.whatsapp.webEnabled,
      status: webStatus,
      qrDataUrl:
        configured && webStatus === 'QR_REQUIRED' ? manager.getLiveQr(organizationId) : null,
      phoneNumber: channel.webPhoneNumber,
      displayName: channel.webDisplayName,
      connectedAt: channel.webConnectedAt,
      lastActiveAt: channel.webLastActiveAt,
      // Kept after an unlink from the phone too, so the page can say why it dropped.
      lastError: webStatus === 'FAILED' || webStatus === 'DISCONNECTED' ? channel.webLastError : null,
      messagesSent,
      monthlyLimit: channel.monthlyLimit,
    },
  };
}

// ----------------------------- Cloud API -------------------------------------

/** Adds (or refreshes) a Cloud API number. */
export async function connectCloud(
  auth: Pick<AuthContext, 'organizationId' | 'userId'>,
  input: { phoneNumberId: string; businessAccountId: string; accessToken: string },
  req: Request,
  options: { method: numbers.ConnectMethod; tokenExpiresAt?: Date | null } = { method: 'MANUAL' },
) {
  assertConfigured();
  await getOrCreateChannel(auth.organizationId);
  await numbers.connectNumber(auth, input, req, options);
  return getStatus(auth.organizationId);
}

/** Disconnects every Cloud API number. */
export async function disconnectCloud(auth: AuthContext, req: Request) {
  await getOrCreateChannel(auth.organizationId);
  await numbers.disconnectAllNumbers(auth, req);
  return getStatus(auth.organizationId);
}

export async function disconnectCloudNumber(auth: AuthContext, numberId: string, req: Request) {
  await numbers.disconnectNumber(auth, numberId, req);
  return getStatus(auth.organizationId);
}

/** Credentials for a send — a specific number, or the organization's default. */
export function cloudCredentials(organizationId: string, numberId?: string | null) {
  return numbers.credentialsFor(organizationId, numberId);
}

/** Approved templates of the chosen (or default) number's business account. */
export async function listTemplates(organizationId: string, numberId?: string | null) {
  const credentials = await cloudCredentials(organizationId, numberId);
  if (!credentials.businessAccountId) return [];
  return cloud.listApprovedTemplates(credentials.businessAccountId, credentials.token);
}

// ----------------------------- QR / linked device ----------------------------

export async function connectWeb(organizationId: string) {
  assertWebEnabled();
  await getOrCreateChannel(organizationId);
  if (!manager.isLive(organizationId)) await manager.startConnection(organizationId);
  return getStatus(organizationId);
}

export async function reconnectWeb(organizationId: string) {
  assertWebEnabled();
  await getOrCreateChannel(organizationId);
  await manager.reconnectConnection(organizationId);
  return getStatus(organizationId);
}

export async function disconnectWeb(auth: AuthContext, req: Request) {
  const channel = await getOrCreateChannel(auth.organizationId);
  if (hasEncryptionKey()) {
    await manager.disconnectConnection(auth.organizationId);
  } else {
    await prisma.whatsAppChannel.update({
      where: { organizationId: auth.organizationId },
      data: { webStatus: 'DISCONNECTED', webPhoneNumber: null, webDisplayName: null },
    });
  }
  if (channel.activeProvider === 'WEB_QR') {
    await prisma.whatsAppChannel.update({
      where: { organizationId: auth.organizationId },
      data: { activeProvider: (await numbers.activeNumbers(auth.organizationId)).length ? 'CLOUD_API' : null },
    });
  }
  await recordAudit({
    organizationId: auth.organizationId,
    userId: auth.userId,
    action: AUDIT_ACTIONS.WHATSAPP_DISCONNECTED,
    entityType: 'WhatsAppChannel',
    entityLabel: 'QR linked device',
    req,
  });
  return getStatus(auth.organizationId);
}

export async function setActiveProvider(auth: AuthContext, provider: WhatsAppProvider, req: Request) {
  const status = await getStatus(auth.organizationId);
  const ready = provider === 'CLOUD_API' ? status.cloud.status === 'CONNECTED' : status.web.status === 'CONNECTED';
  if (!ready) throw new WhatsAppError(WhatsAppErrorCode.NOT_CONNECTED);

  await prisma.whatsAppChannel.update({
    where: { organizationId: auth.organizationId },
    data: { activeProvider: provider },
  });
  await recordAudit({
    organizationId: auth.organizationId,
    userId: auth.userId,
    action: AUDIT_ACTIONS.SETTINGS_CHANGED,
    entityType: 'WhatsAppChannel',
    entityLabel: 'Sending channel',
    newValue: { activeProvider: provider },
    req,
  });
  return getStatus(auth.organizationId);
}

/** The provider a send will actually use right now, or a clear reason why not. */
export async function resolveSender(organizationId: string): Promise<WhatsAppProvider> {
  assertConfigured();
  const status = await getStatus(organizationId);
  if (status.activeProvider === 'CLOUD_API' && status.cloud.status === 'CONNECTED') return 'CLOUD_API';
  if (status.activeProvider === 'WEB_QR' && status.web.status === 'CONNECTED') return 'WEB_QR';
  // Fall back to whichever is live rather than refusing on a stale preference.
  if (status.cloud.status === 'CONNECTED') return 'CLOUD_API';
  if (status.web.status === 'CONNECTED') return 'WEB_QR';
  throw new WhatsAppError(WhatsAppErrorCode.NOT_CONNECTED);
}

/** QR-linked sends are capped per month; the cap is a hard stop, checked before sending. */
export async function reserveWebSend(organizationId: string): Promise<void> {
  const channel = await getOrCreateChannel(organizationId);
  const month = currentMonth();
  const sent = channel.countedMonth === month ? channel.messagesSent : 0;
  if (sent >= channel.monthlyLimit) throw new WhatsAppError(WhatsAppErrorCode.MONTHLY_LIMIT);
  await prisma.whatsAppChannel.update({
    where: { organizationId },
    data: { messagesSent: sent + 1, countedMonth: month },
  });
}

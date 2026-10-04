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
import { decryptText, encryptText, hasEncryptionKey } from './crypto';
import { WhatsAppError, WhatsAppErrorCode } from './errors';

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
      status: channel.cloudStatus,
      phoneNumberId: channel.cloudPhoneNumberId,
      businessAccountId: channel.cloudBusinessAccountId,
      displayNumber: channel.cloudDisplayNumber,
      verifiedName: channel.cloudVerifiedName,
      connectedAt: channel.cloudConnectedAt,
      lastError: channel.cloudStatus === 'FAILED' ? channel.cloudLastError : null,
      webhookPath: '/api/webhooks/whatsapp',
      webhookReady: Boolean(env.whatsapp.webhookVerifyToken && env.whatsapp.appSecret),
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

export async function connectCloud(
  auth: AuthContext,
  input: { phoneNumberId: string; businessAccountId: string; accessToken: string },
  req: Request,
) {
  assertConfigured();
  await getOrCreateChannel(auth.organizationId);

  // Verify before storing anything: a token Meta rejects is never saved.
  let info: cloud.PhoneNumberInfo;
  try {
    info = await cloud.verifyPhoneNumber(input.phoneNumberId, input.accessToken);
  } catch (error) {
    await prisma.whatsAppChannel.update({
      where: { organizationId: auth.organizationId },
      data: {
        cloudStatus: 'FAILED',
        cloudLastError: error instanceof WhatsAppError ? error.whatsappCode : WhatsAppErrorCode.CLOUD_UNREACHABLE,
      },
    });
    throw error;
  }

  const token = encryptText(input.accessToken);
  const existing = await prisma.whatsAppChannel.findUniqueOrThrow({ where: { organizationId: auth.organizationId } });

  await prisma.whatsAppChannel.update({
    where: { organizationId: auth.organizationId },
    data: {
      cloudPhoneNumberId: input.phoneNumberId,
      cloudBusinessAccountId: input.businessAccountId,
      cloudTokenCiphertext: token.ciphertext,
      cloudTokenIv: token.iv,
      cloudTokenTag: token.tag,
      cloudDisplayNumber: info.display_phone_number ?? null,
      cloudVerifiedName: info.verified_name ?? null,
      cloudStatus: 'CONNECTED',
      cloudLastError: null,
      cloudConnectedAt: new Date(),
      activeProvider: existing.activeProvider ?? 'CLOUD_API',
    },
  });

  await recordAudit({
    organizationId: auth.organizationId,
    userId: auth.userId,
    action: AUDIT_ACTIONS.WHATSAPP_CONNECTED,
    entityType: 'WhatsAppChannel',
    entityLabel: 'Cloud API',
    newValue: { provider: 'CLOUD_API', number: info.display_phone_number ?? null },
    req,
  });

  return getStatus(auth.organizationId);
}

export async function disconnectCloud(auth: AuthContext, req: Request) {
  const channel = await getOrCreateChannel(auth.organizationId);
  await prisma.whatsAppChannel.update({
    where: { organizationId: auth.organizationId },
    data: {
      cloudTokenCiphertext: null,
      cloudTokenIv: null,
      cloudTokenTag: null,
      cloudStatus: 'DISCONNECTED',
      cloudDisplayNumber: null,
      cloudVerifiedName: null,
      cloudLastError: null,
      cloudConnectedAt: null,
      activeProvider:
        channel.activeProvider === 'CLOUD_API' ? (channel.webStatus === 'CONNECTED' ? 'WEB_QR' : null) : channel.activeProvider,
    },
  });
  await recordAudit({
    organizationId: auth.organizationId,
    userId: auth.userId,
    action: AUDIT_ACTIONS.WHATSAPP_DISCONNECTED,
    entityType: 'WhatsAppChannel',
    entityLabel: 'Cloud API',
    req,
  });
  return getStatus(auth.organizationId);
}

export async function cloudCredentials(organizationId: string) {
  const channel = await prisma.whatsAppChannel.findUnique({ where: { organizationId } });
  if (
    !channel ||
    channel.cloudStatus !== 'CONNECTED' ||
    !channel.cloudPhoneNumberId ||
    !channel.cloudTokenCiphertext ||
    !channel.cloudTokenIv ||
    !channel.cloudTokenTag
  ) {
    throw new WhatsAppError(WhatsAppErrorCode.NOT_CONNECTED);
  }
  assertConfigured();
  return {
    phoneNumberId: channel.cloudPhoneNumberId,
    businessAccountId: channel.cloudBusinessAccountId,
    token: decryptText({
      ciphertext: Buffer.from(channel.cloudTokenCiphertext),
      iv: Buffer.from(channel.cloudTokenIv),
      tag: Buffer.from(channel.cloudTokenTag),
    }),
  };
}

export async function listTemplates(organizationId: string) {
  const credentials = await cloudCredentials(organizationId);
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
      data: { activeProvider: channel.cloudStatus === 'CONNECTED' ? 'CLOUD_API' : null },
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

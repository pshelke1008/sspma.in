/**
 * Cloud API numbers. An organization may connect several WhatsApp Business
 * numbers (CAThrives' "Add Another Number"), each with its own encrypted token
 * since they can belong to different Meta business accounts.
 */
import type { Request } from 'express';
import type { WhatsAppNumber } from '@prisma/client';
import { prisma } from '../../db';
import { AUDIT_ACTIONS, recordAudit } from '../../lib/audit';
import { notFound } from '../../lib/errors';
import type { AuthContext } from '../../middleware/auth';
import * as cloud from './cloudApi';
import { decryptText, encryptText, hasEncryptionKey } from './crypto';
import { WhatsAppError, WhatsAppErrorCode } from './errors';
import { inspectToken, oauthAvailable, subscribeApp } from './oauth.service';

export type ConnectMethod = 'MANUAL' | 'OAUTH';

/** A number as the API shows it — never the token. */
export function publicNumber(number: WhatsAppNumber) {
  return {
    id: number.id,
    phoneNumberId: number.phoneNumberId,
    businessAccountId: number.businessAccountId,
    displayNumber: number.displayNumber,
    verifiedName: number.verifiedName,
    qualityRating: number.qualityRating,
    connectMethod: number.connectMethod as ConnectMethod,
    accessExpiresAt: number.tokenExpiresAt,
    webhookSubscribed: number.webhookSubscribed,
    connectedAt: number.connectedAt,
  };
}

export type PublicNumber = ReturnType<typeof publicNumber>;

/** Active numbers, oldest first — the first is the default for broadcasts and new chats. */
export function activeNumbers(organizationId: string) {
  return prisma.whatsAppNumber.findMany({
    where: { organizationId, isActive: true },
    orderBy: { connectedAt: 'asc' },
  });
}

export async function listNumbers(organizationId: string) {
  return (await activeNumbers(organizationId)).map(publicNumber);
}

/**
 * Verifies the number with Meta, then stores (or re-activates) it. A number
 * already active in another organization is refused, so webhooks always route
 * to exactly one tenant.
 */
export async function connectNumber(
  auth: Pick<AuthContext, 'organizationId' | 'userId'>,
  input: { phoneNumberId: string; businessAccountId: string; accessToken: string },
  req: Request,
  options: { method: ConnectMethod; tokenExpiresAt?: Date | null } = { method: 'MANUAL' },
) {
  if (!hasEncryptionKey()) throw new WhatsAppError(WhatsAppErrorCode.NOT_CONFIGURED);

  const taken = await prisma.whatsAppNumber.findFirst({
    where: { phoneNumberId: input.phoneNumberId, isActive: true, NOT: { organizationId: auth.organizationId } },
    select: { id: true },
  });
  if (taken) throw new WhatsAppError(WhatsAppErrorCode.NUMBER_IN_USE);

  let info: cloud.PhoneNumberInfo;
  try {
    info = await cloud.verifyPhoneNumber(input.phoneNumberId, input.accessToken);
  } catch (error) {
    await prisma.whatsAppChannel.upsert({
      where: { organizationId: auth.organizationId },
      create: {
        organizationId: auth.organizationId,
        cloudLastError: error instanceof WhatsAppError ? error.whatsappCode : WhatsAppErrorCode.CLOUD_UNREACHABLE,
      },
      update: { cloudLastError: error instanceof WhatsAppError ? error.whatsappCode : WhatsAppErrorCode.CLOUD_UNREACHABLE },
    });
    throw error;
  }

  // Expiry is known from a Facebook sign-in; for a pasted token, Meta is asked
  // when the app credentials are configured (system user tokens never expire).
  let tokenExpiresAt = options.tokenExpiresAt ?? null;
  if (options.method === 'MANUAL' && oauthAvailable()) {
    tokenExpiresAt = await inspectToken(input.accessToken)
      .then((inspected) => inspected.expiresAt)
      .catch(() => null);
  }
  const webhookSubscribed = await subscribeApp(input.businessAccountId, input.accessToken);
  const token = encryptText(input.accessToken);

  const data = {
    organizationId: auth.organizationId,
    businessAccountId: input.businessAccountId,
    displayNumber: info.display_phone_number ?? null,
    verifiedName: info.verified_name ?? null,
    qualityRating: info.quality_rating ?? null,
    tokenCiphertext: token.ciphertext,
    tokenIv: token.iv,
    tokenTag: token.tag,
    tokenExpiresAt,
    connectMethod: options.method,
    webhookSubscribed,
    isActive: true,
    connectedById: auth.userId,
    connectedAt: new Date(),
  };
  const number = await prisma.whatsAppNumber.upsert({
    where: { phoneNumberId: input.phoneNumberId },
    create: { phoneNumberId: input.phoneNumberId, ...data },
    update: data,
  });

  const channel = await prisma.whatsAppChannel.upsert({
    where: { organizationId: auth.organizationId },
    create: { organizationId: auth.organizationId, activeProvider: 'CLOUD_API' },
    update: { cloudLastError: null },
  });
  if (!channel.activeProvider) {
    await prisma.whatsAppChannel.update({ where: { organizationId: auth.organizationId }, data: { activeProvider: 'CLOUD_API' } });
  }

  await recordAudit({
    organizationId: auth.organizationId,
    userId: auth.userId,
    action: AUDIT_ACTIONS.WHATSAPP_CONNECTED,
    entityType: 'WhatsAppNumber',
    entityId: number.id,
    entityLabel: number.displayNumber ?? number.phoneNumberId,
    newValue: { provider: 'CLOUD_API', number: number.displayNumber, method: options.method },
    req,
  });
  return publicNumber(number);
}

/** Stops using a number. The row stays so message history keeps its number; the token is wiped. */
export async function disconnectNumber(auth: AuthContext, numberId: string, req: Request) {
  const number = await prisma.whatsAppNumber.findFirst({ where: { id: numberId, organizationId: auth.organizationId, isActive: true } });
  if (!number) throw notFound('WhatsApp number not found');

  await prisma.whatsAppNumber.update({
    where: { id: number.id },
    data: { isActive: false, tokenCiphertext: Buffer.alloc(0), tokenIv: Buffer.alloc(0), tokenTag: Buffer.alloc(0), tokenExpiresAt: null },
  });
  await afterNumbersChanged(auth.organizationId);
  await recordAudit({
    organizationId: auth.organizationId,
    userId: auth.userId,
    action: AUDIT_ACTIONS.WHATSAPP_DISCONNECTED,
    entityType: 'WhatsAppNumber',
    entityId: number.id,
    entityLabel: number.displayNumber ?? number.phoneNumberId,
    req,
  });
}

export async function disconnectAllNumbers(auth: AuthContext, req: Request) {
  for (const number of await activeNumbers(auth.organizationId)) await disconnectNumber(auth, number.id, req);
}

/** With no Cloud number left, sending falls back to the QR-linked phone (or nothing). */
async function afterNumbersChanged(organizationId: string) {
  const remaining = await prisma.whatsAppNumber.count({ where: { organizationId, isActive: true } });
  if (remaining > 0) return;
  const channel = await prisma.whatsAppChannel.findUnique({ where: { organizationId } });
  if (channel?.activeProvider === 'CLOUD_API') {
    await prisma.whatsAppChannel.update({
      where: { organizationId },
      data: { activeProvider: channel.webStatus === 'CONNECTED' ? 'WEB_QR' : null },
    });
  }
}

/**
 * Credentials to send with: the requested number, else the default (oldest)
 * active number. Throws NOT_CONNECTED when the organization has none.
 */
export async function credentialsFor(organizationId: string, numberId?: string | null) {
  if (!hasEncryptionKey()) throw new WhatsAppError(WhatsAppErrorCode.NOT_CONFIGURED);
  const number = numberId
    ? await prisma.whatsAppNumber.findFirst({ where: { id: numberId, organizationId, isActive: true } })
    : (await activeNumbers(organizationId))[0];
  if (!number) throw new WhatsAppError(WhatsAppErrorCode.NOT_CONNECTED);
  return {
    numberId: number.id,
    phoneNumberId: number.phoneNumberId,
    businessAccountId: number.businessAccountId,
    token: decryptText({
      ciphertext: Buffer.from(number.tokenCiphertext),
      iv: Buffer.from(number.tokenIv),
      tag: Buffer.from(number.tokenTag),
    }),
  };
}

/** Webhook routing: the organization and number a Meta callback belongs to. */
export function findByPhoneNumberId(phoneNumberId: string) {
  return prisma.whatsAppNumber.findFirst({
    where: { phoneNumberId, isActive: true },
    select: { id: true, organizationId: true },
  });
}

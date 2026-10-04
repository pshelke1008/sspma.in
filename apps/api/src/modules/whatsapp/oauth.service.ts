/**
 * "Connect with Facebook" for the WhatsApp Cloud API.
 *
 * The admin is sent to Meta's login dialog, grants this app access to their
 * WhatsApp Business account, and Meta redirects the browser back to
 * /api/whatsapp/oauth/callback with a one-time code. The code is exchanged for
 * a long-lived (about 60 days) user token, the shared business accounts and
 * their numbers are listed, and the admin picks the number to send from.
 *
 * Ported from CAThrives' redirect flow, with two hardening changes: `state` is
 * HMAC-signed and time-limited (CAThrives trusted an unsigned firm id from the
 * query string), and the pending choice is only readable by the organization
 * that started it.
 */
import crypto from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../db';
import { env } from '../../env';
import type { AuthContext } from '../../middleware/auth';
import { decryptText, encryptText, hasEncryptionKey } from './crypto';
import { WhatsAppError, WhatsAppErrorCode } from './errors';

const SCOPES = ['whatsapp_business_management', 'whatsapp_business_messaging', 'business_management'];
const STATE_TTL_MS = 15 * 60_000;
const PENDING_TTL_MS = 15 * 60_000;

export const CALLBACK_PATH = '/api/whatsapp/oauth/callback';
const redirectUri = () => `${env.publicApiUrl}${CALLBACK_PATH}`;

export function oauthAvailable(): boolean {
  return Boolean(env.whatsapp.appId && env.whatsapp.appSecret && hasEncryptionKey());
}

function assertAvailable() {
  if (!hasEncryptionKey()) throw new WhatsAppError(WhatsAppErrorCode.NOT_CONFIGURED);
  if (!env.whatsapp.appId || !env.whatsapp.appSecret) throw new WhatsAppError(WhatsAppErrorCode.OAUTH_NOT_CONFIGURED);
}

// ----------------------------- Signed state ----------------------------------

interface OAuthState {
  /** organizationId */
  o: string;
  /** userId */
  u: string;
  /** expiry, epoch ms */
  e: number;
  n: string;
}

const sign = (payload: string) => crypto.createHmac('sha256', env.sessionSecret).update(`wa-oauth:${payload}`).digest('base64url');

export function createState(auth: AuthContext): string {
  const state: OAuthState = { o: auth.organizationId, u: auth.userId, e: Date.now() + STATE_TTL_MS, n: crypto.randomBytes(9).toString('base64url') };
  const payload = Buffer.from(JSON.stringify(state)).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export function readState(value: unknown): OAuthState | null {
  if (typeof value !== 'string') return null;
  const [payload, signature] = value.split('.');
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  try {
    const state = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as OAuthState;
    if (typeof state.o !== 'string' || typeof state.u !== 'string' || typeof state.e !== 'number') return null;
    return state.e > Date.now() ? state : null;
  } catch {
    return null;
  }
}

/** Meta's login dialog, asking only for WhatsApp access. */
export function buildAuthUrl(auth: AuthContext): string {
  assertAvailable();
  const url = new URL(`https://www.facebook.com/${env.whatsapp.graphVersion}/dialog/oauth`);
  url.searchParams.set('client_id', env.whatsapp.appId!);
  url.searchParams.set('redirect_uri', redirectUri());
  url.searchParams.set('state', createState(auth));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', SCOPES.join(','));
  // Always show the dialog, so a second business account can be granted later.
  url.searchParams.set('auth_type', 'rerequest');
  return url.toString();
}

// ----------------------------- Graph calls -----------------------------------

async function graphGet<T>(path: string, query: Record<string, string>, token?: string): Promise<T> {
  const url = new URL(`${env.whatsapp.graphUrl}/${env.whatsapp.graphVersion}/${path}`);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  let response: Response;
  try {
    response = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new WhatsAppError(WhatsAppErrorCode.CLOUD_UNREACHABLE);
  }
  const body = (await response.json().catch(() => ({}))) as T & { error?: { code?: number; type?: string } };
  if (!response.ok || body.error) {
    // Never log the query string: it carries the code, secret or token.
    console.warn('[whatsapp] OAuth Graph error', { path: path.split('/')[0], status: response.status, code: body.error?.code });
    throw new WhatsAppError(WhatsAppErrorCode.OAUTH_FAILED);
  }
  return body;
}

interface TokenResponse {
  access_token: string;
  expires_in?: number;
}

/** code → short-lived token → long-lived token (about 60 days). */
async function exchangeCode(code: string): Promise<{ token: string; expiresAt: Date | null }> {
  const short = await graphGet<TokenResponse>('oauth/access_token', {
    client_id: env.whatsapp.appId!,
    client_secret: env.whatsapp.appSecret!,
    redirect_uri: redirectUri(),
    code,
  });
  const long = await graphGet<TokenResponse>('oauth/access_token', {
    grant_type: 'fb_exchange_token',
    client_id: env.whatsapp.appId!,
    client_secret: env.whatsapp.appSecret!,
    fb_exchange_token: short.access_token,
  });
  return {
    token: long.access_token,
    expiresAt: long.expires_in ? new Date(Date.now() + long.expires_in * 1000) : null,
  };
}

interface DebugToken {
  data?: {
    is_valid?: boolean;
    app_id?: string;
    expires_at?: number;
    granular_scopes?: { scope: string; target_ids?: string[] }[];
  };
}

/**
 * What a token can reach and when it expires, asked of Meta with the app's own
 * credentials. `expires_at` 0 means a non-expiring (system user) token.
 */
export async function inspectToken(token: string) {
  const debug = await graphGet<DebugToken>('debug_token', {
    input_token: token,
    access_token: `${env.whatsapp.appId}|${env.whatsapp.appSecret}`,
  });
  const data = debug.data ?? {};
  const idsFor = (scope: string) => data.granular_scopes?.find((item) => item.scope === scope)?.target_ids ?? [];
  return {
    valid: data.is_valid === true && (!data.app_id || data.app_id === env.whatsapp.appId),
    expiresAt: data.expires_at ? new Date(data.expires_at * 1000) : null,
    // Only accounts the token may *send* from — a management-only grant can't message donors.
    messagingAccountIds: idsFor('whatsapp_business_messaging'),
  };
}

export interface PhoneOption {
  id: string;
  displayNumber: string | null;
  verifiedName: string | null;
  qualityRating: string | null;
}

export interface BusinessAccountOption {
  id: string;
  name: string | null;
  phoneNumbers: PhoneOption[];
}

async function describeAccounts(accountIds: string[], token: string): Promise<BusinessAccountOption[]> {
  return Promise.all(
    accountIds.map(async (id) => {
      const [account, numbers] = await Promise.all([
        graphGet<{ name?: string }>(id, { fields: 'name' }, token).catch(() => ({ name: undefined })),
        graphGet<{ data?: { id: string; display_phone_number?: string; verified_name?: string; quality_rating?: string }[] }>(
          `${id}/phone_numbers`,
          { fields: 'id,display_phone_number,verified_name,quality_rating' },
          token,
        ),
      ]);
      return {
        id,
        name: account.name ?? null,
        phoneNumbers: (numbers.data ?? []).map((phone) => ({
          id: phone.id,
          displayNumber: phone.display_phone_number ?? null,
          verifiedName: phone.verified_name ?? null,
          qualityRating: phone.quality_rating ?? null,
        })),
      };
    }),
  );
}

/**
 * Subscribes this app to the business account's webhook, so delivery receipts
 * and replies reach /api/webhooks/whatsapp. Without it Meta sends nothing.
 * Best effort: a failure is reported on the settings page, not fatal.
 */
export async function subscribeApp(businessAccountId: string, token: string): Promise<boolean> {
  // Meta's per-account webhook override (see env.whatsapp.webhookOverride). It
  // verifies the URL with a GET challenge, so it needs a public HTTPS address
  // and the verify token this server answers with.
  const override =
    env.whatsapp.webhookOverride && env.publicApiUrl.startsWith('https://') && env.whatsapp.webhookVerifyToken
      ? { override_callback_uri: `${env.publicApiUrl}/api/webhooks/whatsapp`, verify_token: env.whatsapp.webhookVerifyToken }
      : null;
  try {
    const response = await fetch(`${env.whatsapp.graphUrl}/${env.whatsapp.graphVersion}/${businessAccountId}/subscribed_apps`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, ...(override ? { 'Content-Type': 'application/json' } : {}) },
      body: override ? JSON.stringify(override) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await response.json().catch(() => ({}))) as { success?: boolean };
    if (!response.ok || body.success === false) {
      console.warn('[whatsapp] subscribed_apps failed', { status: response.status });
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

// ----------------------------- Callback + choice -----------------------------

export type CallbackOutcome =
  | { kind: 'pending'; pendingId: string; onlyChoice: { businessAccountId: string; phoneNumberId: string } | null }
  | { kind: 'error'; code: string };

/**
 * Handles Meta's redirect. Never throws: every outcome becomes a redirect back
 * to the settings page with a reason the page can translate.
 */
export async function handleCallback(query: Record<string, unknown>): Promise<{ state: OAuthState | null; outcome: CallbackOutcome }> {
  const state = readState(query.state);
  if (!state) return { state: null, outcome: { kind: 'error', code: WhatsAppErrorCode.OAUTH_EXPIRED } };
  if (query.error) return { state, outcome: { kind: 'error', code: 'denied' } };
  if (typeof query.code !== 'string' || !query.code) return { state, outcome: { kind: 'error', code: WhatsAppErrorCode.OAUTH_FAILED } };

  try {
    assertAvailable();
    const { token, expiresAt: exchangedExpiry } = await exchangeCode(query.code);
    const inspected = await inspectToken(token);
    if (!inspected.valid) return { state, outcome: { kind: 'error', code: WhatsAppErrorCode.OAUTH_FAILED } };
    if (inspected.messagingAccountIds.length === 0) {
      return { state, outcome: { kind: 'error', code: WhatsAppErrorCode.OAUTH_NO_ACCOUNTS } };
    }

    const accounts = (await describeAccounts(inspected.messagingAccountIds, token)).filter((account) => account.phoneNumbers.length > 0);
    if (accounts.length === 0) return { state, outcome: { kind: 'error', code: WhatsAppErrorCode.OAUTH_NO_ACCOUNTS } };

    const encrypted = encryptText(token);
    // Clear this organization's abandoned attempts; one pending choice at a time.
    await prisma.whatsAppPendingConnection.deleteMany({
      where: { OR: [{ organizationId: state.o }, { expiresAt: { lt: new Date() } }] },
    });
    const pending = await prisma.whatsAppPendingConnection.create({
      data: {
        organizationId: state.o,
        userId: state.u,
        tokenCiphertext: encrypted.ciphertext,
        tokenIv: encrypted.iv,
        tokenTag: encrypted.tag,
        tokenExpiresAt: inspected.expiresAt ?? exchangedExpiry,
        businessAccounts: accounts as unknown as Prisma.InputJsonValue,
        expiresAt: new Date(Date.now() + PENDING_TTL_MS),
      },
    });

    const numbers = accounts.flatMap((account) => account.phoneNumbers.map((phone) => ({ account, phone })));
    const onlyChoice = numbers.length === 1 ? { businessAccountId: numbers[0].account.id, phoneNumberId: numbers[0].phone.id } : null;
    return { state, outcome: { kind: 'pending', pendingId: pending.id, onlyChoice } };
  } catch (error) {
    const code = error instanceof WhatsAppError ? error.whatsappCode : WhatsAppErrorCode.OAUTH_FAILED;
    return { state, outcome: { kind: 'error', code } };
  }
}

async function findPending(organizationId: string, pendingId: string) {
  const pending = await prisma.whatsAppPendingConnection.findFirst({ where: { id: pendingId, organizationId } });
  if (!pending || pending.expiresAt < new Date()) throw new WhatsAppError(WhatsAppErrorCode.OAUTH_EXPIRED);
  return pending;
}

/** The numbers to choose from — never the token. */
export async function getPending(organizationId: string, pendingId: string) {
  const pending = await findPending(organizationId, pendingId);
  return {
    id: pending.id,
    expiresAt: pending.expiresAt,
    businessAccounts: pending.businessAccounts as unknown as BusinessAccountOption[],
  };
}

/** Resolves the admin's choice to credentials; the caller saves them through the normal connect path. */
export async function takePendingChoice(organizationId: string, pendingId: string, choice: { businessAccountId: string; phoneNumberId: string }) {
  const pending = await findPending(organizationId, pendingId);
  const accounts = pending.businessAccounts as unknown as BusinessAccountOption[];
  const account = accounts.find((item) => item.id === choice.businessAccountId);
  const phone = account?.phoneNumbers.find((item) => item.id === choice.phoneNumberId);
  // Only a number Meta listed for this sign-in can be chosen.
  if (!account || !phone) throw new WhatsAppError(WhatsAppErrorCode.OAUTH_EXPIRED);

  const accessToken = decryptText({
    ciphertext: Buffer.from(pending.tokenCiphertext),
    iv: Buffer.from(pending.tokenIv),
    tag: Buffer.from(pending.tokenTag),
  });
  return {
    pendingId: pending.id,
    credentials: { phoneNumberId: phone.id, businessAccountId: account.id, accessToken },
    tokenExpiresAt: pending.tokenExpiresAt,
  };
}

export async function discardPending(pendingId: string) {
  await prisma.whatsAppPendingConnection.deleteMany({ where: { id: pendingId } });
}

/** Where the browser lands after Meta: the WhatsApp settings page, with the outcome. */
export function settingsRedirect(params: Record<string, string>): string {
  const url = new URL('/settings/whatsapp', env.webOrigin[0] ?? 'http://localhost:5173');
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}


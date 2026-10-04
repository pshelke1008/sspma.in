/**
 * Owns every live Baileys socket in this process — one per organization.
 * Adapted from the CAThrives connection manager; the non-obvious parts carry
 * over because each was a real bug there:
 *
 *  1. Generation guard. A superseded socket's handlers close over an older auth
 *     blob; a straggler write from it rolls the Signal ratchet back ("Bad MAC").
 *  2. Crash isolation. Every handler runs inside `guarded()`, so a throw inside
 *     Baileys marks one organization FAILED instead of taking the API down.
 *  3. Restore on boot. Sockets live in memory; without `restoreAllConnections`
 *     every restart would silently unlink every organization.
 *  4. 515 "restart required" arrives right after a successful scan. It is not
 *     a failure — redial with the credentials, never wipe them.
 */
import type { WASocket } from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import type { WhatsAppConnectionStatus } from '@prisma/client';
import { prisma } from '../../db';
import { loadBaileys } from './baileys';
import { clearAuthState, useDbAuthState } from './dbAuthState';
import { WhatsAppError, WhatsAppErrorCode, sanitizeError } from './errors';
import { toWhatsAppJid } from './phone';

const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_BASE_DELAY_MS = 2_000;
const RESTART_DELAY_MS = 500;
const MAX_QR_TIMEOUTS = 3;
/**
 * Minimum gap between sends on one number. A personal account firing messages
 * back to back looks exactly like the automation WhatsApp bans for.
 */
const SEND_GAP_MS = 3_000;

export type InboundHandler = (organizationId: string, phone: string, text: string, messageId: string) => Promise<void>;
export type ReceiptHandler = (organizationId: string, messageId: string, status: 'DELIVERED' | 'READ') => Promise<void>;

let onInbound: InboundHandler | null = null;
let onReceipt: ReceiptHandler | null = null;

/** Set by the messaging service, so this module never imports it (no cycle). */
export function setEventHandlers(handlers: { inbound: InboundHandler; receipt: ReceiptHandler }) {
  onInbound = handlers.inbound;
  onReceipt = handlers.receipt;
}

interface ManagedConnection {
  organizationId: string;
  sock: WASocket | null;
  qrDataUrl: string | null;
  reconnectAttempts: number;
  reconnectTimer: NodeJS.Timeout | null;
  generation: number;
  sendChain: Promise<unknown>;
  hasPaired: boolean;
  qrTimeouts: number;
}

const live = new Map<string, ManagedConnection>();
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function setStatus(
  organizationId: string,
  status: WhatsAppConnectionStatus,
  extra: Record<string, unknown> = {},
): Promise<void> {
  try {
    await prisma.whatsAppChannel.update({ where: { organizationId }, data: { webStatus: status, ...extra } });
  } catch (error) {
    console.error('[whatsapp] could not persist status', { organizationId, error: sanitizeError(error) });
  }
}

async function guarded(organizationId: string, label: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
  } catch (error) {
    console.error(`[whatsapp] [${label}] unhandled error`, { organizationId, error: sanitizeError(error) });
    // The raw error is logged above; the stored value is a code the interface can translate.
    await setStatus(organizationId, 'FAILED', {
      webLastError: error instanceof WhatsAppError ? error.whatsappCode : WhatsAppErrorCode.CONNECTION_LOST,
    });
  }
}

function retireSocket(managed: ManagedConnection): void {
  if (managed.reconnectTimer) {
    clearTimeout(managed.reconnectTimer);
    managed.reconnectTimer = null;
  }
  const sock = managed.sock;
  if (!sock) return;
  managed.sock = null;
  try {
    sock.ev.removeAllListeners('creds.update');
    sock.ev.removeAllListeners('connection.update');
    sock.ev.removeAllListeners('messages.upsert');
    sock.ev.removeAllListeners('messages.update');
  } catch {
    /* emitter already torn down */
  }
  try {
    sock.end(undefined);
  } catch {
    /* already closed */
  }
}

/** A silent pino-shaped logger: Baileys' info logs can carry session detail. */
const silentLogger = (() => {
  const noop = () => undefined;
  const logger: Record<string, unknown> = { level: 'silent', trace: noop, debug: noop, info: noop, warn: noop, error: noop, fatal: noop };
  logger.child = () => logger;
  return logger;
})();

/** Baileys v7 may address chats by LID; prefer whichever field carries the phone. */
function phoneFromKey(key: Record<string, unknown>): string | null {
  const candidates = [key.senderPn, key.remoteJidAlt, key.participantPn, key.remoteJid].filter(
    (value): value is string => typeof value === 'string',
  );
  const jid = candidates.find((value) => value.endsWith('@s.whatsapp.net'));
  return jid ? jid.split('@')[0].split(':')[0] : null;
}

function textOf(message: Record<string, any> | null | undefined): string | null {
  if (!message) return null;
  return (
    message.conversation ??
    message.extendedTextMessage?.text ??
    message.imageMessage?.caption ??
    message.videoMessage?.caption ??
    message.documentMessage?.caption ??
    null
  );
}

async function startSocket(organizationId: string, isRestore: boolean): Promise<void> {
  const existing = live.get(organizationId);
  if (existing?.sock && !isRestore) return;

  const managed: ManagedConnection = existing ?? {
    organizationId,
    sock: null,
    qrDataUrl: null,
    reconnectAttempts: 0,
    reconnectTimer: null,
    generation: 0,
    sendChain: Promise.resolve(),
    hasPaired: false,
    qrTimeouts: 0,
  };
  live.set(organizationId, managed);
  retireSocket(managed);

  const generation = ++managed.generation;
  const baileys = await loadBaileys();
  const makeWASocket = baileys.default;
  const { DisconnectReason, fetchLatestBaileysVersion } = baileys;

  const { state, saveCreds } = await useDbAuthState(organizationId);
  const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined as never }));

  const sock = makeWASocket({
    auth: state,
    version,
    logger: silentLogger as never,
    // Shown on the phone's Linked Devices list.
    browser: ['Ashram Management', 'Chrome', '1.0.0'],
    syncFullHistory: false,
    markOnlineOnConnect: false,
  });

  // Something else took over while we awaited — do not install an orphan socket.
  if (managed.generation !== generation) {
    try {
      sock.end(undefined);
    } catch {
      /* already closed */
    }
    return;
  }
  managed.sock = sock;
  const superseded = () => managed.generation !== generation;

  sock.ev.on('creds.update', () => {
    if (superseded()) return;
    void guarded(organizationId, 'creds.update', saveCreds);
  });

  sock.ev.on('messages.upsert', (event) => {
    if (superseded() || event.type !== 'notify') return;
    void guarded(organizationId, 'messages.upsert', async () => {
      for (const message of event.messages) {
        if (message.key.fromMe) continue;
        const phone = phoneFromKey(message.key as unknown as Record<string, unknown>);
        const text = textOf(message.message as Record<string, any>);
        if (!phone || !text || !onInbound) continue;
        await onInbound(organizationId, phone, text, message.key.id ?? '');
      }
    });
  });

  sock.ev.on('messages.update', (updates) => {
    if (superseded()) return;
    void guarded(organizationId, 'messages.update', async () => {
      for (const update of updates) {
        if (!update.key.fromMe || !update.key.id || !onReceipt) continue;
        const status = update.update.status;
        // Baileys' WebMessageInfo.Status: 3 = delivered, 4 = read, 5 = played.
        if (status === 3) await onReceipt(organizationId, update.key.id, 'DELIVERED');
        else if (status === 4 || status === 5) await onReceipt(organizationId, update.key.id, 'READ');
      }
    });
  });

  sock.ev.on('connection.update', (update) => {
    if (superseded()) return;
    void guarded(organizationId, 'connection.update', async () => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        managed.qrDataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 320 });
        // A fresh code means the link is working, not failing — do not spend
        // the reconnect budget while someone walks to their phone.
        managed.reconnectAttempts = 0;
        await setStatus(organizationId, 'QR_REQUIRED', { webLastError: null });
      }

      if (connection === 'open') {
        managed.qrDataUrl = null;
        managed.reconnectAttempts = 0;
        managed.hasPaired = true;
        managed.qrTimeouts = 0;
        const jid = sock.user?.id ?? '';
        const phoneNumber = jid.split(':')[0].split('@')[0] || null;

        // One number, one organization: refuse a phone already linked elsewhere.
        if (phoneNumber) {
          const conflict = await prisma.whatsAppChannel.findFirst({
            where: { webPhoneNumber: phoneNumber, webStatus: 'CONNECTED', organizationId: { not: organizationId } },
            select: { id: true },
          });
          if (conflict) {
            try {
              await sock.logout();
            } catch {
              /* best effort */
            }
            managed.generation += 1;
            retireSocket(managed);
            live.delete(organizationId);
            await clearAuthState(organizationId);
            await setStatus(organizationId, 'FAILED', {
              webPhoneNumber: null,
              webDisplayName: null,
              webLastError: WhatsAppErrorCode.NUMBER_IN_USE,
            });
            return;
          }
        }

        const now = new Date();
        await setStatus(organizationId, 'CONNECTED', {
          webPhoneNumber: phoneNumber,
          webDisplayName: sock.user?.name ?? null,
          webConnectedAt: now,
          webLastActiveAt: now,
          webLastError: null,
        });
      }

      if (connection === 'close') {
        managed.qrDataUrl = null;
        const statusCode = (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output
          ?.statusCode;

        if (statusCode === DisconnectReason.loggedOut) {
          // Unlinked from the phone: terminal, and retrying looks like abuse.
          managed.generation += 1;
          retireSocket(managed);
          live.delete(organizationId);
          await clearAuthState(organizationId);
          await setStatus(organizationId, 'DISCONNECTED', {
            webPhoneNumber: null,
            webDisplayName: null,
            webLastError: WhatsAppErrorCode.UNLINKED,
          });
          return;
        }

        if (statusCode === DisconnectReason.restartRequired) {
          await setStatus(organizationId, 'CONNECTING');
          managed.reconnectTimer = setTimeout(() => {
            startSocket(organizationId, true).catch((error) =>
              console.error('[whatsapp] redial after restart request failed', sanitizeError(error)),
            );
          }, RESTART_DELAY_MS);
          return;
        }

        managed.reconnectAttempts += 1;
        const scanned = Boolean(state.creds.me);

        if (!managed.hasPaired && !scanned) {
          // An unscanned attempt's keys are throwaway; start the next one clean,
          // and stop cycling codes for an abandoned settings tab.
          await clearAuthState(organizationId);
          managed.qrTimeouts += 1;
          if (managed.qrTimeouts >= MAX_QR_TIMEOUTS) {
            retireSocket(managed);
            live.delete(organizationId);
            await setStatus(organizationId, 'FAILED', {
              webLastError: WhatsAppErrorCode.QR_EXPIRED,
            });
            return;
          }
        }

        if (managed.reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
          retireSocket(managed);
          live.delete(organizationId);
          if (!managed.hasPaired) await clearAuthState(organizationId);
          await setStatus(organizationId, 'FAILED', {
            webLastError: managed.hasPaired ? WhatsAppErrorCode.CONNECTION_LOST : WhatsAppErrorCode.LINK_FAILED,
          });
          return;
        }

        await setStatus(organizationId, 'CONNECTING');
        const delay = RECONNECT_BASE_DELAY_MS * 2 ** (managed.reconnectAttempts - 1);
        managed.reconnectTimer = setTimeout(() => {
          startSocket(organizationId, true).catch((error) =>
            console.error('[whatsapp] reconnect attempt failed', sanitizeError(error)),
          );
        }, delay);
      }
    });
  });
}

// ----------------------------- Public API -----------------------------------

export async function startConnection(organizationId: string): Promise<void> {
  await setStatus(organizationId, 'CONNECTING', { webLastError: null });
  await guarded(organizationId, 'start', () => startSocket(organizationId, false));
}

export async function reconnectConnection(organizationId: string): Promise<void> {
  const managed = live.get(organizationId);
  if (managed) {
    managed.reconnectAttempts = 0;
    managed.qrTimeouts = 0;
  }
  await setStatus(organizationId, 'CONNECTING', { webLastError: null });
  await guarded(organizationId, 'reconnect', () => startSocket(organizationId, true));
}

export function getLiveQr(organizationId: string): string | null {
  return live.get(organizationId)?.qrDataUrl ?? null;
}

export function isLive(organizationId: string): boolean {
  return Boolean(live.get(organizationId)?.sock);
}

export async function disconnectConnection(organizationId: string): Promise<void> {
  const managed = live.get(organizationId);
  if (managed?.sock) {
    try {
      // logout() also removes the entry from the phone's Linked Devices.
      await managed.sock.logout();
    } catch {
      /* already gone */
    }
  }
  if (managed) {
    managed.generation += 1;
    retireSocket(managed);
  }
  live.delete(organizationId);
  await clearAuthState(organizationId);
  await setStatus(organizationId, 'DISCONNECTED', {
    webPhoneNumber: null,
    webDisplayName: null,
    webLastError: null,
  });
}

function queued<T>(managed: ManagedConnection, run: () => Promise<T>): Promise<T> {
  const task = managed.sendChain.then(run, run);
  managed.sendChain = task.catch(() => undefined);
  return task;
}

export async function sendText(organizationId: string, phone: string, body: string): Promise<string> {
  const managed = live.get(organizationId);
  if (!managed?.sock) throw new Error('NOT_CONNECTED');
  return queued(managed, async () => {
    await sleep(SEND_GAP_MS);
    if (!managed.sock) throw new Error('NOT_CONNECTED');
    const result = await managed.sock.sendMessage(toWhatsAppJid(phone), { text: body });
    await prisma.whatsAppChannel
      .update({ where: { organizationId }, data: { webLastActiveAt: new Date() } })
      .catch(() => undefined);
    return result?.key?.id ?? '';
  });
}

/** Whether a number has WhatsApp, so a send fails loudly instead of vanishing. */
export async function isOnWhatsApp(organizationId: string, phone: string): Promise<boolean> {
  const managed = live.get(organizationId);
  if (!managed?.sock) throw new Error('NOT_CONNECTED');
  const results = await managed.sock.onWhatsApp(toWhatsAppJid(phone));
  // No answer means the lookup did not respond — let the send try.
  if (!results || results.length === 0) return true;
  return Boolean(results[0]?.exists);
}

/** Boot-time restore. A CONNECTED row is not trusted until Baileys confirms it. */
export async function restoreAllConnections(): Promise<void> {
  await prisma.whatsAppChannel.updateMany({
    where: {
      OR: [
        { webStatus: 'QR_REQUIRED' },
        { webStatus: { in: ['CONNECTED', 'CONNECTING'] }, webSessionCiphertext: null },
      ],
    },
    data: { webStatus: 'DISCONNECTED' },
  });

  const rows = await prisma.whatsAppChannel.findMany({
    where: { webStatus: { in: ['CONNECTED', 'CONNECTING'] }, webSessionCiphertext: { not: null } },
    select: { organizationId: true },
  });
  if (rows.length) console.log(`[whatsapp] restoring ${rows.length} linked device session(s)`);
  for (const row of rows) {
    await setStatus(row.organizationId, 'CONNECTING');
    await guarded(row.organizationId, 'restore', () => startSocket(row.organizationId, true));
  }
}

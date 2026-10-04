/**
 * Postgres-backed Baileys auth state, adapted from the CAThrives integration.
 *
 * Baileys' own `useMultiFileAuthState` writes credentials to local disk, which
 * neither survives a redeploy nor keeps the linked device encrypted. This keeps
 * the same `AuthenticationState` contract against the encrypted session columns
 * on `WhatsAppChannel`.
 *
 * Correctness constraint: creds and every Signal key are one encrypted blob,
 * rewritten on each `keys.set()`. Signal ratchets must advance monotonically —
 * two overlapping whole-blob writes lose an update, which libsignal later
 * reports as `Bad MAC` on every inbound message. Two guards prevent that:
 *   1. `enqueueSave` serialises every write for an organization;
 *   2. the epoch guard drops writes from a socket that has been superseded.
 */
import type { AuthenticationCreds, AuthenticationState, SignalDataTypeMap } from '@whiskeysockets/baileys';
import { prisma } from '../../db';
import { decryptText, encryptText } from './crypto';
import { loadBaileys } from './baileys';

interface StoredAuthBlob {
  creds: AuthenticationCreds;
  keys: Record<string, Record<string, unknown>>;
}

async function loadBlob(organizationId: string): Promise<StoredAuthBlob> {
  const { initAuthCreds, BufferJSON } = await loadBaileys();
  const row = await prisma.whatsAppChannel.findUnique({
    where: { organizationId },
    select: { webSessionCiphertext: true, webSessionIv: true, webSessionTag: true },
  });

  if (!row?.webSessionCiphertext || !row.webSessionIv || !row.webSessionTag) {
    return { creds: initAuthCreds(), keys: {} };
  }

  try {
    const serialized = decryptText({
      ciphertext: Buffer.from(row.webSessionCiphertext),
      iv: Buffer.from(row.webSessionIv),
      tag: Buffer.from(row.webSessionTag),
    });
    return JSON.parse(serialized, BufferJSON.reviver) as StoredAuthBlob;
  } catch (error) {
    // A blob we cannot decrypt (rotated key, truncated write) means "no
    // session" — the page then shows a QR again, which is the honest state.
    console.error('[whatsapp] stored session could not be decrypted; starting fresh', {
      organizationId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { creds: initAuthCreds(), keys: {} };
  }
}

async function saveBlob(organizationId: string, blob: StoredAuthBlob): Promise<void> {
  const { BufferJSON } = await loadBaileys();
  const encrypted = encryptText(JSON.stringify(blob, BufferJSON.replacer));
  await prisma.whatsAppChannel.update({
    where: { organizationId },
    data: {
      webSessionCiphertext: encrypted.ciphertext,
      webSessionIv: encrypted.iv,
      webSessionTag: encrypted.tag,
    },
  });
}

const writeQueues = new Map<string, Promise<void>>();

function enqueueSave(organizationId: string, blob: StoredAuthBlob): Promise<void> {
  const previous = writeQueues.get(organizationId) ?? Promise.resolve();
  const save = previous.then(() => saveBlob(organizationId, blob));
  // The stored tail never rejects, so one failed write cannot poison the next.
  const tail = save.catch(() => undefined);
  writeQueues.set(organizationId, tail);
  void tail.then(() => {
    if (writeQueues.get(organizationId) === tail) writeQueues.delete(organizationId);
  });
  return save;
}

/** Wait until no write is queued — looping, because one may be queued while we wait. */
async function drainWrites(organizationId: string): Promise<void> {
  let pending = writeQueues.get(organizationId);
  while (pending) {
    await pending;
    const current = writeQueues.get(organizationId);
    if (current === pending) {
      writeQueues.delete(organizationId);
      return;
    }
    pending = current;
  }
}

const activeEpochs = new Map<string, number>();

function claimEpoch(organizationId: string): number {
  const epoch = (activeEpochs.get(organizationId) ?? 0) + 1;
  activeEpochs.set(organizationId, epoch);
  return epoch;
}

export interface DbAuthState {
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
}

export async function useDbAuthState(organizationId: string): Promise<DbAuthState> {
  const { proto } = await loadBaileys();
  // Let the outgoing socket's writes land, then claim the epoch that makes its
  // later writes inert.
  await drainWrites(organizationId);
  const epoch = claimEpoch(organizationId);
  const isCurrent = () => activeEpochs.get(organizationId) === epoch;
  const blob = await loadBlob(organizationId);

  return {
    state: {
      creds: blob.creds,
      keys: {
        get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
          const category = blob.keys[type] || {};
          const result: { [id: string]: SignalDataTypeMap[T] } = {};
          for (const id of ids) {
            let value = category[id];
            if (type === 'app-state-sync-key' && value) {
              value = proto.Message.AppStateSyncKeyData.fromObject(value as never);
            }
            if (value !== undefined) result[id] = value as SignalDataTypeMap[T];
          }
          return result;
        },
        set: async (data) => {
          for (const category of Object.keys(data) as (keyof SignalDataTypeMap)[]) {
            blob.keys[category] = blob.keys[category] || {};
            const entries = (data as Record<string, Record<string, unknown>>)[category] || {};
            for (const id of Object.keys(entries)) {
              const value = entries[id];
              if (value) blob.keys[category][id] = value;
              else delete blob.keys[category][id];
            }
          }
          if (!isCurrent()) return;
          await enqueueSave(organizationId, blob);
        },
      },
    },
    saveCreds: async () => {
      if (!isCurrent()) return;
      await enqueueSave(organizationId, blob);
    },
  };
}

/** Invalidate, drain, then wipe — in that order, so nothing resurrects the session. */
export async function clearAuthState(organizationId: string): Promise<void> {
  claimEpoch(organizationId);
  await drainWrites(organizationId);
  await prisma.whatsAppChannel.updateMany({
    where: { organizationId },
    data: { webSessionCiphertext: null, webSessionIv: null, webSessionTag: null },
  });
}

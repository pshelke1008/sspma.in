/**
 * AES-256-GCM for WhatsApp secrets. Adapted from the CAThrives integration.
 *
 * Two things are encrypted with this: Cloud API access tokens, and the Baileys
 * auth state for a QR-linked phone. The second *is* the linked device — whoever
 * holds it can send as that number — so neither is ever stored in the clear.
 *
 * There is deliberately no fallback key: a key that silently defaults to a
 * known value is the same as no encryption.
 */
import crypto from 'node:crypto';
import { env } from '../../env';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

let cachedKey: Buffer | null = null;

function loadKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = env.whatsapp.encryptionKey;
  if (!raw) {
    throw new Error('WHATSAPP_ENCRYPTION_KEY is not set. Generate one with `openssl rand -base64 32`.');
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error(`WHATSAPP_ENCRYPTION_KEY must decode to exactly 32 bytes (got ${key.length}).`);
  }
  cachedKey = key;
  return key;
}

export interface EncryptedBlob {
  ciphertext: Buffer;
  iv: Buffer;
  tag: Buffer;
}

export function encryptText(plaintext: string): EncryptedBlob {
  const key = loadKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return { ciphertext, iv, tag: cipher.getAuthTag() };
}

export function decryptText(blob: EncryptedBlob): string {
  const key = loadKey();
  const decipher = crypto.createDecipheriv(ALGORITHM, key, blob.iv);
  decipher.setAuthTag(blob.tag);
  return Buffer.concat([decipher.update(blob.ciphertext), decipher.final()]).toString('utf8');
}

/** Whether a usable key is configured, without throwing — lets boot fail safe. */
export function hasEncryptionKey(): boolean {
  try {
    loadKey();
    return true;
  } catch {
    return false;
  }
}

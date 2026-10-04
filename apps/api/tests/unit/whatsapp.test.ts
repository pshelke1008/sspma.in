import { describe, expect, it } from 'vitest';
import { maskPhone, normalizePhone, toWhatsAppJid } from '../../src/modules/whatsapp/phone';
import { decryptText, encryptText, hasEncryptionKey } from '../../src/modules/whatsapp/crypto';
import { WhatsAppError, WhatsAppErrorCode, sanitizeError } from '../../src/modules/whatsapp/errors';

describe('phone normalisation', () => {
  it('defaults a bare ten-digit number to India', () => {
    expect(normalizePhone('9820011223')).toBe('919820011223');
    expect(normalizePhone('+91 98200 11223')).toBe('919820011223');
  });

  it('drops the domestic trunk prefix', () => {
    expect(normalizePhone('098200 11223')).toBe('919820011223');
  });

  it('keeps international numbers as typed', () => {
    expect(normalizePhone('+44 7700 900123')).toBe('447700900123');
  });

  it('rejects implausible numbers', () => {
    expect(normalizePhone('12345')).toBeNull();
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone('1'.repeat(16))).toBeNull();
  });

  it('builds a WhatsApp address and a masked form for logs', () => {
    expect(toWhatsAppJid('919820011223')).toBe('919820011223@s.whatsapp.net');
    expect(maskPhone('919820011223')).toBe('9198••••23');
  });
});

describe.skipIf(!hasEncryptionKey())('secret encryption', () => {
  it('round-trips a secret', () => {
    const blob = encryptText('EAAG-access-token');
    expect(blob.ciphertext.toString('utf8')).not.toContain('EAAG');
    expect(decryptText(blob)).toBe('EAAG-access-token');
  });

  it('uses a fresh IV every time', () => {
    expect(encryptText('same').iv.equals(encryptText('same').iv)).toBe(false);
  });

  it('refuses a tampered ciphertext', () => {
    const blob = encryptText('secret');
    blob.ciphertext[0] ^= 0xff;
    expect(() => decryptText(blob)).toThrow();
  });
});

describe('WhatsApp errors', () => {
  it('maps server configuration problems to 503', () => {
    expect(new WhatsAppError(WhatsAppErrorCode.NOT_CONFIGURED).status).toBe(503);
    expect(new WhatsAppError(WhatsAppErrorCode.WEB_DISABLED).status).toBe(503);
  });

  it('maps bad requests to 400 and state conflicts to 409', () => {
    expect(new WhatsAppError(WhatsAppErrorCode.EMPTY_MESSAGE).status).toBe(400);
    expect(new WhatsAppError(WhatsAppErrorCode.NOT_CONNECTED).status).toBe(409);
    expect(new WhatsAppError(WhatsAppErrorCode.NOT_OPTED_IN).status).toBe(409);
  });

  it('exposes a stable code the interface can translate', () => {
    const error = new WhatsAppError(WhatsAppErrorCode.MONTHLY_LIMIT);
    expect(error.code).toBe('WHATSAPP_MONTHLY_LIMIT');
    expect(sanitizeError(error)).toBe('WHATSAPP_MONTHLY_LIMIT');
  });

  it('truncates library errors before they are stored', () => {
    expect(sanitizeError(new Error('x'.repeat(1000)))).toHaveLength(300);
  });
});

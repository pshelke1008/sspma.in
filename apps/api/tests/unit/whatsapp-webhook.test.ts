import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { WhatsAppError, WhatsAppErrorCode, codeForMetaError, failureOf, metaErrorDetail } from '../../src/modules/whatsapp/errors';
import { isValidSignature } from '../../src/modules/whatsapp/webhook.routes';

const sign = (body: Buffer, secret: string) => `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;

describe('webhook signature', () => {
  const body = Buffer.from('{"entry":[]}');

  it('accepts the secret the callback was signed with', () => {
    expect(isValidSignature(body, sign(body, 'secret-a'), ['secret-a'])).toBe(true);
  });

  it('accepts a callback from any of several Meta apps, each with its own secret', () => {
    const secrets = ['secret-a', 'secret-b'];
    expect(isValidSignature(body, sign(body, 'secret-a'), secrets)).toBe(true);
    expect(isValidSignature(body, sign(body, 'secret-b'), secrets)).toBe(true);
  });

  it('refuses an unknown secret, a tampered body and a malformed header', () => {
    expect(isValidSignature(body, sign(body, 'someone-else'), ['secret-a', 'secret-b'])).toBe(false);
    expect(isValidSignature(Buffer.from('{"entry":[1]}'), sign(body, 'secret-a'), ['secret-a'])).toBe(false);
    expect(isValidSignature(body, 'sha256=abc', ['secret-a'])).toBe(false);
    expect(isValidSignature(body, '', ['secret-a'])).toBe(false);
  });

  it('refuses everything when no secret is configured', () => {
    expect(isValidSignature(body, sign(body, 'secret-a'), [])).toBe(false);
  });
});

describe('Meta failure reasons', () => {
  it.each([
    [131042, 'WHATSAPP_PAYMENT_ISSUE'],
    [131047, 'WHATSAPP_OUTSIDE_WINDOW'],
    [131026, 'WHATSAPP_NOT_ON_WHATSAPP'],
    [131049, 'WHATSAPP_ENGAGEMENT_LIMIT'],
    [131031, 'WHATSAPP_ACCOUNT_RESTRICTED'],
    [131053, 'WHATSAPP_MEDIA_FAILED'],
    [131056, 'WHATSAPP_RATE_LIMITED'],
    [132012, 'WHATSAPP_TEMPLATE_PARAMS_MISMATCH'],
    [132015, 'WHATSAPP_TEMPLATE_PAUSED'],
    [999999, 'WHATSAPP_SEND_FAILED'],
    [undefined, 'WHATSAPP_SEND_FAILED'],
  ])('maps Meta code %s to %s', (code, expected) => {
    expect(codeForMetaError(code)).toBe(expected);
  });

  it('keeps Meta’s own words short enough to store', () => {
    expect(metaErrorDetail({ code: 131042, title: 'Business eligibility payment issue', details: 'Currency is not configured.' })).toBe(
      '131042: Currency is not configured.',
    );
    expect(metaErrorDetail({ code: 131042, title: 'Business eligibility payment issue' })).toBe('131042: Business eligibility payment issue');
    expect(metaErrorDetail({ message: 'x'.repeat(1000) })?.length).toBe(400);
    expect(metaErrorDetail(undefined)).toBeNull();
  });

  it('carries the detail from a failed send to the stored message', () => {
    const error = new WhatsAppError(WhatsAppErrorCode.PAYMENT_ISSUE, undefined, '131042: no currency');
    expect(failureOf(error)).toEqual({ error: 'WHATSAPP_PAYMENT_ISSUE', errorDetail: '131042: no currency' });
    expect(failureOf(new Error('boom'))).toEqual({ error: 'boom', errorDetail: null });
  });
});

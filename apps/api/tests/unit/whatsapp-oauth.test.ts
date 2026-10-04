import { describe, expect, it, vi } from 'vitest';
import { createState, readState } from '../../src/modules/whatsapp/oauth.service';

const auth = { organizationId: 'org_1', userId: 'user_1' } as Parameters<typeof createState>[0];

describe('Connect with Facebook state', () => {
  it('round-trips the organization and user it was issued for', () => {
    const state = readState(createState(auth));
    expect(state).toMatchObject({ o: 'org_1', u: 'user_1' });
  });

  it('rejects a state whose payload was edited to point at another organization', () => {
    const [payload, signature] = createState(auth).split('.');
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const forged = Buffer.from(JSON.stringify({ ...decoded, o: 'org_2' })).toString('base64url');
    expect(readState(`${forged}.${signature}`)).toBeNull();
  });

  it('rejects a missing, malformed or unsigned state', () => {
    expect(readState(undefined)).toBeNull();
    expect(readState('')).toBeNull();
    expect(readState('not-a-state')).toBeNull();
    expect(readState(Buffer.from(JSON.stringify({ o: 'org_1', u: 'user_1', e: Date.now() + 60_000 })).toString('base64url'))).toBeNull();
  });

  it('expires after fifteen minutes', () => {
    vi.useFakeTimers();
    try {
      const state = createState(auth);
      vi.advanceTimersByTime(14 * 60_000);
      expect(readState(state)).not.toBeNull();
      vi.advanceTimersByTime(2 * 60_000);
      expect(readState(state)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

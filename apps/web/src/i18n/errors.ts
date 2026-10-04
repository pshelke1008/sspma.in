import type { TFunction } from 'i18next';
import { ApiError } from '@/lib/api/client';

/**
 * The message to show for a failed request. Known error codes use the
 * translated copy; otherwise the server's own message is shown, which is more
 * specific than any generic fallback.
 */
export function errorMessage(t: TFunction, error: unknown): string | undefined {
  if (error instanceof ApiError) {
    const key = `errors.${error.code}`;
    const translated = t(key, { defaultValue: '' });
    if (translated) return translated;
    return error.message;
  }
  if (error instanceof Error && error.message === 'Failed to fetch') return t('errors.NETWORK');
  return undefined;
}

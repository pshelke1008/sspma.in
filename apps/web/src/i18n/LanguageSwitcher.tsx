import { useTranslation } from 'react-i18next';
import { Languages } from 'lucide-react';
import { toast } from 'sonner';
import { SUPPORTED_LOCALES, type Locale } from '@ashram/types';
import { api } from '@/lib/api/client';
import { queryClient, queryKeys } from '@/lib/api/queryClient';
import { cn } from '@/lib/utils/cn';
import { applyLocale } from './index';

/**
 * English ⇄ मराठी. Signed-in users also have the choice saved to their
 * profile, so it follows them to another device.
 */
export function LanguageSwitcher({
  signedIn,
  tone = 'light',
  className,
}: {
  signedIn: boolean;
  tone?: 'light' | 'dark';
  className?: string;
}) {
  const { t, i18n } = useTranslation();
  const current = i18n.language === 'mr' ? 'mr' : 'en';

  async function choose(locale: Locale) {
    if (locale === current) return;
    await applyLocale(locale);
    // Report labels are rendered by the API in the requested language.
    queryClient.invalidateQueries({ queryKey: ['report'] });
    if (signedIn) {
      try {
        await api.put('/auth/me/preferences', { locale });
        queryClient.invalidateQueries({ queryKey: queryKeys.session });
      } catch {
        /* the device keeps the choice even if saving to the profile fails */
      }
    }
    toast.success(t('language.changed'));
  }

  return (
    <div
      role="group"
      aria-label={t('language.label')}
      className={cn(
        'inline-flex items-center gap-0.5 rounded-control p-0.5',
        tone === 'light' ? 'border border-line bg-white' : 'bg-white/12',
        className,
      )}
    >
      <Languages
        className={cn('ml-1.5 mr-0.5 h-3.5 w-3.5', tone === 'light' ? 'text-ink-muted' : 'text-white/80')}
        aria-hidden="true"
      />
      {SUPPORTED_LOCALES.map((locale) => (
        <button
          key={locale}
          type="button"
          lang={locale}
          aria-pressed={current === locale}
          onClick={() => void choose(locale)}
          className={cn(
            'rounded-[6px] px-2 py-1 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/50',
            current === locale
              ? tone === 'light'
                ? 'bg-brand-light text-brand'
                : 'bg-white text-brand'
              : tone === 'light'
                ? 'text-ink-muted hover:text-ink'
                : 'text-white/80 hover:text-white',
          )}
        >
          {t(`language.${locale}`)}
        </button>
      ))}
    </div>
  );
}

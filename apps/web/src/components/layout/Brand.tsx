import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils/cn';

/** The Om mark plus product name. */
export function Brand({
  size = 'md',
  tone = 'light',
  showTagline = true,
  className,
}: {
  size?: 'sm' | 'md' | 'lg';
  tone?: 'light' | 'dark';
  showTagline?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const markSize = size === 'lg' ? 'h-11 w-11 text-[22px]' : size === 'sm' ? 'h-8 w-8 text-[16px]' : 'h-9 w-9 text-[18px]';

  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <span
        className={cn(
          'flex shrink-0 items-center justify-center rounded-[10px] font-serif leading-none',
          markSize,
          tone === 'light' ? 'bg-white/12 text-white' : 'bg-brand-primary text-white',
        )}
        aria-hidden="true"
      >
        ॐ
      </span>
      <span className="min-w-0">
        <span
          className={cn(
            'block truncate font-semibold leading-tight',
            size === 'lg' ? 'text-[19px]' : 'text-[15px]',
            tone === 'light' ? 'text-white' : 'text-ink',
          )}
        >
          {t('brand.name')}
        </span>
        {showTagline && (
          <span
            className={cn(
              // Wraps rather than truncating: a clipped tagline reads as a bug.
              'block leading-tight',
              size === 'lg' ? 'text-[12px]' : 'text-[10.5px]',
              tone === 'light' ? 'text-white/70' : 'text-ink-muted',
            )}
          >
            {t('brand.tagline')}
          </span>
        )}
      </span>
    </div>
  );
}

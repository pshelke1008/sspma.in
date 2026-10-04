import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils/cn';
import logo from '@/images/logo.png';

const SIZES = {
  sm: 'h-11 w-11',
  md: 'h-14 w-14',
  lg: 'h-32 w-32',
} as const;

/** The organization's logo; it carries the name, so no text sits beside it. */
export function Brand({ size = 'md', className }: { size?: keyof typeof SIZES; className?: string }) {
  const { t } = useTranslation();

  return (
    <img
      src={logo}
      alt={t('brand.name')}
      width={500}
      height={500}
      decoding="async"
      draggable={false}
      className={cn('block shrink-0 select-none object-contain', SIZES[size], className)}
    />
  );
}

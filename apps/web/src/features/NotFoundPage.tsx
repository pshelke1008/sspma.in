import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Compass } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-light">
        <Compass className="h-6 w-6 text-brand" aria-hidden="true" />
      </span>
      <h1 className="mt-4 text-[20px] font-semibold text-ink">{t('auth.notFoundTitle')}</h1>
      <p className="mt-1.5 max-w-md text-[13px] leading-relaxed text-ink-muted">{t('auth.notFoundText')}</p>
      <Button asChild className="mt-5">
        <Link to="/dashboard">{t('auth.backToDashboard')}</Link>
      </Button>
    </div>
  );
}

import { useTranslation } from 'react-i18next';

/** Keeps keyboard users out of the navigation loop. */
export function SkipLink() {
  const { t } = useTranslation();
  return (
    <a
      href="#main-content"
      className="sr-only-focusable fixed left-3 top-3 z-[100] rounded-control bg-brand px-3 py-2 text-[13px] font-medium text-white shadow-pop"
    >
      {t('nav.skipToContent')}
    </a>
  );
}

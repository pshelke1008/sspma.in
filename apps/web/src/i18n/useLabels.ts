import { useTranslation } from 'react-i18next';
import { DOMAIN_LABELS } from '@ashram/types';

/** Status, method and report vocabulary in the current language. */
export function useLabels() {
  const { i18n } = useTranslation();
  return DOMAIN_LABELS[i18n.language === 'mr' ? 'mr' : 'en'];
}

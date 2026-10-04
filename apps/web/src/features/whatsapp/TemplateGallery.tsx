import { useTranslation } from 'react-i18next';
import { BookOpenText } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TemplatePreview } from './TemplatePreview';
import { draftFromGallery } from './templateDrafts';
import { TEMPLATE_GALLERY, type GalleryLanguage } from './galleryTemplates';
import type { TemplateDraft } from './CreateTemplateDialog';

const LANGUAGES: { value: GalleryLanguage; label: string }[] = [
  { value: 'mr', label: 'मराठी' },
  { value: 'en', label: 'English' },
];

/** Ready-made templates for an ashram. Pick a language and the form opens with the wording filled in. */
export function TemplateGallery({ onPick }: { onPick: (draft: TemplateDraft) => void }) {
  const { t, i18n } = useTranslation();
  const preferred: GalleryLanguage = i18n.language === 'en' ? 'en' : 'mr';

  return (
    <section aria-labelledby="template-gallery" className="space-y-3">
      <div>
        <h2 id="template-gallery" className="flex items-center gap-2 text-[14.5px] font-semibold text-ink">
          <BookOpenText className="h-4 w-4 text-brand" aria-hidden="true" />
          {t('whatsapp.templates.libraryTitle')}
        </h2>
        <p className="mt-0.5 text-[12px] text-ink-muted">{t('whatsapp.templates.libraryText')}</p>
      </div>

      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {TEMPLATE_GALLERY.map((item) => (
          <li key={item.id} className="flex min-w-0 flex-col rounded-card border border-line bg-white p-3 shadow-card">
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-[13px] font-semibold text-ink">{t(`whatsapp.templates.gallery.${item.id}.title`)}</h3>
              <Badge tone={item.category === 'MARKETING' ? 'accent' : 'info'}>{t(`whatsapp.templates.category.${item.category}`)}</Badge>
            </div>
            <p className="mt-0.5 text-[11.5px] leading-snug text-ink-muted">{t(`whatsapp.templates.gallery.${item.id}.description`)}</p>
            <TemplatePreview
              className="mt-2 flex-1"
              bodyText={item.texts[preferred].body}
              footerText={item.texts[preferred].footer}
              values={item.texts[preferred].examples}
            />
            <div className="mt-3 flex flex-wrap gap-2">
              {LANGUAGES.map((language) => (
                <Button
                  key={language.value}
                  type="button"
                  size="sm"
                  variant={language.value === preferred ? 'primary' : 'outline'}
                  onClick={() => onPick(draftFromGallery(item, language.value))}
                  aria-label={t('whatsapp.templates.useIn', { template: t(`whatsapp.templates.gallery.${item.id}.title`), language: language.label })}
                >
                  {t('whatsapp.templates.useInLanguage', { language: language.label })}
                </Button>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

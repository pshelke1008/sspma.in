import type { MessageTemplate } from './api';
import type { TemplateDraft } from './CreateTemplateDialog';
import type { GalleryLanguage, GalleryTemplate } from './galleryTemplates';

/** A library template in one language, ready for the form. */
export function draftFromGallery(item: GalleryTemplate, language: GalleryLanguage): TemplateDraft {
  const text = item.texts[language];
  return {
    name: item.name,
    language,
    category: item.category,
    headerType: 'NONE',
    bodyText: text.body,
    bodyExamples: text.examples,
    footerText: text.footer ?? '',
    buttons: [],
  };
}

/**
 * An existing template as the start of a new one. Meta does not let approved text
 * be changed in place, so changing a template means submitting a revised copy
 * under a new name. Example values are not returned by Meta and must be re-entered.
 */
export function draftFromTemplate(template: MessageTemplate): TemplateDraft {
  const media = ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(template.headerFormat ?? '');
  return {
    name: `${template.name}_v2`.slice(0, 512),
    language: template.language,
    category: template.category === 'MARKETING' ? 'MARKETING' : 'UTILITY',
    headerType: media ? (template.headerFormat as 'IMAGE' | 'VIDEO' | 'DOCUMENT') : template.headerFormat === 'TEXT' ? 'TEXT' : 'NONE',
    headerText: template.headerFormat === 'TEXT' ? (template.headerText ?? '') : '',
    bodyText: template.bodyText,
    bodyExamples: [],
    footerText: template.footerText ?? '',
    buttons: template.buttons
      .filter((button) => button.type !== 'OTHER')
      .map((button) => ({
        type: button.type as 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER',
        text: button.text,
        url: button.url,
        phoneNumber: button.phoneNumber,
      })),
  };
}

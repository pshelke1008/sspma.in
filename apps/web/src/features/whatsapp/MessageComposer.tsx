import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Braces, Info } from 'lucide-react';
import { MESSAGE_PLACEHOLDERS, type WhatsAppProviderKey } from '@ashram/types';
import { FormField } from '@/components/common/forms';
import { SegmentedControl } from '@/components/common/SegmentedControl';
import { Input, Textarea } from '@/components/ui/input';
import { SimpleSelect } from '@/components/ui/select';
import { useTemplates, type MessageContent } from './api';

export type ComposerMode = 'text' | 'template';

export interface ComposerState {
  mode: ComposerMode;
  body: string;
  templateKey: string;
  templateParams: string[];
}

export const EMPTY_COMPOSER: ComposerState = { mode: 'text', body: '', templateKey: '', templateParams: [] };

const MAX_BODY = 4096;

/** Templates exist only on the Cloud API; anything else sends plain text. */
function effectiveMode(state: ComposerState, provider: WhatsAppProviderKey | null): ComposerMode {
  return provider === 'CLOUD_API' ? state.mode : 'text';
}

/** Converts what the user typed into the API's content shape. */
export function toContent(state: ComposerState, provider: WhatsAppProviderKey | null): MessageContent {
  if (effectiveMode(state, provider) === 'template' && state.templateKey) {
    const [templateName, templateLanguage] = state.templateKey.split('|');
    return { templateName, templateLanguage, templateParams: state.templateParams };
  }
  return { body: state.body.trim() };
}

export function hasContent(state: ComposerState, provider: WhatsAppProviderKey | null): boolean {
  return effectiveMode(state, provider) === 'template' ? Boolean(state.templateKey) : Boolean(state.body.trim());
}

/**
 * Plain text for the linked phone; plain text or an approved template for the
 * Cloud API, which only allows free text within 24 hours of the donor's last
 * message. Placeholders are filled in per donor by the server.
 */
export function MessageComposer({
  idPrefix,
  provider,
  value,
  onChange,
  error,
}: {
  idPrefix: string;
  provider: WhatsAppProviderKey | null;
  value: ComposerState;
  onChange: (next: ComposerState) => void;
  error?: string;
}) {
  const { t } = useTranslation();
  const textarea = useRef<HTMLTextAreaElement>(null);
  const cloud = provider === 'CLOUD_API';
  const { data: templates, isLoading: templatesLoading } = useTemplates(cloud);
  const mode = effectiveMode(value, provider);
  const selectedTemplate = templates?.data.find((item) => `${item.name}|${item.language}` === value.templateKey);

  function insertPlaceholder(key: string) {
    const token = `{{${key}}}`;
    const element = textarea.current;
    const start = element?.selectionStart ?? value.body.length;
    const end = element?.selectionEnd ?? value.body.length;
    const body = value.body.slice(0, start) + token + value.body.slice(end);
    onChange({ ...value, body });
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(start + token.length, start + token.length);
    });
  }

  return (
    <div className="space-y-3">
      {cloud && (
        <SegmentedControl
          label={t('whatsapp.messageType')}
          value={mode}
          onChange={(next) => onChange({ ...value, mode: next as ComposerMode })}
          segments={[
            { value: 'text', label: t('whatsapp.textMessage') },
            { value: 'template', label: t('whatsapp.template') },
          ]}
        />
      )}

      {mode === 'text' ? (
        <>
          <FormField
            label={t('whatsapp.message')}
            htmlFor={`${idPrefix}-body`}
            required
            error={error}
            hint={t('whatsapp.characters', { count: value.body.length, max: MAX_BODY })}
          >
            <Textarea
              ref={textarea}
              id={`${idPrefix}-body`}
              rows={6}
              maxLength={MAX_BODY}
              invalid={Boolean(error)}
              placeholder={t('whatsapp.messagePlaceholder')}
              value={value.body}
              onChange={(event) => onChange({ ...value, body: event.target.value })}
            />
          </FormField>

          <div>
            <p className="mb-1.5 flex items-center gap-1.5 text-[11.5px] font-medium text-ink-muted">
              <Braces className="h-3.5 w-3.5" aria-hidden="true" />
              {t('whatsapp.personalise')}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {MESSAGE_PLACEHOLDERS.map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => insertPlaceholder(key)}
                  className="rounded-full border border-line bg-white px-2.5 py-1 text-[11.5px] text-ink transition-colors hover:border-brand-primary/40 hover:bg-brand-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/50"
                >
                  {t(`whatsapp.placeholders.${key}`)}
                </button>
              ))}
            </div>
          </div>

          {cloud && (
            <p className="flex items-start gap-2 rounded-control border border-info/25 bg-info/5 px-3 py-2 text-[11.5px] leading-relaxed text-info">
              <Info className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {t('whatsapp.windowHint')}
            </p>
          )}
        </>
      ) : (
        <>
          <FormField
            label={t('whatsapp.template')}
            htmlFor={`${idPrefix}-template`}
            required
            error={error}
            hint={!templatesLoading && !templates?.data.length ? t('whatsapp.noTemplates') : undefined}
          >
            <SimpleSelect
              value={value.templateKey || undefined}
              onValueChange={(key) => {
                const template = templates?.data.find((item) => `${item.name}|${item.language}` === key);
                onChange({ ...value, templateKey: key, templateParams: Array(template?.bodyParameterCount ?? 0).fill('') });
              }}
              options={(templates?.data ?? []).map((item) => ({
                value: `${item.name}|${item.language}`,
                label: item.name,
                hint: item.language,
              }))}
              placeholder={templatesLoading ? t('common.loading') : t('whatsapp.chooseTemplate')}
              invalid={Boolean(error)}
              ariaLabel={t('whatsapp.template')}
            />
          </FormField>

          {selectedTemplate && (
            <>
              <blockquote className="whitespace-pre-wrap rounded-control border border-line bg-canvas/60 px-3 py-2 text-[12.5px] text-ink">
                {selectedTemplate.bodyText}
              </blockquote>
              {value.templateParams.map((param, index) => (
                <FormField
                  key={index}
                  label={t('whatsapp.variable', { number: index + 1 })}
                  htmlFor={`${idPrefix}-param-${index}`}
                  hint={index === 0 ? t('whatsapp.variableHint') : undefined}
                >
                  <Input
                    id={`${idPrefix}-param-${index}`}
                    value={param}
                    maxLength={1024}
                    placeholder={index === 0 ? '{{name}}' : undefined}
                    onChange={(event) => {
                      const templateParams = [...value.templateParams];
                      templateParams[index] = event.target.value;
                      onChange({ ...value, templateParams });
                    }}
                  />
                </FormField>
              ))}
            </>
          )}
        </>
      )}
    </div>
  );
}

import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { BROADCAST_DONOR_FIELDS, type BroadcastDonorField, type VariableMapping, type VariableSource } from '@ashram/types';
import { FormField } from '@/components/common/forms';
import { Input } from '@/components/ui/input';
import { SimpleSelect } from '@/components/ui/select';
import type { MessageTemplate } from '../api';
import { TemplatePreview } from '../TemplatePreview';
import type { WizardState } from './api';

/** What the select shows for a variable's source, as a single string. */
const encode = (source: VariableSource | undefined) =>
  !source ? undefined : source.source === 'static' ? 'static' : source.source === 'donor' ? `donor:${source.field}` : `column:${source.column}`;

function decode(value: string): VariableSource {
  if (value === 'static') return { source: 'static', value: '' };
  if (value.startsWith('donor:')) return { source: 'donor', field: value.slice(6) as BroadcastDonorField };
  return { source: 'column', column: value.slice(7) };
}

/** Why the mapping is not ready: a translation key, or nothing if every variable has a source. */
export function mappingError(count: number, mapping: VariableMapping, upload: boolean): string | undefined {
  for (let index = 1; index <= count; index += 1) {
    const source = mapping[String(index)];
    if (!source) return 'whatsapp.campaign.errors.variable';
    if (source.source === 'static' && !source.value.trim()) return 'whatsapp.campaign.errors.staticValue';
    if (source.source === 'column' && (!upload || !source.column)) return 'whatsapp.campaign.errors.variable';
  }
  return undefined;
}

/** Step 3: where each template variable's value comes from, per recipient. */
export function VariablesStep({
  state,
  template,
  onChange,
  error,
}: {
  state: WizardState;
  template: MessageTemplate;
  onChange: (mapping: VariableMapping) => void;
  error?: string;
}) {
  const { t } = useTranslation();
  const upload = state.audience === 'UPLOAD';
  const columns = upload ? (state.upload?.columns ?? []) : [];
  const count = template.bodyParameterCount;

  // The first variable is almost always the donor's name; start there.
  useEffect(() => {
    if (!state.mapping['1']) onChange({ ...state.mapping, '1': { source: 'donor', field: 'name' } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const options = [
    ...BROADCAST_DONOR_FIELDS.map((field) => ({ value: `donor:${field}`, label: t(`whatsapp.campaign.fields.${field}`) })),
    { value: 'static', label: t('whatsapp.campaign.fixedText') },
    ...columns.map((column) => ({ value: `column:${column}`, label: t('whatsapp.campaign.fromColumn', { column }) })),
  ];

  // The preview names each variable's source instead of a value, since values differ per donor.
  const sampleValues = Array.from({ length: count }, (_, index) => {
    const source = state.mapping[String(index + 1)];
    if (!source) return '';
    if (source.source === 'static') return source.value;
    if (source.source === 'donor') return `‹${t(`whatsapp.campaign.fields.${source.field}`)}›`;
    return `‹${source.column}›`;
  });

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-4">
        <p className="text-[12.5px] leading-relaxed text-ink-muted">{t('whatsapp.campaign.variablesText')}</p>
        {Array.from({ length: count }, (_, index) => {
          const key = String(index + 1);
          const source = state.mapping[key];
          return (
            <div key={key} className="grid gap-3 rounded-control border border-line p-3 sm:grid-cols-2">
              <FormField label={t('whatsapp.variable', { number: key })} htmlFor={`var-${key}`} required>
                <SimpleSelect
                  value={encode(source)}
                  onValueChange={(value) => onChange({ ...state.mapping, [key]: decode(value) })}
                  options={options}
                  placeholder={t('whatsapp.campaign.chooseSource')}
                  ariaLabel={t('whatsapp.variable', { number: key })}
                />
              </FormField>
              {source?.source === 'static' && (
                <FormField label={t('whatsapp.campaign.fixedText')} htmlFor={`var-${key}-text`} hint={t('whatsapp.campaign.fixedTextHint')}>
                  <Input
                    id={`var-${key}-text`}
                    value={source.value}
                    maxLength={1024}
                    onChange={(event) => onChange({ ...state.mapping, [key]: { source: 'static', value: event.target.value } })}
                  />
                </FormField>
              )}
            </div>
          );
        })}
        {upload && columns.length === 0 && <p className="text-[12px] text-ink-muted">{t('whatsapp.campaign.noColumns')}</p>}
        {error && (
          <p role="alert" className="text-[12px] font-medium text-danger">
            {t(error, { defaultValue: error })}
          </p>
        )}
      </div>

      <aside className="min-w-0">
        <p className="mb-1.5 text-[11.5px] font-medium text-ink-muted">{t('whatsapp.templates.preview')}</p>
        <TemplatePreview
          headerFormat={template.headerFormat}
          headerMedia={state.headerMedia}
          headerText={template.headerText}
          bodyText={template.bodyText}
          footerText={template.footerText}
          buttons={template.buttons}
          values={sampleValues}
        />
      </aside>
    </div>
  );
}

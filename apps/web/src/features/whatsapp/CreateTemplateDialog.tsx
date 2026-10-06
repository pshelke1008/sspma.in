import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { Braces, CheckCircle2, Paperclip, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, api } from '@/lib/api/client';
import { errorMessage } from '@/i18n/errors';
import { FormField } from '@/components/common/forms';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { SimpleSelect } from '@/components/ui/select';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { invalidateTemplates, type CreateTemplateBody } from './api';
import { TemplatePreview } from './TemplatePreview';

/** Languages Meta accepts for templates that an ashram is likely to need. */
const LANGUAGES = [
  { value: 'mr', label: 'मराठी (mr)' },
  { value: 'en', label: 'English (en)' },
  { value: 'en_US', label: 'English US (en_US)' },
  { value: 'hi', label: 'हिन्दी (hi)' },
  { value: 'gu', label: 'ગુજરાતી (gu)' },
  { value: 'kn', label: 'ಕನ್ನಡ (kn)' },
  { value: 'ta', label: 'தமிழ் (ta)' },
  { value: 'te', label: 'తెలుగు (te)' },
  { value: 'ml', label: 'മലയാളം (ml)' },
  { value: 'bn', label: 'বাংলা (bn)' },
];

/** Meta's own {{n}} markers, passed in so i18next does not mistake them for its placeholders. */
const VARIABLE_SAMPLES = { v1: '{{1}}', v2: '{{2}}' };

const HEADER_TYPES = ['NONE', 'TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT'] as const;
const SAMPLE_ACCEPT: Record<string, string> = { IMAGE: 'image/jpeg,image/png', VIDEO: 'video/mp4,video/3gpp', DOCUMENT: 'application/pdf' };

const MAX_BODY = 1024;
const MAX_BUTTONS = 3;
const PLACEHOLDER = /\{\{\s*(\d+)\s*\}\}/g;

const variableIndexes = (text: string) =>
  [...new Set([...text.matchAll(PLACEHOLDER)].map((match) => Number(match[1])))].sort((a, b) => a - b);

const buttonSchema = z.object({
  type: z.enum(['QUICK_REPLY', 'URL', 'PHONE_NUMBER']),
  text: z.string().trim().min(1, 'whatsapp.templates.errors.buttonText').max(25),
  url: z.string().trim().optional(),
  phoneNumber: z.string().trim().optional(),
});

/** Message keys, not text: FormField translates them. Mirrors the server's rules. */
const schema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'whatsapp.templates.errors.name')
      .max(512)
      .regex(/^[a-z0-9_]+$/, 'whatsapp.templates.errors.name'),
    language: z.string().min(1, 'whatsapp.templates.errors.language'),
    category: z.enum(['UTILITY', 'MARKETING']),
    headerType: z.enum(HEADER_TYPES),
    headerText: z.string().trim().max(60).optional(),
    /** Meta's handle for the sample file an image, video or document header is reviewed with. */
    headerHandle: z.string().optional(),
    headerSampleName: z.string().optional(),
    bodyText: z.string().trim().min(1, 'whatsapp.templates.errors.body').max(MAX_BODY),
    bodyExamples: z.array(z.string()),
    footerText: z.string().trim().max(60).optional(),
    buttons: z.array(buttonSchema).max(MAX_BUTTONS),
  })
  .superRefine((data, ctx) => {
    const indexes = variableIndexes(data.bodyText);
    if (indexes.some((value, position) => value !== position + 1)) {
      ctx.addIssue({ code: 'custom', path: ['bodyText'], message: 'whatsapp.templates.errors.bodyGaps' });
    } else if (/^\{\{\s*\d+\s*\}\}/.test(data.bodyText) || /\{\{\s*\d+\s*\}\}$/.test(data.bodyText)) {
      ctx.addIssue({ code: 'custom', path: ['bodyText'], message: 'whatsapp.templates.errors.bodyEdge' });
    }
    indexes.forEach((_, position) => {
      if (!data.bodyExamples[position]?.trim()) {
        ctx.addIssue({ code: 'custom', path: ['bodyExamples', position], message: 'whatsapp.templates.errors.example' });
      }
    });
    if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(data.headerType) && !data.headerHandle) {
      ctx.addIssue({ code: 'custom', path: ['headerHandle'], message: 'whatsapp.templates.errors.headerSample' });
    }
    if (data.headerType === 'TEXT' && data.headerText && data.headerText.includes('{{')) {
      ctx.addIssue({ code: 'custom', path: ['headerText'], message: 'whatsapp.templates.errors.headerVariable' });
    }
    data.buttons.forEach((button, position) => {
      if (button.type === 'URL' && !/^https:\/\/\S+$/.test(button.url ?? '')) {
        ctx.addIssue({ code: 'custom', path: ['buttons', position, 'url'], message: 'whatsapp.templates.errors.url' });
      }
      if (button.type === 'PHONE_NUMBER' && !/^\+\d{8,15}$/.test(button.phoneNumber ?? '')) {
        ctx.addIssue({ code: 'custom', path: ['buttons', position, 'phoneNumber'], message: 'whatsapp.templates.errors.phone' });
      }
    });
  });

type Values = z.infer<typeof schema>;

/** Pre-filled fields when a template is started from the library or from an existing one. */
export type TemplateDraft = Partial<Values>;

const EMPTY: Values = {
  name: '',
  language: 'mr',
  category: 'UTILITY',
  headerType: 'NONE',
  headerText: '',
  headerHandle: '',
  headerSampleName: '',
  bodyText: '',
  bodyExamples: [],
  footerText: '',
  buttons: [],
};

/** Meta wants lowercase letters, digits and underscores; fix what the user types as they go. */
const toTemplateName = (value: string) => value.toLowerCase().replace(/[\s-]+/g, '_').replace(/[^a-z0-9_]/g, '');

/** Writes a message template and submits it to Meta for review (usually minutes to a day). */
export function CreateTemplateDialog({
  open,
  onOpenChange,
  numberId,
  initial,
  onSubmitted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  numberId: string | null;
  /** Start from this wording instead of a blank form. */
  initial?: TemplateDraft | null;
  onSubmitted?: () => void;
}) {
  const { t } = useTranslation();
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);

  const {
    register,
    control,
    handleSubmit,
    reset,
    setError,
    setValue,
    getValues,
    watch,
    formState: { errors },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: EMPTY });
  const { fields, append, remove } = useFieldArray({ control, name: 'buttons' });

  const values = watch();
  const indexes = variableIndexes(values.bodyText ?? '');
  const examplesNeeded = indexes.length;

  // One example box per variable; keep what was typed when the count changes.
  useEffect(() => {
    const current = getValues('bodyExamples');
    if (current.length !== examplesNeeded) {
      setValue('bodyExamples', Array.from({ length: examplesNeeded }, (_, position) => current[position] ?? ''));
    }
  }, [examplesNeeded, getValues, setValue]);

  // A fresh form each time it opens: blank, or the wording it was started from.
  useEffect(() => {
    reset(open ? { ...EMPTY, ...initial } : EMPTY);
    replacePreview(null);
  }, [open, initial, reset]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = useMutation({
    mutationFn: (input: Values) => {
      const body: CreateTemplateBody = {
        numberId,
        name: input.name,
        language: input.language,
        category: input.category,
        headerText: input.headerType === 'TEXT' ? input.headerText || null : null,
        headerFormat: ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(input.headerType) ? (input.headerType as 'IMAGE' | 'VIDEO' | 'DOCUMENT') : null,
        headerHandle: ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(input.headerType) ? input.headerHandle : null,
        bodyText: input.bodyText,
        bodyExamples: input.bodyExamples,
        footerText: input.footerText || null,
        buttons: input.buttons.map((button) =>
          button.type === 'URL'
            ? { type: 'URL', text: button.text, url: button.url }
            : button.type === 'PHONE_NUMBER'
              ? { type: 'PHONE_NUMBER', text: button.text, phoneNumber: button.phoneNumber }
              : { type: 'QUICK_REPLY', text: button.text },
        ),
      };
      return api.post('/whatsapp/templates', body);
    },
    onSuccess: () => {
      invalidateTemplates();
      toast.success(t('whatsapp.templates.submitted'), { description: t('whatsapp.templates.submittedText') });
      onOpenChange(false);
      onSubmitted?.();
    },
    onError: (error) => {
      if (error instanceof ApiError && Object.keys(error.fieldErrors).length) {
        for (const [field, message] of Object.entries(error.fieldErrors)) setError(field as keyof Values, { message });
        return;
      }
      toast.error(t('whatsapp.templates.submitFailed'), { description: errorMessage(t, error) });
    },
  });

  const sampleInput = useRef<HTMLInputElement>(null);
  // A local preview of the chosen sample (this browser only), so the preview shows the real image.
  const [samplePreview, setSamplePreview] = useState<string | null>(null);
  const replacePreview = (next: string | null) =>
    setSamplePreview((current) => {
      if (current) URL.revokeObjectURL(current);
      return next;
    });
  useEffect(() => () => replacePreview(null), []); // eslint-disable-line react-hooks/exhaustive-deps

  const uploadSample = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append('file', file);
      if (numberId) form.append('numberId', numberId);
      const result = await api.post<{ data: { handle: string } }>('/whatsapp/templates/header-sample', form);
      return { handle: result.data.handle, name: file.name, preview: /^(image|video)\//.test(file.type) ? URL.createObjectURL(file) : null };
    },
    onSuccess: ({ handle, name, preview }) => {
      setValue('headerHandle', handle, { shouldValidate: true });
      setValue('headerSampleName', name);
      replacePreview(preview);
    },
    onError: (error) => toast.error(t('whatsapp.templates.sampleFailed'), { description: errorMessage(t, error) }),
  });

  function addVariable() {
    const element = bodyRef.current;
    const text = getValues('bodyText');
    const next = (variableIndexes(text).pop() ?? 0) + 1;
    const token = `{{${next}}}`;
    const start = element?.selectionStart ?? text.length;
    const end = element?.selectionEnd ?? text.length;
    setValue('bodyText', text.slice(0, start) + token + text.slice(end), { shouldDirty: true });
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(start + token.length, start + token.length);
    });
  }

  const bodyField = register('bodyText');
  const exampleError = (position: number) => {
    const entry = errors.bodyExamples;
    return Array.isArray(entry) ? entry[position]?.message : undefined;
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !submit.isPending && onOpenChange(next)}>
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle>{t('whatsapp.templates.createTitle')}</DialogTitle>
          <DialogDescription>{t('whatsapp.templates.createText')}</DialogDescription>
        </DialogHeader>

        <form id="create-template" onSubmit={handleSubmit((input) => submit.mutate(input))} noValidate className="flex min-h-0 flex-1 flex-col">
          <DialogBody className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
            <div className="min-w-0 space-y-4">
              <FormField
                label={t('whatsapp.templates.name')}
                htmlFor="tpl-name"
                required
                error={errors.name?.message}
                hint={t('whatsapp.templates.nameHint')}
              >
                <Input
                  id="tpl-name"
                  autoComplete="off"
                  invalid={Boolean(errors.name)}
                  placeholder="donation_thank_you"
                  {...register('name', { onChange: (event) => setValue('name', toTemplateName(event.target.value)) })}
                />
              </FormField>

              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label={t('whatsapp.templates.language')} htmlFor="tpl-language" required error={errors.language?.message}>
                  <Controller
                    control={control}
                    name="language"
                    render={({ field }) => (
                      <SimpleSelect
                        value={field.value}
                        onValueChange={field.onChange}
                        options={LANGUAGES}
                        ariaLabel={t('whatsapp.templates.language')}
                      />
                    )}
                  />
                </FormField>
                <FormField label={t('whatsapp.templates.categoryLabel')} htmlFor="tpl-category" required hint={t(`whatsapp.templates.categoryHint.${values.category}`)}>
                  <Controller
                    control={control}
                    name="category"
                    render={({ field }) => (
                      <SimpleSelect
                        value={field.value}
                        onValueChange={field.onChange}
                        options={(['UTILITY', 'MARKETING'] as const).map((key) => ({
                          value: key,
                          label: t(`whatsapp.templates.category.${key}`),
                        }))}
                        ariaLabel={t('whatsapp.templates.categoryLabel')}
                      />
                    )}
                  />
                </FormField>
              </div>

              <div className="space-y-3">
                <FormField label={t('whatsapp.templates.header')} htmlFor="tpl-header-type" hint={t('whatsapp.templates.headerHint')}>
                  <Controller
                    control={control}
                    name="headerType"
                    render={({ field }) => (
                      <SimpleSelect
                        value={field.value}
                        onValueChange={(next) => {
                          field.onChange(next);
                          // A sample belongs to one kind of file; a different kind needs its own.
                          setValue('headerHandle', '');
                          setValue('headerSampleName', '');
                          replacePreview(null);
                        }}
                        options={HEADER_TYPES.map((key) => ({ value: key, label: t(`whatsapp.templates.headerTypes.${key}`) }))}
                        ariaLabel={t('whatsapp.templates.header')}
                      />
                    )}
                  />
                </FormField>
                {values.headerType === 'TEXT' && (
                  <FormField label={t('whatsapp.templates.headerText')} htmlFor="tpl-header" error={errors.headerText?.message}>
                    <Input id="tpl-header" maxLength={60} invalid={Boolean(errors.headerText)} {...register('headerText')} />
                  </FormField>
                )}
                {['IMAGE', 'VIDEO', 'DOCUMENT'].includes(values.headerType) && (
                  <FormField
                    label={t('whatsapp.templates.headerSample')}
                    htmlFor="tpl-header-sample"
                    required
                    error={errors.headerHandle?.message}
                    hint={t('whatsapp.templates.headerSampleHint')}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        ref={sampleInput}
                        id="tpl-header-sample"
                        type="file"
                        accept={SAMPLE_ACCEPT[values.headerType]}
                        className="sr-only"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) uploadSample.mutate(file);
                          event.target.value = '';
                        }}
                      />
                      <Button type="button" variant="outline" size="sm" loading={uploadSample.isPending} onClick={() => sampleInput.current?.click()}>
                        <Paperclip className="h-3.5 w-3.5" aria-hidden="true" />
                        {values.headerHandle ? t('whatsapp.campaign.replaceFile') : t('whatsapp.campaign.chooseFile')}
                      </Button>
                      {values.headerHandle && (
                        <span className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-ink">
                          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" aria-hidden="true" />
                          <span className="truncate">{values.headerSampleName}</span>
                        </span>
                      )}
                    </div>
                  </FormField>
                )}
              </div>

              <FormField
                label={t('whatsapp.templates.body')}
                htmlFor="tpl-body"
                required
                error={errors.bodyText?.message}
                hint={t('whatsapp.characters', { count: (values.bodyText ?? '').length, max: MAX_BODY })}
              >
                <Textarea
                  id="tpl-body"
                  rows={6}
                  maxLength={MAX_BODY}
                  invalid={Boolean(errors.bodyText)}
                  placeholder={t('whatsapp.templates.bodyPlaceholder', VARIABLE_SAMPLES)}
                  {...bodyField}
                  ref={(element) => {
                    bodyField.ref(element);
                    bodyRef.current = element;
                  }}
                />
              </FormField>
              <div className="-mt-2 flex items-center gap-2">
                <Button type="button" variant="outline" size="sm" onClick={addVariable}>
                  <Braces className="h-3.5 w-3.5" aria-hidden="true" />
                  {t('whatsapp.templates.addVariable')}
                </Button>
                <span className="text-[11.5px] text-ink-muted">{t('whatsapp.templates.variableNote', VARIABLE_SAMPLES)}</span>
              </div>

              {examplesNeeded > 0 && (
                <fieldset className="space-y-3 rounded-control border border-line bg-canvas/40 p-3">
                  <legend className="px-1 text-[12px] font-medium text-ink">{t('whatsapp.templates.examples')}</legend>
                  <p className="text-[11.5px] text-ink-muted">{t('whatsapp.templates.examplesText')}</p>
                  {indexes.map((index, position) => (
                    <FormField
                      key={index}
                      label={t('whatsapp.variable', { number: index })}
                      htmlFor={`tpl-example-${position}`}
                      required
                      error={exampleError(position)}
                    >
                      <Input
                        id={`tpl-example-${position}`}
                        maxLength={200}
                        invalid={Boolean(exampleError(position))}
                        {...register(`bodyExamples.${position}` as const)}
                      />
                    </FormField>
                  ))}
                </fieldset>
              )}

              <FormField label={t('whatsapp.templates.footer')} htmlFor="tpl-footer" error={errors.footerText?.message} hint={t('whatsapp.templates.footerHint')}>
                <Input id="tpl-footer" maxLength={60} invalid={Boolean(errors.footerText)} {...register('footerText')} />
              </FormField>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[13px] font-medium text-ink">{t('whatsapp.templates.buttons')}</p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={fields.length >= MAX_BUTTONS}
                    onClick={() => append({ type: 'QUICK_REPLY', text: '' })}
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    {t('whatsapp.templates.addButton')}
                  </Button>
                </div>
                {fields.length === 0 && <p className="text-[11.5px] text-ink-muted">{t('whatsapp.templates.buttonsHint')}</p>}
                {fields.map((field, position) => {
                  const type = values.buttons?.[position]?.type ?? field.type;
                  const rowErrors = errors.buttons?.[position];
                  return (
                    <div key={field.id} className="grid gap-3 rounded-control border border-line p-3 sm:grid-cols-[150px_minmax(0,1fr)_auto] sm:items-start">
                      <FormField label={t('whatsapp.templates.buttonType')} htmlFor={`tpl-button-type-${position}`}>
                        <Controller
                          control={control}
                          name={`buttons.${position}.type`}
                          render={({ field: typeField }) => (
                            <SimpleSelect
                              value={typeField.value}
                              onValueChange={typeField.onChange}
                              options={(['QUICK_REPLY', 'URL', 'PHONE_NUMBER'] as const).map((key) => ({
                                value: key,
                                label: t(`whatsapp.templates.buttonTypes.${key}`),
                              }))}
                              ariaLabel={t('whatsapp.templates.buttonType')}
                            />
                          )}
                        />
                      </FormField>
                      <div className="min-w-0 space-y-3">
                        <FormField label={t('whatsapp.templates.buttonText')} htmlFor={`tpl-button-text-${position}`} required error={rowErrors?.text?.message}>
                          <Input id={`tpl-button-text-${position}`} maxLength={25} invalid={Boolean(rowErrors?.text)} {...register(`buttons.${position}.text`)} />
                        </FormField>
                        {type === 'URL' && (
                          <FormField label={t('whatsapp.templates.buttonUrl')} htmlFor={`tpl-button-url-${position}`} required error={rowErrors?.url?.message}>
                            <Input
                              id={`tpl-button-url-${position}`}
                              inputMode="url"
                              placeholder="https://"
                              invalid={Boolean(rowErrors?.url)}
                              {...register(`buttons.${position}.url`)}
                            />
                          </FormField>
                        )}
                        {type === 'PHONE_NUMBER' && (
                          <FormField label={t('whatsapp.templates.buttonPhone')} htmlFor={`tpl-button-phone-${position}`} required error={rowErrors?.phoneNumber?.message}>
                            <Input
                              id={`tpl-button-phone-${position}`}
                              inputMode="tel"
                              placeholder="+919876543210"
                              invalid={Boolean(rowErrors?.phoneNumber)}
                              {...register(`buttons.${position}.phoneNumber`)}
                            />
                          </FormField>
                        )}
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="sm:mt-6"
                        aria-label={t('whatsapp.templates.removeButton')}
                        onClick={() => remove(position)}
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            </div>

            <aside className="min-w-0 lg:sticky lg:top-0 lg:self-start">
              <p className="mb-1.5 text-[11.5px] font-medium text-ink-muted">{t('whatsapp.templates.preview')}</p>
              <TemplatePreview
                headerFormat={['IMAGE', 'VIDEO', 'DOCUMENT'].includes(values.headerType) ? values.headerType : null}
                headerMedia={
                  values.headerSampleName
                    ? { kind: values.headerType.toLowerCase() as 'image' | 'video' | 'document', fileName: values.headerSampleName, previewUrl: samplePreview ?? undefined }
                    : null
                }
                headerText={values.headerType === 'TEXT' ? values.headerText : null}
                bodyText={values.bodyText || t('whatsapp.templates.bodyPlaceholder', VARIABLE_SAMPLES)}
                footerText={values.footerText}
                buttons={(values.buttons ?? []).map((button) => ({ type: button.type, text: button.text || t(`whatsapp.templates.buttonTypes.${button.type}`) }))}
                values={values.bodyExamples}
              />
              <p className="mt-3 text-[11.5px] leading-relaxed text-ink-muted">{t('whatsapp.templates.reviewNote')}</p>
            </aside>
          </DialogBody>

          <DialogFooter>
            <Button type="button" variant="outline" disabled={submit.isPending} onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" loading={submit.isPending}>
              {t('whatsapp.templates.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

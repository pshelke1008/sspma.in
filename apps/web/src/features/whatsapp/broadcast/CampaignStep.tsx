import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, LayoutTemplate, Loader2, Paperclip, PlugZap, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/AuthProvider';
import { errorMessage } from '@/i18n/errors';
import { FormField } from '@/components/common/forms';
import { EmptyState } from '@/components/common/states';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SimpleSelect } from '@/components/ui/select';
import { bytes } from '@/lib/utils/format';
import type { MessageTemplate } from '../api';
import { CreateTemplateDialog } from '../CreateTemplateDialog';
import { TemplatePreview } from '../TemplatePreview';
import { templateKeyOf, type HeaderKind, type HeaderMedia, type WizardState } from './api';

const NAME_MAX = 120;
const ACCEPT: Record<HeaderKind, string> = {
  image: 'image/jpeg,image/png',
  video: 'video/mp4,video/3gpp',
  document: 'application/pdf',
};

/** Step 1: name the broadcast, pick the approved template, attach its header file if it has one. */
export function CampaignStep({
  state,
  onChange,
  templates,
  hidden,
  loading,
  hasCloud,
  errors,
}: {
  state: WizardState;
  onChange: (next: Partial<WizardState>) => void;
  templates: MessageTemplate[];
  hidden: number;
  loading: boolean;
  hasCloud: boolean;
  errors: { name?: string; template?: string; media?: string };
}) {
  const { t } = useTranslation();
  const { can } = useAuth();
  const [templateOpen, setTemplateOpen] = useState(false);
  const selected = templates.find((template) => templateKeyOf(template) === state.templateKey);

  if (!hasCloud) {
    return (
      <EmptyState
        icon={PlugZap}
        title={t('whatsapp.campaign.needCloudTitle')}
        description={t('whatsapp.campaign.needCloudText')}
        action={
          can('whatsapp.manage') ? (
            <Button asChild size="sm">
              <Link to="/settings/whatsapp">{t('whatsapp.openSettings')}</Link>
            </Button>
          ) : undefined
        }
      />
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-4">
        <FormField
          label={t('whatsapp.broadcastName')}
          htmlFor="campaign-name"
          required
          error={errors.name}
          hint={t('whatsapp.broadcastNameHint')}
        >
          <Input
            id="campaign-name"
            maxLength={NAME_MAX}
            invalid={Boolean(errors.name)}
            value={state.name}
            onChange={(event) => onChange({ name: event.target.value })}
          />
        </FormField>

        <FormField
          label={t('whatsapp.template')}
          htmlFor="campaign-template"
          required
          error={errors.template}
          hint={
            !loading && templates.length === 0
              ? t('whatsapp.noTemplates')
              : hidden
                ? t('whatsapp.templatesHidden', { count: hidden })
                : t('whatsapp.campaign.templateHint')
          }
        >
          <SimpleSelect
            value={state.templateKey || undefined}
            onValueChange={(key) => {
              const next = templates.find((template) => templateKeyOf(template) === key);
              // New template, new variables and possibly a different kind of header.
              onChange({ templateKey: key, mapping: {}, headerMedia: next?.requiresHeaderMedia && state.headerMedia?.kind === next.headerFormat?.toLowerCase() ? state.headerMedia : null });
            }}
            options={templates.map((template) => ({
              value: templateKeyOf(template),
              label: template.name,
              hint: `${template.language} · ${t(`whatsapp.templates.category.${template.category}`, { defaultValue: template.category })}`,
            }))}
            placeholder={loading ? t('common.loading') : t('whatsapp.chooseTemplate')}
            invalid={Boolean(errors.template)}
            ariaLabel={t('whatsapp.template')}
          />
        </FormField>

        {can('whatsapp.manage') && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-control border border-dashed border-line px-3 py-2.5">
            <p className="min-w-0 flex-1 text-[12px] text-ink-muted">{t('whatsapp.campaign.needAnother')}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => setTemplateOpen(true)}>
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              {t('whatsapp.templates.add')}
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link to="/whatsapp/templates">
                <LayoutTemplate className="h-3.5 w-3.5" aria-hidden="true" />
                {t('whatsapp.templates.libraryButton')}
              </Link>
            </Button>
            <CreateTemplateDialog open={templateOpen} onOpenChange={setTemplateOpen} numberId={null} />
          </div>
        )}

        {selected?.requiresHeaderMedia && (
          <HeaderMediaField template={selected} media={state.headerMedia} onChange={(headerMedia) => onChange({ headerMedia })} error={errors.media} />
        )}
      </div>

      <aside className="min-w-0">
        <p className="mb-1.5 text-[11.5px] font-medium text-ink-muted">{t('whatsapp.templates.preview')}</p>
        {selected ? (
          <>
            <TemplatePreview
              headerFormat={selected.headerFormat}
              headerMedia={state.headerMedia}
              headerText={selected.headerText}
              bodyText={selected.bodyText}
              footerText={selected.footerText}
              buttons={selected.buttons}
            />
            {selected.bodyParameterCount > 0 && (
              <p className="mt-2 text-[11.5px] text-ink-muted">{t('whatsapp.campaign.variablesNext', { count: selected.bodyParameterCount })}</p>
            )}
          </>
        ) : (
          <p className="rounded-card border border-dashed border-line px-4 py-8 text-center text-[12.5px] text-ink-muted">{t('whatsapp.campaign.pickTemplate')}</p>
        )}
      </aside>
    </div>
  );
}

/** The image, video or PDF that goes at the top of every message. Uploaded to Meta as soon as it is chosen. */
function HeaderMediaField({
  template,
  media,
  onChange,
  error,
}: {
  template: MessageTemplate;
  media: HeaderMedia | null;
  onChange: (media: HeaderMedia | null) => void;
  error?: string;
}) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const [size, setSize] = useState<number | null>(null);
  const kind = (template.headerFormat ?? 'IMAGE').toLowerCase() as HeaderKind;

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append('file', file);
      const result = await api.post<{ data: HeaderMedia }>('/whatsapp/campaigns/header-media', form);
      return { media: { ...result.data, previewUrl: kind === 'document' ? undefined : URL.createObjectURL(file) }, size: file.size };
    },
    onSuccess: (result) => {
      if (media?.previewUrl) URL.revokeObjectURL(media.previewUrl);
      setSize(result.size);
      onChange(result.media);
    },
    onError: (err) => toast.error(t('whatsapp.campaign.mediaFailed'), { description: errorMessage(t, err) }),
  });

  return (
    <FormField
      label={t(`whatsapp.campaign.headerLabel.${kind}`)}
      htmlFor="campaign-header-media"
      required
      error={error}
      hint={t(`whatsapp.campaign.headerHint.${kind}`)}
    >
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={input}
          id="campaign-header-media"
          type="file"
          accept={ACCEPT[kind]}
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) upload.mutate(file);
            event.target.value = '';
          }}
        />
        <Button type="button" variant="outline" size="sm" onClick={() => input.current?.click()} disabled={upload.isPending}>
          {upload.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Paperclip className="h-3.5 w-3.5" aria-hidden="true" />}
          {media ? t('whatsapp.campaign.replaceFile') : t('whatsapp.campaign.chooseFile')}
        </Button>
        {media && (
          <>
            <span className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-ink">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" aria-hidden="true" />
              <span className="truncate">{media.fileName}</span>
              {size !== null && <span className="shrink-0 text-ink-muted">{bytes(size)}</span>}
            </span>
            <Button type="button" variant="ghost" size="icon-sm" aria-label={t('whatsapp.campaign.removeFile')} onClick={() => onChange(null)}>
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          </>
        )}
      </div>
    </FormField>
  );
}

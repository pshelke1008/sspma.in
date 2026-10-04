import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Trans, useTranslation } from 'react-i18next';
import { AlertTriangle, Copy, FileText, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api, buildQuery } from '@/lib/api/client';
import { errorMessage } from '@/i18n/errors';
import { SectionCard } from '@/components/common/SectionCard';
import { ConfirmationDialog } from '@/components/common/ConfirmationDialog';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/common/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SimpleSelect } from '@/components/ui/select';
import { TEMPLATE_STATUS_TONES, invalidateTemplates, useAllTemplates, type MessageTemplate, type WhatsAppStatus } from './api';
import { CreateTemplateDialog, type TemplateDraft } from './CreateTemplateDialog';
import { TemplateGallery } from './TemplateGallery';
import { draftFromTemplate } from './templateDrafts';
import { TemplatePreview } from './TemplatePreview';

/**
 * Message templates of the connected WhatsApp Business Account: what Meta has
 * approved, what is still in review, and a form to submit new ones. Templates
 * are what lets a broadcast reach donors who have not messaged recently.
 */
export function TemplatesCard({ status, gallery = false }: { status: WhatsAppStatus; /** Also show the starter library above the list. */ gallery?: boolean }) {
  const { t } = useTranslation();
  const numbers = status.cloud.numbers ?? [];
  // Templates belong to the business account, so only offer a choice when there is more than one.
  const accounts = numbers.filter((number, index) => numbers.findIndex((other) => other.businessAccountId === number.businessAccountId) === index);
  const [numberId, setNumberId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  // The wording the form starts from: held in state so typing in the form never resets it.
  const [draft, setDraft] = useState<TemplateDraft | null>(null);
  const openForm = (next: TemplateDraft | null = null) => {
    setDraft(next);
    setCreating(true);
  };
  const [pendingDelete, setPendingDelete] = useState<MessageTemplate | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data, isLoading, isFetching, error, refetch } = useAllTemplates(numberId, true);
  const templates = data?.data ?? [];

  const remove = useMutation({
    mutationFn: (template: MessageTemplate) =>
      api.delete(`/whatsapp/templates/${encodeURIComponent(template.name)}` + buildQuery({ id: template.id, numberId })),
    onSuccess: (_data, template) => {
      invalidateTemplates();
      setPendingDelete(null);
      toast.success(t('whatsapp.templates.deleted', { name: template.name }));
    },
    onError: (err) => toast.error(t('whatsapp.templates.deleteFailed'), { description: errorMessage(t, err) }),
  });

  const card = (
    <SectionCard
      title={
        <span className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-brand" aria-hidden="true" />
          {t('whatsapp.templates.title')}
        </span>
      }
      description={t('whatsapp.templates.text')}
      action={
        <>
          {accounts.length > 1 && (
            <SimpleSelect
              className="w-44"
              value={numberId ?? accounts[0].id}
              onValueChange={setNumberId}
              options={accounts.map((number) => ({ value: number.id, label: number.displayNumber ?? number.phoneNumberId }))}
              ariaLabel={t('whatsapp.templates.account')}
            />
          )}
          <Button variant="outline" size="sm" loading={isFetching && !isLoading} onClick={() => void refetch()}>
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            {t('whatsapp.templates.refresh')}
          </Button>
          <Button size="sm" onClick={() => openForm()}>
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            {t('whatsapp.templates.new')}
          </Button>
        </>
      }
      noPadding
    >
      {isLoading ? (
        <div className="p-4">
          <TableSkeleton rows={3} columns={4} />
        </div>
      ) : error ? (
        <ErrorState message={errorMessage(t, error)} onRetry={() => void refetch()} />
      ) : templates.length === 0 ? (
        <EmptyState
          icon={FileText}
          title={t('whatsapp.templates.emptyTitle')}
          description={t('whatsapp.templates.emptyText')}
          action={
            <Button size="sm" onClick={() => openForm()}>
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              {t('whatsapp.templates.new')}
            </Button>
          }
        />
      ) : (
        <ul className="divide-y divide-line">
          {templates.map((template) => {
            const key = `${template.name}|${template.language}`;
            const open = expanded === key;
            return (
              <li key={key} className="px-4 py-3 sm:px-5">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => setExpanded(open ? null : key)}
                    className="min-w-0 flex-1 rounded-control text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/50"
                  >
                    <span className="block truncate text-[13px] font-medium text-ink">{template.name}</span>
                    <span className="block truncate text-[11.5px] text-ink-muted">
                      {template.language} · {t(`whatsapp.templates.category.${template.category}`, { defaultValue: template.category })}
                      {template.bodyParameterCount > 0 && ` · ${t('whatsapp.templates.variables', { count: template.bodyParameterCount })}`}
                    </span>
                  </button>
                  <Badge tone={TEMPLATE_STATUS_TONES[template.status] ?? 'neutral'}>
                    {t(`whatsapp.templates.status.${template.status}`, { defaultValue: template.status })}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('whatsapp.templates.copyLabel', { name: template.name })}
                    title={t('whatsapp.templates.copyHint')}
                    onClick={() => openForm(draftFromTemplate(template))}
                  >
                    <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('whatsapp.templates.deleteLabel', { name: template.name })}
                    onClick={() => setPendingDelete(template)}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                </div>

                {template.status === 'REJECTED' && template.rejectedReason && (
                  <p className="mt-1.5 flex items-start gap-1.5 text-[11.5px] text-danger">
                    <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    {t('whatsapp.templates.rejectedBecause', { reason: template.rejectedReason.replace(/_/g, ' ').toLowerCase() })}
                  </p>
                )}
                {template.status === 'APPROVED' && template.requiresHeaderMedia && !template.unsendableReason && (
                  <p className="mt-1.5 text-[11.5px] text-ink-muted">{t('whatsapp.templates.mediaNote')}</p>
                )}
                {template.status === 'APPROVED' && template.unsendableReason && (
                  <p className="mt-1.5 text-[11.5px] text-ink-muted">
                    {t(`whatsapp.templates.unsendable.${template.unsendableReason}`)}
                  </p>
                )}

                {open && (
                  <TemplatePreview
                    className="mt-3 max-w-md"
                    headerFormat={template.headerFormat}
                    headerText={template.headerText}
                    bodyText={template.bodyText}
                    footerText={template.footerText}
                    buttons={template.buttons}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}

      <CreateTemplateDialog open={creating} onOpenChange={setCreating} numberId={numberId} initial={draft} />

      <ConfirmationDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => !open && !remove.isPending && setPendingDelete(null)}
        title={t('whatsapp.templates.deleteTitle')}
        description={
          <Trans
            i18nKey="whatsapp.templates.deleteText"
            values={{ name: pendingDelete?.name ?? '', language: pendingDelete?.language ?? '' }}
            components={{ bold: <span className="font-semibold text-ink" /> }}
          />
        }
        confirmLabel={t('common.delete')}
        tone="danger"
        loading={remove.isPending}
        onConfirm={() => pendingDelete && remove.mutate(pendingDelete)}
      />
    </SectionCard>
  );

  if (!gallery) return card;
  return (
    <div className="space-y-6">
      <TemplateGallery onPick={openForm} />
      {card}
    </div>
  );
}

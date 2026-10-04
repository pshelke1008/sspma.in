import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, ArrowLeft, CheckCircle2, MessageCircle, PlugZap, Send, Users } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api/client';
import { queryClient, queryKeys } from '@/lib/api/queryClient';
import { useAuth } from '@/lib/auth/AuthProvider';
import { errorMessage } from '@/i18n/errors';
import { EmptyState } from '@/components/common/states';
import { FormField } from '@/components/common/forms';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/misc';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { formatDate, formatNumber } from '@/lib/utils/format';
import {
  BROADCAST_TONES,
  sendingProvider,
  useWhatsAppStatus,
  type Broadcast,
  type BroadcastPreview,
} from './api';
import { EMPTY_COMPOSER, MessageComposer, contentError, toContent, type ComposerState } from './MessageComposer';

type Stage = 'compose' | 'review' | 'progress';

/**
 * Compose → review who will actually receive it → send and watch progress.
 * The review step is where consent and quota are made visible: donors who have
 * not opted in are counted and skipped, never messaged.
 */
export function BroadcastDialog({
  open,
  onOpenChange,
  donorIds,
  onStarted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  donorIds: string[];
  onStarted?: () => void;
}) {
  const { t } = useTranslation();
  const { can } = useAuth();
  const { data: status, isLoading: statusLoading } = useWhatsAppStatus(open);
  const provider = sendingProvider(status);

  const [stage, setStage] = useState<Stage>('compose');
  const [name, setName] = useState('');
  const [composer, setComposer] = useState<ComposerState>(EMPTY_COMPOSER);
  const [errors, setErrors] = useState<{ name?: string; content?: string }>({});
  const [preview, setPreview] = useState<BroadcastPreview | null>(null);
  const [broadcastId, setBroadcastId] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setStage('compose');
      setName(t('whatsapp.defaultBroadcastName', { date: formatDate(new Date()) }));
      setComposer(EMPTY_COMPOSER);
      setErrors({});
      setPreview(null);
      setBroadcastId(null);
    }
  }, [open, t]);

  const previewMutation = useMutation({
    mutationFn: () =>
      api.post<BroadcastPreview>('/whatsapp/broadcasts/preview', { donorIds, ...toContent(composer, provider) }),
    onSuccess: (data) => {
      setPreview(data);
      setStage('review');
    },
    onError: (error) => toast.error(t('whatsapp.previewFailed'), { description: errorMessage(t, error) }),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      api.post<{ data: Broadcast }>('/whatsapp/broadcasts', { name: name.trim(), donorIds, ...toContent(composer, provider) }),
    onSuccess: (result) => {
      setBroadcastId(result.data.id);
      setStage('progress');
      onStarted?.();
      queryClient.invalidateQueries({ queryKey: queryKeys.broadcasts });
    },
    onError: (error) => toast.error(t('whatsapp.broadcastFailed'), { description: errorMessage(t, error) }),
  });

  const { data: progress } = useQuery({
    queryKey: queryKeys.broadcast(broadcastId ?? ''),
    queryFn: () => api.get<{ data: Broadcast }>(`/whatsapp/broadcasts/${broadcastId}?summary=1`),
    enabled: Boolean(broadcastId) && stage === 'progress',
    refetchInterval: (query) => {
      const current = query.state.data?.data.status;
      return current === 'COMPLETED' || current === 'CANCELLED' ? false : 2000;
    },
  });

  const cancelMutation = useMutation({
    mutationFn: () => api.post(`/whatsapp/broadcasts/${broadcastId}/cancel`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.broadcast(broadcastId ?? '') });
      queryClient.invalidateQueries({ queryKey: queryKeys.broadcasts });
    },
    onError: (error) => toast.error(t('whatsapp.cancelFailed'), { description: errorMessage(t, error) }),
  });

  function review() {
    const next: typeof errors = {};
    if (name.trim().length < 2) next.name = 'whatsapp.nameRequired';
    const problem = contentError(composer, provider);
    if (problem) next.content = problem;
    setErrors(next);
    if (Object.keys(next).length === 0) previewMutation.mutate();
  }

  const broadcast = progress?.data;
  const done = broadcast ? broadcast.sentCount + broadcast.failedCount + broadcast.skippedCount : 0;
  const finished = broadcast?.status === 'COMPLETED' || broadcast?.status === 'CANCELLED';

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && stage === 'progress') queryClient.invalidateQueries({ queryKey: queryKeys.broadcasts });
        onOpenChange(next);
      }}
    >
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{t('whatsapp.broadcastTitle')}</DialogTitle>
          <DialogDescription>{t('whatsapp.selectedDonors', { count: donorIds.length })}</DialogDescription>
        </DialogHeader>

        <DialogBody>
          {!statusLoading && !provider && stage !== 'progress' ? (
            <EmptyState
              icon={PlugZap}
              title={t('whatsapp.notConnectedTitle')}
              description={t('whatsapp.notConnectedText')}
              action={
                can('whatsapp.manage') && (
                  <Button asChild size="sm">
                    <Link to="/settings/whatsapp">{t('whatsapp.openSettings')}</Link>
                  </Button>
                )
              }
            />
          ) : stage === 'compose' ? (
            <div className="space-y-4">
              <FormField label={t('whatsapp.broadcastName')} htmlFor="bc-name" required error={errors.name} hint={t('whatsapp.broadcastNameHint')}>
                <Input id="bc-name" value={name} maxLength={120} invalid={Boolean(errors.name)} onChange={(event) => setName(event.target.value)} />
              </FormField>
              <MessageComposer idPrefix="bc" provider={provider} value={composer} onChange={setComposer} error={errors.content} />
            </div>
          ) : stage === 'review' && preview ? (
            <div className="space-y-4">
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Figure label={t('whatsapp.selected')} value={preview.selected} />
                <Figure label={t('whatsapp.willReceive')} value={preview.eligible} tone="success" />
                <Figure label={t('whatsapp.notOptedIn')} value={preview.skipped.NOT_OPTED_IN} tone={preview.skipped.NOT_OPTED_IN ? 'warning' : undefined} />
                <Figure
                  label={t('whatsapp.noNumberOrInactive')}
                  value={preview.skipped.NO_NUMBER + preview.skipped.INACTIVE}
                  tone={preview.skipped.NO_NUMBER + preview.skipped.INACTIVE ? 'warning' : undefined}
                />
              </dl>

              <p className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink-muted">
                {t('whatsapp.sendingVia')}
                {preview.provider && <Badge tone="brand">{t(`whatsapp.provider.${preview.provider}`)}</Badge>}
              </p>

              {preview.skipped.NOT_OPTED_IN > 0 && (
                <p className="rounded-control border border-line bg-canvas/60 px-3 py-2 text-[12px] leading-relaxed text-ink-muted">
                  {t('whatsapp.consentNote')}
                </p>
              )}

              {preview.quota && (
                <div
                  className={
                    preview.eligible > preview.quota.remaining
                      ? 'flex items-start gap-2 rounded-control border border-warning/30 bg-warning/10 px-3 py-2 text-[12px] text-[#7a5410]'
                      : 'flex items-start gap-2 rounded-control border border-line bg-canvas/60 px-3 py-2 text-[12px] text-ink-muted'
                  }
                >
                  <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>
                    {t('whatsapp.quotaRemaining', {
                      remaining: formatNumber(preview.quota.remaining),
                      limit: formatNumber(preview.quota.limit),
                    })}{' '}
                    {preview.eligible > preview.quota.remaining ? t('whatsapp.quotaShort') : t('whatsapp.pacingNote')}
                  </span>
                </div>
              )}

              {preview.sample && (
                <div>
                  <p className="mb-1.5 text-[11.5px] font-medium text-ink-muted">
                    {t('whatsapp.previewFor', { name: preview.sample.donorName })}
                  </p>
                  <div className="rounded-card bg-brand-light p-3">
                    <div className="ml-auto max-w-[85%] whitespace-pre-wrap rounded-[10px] rounded-tr-sm bg-white px-3 py-2 text-[13px] leading-relaxed text-ink shadow-sm">
                      {preview.sample.body ??
                        `${composer.templateKey.split('|')[0]}${preview.sample.templateParams.length ? ` · ${preview.sample.templateParams.join(' · ')}` : ''}`}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : broadcast ? (
            <div className="space-y-4" aria-live="polite">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[13.5px] font-semibold text-ink">{broadcast.name}</p>
                <Badge tone={BROADCAST_TONES[broadcast.status]}>{t(`whatsapp.broadcastStatus.${broadcast.status}`)}</Badge>
              </div>
              <Progress
                value={broadcast.totalRecipients ? (done / broadcast.totalRecipients) * 100 : 100}
                label={t('whatsapp.progressLabel')}
                className="h-2"
              />
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Figure label={t('whatsapp.recipients')} value={broadcast.totalRecipients} />
                <Figure label={t('whatsapp.sentCount')} value={broadcast.sentCount} tone="success" />
                <Figure label={t('whatsapp.failedCount')} value={broadcast.failedCount} tone={broadcast.failedCount ? 'danger' : undefined} />
                <Figure label={t('whatsapp.skippedCount')} value={broadcast.skippedCount} tone={broadcast.skippedCount ? 'warning' : undefined} />
              </dl>
              <p className="flex items-start gap-2 text-[12px] leading-relaxed text-ink-muted">
                {finished ? (
                  <CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0 text-success" aria-hidden="true" />
                ) : (
                  <MessageCircle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                )}
                {finished ? t('whatsapp.broadcastDone') : t('whatsapp.backgroundNote')}
              </p>
            </div>
          ) : (
            <p className="py-8 text-center text-[12.5px] text-ink-muted">{t('common.loading')}</p>
          )}
        </DialogBody>

        <DialogFooter>
          {stage === 'compose' && (
            <>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t('common.cancel')}
              </Button>
              <Button type="button" onClick={review} loading={previewMutation.isPending} disabled={!provider}>
                <Users className="h-3.5 w-3.5" aria-hidden="true" />
                {t('whatsapp.reviewRecipients')}
              </Button>
            </>
          )}
          {stage === 'review' && preview && (
            <>
              <Button type="button" variant="outline" onClick={() => setStage('compose')}>
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                {t('common.back')}
              </Button>
              <Button
                type="button"
                onClick={() => createMutation.mutate()}
                loading={createMutation.isPending}
                disabled={preview.eligible === 0}
              >
                <Send className="h-3.5 w-3.5" aria-hidden="true" />
                {t('whatsapp.sendToCount', { count: preview.eligible })}
              </Button>
            </>
          )}
          {stage === 'progress' && (
            <>
              {broadcast && !finished && (
                <Button type="button" variant="danger-outline" onClick={() => cancelMutation.mutate()} loading={cancelMutation.isPending}>
                  {t('whatsapp.stopSending')}
                </Button>
              )}
              <Button type="button" onClick={() => onOpenChange(false)}>
                {t('common.close')}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Figure({ label, value, tone }: { label: string; value: number; tone?: 'success' | 'warning' | 'danger' }) {
  const color = tone === 'success' ? 'text-success' : tone === 'warning' ? 'text-[#986812]' : tone === 'danger' ? 'text-danger' : 'text-ink';
  return (
    <div className="rounded-control border border-line bg-white px-3 py-2">
      <dt className="text-[11px] text-ink-muted">{label}</dt>
      <dd className={`mt-0.5 text-[17px] font-semibold tnum ${color}`}>{formatNumber(value)}</dd>
    </div>
  );
}

import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CalendarClock, Megaphone, Square } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api/client';
import { queryClient } from '@/lib/api/queryClient';
import { errorMessage } from '@/i18n/errors';
import { PageHeader } from '@/components/layout/PageHeader';
import { SectionCard } from '@/components/common/SectionCard';
import { ConfirmationDialog } from '@/components/common/ConfirmationDialog';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/common/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/misc';
import { cn } from '@/lib/utils/cn';
import { formatCurrency, formatDate, formatNumber, relativeTime } from '@/lib/utils/format';
import { BROADCAST_TONES, MESSAGE_TONES } from '../api';
import { TemplatePreview } from '../TemplatePreview';
import { isLiveBroadcast, useBroadcast, useBroadcastMessages } from './api';

const FILTERS = ['all', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'SKIPPED', 'QUEUED'] as const;

/** One broadcast: how far it got, what was sent, and what happened to each recipient. */
export default function BroadcastDetailPage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('all');
  const [page, setPage] = useState(1);
  const [confirmStop, setConfirmStop] = useState(false);

  const { data, isLoading, error, refetch } = useBroadcast(id);
  const broadcast = data?.data;
  const live = broadcast ? isLiveBroadcast(broadcast) : false;
  const messages = useBroadcastMessages(id, filter, page, live);

  const stop = useMutation({
    mutationFn: () => api.post(`/whatsapp/broadcasts/${id}/cancel`),
    onSuccess: () => {
      setConfirmStop(false);
      toast.success(t(broadcast?.status === 'SCHEDULED' ? 'whatsapp.campaign.scheduleCancelled' : 'whatsapp.stopped'));
      void queryClient.invalidateQueries({ queryKey: ['whatsapp'] });
    },
    onError: (err) => toast.error(t('whatsapp.cancelFailed'), { description: errorMessage(t, err) }),
  });

  if (error) return <ErrorState message={errorMessage(t, error)} onRetry={() => void refetch()} />;

  const done = broadcast ? broadcast.sentCount + broadcast.failedCount + broadcast.skippedCount : 0;
  const scheduled = broadcast?.status === 'SCHEDULED';

  return (
    <>
      <PageHeader
        title={broadcast?.name ?? t('whatsapp.broadcastTitle')}
        subtitle={broadcast ? `${broadcast.templateName ?? ''} · ${formatDate(broadcast.createdAt, 'long')}${broadcast.createdBy ? ` · ${broadcast.createdBy.name}` : ''}` : undefined}
        breadcrumbs={[{ label: t('whatsapp.campaign.listTitle'), to: '/whatsapp/broadcasts' }, { label: broadcast?.name ?? '…' }]}
        actions={
          broadcast && live ? (
            <Button variant="danger-outline" onClick={() => setConfirmStop(true)}>
              <Square className="h-3.5 w-3.5" aria-hidden="true" />
              {t(scheduled ? 'whatsapp.campaign.cancelSchedule' : 'whatsapp.stopSending')}
            </Button>
          ) : undefined
        }
      />

      {isLoading || !broadcast ? (
        <TableSkeleton columns={4} rows={6} />
      ) : (
        <div className="space-y-4">
          <SectionCard>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={BROADCAST_TONES[broadcast.status]}>{t(`whatsapp.broadcastStatus.${broadcast.status}`)}</Badge>
              {scheduled && broadcast.scheduledAt && (
                <span className="flex items-center gap-1 text-[12.5px] text-ink">
                  <CalendarClock className="h-3.5 w-3.5 text-brand" aria-hidden="true" />
                  {t('whatsapp.campaign.startsAt', { when: formatDate(broadcast.scheduledAt, 'long') })}
                </span>
              )}
              {broadcast.audienceMode && <Badge>{t(`whatsapp.campaign.audienceMode.${broadcast.audienceMode}`)}</Badge>}
              {broadcast.estimatedCost && (
                <span className="text-[12px] text-ink-muted" title={t('whatsapp.campaign.costNote')}>
                  {t('whatsapp.campaign.estimatedCost')}: ≈ {formatCurrency(Number(broadcast.estimatedCost), { decimals: true })}
                </span>
              )}
            </div>

            <Progress
              className="mt-3 h-2"
              value={broadcast.totalRecipients ? (done / broadcast.totalRecipients) * 100 : scheduled ? 0 : 100}
              label={t('whatsapp.progressLabel')}
            />

            <dl className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-6">
              <Figure label={t('whatsapp.recipients')} value={broadcast.totalRecipients} />
              <Figure label={t('whatsapp.sentCount')} value={broadcast.sentCount} />
              <Figure label={t('whatsapp.campaign.delivered')} value={broadcast.deliveredCount} tone="text-success" />
              <Figure label={t('whatsapp.campaign.read')} value={broadcast.readCount} tone="text-info" />
              <Figure label={t('whatsapp.failedCount')} value={broadcast.failedCount} tone={broadcast.failedCount ? 'text-danger' : undefined} />
              <Figure label={t('whatsapp.skippedCount')} value={broadcast.skippedCount} />
            </dl>
          </SectionCard>

          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <SectionCard title={t('whatsapp.campaign.recipientsTitle')} noPadding>
              <div className="flex flex-wrap gap-1.5 border-b border-line px-4 py-2.5" role="group" aria-label={t('common.status')}>
                {FILTERS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={filter === value}
                    onClick={() => {
                      setFilter(value);
                      setPage(1);
                    }}
                    className={cn(
                      'rounded-full border px-2.5 py-1 text-[11.5px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/50',
                      filter === value ? 'border-brand-primary bg-brand-light text-brand' : 'border-line bg-white text-ink hover:bg-canvas',
                    )}
                  >
                    {value === 'all' ? t('whatsapp.campaign.allStatuses') : t(`whatsapp.messageStatus.${value}`)}
                  </button>
                ))}
              </div>

              {messages.isLoading ? (
                <TableSkeleton columns={3} rows={5} />
              ) : !messages.data?.data.length ? (
                <EmptyState icon={Megaphone} title={t('whatsapp.campaign.noRecipients')} />
              ) : (
                <ul className={cn('divide-y divide-line transition-opacity', messages.isFetching && 'opacity-70')}>
                  {messages.data.data.map((message) => (
                    <li key={message.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                      <div className="min-w-0 flex-1">
                        {message.donor ? (
                          <Link to={`/donors/${message.donor.id}`} className="text-[13px] font-medium text-ink hover:text-brand-primary hover:underline">
                            {message.donor.name}
                          </Link>
                        ) : (
                          <span className="text-[13px] text-ink">{message.phone}</span>
                        )}
                        <p className="text-[11.5px] text-ink-muted">
                          {message.error
                            ? t(`errors.${message.error}`, { defaultValue: message.error })
                            : message.readAt
                              ? `${t('whatsapp.messageStatus.READ')} · ${relativeTime(message.readAt)}`
                              : message.deliveredAt
                                ? `${t('whatsapp.messageStatus.DELIVERED')} · ${relativeTime(message.deliveredAt)}`
                                : message.sentAt
                                  ? `${t('whatsapp.messageStatus.SENT')} · ${relativeTime(message.sentAt)}`
                                  : ''}
                        </p>
                      </div>
                      <Badge tone={MESSAGE_TONES[message.status]}>{t(`whatsapp.messageStatus.${message.status}`)}</Badge>
                      {message.errorDetail && (
                        <p className="basis-full text-[11px] leading-snug text-ink-muted [overflow-wrap:anywhere]">
                          {t('whatsapp.campaign.metaSays')} {message.errorDetail}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {messages.data && messages.data.meta.totalPages > 1 && (
                <div className="flex items-center justify-between border-t border-line px-4 py-2.5 text-[12px] text-ink-muted">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                    {t('table.previous')}
                  </Button>
                  <span>
                    {t('whatsapp.campaign.pageOf', { page, total: messages.data.meta.totalPages })} · {formatNumber(messages.data.meta.total)}
                  </span>
                  <Button variant="outline" size="sm" disabled={page >= messages.data.meta.totalPages} onClick={() => setPage(page + 1)}>
                    {t('table.next')}
                  </Button>
                </div>
              )}
            </SectionCard>

            {broadcast.body && (
              <aside className="min-w-0">
                <p className="mb-1.5 text-[11.5px] font-medium text-ink-muted">{t('whatsapp.campaign.messageSent')}</p>
                <TemplatePreview
                  headerFormat={broadcast.headerFormat}
                  headerMedia={broadcast.headerMediaName ? { kind: (broadcast.headerFormat ?? 'IMAGE').toLowerCase() as 'image' | 'video' | 'document', fileName: broadcast.headerMediaName } : null}
                  bodyText={broadcast.body}
                />
                <p className="mt-2 text-[11.5px] text-ink-muted">{t('whatsapp.campaign.messageSentNote')}</p>
              </aside>
            )}
          </div>
        </div>
      )}

      <ConfirmationDialog
        open={confirmStop}
        onOpenChange={(open) => !open && !stop.isPending && setConfirmStop(false)}
        title={t(scheduled ? 'whatsapp.campaign.cancelScheduleTitle' : 'whatsapp.campaign.stopTitle')}
        description={t(scheduled ? 'whatsapp.campaign.cancelScheduleText' : 'whatsapp.campaign.stopText')}
        confirmLabel={t(scheduled ? 'whatsapp.campaign.cancelSchedule' : 'whatsapp.stopSending')}
        tone="danger"
        loading={stop.isPending}
        onConfirm={() => stop.mutate()}
      />
    </>
  );
}

function Figure({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div>
      <dt className="text-[10.5px] uppercase tracking-wide text-ink-muted">{label}</dt>
      <dd className={cn('tnum text-[18px] font-semibold text-ink', tone)}>{formatNumber(value)}</dd>
    </div>
  );
}

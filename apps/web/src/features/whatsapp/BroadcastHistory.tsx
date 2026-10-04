import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Megaphone } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api/client';
import { queryClient, queryKeys } from '@/lib/api/queryClient';
import { errorMessage } from '@/i18n/errors';
import { SectionCard } from '@/components/common/SectionCard';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/common/states';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/misc';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { formatDate } from '@/lib/utils/format';
import { BROADCAST_TONES, MESSAGE_TONES, type Broadcast, type BroadcastDetail } from './api';

const isLive = (broadcast: Broadcast) => broadcast.status === 'QUEUED' || broadcast.status === 'RUNNING';

/** Past and running broadcasts, refreshed while any is still sending. */
export function BroadcastHistory() {
  const { t } = useTranslation();
  const [openId, setOpenId] = useState<string | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: queryKeys.broadcasts,
    queryFn: () => api.get<{ data: Broadcast[] }>('/whatsapp/broadcasts'),
    refetchInterval: (query) => (query.state.data?.data.some(isLive) ? 3000 : false),
  });

  if (error) return <ErrorState message={errorMessage(t, error)} onRetry={() => void refetch()} />;

  return (
    <SectionCard noPadding>
      {isLoading ? (
        <TableSkeleton columns={5} rows={4} />
      ) : !data?.data.length ? (
        <EmptyState icon={Megaphone} title={t('whatsapp.noBroadcasts')} description={t('whatsapp.noBroadcastsText')} />
      ) : (
        <ul className="divide-y divide-line">
          {data.data.map((broadcast) => {
            const done = broadcast.sentCount + broadcast.failedCount + broadcast.skippedCount;
            return (
              <li key={broadcast.id}>
                <button
                  type="button"
                  onClick={() => setOpenId(broadcast.id)}
                  className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-left transition-colors hover:bg-canvas/60 focus-visible:bg-canvas focus-visible:outline-none"
                >
                  <div className="min-w-0 flex-1 basis-60">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-[13.5px] font-medium text-ink">{broadcast.name}</p>
                      <Badge tone={BROADCAST_TONES[broadcast.status]}>{t(`whatsapp.broadcastStatus.${broadcast.status}`)}</Badge>
                    </div>
                    <p className="mt-0.5 text-[11.5px] text-ink-muted">
                      {t(`whatsapp.provider.${broadcast.provider}`)} · {formatDate(broadcast.createdAt, 'long')}
                      {broadcast.createdBy ? ` · ${broadcast.createdBy.name}` : ''}
                    </p>
                    {isLive(broadcast) && (
                      <Progress
                        className="mt-2 max-w-xs"
                        value={broadcast.totalRecipients ? (done / broadcast.totalRecipients) * 100 : 0}
                        label={t('whatsapp.progressLabel')}
                      />
                    )}
                  </div>
                  <dl className="flex shrink-0 gap-4 text-[12px] tnum">
                    <Count label={t('whatsapp.recipients')} value={broadcast.totalRecipients} />
                    <Count label={t('whatsapp.sentCount')} value={broadcast.sentCount} className="text-success" />
                    <Count label={t('whatsapp.failedCount')} value={broadcast.failedCount} className={broadcast.failedCount ? 'text-danger' : undefined} />
                    <Count label={t('whatsapp.skippedCount')} value={broadcast.skippedCount} />
                  </dl>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <BroadcastDetailDialog id={openId} onClose={() => setOpenId(null)} />
    </SectionCard>
  );
}

function Count({ label, value, className }: { label: string; value: number; className?: string }) {
  return (
    <div className="text-right">
      <dt className="text-[10.5px] uppercase tracking-wide text-ink-muted">{label}</dt>
      <dd className={`text-[13px] font-semibold text-ink ${className ?? ''}`}>{value}</dd>
    </div>
  );
}

function BroadcastDetailDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { t } = useTranslation();

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.broadcast(`${id}-detail`),
    queryFn: () => api.get<{ data: BroadcastDetail }>(`/whatsapp/broadcasts/${id}`),
    enabled: Boolean(id),
    refetchInterval: (query) => (query.state.data && isLive(query.state.data.data) ? 3000 : false),
  });

  const cancel = useMutation({
    mutationFn: () => api.post(`/whatsapp/broadcasts/${id}/cancel`),
    onSuccess: () => {
      toast.success(t('whatsapp.stopped'));
      queryClient.invalidateQueries({ queryKey: ['whatsapp'] });
    },
    onError: (error) => toast.error(t('whatsapp.cancelFailed'), { description: errorMessage(t, error) }),
  });

  const broadcast = data?.data;

  return (
    <Dialog open={Boolean(id)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{broadcast?.name ?? t('whatsapp.broadcastTitle')}</DialogTitle>
          <DialogDescription>
            {broadcast ? `${t(`whatsapp.provider.${broadcast.provider}`)} · ${formatDate(broadcast.createdAt, 'long')}` : t('common.loading')}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          {isLoading || !broadcast ? (
            <TableSkeleton columns={3} rows={5} />
          ) : (
            <div className="space-y-4">
              {broadcast.body && (
                <blockquote className="whitespace-pre-wrap rounded-control border border-line bg-canvas/60 px-3 py-2 text-[12.5px] text-ink">
                  {broadcast.body}
                </blockquote>
              )}
              {broadcast.templateName && (
                <p className="text-[12.5px] text-ink-muted">
                  {t('whatsapp.template')}: <span className="font-medium text-ink">{broadcast.templateName}</span>
                </p>
              )}
              <ul className="divide-y divide-line rounded-control border border-line">
                {broadcast.messages.map((message) => (
                  <li key={message.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      {message.donor ? (
                        <Link to={`/donors/${message.donor.id}`} className="text-[12.5px] font-medium text-ink hover:text-brand-primary hover:underline">
                          {message.donor.name}
                        </Link>
                      ) : (
                        <span className="text-[12.5px] text-ink">{message.phone}</span>
                      )}
                      {message.error && (
                        <p className="text-[11.5px] text-ink-muted">{t(`errors.${message.error}`, { defaultValue: message.error })}</p>
                      )}
                    </div>
                    <Badge tone={MESSAGE_TONES[message.status]}>{t(`whatsapp.messageStatus.${message.status}`)}</Badge>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          {broadcast && isLive(broadcast) && (
            <Button variant="danger-outline" onClick={() => cancel.mutate()} loading={cancel.isPending}>
              {t('whatsapp.stopSending')}
            </Button>
          )}
          <Button onClick={onClose}>{t('common.close')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

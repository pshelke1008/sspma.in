import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CalendarClock, FileText, LayoutTemplate, Megaphone, Plus } from 'lucide-react';
import { api } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/queryClient';
import { useAuth } from '@/lib/auth/AuthProvider';
import { errorMessage } from '@/i18n/errors';
import { PageHeader } from '@/components/layout/PageHeader';
import { SectionCard } from '@/components/common/SectionCard';
import { SearchInput } from '@/components/common/FilterBar';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/common/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/misc';
import { SimpleSelect } from '@/components/ui/select';
import { formatCurrency, formatDate, formatNumber } from '@/lib/utils/format';
import { BROADCAST_TONES, useWhatsAppStatus, type Broadcast, type BroadcastStatus } from '../api';
import { CreateTemplateDialog } from '../CreateTemplateDialog';
import { isLiveBroadcast } from './api';

const STATUSES: BroadcastStatus[] = ['SCHEDULED', 'QUEUED', 'RUNNING', 'COMPLETED', 'CANCELLED'];

/** Every broadcast, newest first, with how far each got. A row opens its progress page. */
export default function BroadcastsPage() {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [templateOpen, setTemplateOpen] = useState(false);
  const { can } = useAuth();
  const { data: connection } = useWhatsAppStatus();
  // Templates are written for the connected business account; only managers can submit them.
  const canTemplates = can('whatsapp.manage') && connection?.cloud.status === 'CONNECTED';

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: queryKeys.broadcasts,
    queryFn: () => api.get<{ data: Broadcast[] }>('/whatsapp/broadcasts'),
    refetchInterval: (query) => (query.state.data?.data.some(isLiveBroadcast) ? 4000 : false),
  });

  const broadcasts = useMemo(
    () =>
      (data?.data ?? []).filter(
        (item) =>
          (status === 'all' || item.status === status) &&
          (!search.trim() || `${item.name} ${item.templateName ?? ''}`.toLowerCase().includes(search.trim().toLowerCase())),
      ),
    [data, search, status],
  );

  return (
    <>
      <PageHeader
        title={t('whatsapp.campaign.listTitle')}
        subtitle={t('whatsapp.campaign.listSubtitle')}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {canTemplates && (
              <>
                <Button asChild variant="outline">
                  <Link to="/whatsapp/templates">
                    <LayoutTemplate className="h-4 w-4" aria-hidden="true" />
                    {t('whatsapp.templates.libraryButton')}
                  </Link>
                </Button>
                <Button variant="outline" onClick={() => setTemplateOpen(true)}>
                  <FileText className="h-4 w-4" aria-hidden="true" />
                  {t('whatsapp.templates.add')}
                </Button>
              </>
            )}
            <Button asChild>
              <Link to="/whatsapp/broadcasts/new">
                <Plus className="h-4 w-4" aria-hidden="true" />
                {t('whatsapp.campaign.newBroadcast')}
              </Link>
            </Button>
          </div>
        }
      />

      <CreateTemplateDialog open={templateOpen} onOpenChange={setTemplateOpen} numberId={null} />

      <SectionCard
        noPadding
        action={
          <>
            <SearchInput value={search} onChange={setSearch} placeholder={t('whatsapp.campaign.searchBroadcasts')} className="w-48" />
            <SimpleSelect
              className="w-40"
              value={status}
              onValueChange={setStatus}
              options={[{ value: 'all', label: t('whatsapp.campaign.allStatuses') }, ...STATUSES.map((value) => ({ value, label: t(`whatsapp.broadcastStatus.${value}`) }))]}
              ariaLabel={t('common.status')}
            />
          </>
        }
      >
        {error ? (
          <ErrorState message={errorMessage(t, error)} onRetry={() => void refetch()} />
        ) : isLoading ? (
          <TableSkeleton columns={5} rows={5} />
        ) : broadcasts.length === 0 ? (
          <EmptyState
            icon={Megaphone}
            title={data?.data.length ? t('states.noResultsTitle') : t('whatsapp.noBroadcasts')}
            description={data?.data.length ? t('states.noResultsText') : t('whatsapp.campaign.noBroadcastsText')}
            action={
              data?.data.length ? undefined : (
                <Button asChild size="sm">
                  <Link to="/whatsapp/broadcasts/new">{t('whatsapp.campaign.newBroadcast')}</Link>
                </Button>
              )
            }
          />
        ) : (
          <ul className="divide-y divide-line">
            {broadcasts.map((broadcast) => {
              const done = broadcast.sentCount + broadcast.failedCount + broadcast.skippedCount;
              return (
                <li key={broadcast.id}>
                  <Link
                    to={`/whatsapp/broadcasts/${broadcast.id}`}
                    className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3 transition-colors hover:bg-canvas/60 focus-visible:bg-canvas focus-visible:outline-none sm:px-5"
                  >
                    <div className="min-w-0 flex-1 basis-64">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-[13.5px] font-medium text-ink">{broadcast.name}</p>
                        <Badge tone={BROADCAST_TONES[broadcast.status]}>{t(`whatsapp.broadcastStatus.${broadcast.status}`)}</Badge>
                      </div>
                      <p className="mt-0.5 truncate text-[11.5px] text-ink-muted">
                        {broadcast.templateName ? `${broadcast.templateName} · ` : ''}
                        {formatDate(broadcast.createdAt, 'long')}
                        {broadcast.createdBy ? ` · ${broadcast.createdBy.name}` : ''}
                      </p>
                      {broadcast.status === 'SCHEDULED' && broadcast.scheduledAt && (
                        <p className="mt-1 flex items-center gap-1 text-[11.5px] text-ink">
                          <CalendarClock className="h-3.5 w-3.5 text-brand" aria-hidden="true" />
                          {t('whatsapp.campaign.startsAt', { when: formatDate(broadcast.scheduledAt, 'long') })}
                        </p>
                      )}
                      {(broadcast.status === 'QUEUED' || broadcast.status === 'RUNNING') && (
                        <Progress
                          className="mt-2 max-w-xs"
                          value={broadcast.totalRecipients ? (done / broadcast.totalRecipients) * 100 : 0}
                          label={t('whatsapp.progressLabel')}
                        />
                      )}
                    </div>
                    <dl className="flex shrink-0 gap-4 text-[12px] tnum">
                      <Figure label={t('whatsapp.recipients')} value={broadcast.totalRecipients} />
                      <Figure label={t('whatsapp.sentCount')} value={broadcast.sentCount} />
                      <Figure label={t('whatsapp.campaign.delivered')} value={broadcast.deliveredCount} className="text-success" />
                      <Figure label={t('whatsapp.campaign.read')} value={broadcast.readCount} className="text-info" />
                      <Figure label={t('whatsapp.failedCount')} value={broadcast.failedCount} className={broadcast.failedCount ? 'text-danger' : undefined} />
                    </dl>
                    {broadcast.estimatedCost && (
                      <span className="shrink-0 text-[11.5px] text-ink-muted tnum" title={t('whatsapp.campaign.costNote')}>
                        ≈ {formatCurrency(Number(broadcast.estimatedCost), { decimals: true })}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>
    </>
  );
}

function Figure({ label, value, className }: { label: string; value: number; className?: string }) {
  return (
    <div className="text-right">
      <dt className="text-[10.5px] uppercase tracking-wide text-ink-muted">{label}</dt>
      <dd className={`text-[13px] font-semibold text-ink ${className ?? ''}`}>{formatNumber(value)}</dd>
    </div>
  );
}

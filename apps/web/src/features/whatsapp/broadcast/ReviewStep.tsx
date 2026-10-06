import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, CalendarClock, CheckCircle2, Send } from 'lucide-react';
import { api } from '@/lib/api/client';
import { errorMessage } from '@/i18n/errors';
import { ErrorState, TableSkeleton } from '@/components/common/states';
import { FormField } from '@/components/common/forms';
import { SegmentedControl } from '@/components/common/SegmentedControl';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils/cn';
import { formatCurrency, formatDate, formatNumber } from '@/lib/utils/format';
import { TemplatePreview } from '../TemplatePreview';
import type { CampaignPreview, CampaignRequest, WizardState } from './api';

/** `datetime-local` wants "2026-10-05T14:30" in the browser's own time zone. */
export function toLocalInput(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** The earliest a broadcast can be scheduled: a couple of minutes from now. */
export const earliestSchedule = () => toLocalInput(new Date(Date.now() + 2 * 60_000));

/** Why the schedule is not ready (a translation key), or nothing. */
export function scheduleError(schedule: WizardState['schedule']): string | undefined {
  if (schedule.mode === 'now') return undefined;
  const at = new Date(schedule.at);
  const lead = at.getTime() - Date.now();
  if (!schedule.at || Number.isNaN(lead) || lead < 60_000 || lead > 30 * 24 * 60 * 60 * 1000) return 'whatsapp.campaign.errors.schedule';
  return undefined;
}

/** Step 4: exactly what will be sent and to how many, then now or later. */
export function ReviewStep({
  state,
  request,
  onSchedule,
}: {
  state: WizardState;
  request: CampaignRequest;
  onSchedule: (schedule: WizardState['schedule']) => void;
}) {
  const { t } = useTranslation();
  const [picked, setPicked] = useState(0);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['whatsapp', 'campaign-preview', request],
    queryFn: () => api.post<CampaignPreview>('/whatsapp/campaigns/preview', request),
    staleTime: 0,
    retry: false,
  });

  if (isLoading) return <TableSkeleton columns={3} rows={5} />;
  if (error || !data) return <ErrorState message={errorMessage(t, error)} onRetry={() => void refetch()} />;

  const sample = data.samples[Math.min(picked, data.samples.length - 1)];
  const skippedTotal = data.found - data.willReceive;
  const problem = scheduleError(state.schedule);

  return (
    <div className="space-y-5">
      <dl className="grid gap-2 sm:grid-cols-3">
        <Figure label={t('whatsapp.campaign.willReceive')} value={formatNumber(data.willReceive)} tone="text-success" />
        <Figure label={t('whatsapp.campaign.leftOut')} value={formatNumber(skippedTotal)} tone={skippedTotal ? 'text-[#986812]' : undefined} />
        <Figure label={t('whatsapp.campaign.estimatedCost')} value={formatCurrency(data.estimatedCost, { decimals: true })} hint={t('whatsapp.campaign.costNote')} />
      </dl>

      {skippedTotal > 0 && (
        <ul className="space-y-1 rounded-control border border-warning/30 bg-warning/5 px-3 py-2 text-[12.5px] text-ink">
          {(['NOT_OPTED_IN', 'MISSING_DATA', 'NO_NUMBER', 'INACTIVE'] as const).map((key) =>
            data.skipped[key] ? (
              <li key={key} className="flex items-start gap-1.5">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#986812]" aria-hidden="true" />
                {t(`whatsapp.campaign.skip.${key}`, { count: data.skipped[key] })}
              </li>
            ) : null,
          )}
        </ul>
      )}
      {data.willReceive === 0 && (
        <p role="alert" className="flex items-center gap-1.5 text-[12.5px] font-medium text-danger">
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
          {t('whatsapp.campaign.nobody')}
        </p>
      )}

      <section aria-labelledby="review-samples" className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">
          <h3 id="review-samples" className="mb-1.5 text-[12px] font-semibold text-ink">
            {t('whatsapp.campaign.sampleRecipients')}
          </h3>
          <ul className="divide-y divide-line overflow-hidden rounded-control border border-line">
            {data.samples.map((item, index) => (
              <li key={item.donorId}>
                <button
                  type="button"
                  onClick={() => setPicked(index)}
                  aria-pressed={index === picked}
                  className={cn(
                    'flex w-full items-center gap-3 px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-primary/50',
                    index === picked ? 'bg-brand-light/60' : 'hover:bg-canvas/60',
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-ink">{item.donorName}</span>
                    <span className="block truncate text-[11.5px] text-ink-muted">{item.phone}</span>
                  </span>
                  {item.status === 'OK' ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-label={t('whatsapp.campaign.willReceive')} />
                  ) : (
                    <Badge tone="warning">{t(`whatsapp.campaign.skipShort.${item.status}`)}</Badge>
                  )}
                </button>
              </li>
            ))}
          </ul>
          {data.found > data.samples.length && (
            <p className="mt-1.5 text-[11.5px] text-ink-muted">{t('whatsapp.campaign.sampleMore', { shown: data.samples.length, total: formatNumber(data.found) })}</p>
          )}
        </div>
        <aside className="min-w-0">
          <p className="mb-1.5 text-[11.5px] font-medium text-ink-muted">{t('whatsapp.campaign.messageFor', { name: sample?.donorName ?? '' })}</p>
          {sample && (
            <TemplatePreview
              headerFormat={data.template.headerFormat}
              headerMedia={state.headerMedia}
              headerText={data.template.headerText}
              bodyText={sample.body}
              footerText={data.template.footerText}
              buttons={data.template.buttons}
            />
          )}
        </aside>
      </section>

      <section aria-labelledby="review-when" className="space-y-3 border-t border-line pt-4">
        <h3 id="review-when" className="text-[12px] font-semibold text-ink">
          {t('whatsapp.campaign.when')}
        </h3>
        <SegmentedControl
          label={t('whatsapp.campaign.when')}
          value={state.schedule.mode}
          onChange={(mode) => onSchedule({ mode: mode as 'now' | 'later', at: mode === 'later' && !state.schedule.at ? earliestSchedule() : state.schedule.at })}
          segments={[
            { value: 'now', label: t('whatsapp.campaign.sendNow') },
            { value: 'later', label: t('whatsapp.campaign.sendLater') },
          ]}
        />
        {state.schedule.mode === 'later' && (
          <FormField
            label={t('whatsapp.campaign.sendAt')}
            htmlFor="schedule-at"
            required
            error={problem}
            hint={state.schedule.at && !problem ? t('whatsapp.campaign.willStart', { when: formatDate(new Date(state.schedule.at), 'long') }) : t('whatsapp.campaign.scheduleHint')}
          >
            <Input
              id="schedule-at"
              type="datetime-local"
              min={earliestSchedule()}
              invalid={Boolean(problem)}
              value={state.schedule.at}
              onChange={(event) => onSchedule({ mode: 'later', at: event.target.value })}
              className="max-w-xs"
            />
          </FormField>
        )}
        <p className="flex items-start gap-2 text-[11.5px] leading-relaxed text-ink-muted">
          {state.schedule.mode === 'later' ? <CalendarClock className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : <Send className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
          {t(state.schedule.mode === 'later' ? 'whatsapp.campaign.laterNote' : 'whatsapp.campaign.nowNote')}
        </p>
      </section>
    </div>
  );
}

function Figure({ label, value, tone, hint }: { label: string; value: string; tone?: string; hint?: string }) {
  return (
    <div className="rounded-control border border-line bg-white px-3 py-2.5">
      <dt className="text-[10.5px] uppercase tracking-wide text-ink-muted">{label}</dt>
      <dd className={cn('tnum text-[19px] font-semibold text-ink', tone)}>{value}</dd>
      {hint && <p className="text-[10.5px] text-ink-muted">{hint}</p>}
    </div>
  );
}

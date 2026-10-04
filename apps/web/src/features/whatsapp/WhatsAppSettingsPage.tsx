import { useState, type ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  Copy,
  Loader2,
  LogOut,
  QrCode,
  RefreshCw,
  ShieldAlert,
  Smartphone,
} from 'lucide-react';
import { toast } from 'sonner';
import type { WhatsAppProviderKey } from '@ashram/types';
import { ApiError, api, fileUrl } from '@/lib/api/client';
import { queryClient, queryKeys } from '@/lib/api/queryClient';
import { errorMessage } from '@/i18n/errors';
import { PageHeader } from '@/components/layout/PageHeader';
import { SectionCard } from '@/components/common/SectionCard';
import { ChartSkeleton, ErrorState } from '@/components/common/states';
import { ConfirmationDialog } from '@/components/common/ConfirmationDialog';
import { FormField } from '@/components/common/forms';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Checkbox, Progress } from '@/components/ui/misc';
import { cn } from '@/lib/utils/cn';
import { formatDate, formatNumber, relativeTime } from '@/lib/utils/format';
import { CONNECTION_TONES, sendingProvider, useWhatsAppStatus, type WhatsAppStatus } from './api';

function applyStatus(status: WhatsAppStatus) {
  queryClient.setQueryData(queryKeys.whatsappStatus, status);
  queryClient.invalidateQueries({ queryKey: queryKeys.whatsappTemplates });
}

export default function WhatsAppSettingsPage() {
  const { t } = useTranslation();
  const { data: status, isLoading, error, refetch } = useWhatsAppStatus();

  const provider = useMutation({
    mutationFn: (value: WhatsAppProviderKey) => api.put<WhatsAppStatus>('/whatsapp/provider', { provider: value }),
    onSuccess: (data) => {
      applyStatus(data);
      toast.success(t('whatsapp.providerChanged'));
    },
    onError: (err) => toast.error(t('whatsapp.actionFailed'), { description: errorMessage(t, err) }),
  });

  if (error) return <ErrorState message={errorMessage(t, error)} onRetry={() => void refetch()} />;

  const active = sendingProvider(status);

  return (
    <>
      <PageHeader
        title={t('settings.whatsappTitle')}
        subtitle={t('whatsapp.settingsSubtitle')}
        breadcrumbs={[{ label: t('settings.title'), to: '/settings' }, { label: t('settings.whatsappTitle') }]}
      />

      {isLoading || !status ? (
        <ChartSkeleton height={420} />
      ) : (
        <div className="space-y-4">
          {!status.configured && (
            <div role="alert" className="flex items-start gap-3 rounded-card border border-danger/25 bg-danger/5 p-4">
              <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-danger" aria-hidden="true" />
              <div>
                <p className="text-[13.5px] font-semibold text-ink">{t('whatsapp.notConfiguredTitle')}</p>
                <p className="mt-1 text-[12.5px] leading-relaxed text-ink-muted [overflow-wrap:anywhere]">{t('whatsapp.notConfiguredText')}</p>
              </div>
            </div>
          )}

          <SectionCard title={t('whatsapp.sendingChannel')} description={t('whatsapp.sendingChannelText')}>
            <div role="radiogroup" aria-label={t('whatsapp.sendingChannel')} className="grid gap-2 sm:grid-cols-2">
              {(['CLOUD_API', 'WEB_QR'] as const).map((key) => {
                const connected = (key === 'CLOUD_API' ? status.cloud.status : status.web.status) === 'CONNECTED';
                const checked = active === key;
                const Icon = key === 'CLOUD_API' ? Cloud : Smartphone;
                return (
                  <button
                    key={key}
                    type="button"
                    role="radio"
                    aria-checked={checked}
                    disabled={!connected || provider.isPending}
                    onClick={() => !checked && provider.mutate(key)}
                    className={cn(
                      'flex items-center gap-3 rounded-control border px-3 py-2.5 text-left transition-colors',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/50',
                      'disabled:cursor-not-allowed disabled:opacity-60',
                      checked ? 'border-brand-primary bg-brand-light/60' : 'border-line bg-white hover:bg-canvas',
                    )}
                  >
                    <Icon className={cn('h-5 w-5 shrink-0', checked ? 'text-brand' : 'text-ink-muted')} aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-medium text-ink">{t(`whatsapp.provider.${key}`)}</span>
                      <span className="block text-[11.5px] text-ink-muted">
                        {connected ? t('whatsapp.connectionStatus.CONNECTED') : t('whatsapp.connectFirst')}
                      </span>
                    </span>
                    {checked && <CheckCircle2 className="h-4 w-4 shrink-0 text-brand" aria-hidden="true" />}
                  </button>
                );
              })}
            </div>
            {!active && <p className="mt-3 text-[12px] text-ink-muted">{t('whatsapp.noChannelYet')}</p>}
          </SectionCard>

          {/* Grid items default to min-width:auto; min-w-0 lets long values wrap on phones. */}
          <div className="grid gap-4 xl:grid-cols-2 [&>*]:min-w-0">
            <CloudApiCard status={status} />
            <LinkedDeviceCard status={status} />
          </div>
        </div>
      )}
    </>
  );
}

// ----------------------------- Cloud API -------------------------------------

const cloudSchema = z.object({
  phoneNumberId: z.string().trim().regex(/^\d{6,25}$/, 'whatsapp.phoneNumberIdInvalid'),
  businessAccountId: z.string().trim().regex(/^\d{6,25}$/, 'whatsapp.businessAccountIdInvalid'),
  accessToken: z.string().trim().min(20, 'whatsapp.accessTokenInvalid'),
});

type CloudValues = z.infer<typeof cloudSchema>;

function CloudApiCard({ status }: { status: WhatsAppStatus }) {
  const { t } = useTranslation();
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const cloud = status.cloud;
  const connected = cloud.status === 'CONNECTED';
  const webhookUrl = new URL(cloud.webhookPath, new URL(fileUrl('/'), window.location.origin)).href;

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<CloudValues>({
    resolver: zodResolver(cloudSchema),
    defaultValues: { phoneNumberId: cloud.phoneNumberId ?? '', businessAccountId: cloud.businessAccountId ?? '', accessToken: '' },
  });

  const connect = useMutation({
    mutationFn: (values: CloudValues) => api.put<WhatsAppStatus>('/whatsapp/cloud', values),
    onSuccess: (data) => {
      applyStatus(data);
      reset({ phoneNumberId: data.cloud.phoneNumberId ?? '', businessAccountId: data.cloud.businessAccountId ?? '', accessToken: '' });
      toast.success(t('whatsapp.cloudConnected'));
    },
    onError: (error) => {
      if (error instanceof ApiError && Object.keys(error.fieldErrors).length) {
        for (const [field, message] of Object.entries(error.fieldErrors)) setError(field as keyof CloudValues, { message });
        return;
      }
      queryClient.invalidateQueries({ queryKey: queryKeys.whatsappStatus });
      toast.error(t('whatsapp.cloudConnectFailed'), { description: errorMessage(t, error) });
    },
  });

  const disconnect = useMutation({
    mutationFn: () => api.delete<WhatsAppStatus>('/whatsapp/cloud'),
    onSuccess: (data) => {
      applyStatus(data);
      setConfirmDisconnect(false);
      toast.success(t('whatsapp.disconnected'));
    },
    onError: (error) => toast.error(t('whatsapp.actionFailed'), { description: errorMessage(t, error) }),
  });

  return (
    <SectionCard
      title={
        <span className="flex items-center gap-2">
          <Cloud className="h-4 w-4 text-brand" aria-hidden="true" />
          {t('whatsapp.provider.CLOUD_API')}
        </span>
      }
      description={t('whatsapp.cloudText')}
      action={<Badge tone={CONNECTION_TONES[cloud.status]}>{t(`whatsapp.connectionStatus.${cloud.status}`)}</Badge>}
    >
      {connected ? (
        <div className="space-y-4">
          <dl className="grid gap-3 sm:grid-cols-2">
            <Item label={t('whatsapp.businessNumber')}>{cloud.displayNumber ?? '—'}</Item>
            <Item label={t('whatsapp.verifiedName')}>{cloud.verifiedName ?? '—'}</Item>
            <Item label={t('whatsapp.phoneNumberId')}>{cloud.phoneNumberId}</Item>
            <Item label={t('whatsapp.connectedSince')}>{formatDate(cloud.connectedAt)}</Item>
          </dl>
          <Button variant="danger-outline" size="sm" onClick={() => setConfirmDisconnect(true)}>
            <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
            {t('whatsapp.disconnect')}
          </Button>
        </div>
      ) : (
        <form onSubmit={handleSubmit((values) => connect.mutate(values))} noValidate className="space-y-3">
          {cloud.lastError && <ErrorNote code={cloud.lastError} />}
          <FormField label={t('whatsapp.phoneNumberId')} htmlFor="wa-phone-id" required error={errors.phoneNumberId?.message}>
            <Input id="wa-phone-id" inputMode="numeric" autoComplete="off" invalid={Boolean(errors.phoneNumberId)} {...register('phoneNumberId')} />
          </FormField>
          <FormField label={t('whatsapp.businessAccountId')} htmlFor="wa-waba-id" required error={errors.businessAccountId?.message}>
            <Input id="wa-waba-id" inputMode="numeric" autoComplete="off" invalid={Boolean(errors.businessAccountId)} {...register('businessAccountId')} />
          </FormField>
          <FormField
            label={t('whatsapp.accessToken')}
            htmlFor="wa-token"
            required
            error={errors.accessToken?.message}
            hint={t('whatsapp.accessTokenHint')}
          >
            <Input
              id="wa-token"
              type="password"
              autoComplete="new-password"
              spellCheck={false}
              invalid={Boolean(errors.accessToken)}
              {...register('accessToken')}
            />
          </FormField>
          <Button type="submit" loading={isSubmitting || connect.isPending} disabled={!status.configured}>
            <Cloud className="h-3.5 w-3.5" aria-hidden="true" />
            {t('whatsapp.verifyAndConnect')}
          </Button>
        </form>
      )}

      <div className="mt-5 border-t border-line pt-4">
        <p className="text-[12px] font-semibold text-ink">{t('whatsapp.webhookTitle')}</p>
        <p className="mt-1 text-[11.5px] leading-relaxed text-ink-muted">{t('whatsapp.webhookText')}</p>
        <div className="mt-2 flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-control border border-line bg-canvas/60 px-2.5 py-1.5 text-[11.5px] text-ink">
            {webhookUrl}
          </code>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label={t('whatsapp.copyWebhook')}
            onClick={() => {
              void navigator.clipboard
                ?.writeText(webhookUrl)
                .then(() => toast.success(t('whatsapp.copied')))
                .catch(() => undefined);
            }}
          >
            <Copy className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </div>
        <p className={cn('mt-2 flex items-start gap-1.5 text-[11.5px] [overflow-wrap:anywhere]', cloud.webhookReady ? 'text-success' : 'text-[#986812]')}>
          {cloud.webhookReady ? (
            <CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          ) : (
            <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          )}
          {cloud.webhookReady ? t('whatsapp.webhookReady') : t('whatsapp.webhookNotReady')}
        </p>
      </div>

      <ConfirmationDialog
        open={confirmDisconnect}
        onOpenChange={setConfirmDisconnect}
        title={t('whatsapp.disconnectCloudTitle')}
        description={t('whatsapp.disconnectCloudText')}
        confirmLabel={t('whatsapp.disconnect')}
        tone="danger"
        loading={disconnect.isPending}
        onConfirm={() => disconnect.mutate()}
      />
    </SectionCard>
  );
}

// ----------------------------- Linked device (QR) ----------------------------

function LinkedDeviceCard({ status }: { status: WhatsAppStatus }) {
  const { t } = useTranslation();
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const web = status.web;

  const onError = (error: unknown) => toast.error(t('whatsapp.actionFailed'), { description: errorMessage(t, error) });

  const connect = useMutation({
    mutationFn: () => api.post<WhatsAppStatus>('/whatsapp/web/connect'),
    onSuccess: applyStatus,
    onError,
  });
  const reconnect = useMutation({
    mutationFn: () => api.post<WhatsAppStatus>('/whatsapp/web/reconnect'),
    onSuccess: applyStatus,
    onError,
  });
  const disconnect = useMutation({
    mutationFn: () => api.delete<WhatsAppStatus>('/whatsapp/web'),
    onSuccess: (data) => {
      applyStatus(data);
      setConfirmDisconnect(false);
      setAcknowledged(false);
      toast.success(t('whatsapp.disconnected'));
    },
    onError,
  });

  const usage = web.monthlyLimit ? Math.round((web.messagesSent / web.monthlyLimit) * 100) : 0;

  let body: ReactNode;
  if (!web.enabled) {
    body = <p className="text-[12.5px] leading-relaxed text-ink-muted">{t('errors.WHATSAPP_WEB_DISABLED')}</p>;
  } else if (web.status === 'CONNECTED') {
    body = (
      <div className="space-y-4">
        <dl className="grid gap-3 sm:grid-cols-2">
          <Item label={t('whatsapp.linkedNumber')}>{web.phoneNumber ? `+${web.phoneNumber}` : '—'}</Item>
          <Item label={t('whatsapp.profileName')}>{web.displayName ?? '—'}</Item>
          <Item label={t('whatsapp.connectedSince')}>{formatDate(web.connectedAt)}</Item>
          <Item label={t('whatsapp.lastActive')}>{web.lastActiveAt ? relativeTime(web.lastActiveAt) : '—'}</Item>
        </dl>
        <div>
          <div className="mb-1.5 flex items-center justify-between text-[12px]">
            <span className="text-ink-muted">{t('whatsapp.monthlyUsage')}</span>
            <span className="font-medium text-ink tnum">
              {formatNumber(web.messagesSent)} / {formatNumber(web.monthlyLimit)}
            </span>
          </div>
          <Progress value={usage} tone={usage >= 90 ? 'danger' : usage >= 70 ? 'accent' : 'brand'} label={t('whatsapp.monthlyUsage')} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" loading={reconnect.isPending} onClick={() => reconnect.mutate()}>
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            {t('whatsapp.reconnect')}
          </Button>
          <Button variant="danger-outline" size="sm" onClick={() => setConfirmDisconnect(true)}>
            <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
            {t('whatsapp.unlink')}
          </Button>
        </div>
      </div>
    );
  } else if (web.status === 'QR_REQUIRED' || web.status === 'CONNECTING') {
    body = (
      <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
        <div className="flex h-[232px] w-[232px] shrink-0 items-center justify-center rounded-card border border-line bg-white p-2">
          {web.qrDataUrl ? (
            <img src={web.qrDataUrl} alt={t('whatsapp.qrAlt')} width={216} height={216} className="h-[216px] w-[216px]" />
          ) : (
            <span className="flex flex-col items-center gap-2 text-[12px] text-ink-muted" role="status">
              <Loader2 className="h-6 w-6 animate-spin text-brand" aria-hidden="true" />
              {t('whatsapp.preparingCode')}
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <ol className="list-decimal space-y-1.5 pl-4 text-[12.5px] leading-relaxed text-ink">
            <li>{t('whatsapp.qrStep1')}</li>
            <li>{t('whatsapp.qrStep2')}</li>
            <li>{t('whatsapp.qrStep3')}</li>
          </ol>
          <p className="text-[11.5px] text-ink-muted" aria-live="polite">
            {web.qrDataUrl ? t('whatsapp.qrRefreshes') : t('whatsapp.connectionStatus.CONNECTING')}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" loading={reconnect.isPending} onClick={() => reconnect.mutate()}>
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              {t('whatsapp.newCode')}
            </Button>
            <Button variant="ghost" size="sm" loading={disconnect.isPending} onClick={() => disconnect.mutate()}>
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      </div>
    );
  } else {
    body = (
      <div className="space-y-3">
        {web.lastError && <ErrorNote code={web.lastError} />}
        <div className="rounded-control border border-warning/30 bg-warning/10 p-3">
          <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-[#7a5410]">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
            {t('whatsapp.riskTitle')}
          </p>
          <ul className="mt-1.5 list-disc space-y-1 pl-5 text-[12px] leading-relaxed text-[#7a5410]">
            <li>{t('whatsapp.risk1')}</li>
            <li>{t('whatsapp.risk2', { limit: formatNumber(web.monthlyLimit) })}</li>
            <li>{t('whatsapp.risk3')}</li>
          </ul>
          <label className="mt-2.5 flex cursor-pointer items-start gap-2 text-[12px] text-ink">
            <Checkbox className="mt-0.5" checked={acknowledged} onCheckedChange={(checked) => setAcknowledged(checked === true)} />
            {t('whatsapp.riskAcknowledge')}
          </label>
        </div>
        <Button onClick={() => connect.mutate()} loading={connect.isPending} disabled={!acknowledged || !status.configured}>
          <QrCode className="h-3.5 w-3.5" aria-hidden="true" />
          {t('whatsapp.showQr')}
        </Button>
      </div>
    );
  }

  return (
    <SectionCard
      title={
        <span className="flex items-center gap-2">
          <Smartphone className="h-4 w-4 text-brand" aria-hidden="true" />
          {t('whatsapp.provider.WEB_QR')}
        </span>
      }
      description={t('whatsapp.webText')}
      action={<Badge tone={CONNECTION_TONES[web.status]}>{t(`whatsapp.connectionStatus.${web.status}`)}</Badge>}
    >
      {body}

      <ConfirmationDialog
        open={confirmDisconnect}
        onOpenChange={setConfirmDisconnect}
        title={t('whatsapp.unlinkTitle')}
        description={t('whatsapp.unlinkText')}
        confirmLabel={t('whatsapp.unlink')}
        tone="danger"
        loading={disconnect.isPending}
        onConfirm={() => disconnect.mutate()}
      />
    </SectionCard>
  );
}

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">{label}</dt>
      <dd className="mt-0.5 truncate text-[13px] font-medium text-ink">{children}</dd>
    </div>
  );
}

function ErrorNote({ code }: { code: string }) {
  const { t } = useTranslation();
  return (
    <p role="alert" className="flex items-start gap-2 rounded-control border border-danger/25 bg-danger/5 px-3 py-2 text-[12px] text-danger">
      <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {t(`errors.${code}`, { defaultValue: t('errors.INTERNAL_ERROR') })}
    </p>
  );
}

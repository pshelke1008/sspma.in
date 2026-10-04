import { useEffect, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Trans, useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  ChevronDown,
  Copy,
  KeyRound,
  Link2,
  Loader2,
  LogOut,
  MessageSquare,
  Plus,
  QrCode,
  RefreshCw,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Trash2,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import type { WhatsAppProviderKey } from '@ashram/types';
import { ApiError, api, fileUrl } from '@/lib/api/client';
import { queryClient, queryKeys } from '@/lib/api/queryClient';
import { useAuth } from '@/lib/auth/AuthProvider';
import { errorMessage } from '@/i18n/errors';
import { useLabels } from '@/i18n/useLabels';
import { PageHeader } from '@/components/layout/PageHeader';
import { SectionCard } from '@/components/common/SectionCard';
import { ChartSkeleton, ErrorState } from '@/components/common/states';
import { ConfirmationDialog } from '@/components/common/ConfirmationDialog';
import { FormField } from '@/components/common/forms';
import { WhatsAppIcon } from '@/components/icons/WhatsAppIcon';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Checkbox, Progress, Switch } from '@/components/ui/misc';
import { cn } from '@/lib/utils/cn';
import { formatDate, formatNumber, relativeTime } from '@/lib/utils/format';
import {
  CONNECTION_TONES,
  sendingProvider,
  tokenDaysLeft,
  useWhatsAppStatus,
  type WhatsAppNumber,
  type WhatsAppStatus,
} from './api';
import { QualityBadge, WabaPickerDialog } from './WabaPickerDialog';

/** WhatsApp brand green — only for the brand tile and the Connect button. */
const WHATSAPP_GREEN = '#075e4d';

function applyStatus(status: WhatsAppStatus) {
  queryClient.setQueryData(queryKeys.whatsappStatus, status);
  queryClient.invalidateQueries({ queryKey: queryKeys.whatsappTemplates });
}

export default function WhatsAppSettingsPage() {
  const { t } = useTranslation();
  const { data: status, isLoading, error, refetch } = useWhatsAppStatus();
  const [searchParams, setSearchParams] = useSearchParams();
  const [pendingId, setPendingId] = useState<string | null>(null);

  // Meta redirects back here with the outcome of "Connect WhatsApp".
  useEffect(() => {
    const pending = searchParams.get('whatsapp_pending');
    const connected = searchParams.get('whatsapp');
    const failure = searchParams.get('whatsapp_error');
    if (!pending && !connected && !failure) return;
    if (pending) setPendingId(pending);
    if (connected === 'connected') {
      toast.success(t('whatsapp.cloudConnected'));
      queryClient.invalidateQueries({ queryKey: queryKeys.whatsappStatus });
    }
    if (failure) {
      toast.error(t('whatsapp.cloudConnectFailed'), {
        description: failure === 'denied' ? t('whatsapp.oauthDenied') : t(`errors.${failure}`, { defaultValue: t('errors.WHATSAPP_OAUTH_FAILED') }),
      });
    }
    setSearchParams(new URLSearchParams(), { replace: true });
  }, [searchParams, setSearchParams, t]);

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
          <div className="grid items-start gap-4 xl:grid-cols-2 [&>*]:min-w-0">
            <WhatsAppBusinessCard status={status} />
            <LinkedDeviceCard status={status} />
          </div>

          <InboxAccessCard />
        </div>
      )}

      <WabaPickerDialog pendingId={pendingId} onClose={() => setPendingId(null)} />
    </>
  );
}

// ----------------------------- WhatsApp Business (Cloud API) -----------------

const cloudSchema = z.object({
  phoneNumberId: z.string().trim().regex(/^\d{6,25}$/, 'whatsapp.phoneNumberIdInvalid'),
  businessAccountId: z.string().trim().regex(/^\d{6,25}$/, 'whatsapp.businessAccountIdInvalid'),
  accessToken: z.string().trim().min(20, 'whatsapp.accessTokenInvalid'),
});

type CloudValues = z.infer<typeof cloudSchema>;

const EMPTY_CLOUD: CloudValues = { phoneNumberId: '', businessAccountId: '', accessToken: '' };

function WhatsAppBusinessCard({ status }: { status: WhatsAppStatus }) {
  const { t } = useTranslation();
  const cloud = status.cloud;
  const numbers = cloud.numbers ?? [];
  const connected = cloud.status === 'CONNECTED' && numbers.length > 0;
  const [showManual, setShowManual] = useState(!cloud.oauthAvailable);
  const [pendingDisconnect, setPendingDisconnect] = useState<WhatsAppNumber | null>(null);
  const expiringSoon = numbers.some((number) => {
    const days = tokenDaysLeft(number.accessExpiresAt);
    return days !== null && days <= 7;
  });

  // Sends the browser to Meta's login dialog; it comes back to this page.
  const startOAuth = useMutation({
    mutationFn: () => api.get<{ authUrl: string }>('/whatsapp/oauth/start'),
    onSuccess: ({ authUrl }) => window.location.assign(authUrl),
    onError: (error) => toast.error(t('whatsapp.cloudConnectFailed'), { description: errorMessage(t, error) }),
  });
  // Stays "busy" from the click until the browser has left for Facebook.
  const redirecting = startOAuth.isPending || startOAuth.isSuccess;
  const resetOAuth = startOAuth.reset;
  // Coming "Back" from Facebook can restore this page from the browser cache.
  useEffect(() => {
    const onShow = (event: PageTransitionEvent) => event.persisted && resetOAuth();
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, [resetOAuth]);
  const webhookUrl = new URL(cloud.webhookPath, new URL(fileUrl('/'), window.location.origin)).href;

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<CloudValues>({ resolver: zodResolver(cloudSchema), defaultValues: EMPTY_CLOUD });

  const addManual = useMutation({
    mutationFn: (values: CloudValues) => api.put<WhatsAppStatus>('/whatsapp/cloud', values),
    onSuccess: (data) => {
      applyStatus(data);
      reset(EMPTY_CLOUD);
      if (data.cloud.oauthAvailable) setShowManual(false);
      toast.success(t('whatsapp.numberAdded'));
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
    mutationFn: (number: WhatsAppNumber) => api.delete<WhatsAppStatus>(`/whatsapp/numbers/${number.id}`),
    onSuccess: (data, number) => {
      applyStatus(data);
      setPendingDisconnect(null);
      toast.success(t('whatsapp.numberDisconnected', { number: number.displayNumber ?? number.phoneNumberId }));
    },
    onError: (error) => toast.error(t('whatsapp.numberDisconnectFailed'), { description: errorMessage(t, error) }),
  });

  return (
    <section
      aria-labelledby="wa-business-title"
      className={cn(
        'rounded-card border-2 p-4 shadow-card transition-colors sm:p-6',
        connected ? 'border-success/40 bg-success/5' : 'border-dashed border-ink-muted/30 bg-white',
      )}
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-control"
            style={{ backgroundColor: WHATSAPP_GREEN }}
          >
            <WhatsAppIcon className="h-6 w-6 text-white" />
          </div>
          <div className="min-w-0">
            <h2 id="wa-business-title" className="truncate text-[16px] font-semibold text-ink">
              {t('whatsapp.businessTitle')}
            </h2>
            <p className="text-[12.5px] text-ink-muted">{t('whatsapp.businessSubtitle')}</p>
          </div>
        </div>
        {connected ? (
          <Badge className="shrink-0 border-success bg-success text-white">
            <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
            {t('whatsapp.connected')}
          </Badge>
        ) : (
          <Badge tone="neutral" className="shrink-0">
            <Settings2 className="h-3 w-3" aria-hidden="true" />
            {t('whatsapp.notConnected')}
          </Badge>
        )}
      </div>

      {connected ? (
        <ul className="space-y-2" aria-label={t('whatsapp.connectedNumbers')}>
          {numbers.map((number) => (
            <NumberRow
              key={number.id}
              number={number}
              busy={disconnect.isPending && disconnect.variables?.id === number.id}
              onDisconnect={() => setPendingDisconnect(number)}
            />
          ))}
        </ul>
      ) : (
        <div className="space-y-3">
          {cloud.lastError && <ErrorNote code={cloud.lastError} />}
          <p className="text-[13px] leading-relaxed text-ink-muted">{t('whatsapp.businessDescription')}</p>
        </div>
      )}

      {expiringSoon && (
        <p role="alert" className="mt-3 flex items-start gap-1.5 rounded-control border border-danger/25 bg-danger/5 px-3 py-2 text-[12px] text-danger">
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {cloud.oauthAvailable ? t('whatsapp.tokenExpiringReconnect') : t('whatsapp.tokenExpiringManual')}
        </p>
      )}

      <div className="mt-4 flex flex-col gap-2">
        {!cloud.oauthAvailable ? (
          <p className="flex items-start gap-1.5 text-[11.5px] leading-relaxed text-ink-muted">
            <KeyRound className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {t('whatsapp.oauthUnavailable')}
          </p>
        ) : connected ? (
          <Button variant="outline" size="sm" className="w-full" disabled={redirecting || !status.configured} onClick={() => startOAuth.mutate()}>
            {redirecting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
            {t('whatsapp.addAnotherNumber')}
          </Button>
        ) : (
          <Button
            className="mx-auto w-full bg-[#075e4d] text-white hover:bg-[#075E54] sm:w-1/2"
            disabled={redirecting || !status.configured}
            aria-busy={redirecting || undefined}
            onClick={() => startOAuth.mutate()}
          >
            {redirecting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Link2 className="h-4 w-4" aria-hidden="true" />}
            {t('whatsapp.connectWhatsApp')}
          </Button>
        )}
      </div>

      <div className="mt-4 border-t border-line pt-3">
        {cloud.oauthAvailable && (
          <button
            type="button"
            onClick={() => setShowManual((value) => !value)}
            aria-expanded={showManual}
            aria-controls="wa-manual-form"
            className="flex items-center gap-1 text-[12px] font-medium text-ink-muted hover:text-ink"
          >
            <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', showManual && 'rotate-180')} aria-hidden="true" />
            {t('whatsapp.manualToggle')}
          </button>
        )}
        {showManual && (
          <form
            id="wa-manual-form"
            onSubmit={handleSubmit((values) => addManual.mutate(values))}
            noValidate
            className={cn('space-y-3', cloud.oauthAvailable && 'mt-3')}
          >
            {!cloud.oauthAvailable && <p className="text-[12px] font-semibold text-ink">{t('whatsapp.manualTitle')}</p>}
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
            <Button type="submit" variant={cloud.oauthAvailable ? 'outline' : 'primary'} loading={isSubmitting || addManual.isPending} disabled={!status.configured}>
              <Cloud className="h-3.5 w-3.5" aria-hidden="true" />
              {connected ? t('whatsapp.verifyAndAdd') : t('whatsapp.verifyAndConnect')}
            </Button>
          </form>
        )}
      </div>

      <div className="mt-4 border-t border-line pt-4">
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
        open={Boolean(pendingDisconnect)}
        onOpenChange={(open) => !open && !disconnect.isPending && setPendingDisconnect(null)}
        title={t('whatsapp.disconnectNumberTitle')}
        description={
          <Trans
            i18nKey="whatsapp.disconnectNumberText"
            values={{ number: pendingDisconnect?.displayNumber ?? pendingDisconnect?.phoneNumberId ?? '' }}
            components={{ bold: <span className="font-semibold text-ink" /> }}
          />
        }
        confirmLabel={t('whatsapp.disconnect')}
        tone="danger"
        loading={disconnect.isPending}
        onConfirm={() => pendingDisconnect && disconnect.mutate(pendingDisconnect)}
      />
    </section>
  );
}

function NumberRow({ number, busy, onDisconnect }: { number: WhatsAppNumber; busy: boolean; onDisconnect: () => void }) {
  const { t } = useTranslation();
  const daysLeft = tokenDaysLeft(number.accessExpiresAt);
  const display = number.displayNumber ?? number.phoneNumberId;

  return (
    <li className="flex items-center gap-3 rounded-card border border-line bg-white p-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-success/10">
        <Smartphone className="h-4 w-4 text-success" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold text-ink">{number.verifiedName ?? display}</p>
        <p className="text-[12px] text-ink-muted tnum">{display}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-ink-muted">
          <QualityBadge rating={number.qualityRating} />
          <span className={cn(daysLeft !== null && daysLeft <= 7 && 'font-medium text-danger')}>
            {daysLeft === null
              ? t('whatsapp.tokenNoExpiry')
              : `${t('whatsapp.accessExpiresOn', { date: formatDate(number.accessExpiresAt) })} · ${
                  daysLeft < 0 ? t('whatsapp.tokenExpired') : t('whatsapp.tokenDaysLeft', { count: daysLeft })
                }`}
          </span>
          <span aria-hidden="true">·</span>
          <span className={cn(!number.webhookSubscribed && 'text-[#986812]')}>
            {number.webhookSubscribed ? t('whatsapp.deliveryUpdatesOn') : t('whatsapp.deliveryUpdatesOff')}
          </span>
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <Badge tone="success" className="px-1.5 py-0 text-[10px]">
          {t('whatsapp.active')}
        </Badge>
        <span className="whitespace-nowrap text-[10.5px] text-ink-muted">{t('whatsapp.since', { date: formatDate(number.connectedAt) })}</span>
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        className="shrink-0 text-danger hover:bg-danger/5 hover:text-danger"
        aria-label={t('whatsapp.disconnectNumberLabel', { number: display })}
        disabled={busy}
        onClick={onDisconnect}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Trash2 className="h-4 w-4" aria-hidden="true" />}
      </Button>
    </li>
  );
}

// ----------------------------- Inbox access ----------------------------------

interface Role {
  id: string;
  key: string;
  name: string;
  userCount: number;
  permissions: string[];
}

const INBOX_PERMISSION = 'whatsapp.inbox';

function withInbox(permissions: string[], enabled: boolean) {
  const others = permissions.filter((key) => key !== INBOX_PERMISSION);
  return enabled ? [...others, INBOX_PERMISSION] : others;
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Who may open the WhatsApp inbox. Access is role-based here, so each role
 * gets a switch that adds or removes the inbox permission.
 */
function InboxAccessCard() {
  const { t } = useTranslation();
  const labels = useLabels();
  const { can } = useAuth();
  const canView = can('user.view', 'settings.view');
  const editable = can('settings.manage');

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: queryKeys.roles,
    queryFn: () => api.get<{ data: Role[] }>('/roles'),
    enabled: canView,
  });
  const roles = data?.data ?? [];

  const toggle = useMutation({
    mutationFn: ({ role, enabled }: { role: Role; enabled: boolean }) =>
      api.put(`/roles/${role.id}/permissions`, { permissions: withInbox(role.permissions, enabled) }),
    onSuccess: (_data, { role, enabled }) => {
      // Update the cached role right away so the switch doesn't flick back while refetching.
      queryClient.setQueryData<{ data: Role[] }>(queryKeys.roles, (current) =>
        current && {
          ...current,
          data: current.data.map((item) => (item.id === role.id ? { ...item, permissions: withInbox(item.permissions, enabled) } : item)),
        },
      );
      const name = labels.roles[role.key] ?? role.name;
      toast.success(enabled ? t('whatsapp.inboxGranted', { role: name }) : t('whatsapp.inboxRevoked', { role: name }));
      queryClient.invalidateQueries({ queryKey: queryKeys.roles });
      queryClient.invalidateQueries({ queryKey: queryKeys.session });
    },
    onError: (err) => toast.error(t('whatsapp.inboxUpdateFailed'), { description: errorMessage(t, err) }),
  });

  return (
    <SectionCard
      title={
        <span className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-brand" aria-hidden="true" />
          {t('whatsapp.inboxAccessTitle')}
        </span>
      }
      description={t('whatsapp.inboxAccessText')}
    >
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-control border border-info/20 bg-info/5 px-4 py-3">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-info" aria-hidden="true" />
          <p className="text-[12px] leading-relaxed text-info">
            <span className="font-semibold">{t('whatsapp.inboxRoleBasedTitle')}</span> {t('whatsapp.inboxRoleBasedText')}{' '}
            <Link to="/settings/roles" className="font-medium underline underline-offset-2">
              {t('settings.rolesTitle')}
            </Link>
          </p>
        </div>

        {!canView ? (
          <p className="text-[12.5px] text-ink-muted">{t('whatsapp.inboxNoRoleAccess')}</p>
        ) : error ? (
          <ErrorState message={errorMessage(t, error)} onRetry={() => void refetch()} />
        ) : (
          <div className="overflow-hidden rounded-card border border-line bg-white">
            <div className="flex items-center gap-2 border-b border-line bg-canvas/60 px-4 py-2.5 sm:px-5">
              <Users className="h-4 w-4 text-ink-muted" aria-hidden="true" />
              <span className="text-[12.5px] font-medium text-ink">{t('whatsapp.inboxRoles')}</span>
              {!isLoading && (
                <span className="ml-auto text-[11.5px] text-ink-muted tnum">{t('whatsapp.inboxRoleCount', { count: roles.length })}</span>
              )}
            </div>

            {isLoading ? (
              <ul className="divide-y divide-line" aria-busy="true">
                {[0, 1, 2].map((index) => (
                  <li key={index} className="flex items-center gap-4 px-4 py-3.5 sm:px-5">
                    <div className="skeleton h-9 w-9 shrink-0 rounded-full" />
                    <div className="flex-1 space-y-2">
                      <div className="skeleton h-3.5 w-36 rounded-full" />
                      <div className="skeleton h-3 w-20 rounded-full" />
                    </div>
                    <div className="skeleton h-5 w-9 rounded-full" />
                  </li>
                ))}
              </ul>
            ) : roles.length === 0 ? (
              <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
                <Users className="mb-2 h-7 w-7 text-ink-muted/50" aria-hidden="true" />
                <p className="text-[12.5px] font-medium text-ink">{t('whatsapp.inboxNoRoles')}</p>
              </div>
            ) : (
              <ul className="divide-y divide-line">
                {roles.map((role) => {
                  const name = labels.roles[role.key] ?? role.name;
                  const updating = toggle.isPending && toggle.variables?.role.id === role.id;
                  // Show the requested state while the change is being saved.
                  const hasAccess = updating ? toggle.variables!.enabled : role.permissions.includes(INBOX_PERMISSION);
                  const switchId = `inbox-role-${role.id}`;
                  return (
                    <li key={role.id} className="flex items-center gap-4 px-4 py-3.5 transition-colors hover:bg-canvas/50 sm:px-5">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-primary text-[11.5px] font-bold text-white">
                        {initials(name)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <label htmlFor={switchId} className="block truncate text-[13px] font-medium text-ink">
                          {name}
                        </label>
                        <p className="truncate text-[11.5px] text-ink-muted">{t('roles.userCount', { count: role.userCount })}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {updating && <Loader2 className="h-3.5 w-3.5 animate-spin text-ink-muted" aria-hidden="true" />}
                        <span className={cn('hidden text-[12px] sm:block', hasAccess ? 'font-medium text-brand' : 'text-ink-muted')}>
                          {hasAccess ? t('whatsapp.inboxFullAccess') : t('whatsapp.inboxNoAccess')}
                        </span>
                        <Switch
                          id={switchId}
                          checked={hasAccess}
                          disabled={!editable || updating}
                          onCheckedChange={(enabled) => toggle.mutate({ role, enabled })}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {canView && !editable && <p className="text-[11.5px] text-ink-muted">{t('whatsapp.inboxReadOnly')}</p>}
      </div>
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

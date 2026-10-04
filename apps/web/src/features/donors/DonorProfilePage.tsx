import { useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  ArrowDownLeft,
  ArrowUpRight,
  CalendarHeart,
  HeartHandshake,
  Mail,
  MapPin,
  MessageCircle,
  Pencil,
  Phone,
  Plus,
  ReceiptText,
  RotateCcw,
  Trash2,
  UserX,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api/client';
import { invalidateDonationData, queryClient, queryKeys } from '@/lib/api/queryClient';
import { useAuth } from '@/lib/auth/AuthProvider';
import { errorMessage } from '@/i18n/errors';
import { useLabels } from '@/i18n/useLabels';
import { PageHeader } from '@/components/layout/PageHeader';
import { SectionCard } from '@/components/common/SectionCard';
import { StatCard } from '@/components/common/StatCard';
import { ChartSkeleton, EmptyState, ErrorState } from '@/components/common/states';
import { ConfirmationDialog } from '@/components/common/ConfirmationDialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar } from '@/components/ui/misc';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BarChart } from '@/components/charts';
import { formatCurrency, formatDate } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';
import { DonationDialog } from '@/features/donations/DonationDialog';
import { SendMessageDialog } from '@/features/whatsapp/SendMessageDialog';
import { MESSAGE_TONES } from '@/features/whatsapp/api';
import { DonorWhatsAppChat } from '@/features/whatsapp/inbox/DonorWhatsAppChat';
import { DonorFormDialog } from './DonorFormDialog';
import type { DonorProfile } from './types';

export default function DonorProfilePage() {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const labels = useLabels();
  const { can } = useAuth();

  const [editOpen, setEditOpen] = useState(false);
  const [donationOpen, setDonationOpen] = useState(false);
  const [messageOpen, setMessageOpen] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const navigate = useNavigate();

  const { data: donor, isLoading, error, refetch } = useQuery({
    queryKey: queryKeys.donor(id),
    queryFn: () => api.get<DonorProfile>(`/donors/${id}`),
    enabled: Boolean(id),
  });

  const setActive = useMutation({
    mutationFn: (active: boolean) => (active ? api.post(`/donors/${id}/restore`) : api.delete(`/donors/${id}`)),
    onSuccess: (_, active) => {
      toast.success(active ? t('donors.restored') : t('donors.deactivated'));
      queryClient.invalidateQueries({ queryKey: ['donors'] });
      queryClient.invalidateQueries({ queryKey: queryKeys.donor(id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.masters });
      setConfirmDeactivate(false);
    },
    onError: (err) => toast.error(t('donors.saveFailed'), { description: errorMessage(t, err) }),
  });

  const remove = useMutation({
    mutationFn: () => api.delete(`/donors/${id}/permanent`),
    onSuccess: () => {
      toast.success(t('donors.deleted'));
      setConfirmDelete(false);
      queryClient.removeQueries({ queryKey: queryKeys.donor(id) });
      invalidateDonationData();
      navigate('/donors', { replace: true });
    },
    onError: (err) => {
      setConfirmDelete(false);
      toast.error(t('donors.deleteFailed'), { description: errorMessage(t, err) });
    },
  });

  if (error) return <ErrorState message={errorMessage(t, error)} onRetry={() => void refetch()} />;

  if (isLoading || !donor) {
    return (
      <div className="space-y-4">
        <ChartSkeleton height={120} />
        <ChartSkeleton height={320} />
      </div>
    );
  }

  const address = [donor.addressLine1, donor.addressLine2, donor.village, donor.district, donor.state, donor.postalCode]
    .filter(Boolean)
    .join(', ');
  const cannotMessageReason = donor.messaging.reason ? t(`donors.reason.${donor.messaging.reason}`) : undefined;

  return (
    <>
      <PageHeader
        title={donor.name}
        subtitle={`${donor.code} · ${labels.donorCategory[donor.category] ?? donor.category}`}
        breadcrumbs={[{ label: t('donors.title'), to: '/donors' }, { label: donor.name }]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {can('donor.manage') && (
              <Button variant="outline" onClick={() => setEditOpen(true)}>
                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                {t('common.edit')}
              </Button>
            )}
            {can('donation.create') && donor.isActive && (
              <Button variant="outline" onClick={() => setDonationOpen(true)}>
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                {t('donors.recordDonation')}
              </Button>
            )}
            {can('whatsapp.send') && (
              <Button
                onClick={() => setMessageOpen(true)}
                disabled={!donor.messaging.canMessage}
                title={cannotMessageReason}
                aria-describedby={cannotMessageReason ? 'donor-message-reason' : undefined}
              >
                <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />
                {t('donors.sendWhatsApp')}
              </Button>
            )}
          </div>
        }
      />

      {can('whatsapp.send') && cannotMessageReason && (
        <p
          id="donor-message-reason"
          className="mb-4 rounded-control border border-warning/30 bg-warning/10 px-3 py-2 text-[12px] text-[#7a5410]"
        >
          {cannotMessageReason}
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard label={t('donors.totalGiven')} value={donor.stats.totalDonated} icon={HeartHandshake} tone="success" />
        <StatCard
          label={t('donors.donations')}
          value={donor.stats.donationCount}
          format="number"
          icon={ReceiptText}
          tone="brand"
          hint={donor.stats.firstDonationAt ? t('donors.since', { date: formatDate(donor.stats.firstDonationAt) }) : undefined}
        />
        <StatCard label={t('donors.averageGift')} value={donor.stats.averageDonation} icon={ArrowUpRight} tone="accent" />
        <StatCard
          label={t('donors.lastDonation')}
          value={donor.donations[0]?.amount ?? 0}
          icon={CalendarHeart}
          tone="info"
          hint={donor.stats.lastDonationAt ? formatDate(donor.stats.lastDonationAt) : t('donors.noDonationsYet')}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[320px_1fr]">
        <SectionCard title={t('donors.profile')}>
          <div className="flex items-center gap-3">
            <Avatar name={donor.name} size="lg" className="h-12 w-12" />
            <div className="min-w-0">
              <p className="truncate text-[14px] font-semibold text-ink">{donor.name}</p>
              <div className="mt-1 flex flex-wrap gap-1">
                <Badge tone={donor.isActive ? 'success' : 'neutral'}>{donor.isActive ? t('common.active') : t('common.inactive')}</Badge>
                {donor.whatsappOptIn ? (
                  <Badge tone="success">{t('donors.optedInBadge')}</Badge>
                ) : (
                  <Badge tone="warning">{t('donors.notOptedIn')}</Badge>
                )}
              </div>
            </div>
          </div>

          <dl className="mt-4 space-y-3 text-[12.5px]">
            <Detail icon={<Phone className="h-3.5 w-3.5" />} label={t('common.mobile')}>
              {donor.phone ?? '—'}
              {donor.alternatePhone && <span className="block text-ink-muted">{donor.alternatePhone}</span>}
            </Detail>
            <Detail icon={<MessageCircle className="h-3.5 w-3.5" />} label={t('donors.whatsappNumber')}>
              {donor.whatsappNumber ?? (donor.phone ? t('donors.sameAsMobile') : '—')}
              {donor.whatsappOptInAt && (
                <span className="block text-[11.5px] text-ink-muted">
                  {t('donors.optedInOn', { date: formatDate(donor.whatsappOptInAt) })}
                </span>
              )}
            </Detail>
            <Detail icon={<Mail className="h-3.5 w-3.5" />} label={t('common.email')}>
              {donor.email ? (
                <a href={`mailto:${donor.email}`} className="break-all text-brand-primary hover:underline">
                  {donor.email}
                </a>
              ) : (
                '—'
              )}
            </Detail>
            <Detail icon={<MapPin className="h-3.5 w-3.5" />} label={t('orgSettings.address')}>
              {address || '—'}
            </Detail>
          </dl>

          <dl className="mt-3 grid grid-cols-2 gap-3 border-t border-line pt-3 text-[12.5px]">
            <Field label={t('donors.pan')} value={donor.panNumber} />
            <Field label={t('donors.aadhaar')} value={donor.aadhaarMasked} />
          </dl>

          {(donor.tags.length > 0 || donor.notes) && (
            <dl className="mt-3 space-y-3 border-t border-line pt-3 text-[12.5px]">
              {donor.tags.length > 0 && (
                <div>
                  <dt className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">{t('donors.tags')}</dt>
                  <dd className="mt-1.5 flex flex-wrap gap-1">
                    {donor.tags.map((tag) => (
                      <Badge key={tag} tone="brand">
                        {tag}
                      </Badge>
                    ))}
                  </dd>
                </div>
              )}
              {donor.notes && (
                <div>
                  <dt className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">{t('common.notes')}</dt>
                  <dd className="mt-1 whitespace-pre-wrap text-ink">{donor.notes}</dd>
                </div>
              )}
            </dl>
          )}

          {(can('donor.manage') || can('donor.delete')) && (
            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3">
              {!can('donor.manage') ? null : donor.isActive ? (
                <Button variant="danger-outline" size="sm" onClick={() => setConfirmDeactivate(true)}>
                  <UserX className="h-3.5 w-3.5" aria-hidden="true" />
                  {t('donors.deactivate')}
                </Button>
              ) : (
                <Button variant="outline" size="sm" loading={setActive.isPending} onClick={() => setActive.mutate(true)}>
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                  {t('donors.restore')}
                </Button>
              )}
              {can('donor.delete') && (
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => setConfirmDelete(true)}
                  disabled={donor.stats.donationCount > 0}
                  aria-describedby={donor.stats.donationCount > 0 ? 'donor-delete-hint' : undefined}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  {t('donors.delete')}
                </Button>
              )}
              {can('donor.delete') && donor.stats.donationCount > 0 && (
                <p id="donor-delete-hint" className="w-full text-[11.5px] text-ink-muted">
                  {t('donors.deleteBlocked', { count: donor.stats.donationCount })}
                </p>
              )}
            </div>
          )}
        </SectionCard>

        <div className="min-w-0">
          <Tabs defaultValue="donations">
            <TabsList className="w-fit">
              <TabsTrigger value="donations">{t('donors.donations')}</TabsTrigger>
              <TabsTrigger value="giving">{t('donors.givingTab')}</TabsTrigger>
              <TabsTrigger value="messages">{t('donors.messagesTab')}</TabsTrigger>
            </TabsList>

            <TabsContent value="donations">
              <SectionCard noPadding>
                {donor.donations.length === 0 ? (
                  <EmptyState
                    icon={HeartHandshake}
                    title={t('donors.noDonationsYet')}
                    description={t('donors.noDonationsText')}
                    action={
                      can('donation.create') &&
                      donor.isActive && (
                        <Button size="sm" onClick={() => setDonationOpen(true)}>
                          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                          {t('donors.recordDonation')}
                        </Button>
                      )
                    }
                  />
                ) : (
                  <ul className="divide-y divide-line">
                    {donor.donations.map((donation) => (
                      <li key={donation.id} className="flex items-start gap-3 px-4 py-3">
                        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-success/10">
                          <ArrowDownLeft className="h-4 w-4 text-success" aria-hidden="true" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-[13px] font-medium text-ink">
                            {donation.fund.name}
                            {donation.is80GEligible && (
                              <Badge tone="success" className="ml-2">
                                80G
                              </Badge>
                            )}
                          </p>
                          <p className="mt-0.5 text-[11.5px] text-ink-muted">
                            {donation.receiptNumber} · {formatDate(donation.date)} · {labels.donationMode[donation.mode] ?? donation.mode}
                            {donation.bankAccount ? ` · ${donation.bankAccount.name}` : ''}
                          </p>
                          {donation.purpose && <p className="mt-0.5 text-[12px] text-ink">{donation.purpose}</p>}
                        </div>
                        <span className="shrink-0 text-[13.5px] font-semibold text-success tnum">
                          {formatCurrency(donation.amount)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </SectionCard>
            </TabsContent>

            <TabsContent value="giving">
              <div className="grid gap-4 xl:grid-cols-2">
                <SectionCard title={t('donors.byYear')}>
                  <BarChart
                    data={donor.stats.byYear}
                    xKey="year"
                    series={[{ key: 'amount', label: t('common.amount') }]}
                    height={220}
                  />
                </SectionCard>
                <SectionCard title={t('donors.byFund')} noPadding>
                  {donor.stats.byFund.length === 0 ? (
                    <EmptyState title={t('donors.noDonationsYet')} />
                  ) : (
                    <ul className="divide-y divide-line">
                      {donor.stats.byFund.map((fund) => {
                        const share = donor.stats.totalDonated ? Math.round((fund.amount / donor.stats.totalDonated) * 100) : 0;
                        return (
                          <li key={fund.fundId} className="px-4 py-3">
                            <div className="flex items-center justify-between gap-3">
                              <p className="truncate text-[12.5px] font-medium text-ink">{fund.name}</p>
                              <p className="shrink-0 text-[12.5px] font-semibold text-ink tnum">{formatCurrency(fund.amount)}</p>
                            </div>
                            <div className="mt-1.5 flex items-center gap-2">
                              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-line" aria-hidden="true">
                                <div className="h-full rounded-full bg-brand-primary" style={{ width: `${share}%` }} />
                              </div>
                              <span className="w-24 shrink-0 text-right text-[11px] text-ink-muted tnum">
                                {share}% · {t('donors.donationCount', { count: fund.count })}
                              </span>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </SectionCard>
              </div>
            </TabsContent>

            <TabsContent value="messages">
              {can('whatsapp.inbox') && donor.messaging.number ? (
                <DonorWhatsAppChat phone={donor.messaging.number} />
              ) : (
                <SectionCard noPadding>
                  {donor.messages.length === 0 ? (
                    <EmptyState icon={MessageCircle} title={t('donors.noMessages')} description={t('donors.noMessagesText')} />
                  ) : (
                    <ol className="space-y-3 p-4">
                      {donor.messages.map((message) => {
                        const inbound = message.direction === 'INBOUND';
                        return (
                          <li key={message.id} className={cn('flex', inbound ? 'justify-start' : 'justify-end')}>
                            <div
                              className={cn(
                                'max-w-[85%] rounded-[12px] px-3 py-2 shadow-sm',
                                inbound ? 'rounded-tl-sm border border-line bg-white' : 'rounded-tr-sm bg-brand-light',
                              )}
                            >
                              <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink">{message.body ?? '—'}</p>
                              <div className="mt-1.5 flex flex-wrap items-center justify-end gap-x-2 gap-y-1 text-[10.5px] text-ink-muted">
                                <span>{formatDate(message.sentAt ?? message.createdAt, 'long')}</span>
                                {!inbound && message.sentBy && <span>· {message.sentBy.name}</span>}
                                <span>· {t(`whatsapp.provider.${message.provider}`)}</span>
                                <Badge tone={MESSAGE_TONES[message.status]}>{t(`whatsapp.messageStatus.${message.status}`)}</Badge>
                              </div>
                              {message.error && (
                                <p className="mt-1 text-[11px] text-danger">
                                  {t(`errors.${message.error}`, { defaultValue: message.error })}
                                </p>
                              )}
                            </div>
                          </li>
                        );
                      })}
                    </ol>
                  )}
                </SectionCard>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </div>

      <DonorFormDialog open={editOpen} onOpenChange={setEditOpen} donor={donor} />

      {donationOpen && (
        <DonationDialog
          open={donationOpen}
          onOpenChange={setDonationOpen}
          donor={{ id: donor.id, name: donor.name }}
          onRecorded={() => {
            queryClient.invalidateQueries({ queryKey: queryKeys.donor(id) });
            queryClient.invalidateQueries({ queryKey: ['donors'] });
          }}
        />
      )}

      <SendMessageDialog
        open={messageOpen}
        onOpenChange={setMessageOpen}
        donor={{ id: donor.id, name: donor.name, number: donor.messaging.number }}
      />

      <ConfirmationDialog
        open={confirmDeactivate}
        onOpenChange={setConfirmDeactivate}
        title={t('donors.deactivateTitle')}
        description={t('donors.deactivateText', { name: donor.name })}
        confirmLabel={t('donors.deactivate')}
        tone="danger"
        loading={setActive.isPending}
        onConfirm={() => setActive.mutate(false)}
      />

      <ConfirmationDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t('donors.deleteTitle')}
        description={t('donors.deleteText', { name: donor.name })}
        confirmLabel={t('donors.deletePermanently')}
        tone="danger"
        loading={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </>
  );
}

/** A <dl> row: <dt> and <dd> sit directly in one wrapper, as the spec requires. */
function Detail({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="flex items-center gap-2.5 text-[11px] font-medium uppercase tracking-wide text-ink-muted">
        <span aria-hidden="true">{icon}</span>
        {label}
      </dt>
      <dd className="mt-0.5 min-w-0 pl-6 text-ink">{children}</dd>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">{label}</dt>
      <dd className="mt-0.5 text-ink">{value || '—'}</dd>
    </div>
  );
}


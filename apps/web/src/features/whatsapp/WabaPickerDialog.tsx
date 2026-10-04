import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Building2, CheckCircle2, Smartphone } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api/client';
import { queryClient, queryKeys } from '@/lib/api/queryClient';
import { errorMessage } from '@/i18n/errors';
import { ErrorState } from '@/components/common/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/misc';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils/cn';
import type { PendingConnection, WhatsAppStatus } from './api';

const QUALITY_TONES: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  GREEN: 'success',
  YELLOW: 'warning',
  RED: 'danger',
};

export function QualityBadge({ rating }: { rating: string | null }) {
  const { t } = useTranslation();
  if (!rating) return null;
  return <Badge tone={QUALITY_TONES[rating] ?? 'neutral'}>{t(`whatsapp.quality.${rating}`, { defaultValue: rating })}</Badge>;
}

type Selection = { businessAccountId: string; phoneNumberId: string };

/**
 * After "Connect WhatsApp", Meta may share several business accounts and
 * numbers. Every number starts selected so an ashram that owns them all
 * connects everything in one click; anything that isn't theirs is unchecked.
 */
export function WabaPickerDialog({ pendingId, onClose }: { pendingId: string | null; onClose: () => void }) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data, isLoading, error } = useQuery({
    queryKey: ['whatsapp', 'pending', pendingId],
    queryFn: () => api.get<{ data: PendingConnection }>(`/whatsapp/oauth/pending/${pendingId}`).then((result) => result.data),
    enabled: Boolean(pendingId),
    retry: false,
  });

  // Phone number id → the business account it belongs to.
  const owners = useMemo(() => {
    const map = new Map<string, string>();
    for (const account of data?.businessAccounts ?? []) {
      for (const phone of account.phoneNumbers) map.set(phone.id, account.id);
    }
    return map;
  }, [data]);

  useEffect(() => {
    setSelected(new Set(owners.keys()));
  }, [owners]);

  const toggle = (phoneNumberId: string, checked: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(phoneNumberId);
      else next.delete(phoneNumberId);
      return next;
    });

  const complete = useMutation({
    mutationFn: () => {
      const numbers: Selection[] = Array.from(selected)
        .filter((id) => owners.has(id))
        .map((phoneNumberId) => ({ businessAccountId: owners.get(phoneNumberId)!, phoneNumberId }));
      return api.post<WhatsAppStatus>('/whatsapp/oauth/complete', { pendingId, numbers });
    },
    onSuccess: (status) => {
      queryClient.setQueryData(queryKeys.whatsappStatus, status);
      queryClient.invalidateQueries({ queryKey: queryKeys.whatsappTemplates });
      toast.success(t('whatsapp.numbersConnected', { count: selected.size }));
      onClose();
    },
    onError: (err) => toast.error(t('whatsapp.cloudConnectFailed'), { description: errorMessage(t, err) }),
  });

  const count = selected.size;
  const empty = Boolean(data) && owners.size === 0;

  return (
    <Dialog open={Boolean(pendingId)} onOpenChange={(open) => !open && !complete.isPending && onClose()}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{t('whatsapp.pickerTitle')}</DialogTitle>
          <DialogDescription>{t('whatsapp.pickerText')}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          {error ? (
            <ErrorState message={errorMessage(t, error)} />
          ) : isLoading || !data ? (
            <div className="space-y-2">
              <div className="skeleton h-16 rounded-card" />
              <div className="skeleton h-16 rounded-card" />
            </div>
          ) : empty ? (
            <p className="rounded-control border border-line bg-canvas/60 px-3 py-4 text-center text-[12.5px] text-ink-muted">
              {t('whatsapp.pickerEmpty')}
            </p>
          ) : (
            <div className="space-y-4">
              {data.businessAccounts
                .filter((account) => account.phoneNumbers.length)
                .map((account) => (
                  <section key={account.id} aria-label={account.name ?? t('whatsapp.businessAccount')}>
                    <h3 className="mb-2 flex items-center gap-2 text-[12px] font-semibold text-ink">
                      <Building2 className="h-3.5 w-3.5 text-ink-muted" aria-hidden="true" />
                      {account.name ?? t('whatsapp.businessAccount')}
                      <span className="font-normal text-ink-muted tnum">· {account.id}</span>
                    </h3>
                    <ul className="space-y-2">
                      {account.phoneNumbers.map((phone) => {
                        const checked = selected.has(phone.id);
                        const inputId = `waba-pick-${phone.id}`;
                        return (
                          <li key={phone.id}>
                            <label
                              htmlFor={inputId}
                              className={cn(
                                'flex cursor-pointer items-center gap-3 rounded-card border-2 p-3 transition-colors',
                                checked ? 'border-success/50 bg-success/5' : 'border-line bg-white hover:border-ink-muted/40',
                              )}
                            >
                              <Checkbox
                                id={inputId}
                                checked={checked}
                                onCheckedChange={(value) => toggle(phone.id, value === true)}
                                className="shrink-0"
                              />
                              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-success/10">
                                <Smartphone className="h-4 w-4 text-success" aria-hidden="true" />
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[13px] font-semibold text-ink">
                                  {phone.verifiedName ?? phone.displayNumber ?? phone.id}
                                </span>
                                <span className="block text-[11.5px] text-ink-muted tnum">{phone.displayNumber ?? phone.id}</span>
                              </span>
                              <QualityBadge rating={phone.qualityRating} />
                              {checked && <CheckCircle2 className="h-5 w-5 shrink-0 text-success" aria-hidden="true" />}
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                ))}
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={complete.isPending}>
            {error ? t('common.close') : t('common.cancel')}
          </Button>
          {!error && (
            <Button onClick={() => complete.mutate()} disabled={count === 0 || !data} loading={complete.isPending}>
              {count === 0 ? t('whatsapp.selectAtLeastOne') : t('whatsapp.connectCount', { count })}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { MessageCircle, PlugZap } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api/client';
import { queryClient, queryKeys } from '@/lib/api/queryClient';
import { useAuth } from '@/lib/auth/AuthProvider';
import { errorMessage } from '@/i18n/errors';
import { EmptyState } from '@/components/common/states';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { sendingProvider, useWhatsAppStatus } from './api';
import { EMPTY_COMPOSER, MessageComposer, hasContent, toContent, type ComposerState } from './MessageComposer';

/** One message to one donor, from their profile. */
export function SendMessageDialog({
  open,
  onOpenChange,
  donor,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  donor: { id: string; name: string; number: string | null };
}) {
  const { t } = useTranslation();
  const { can } = useAuth();
  const { data: status, isLoading } = useWhatsAppStatus(open);
  const provider = sendingProvider(status);
  const [composer, setComposer] = useState<ComposerState>(EMPTY_COMPOSER);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!open) {
      setComposer(EMPTY_COMPOSER);
      setError(undefined);
    }
  }, [open]);

  const mutation = useMutation({
    mutationFn: () => api.post('/whatsapp/send', { donorId: donor.id, ...toContent(composer, provider) }),
    onSuccess: () => {
      toast.success(t('whatsapp.sent'), { description: t('whatsapp.sentTo', { name: donor.name }) });
      queryClient.invalidateQueries({ queryKey: queryKeys.donor(donor.id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.whatsappStatus });
      onOpenChange(false);
    },
    onError: (err) => toast.error(t('whatsapp.sendFailed'), { description: errorMessage(t, err) }),
  });

  function submit() {
    if (!hasContent(composer, provider)) {
      setError(composer.mode === 'template' && provider === 'CLOUD_API' ? 'whatsapp.chooseTemplate' : 'whatsapp.messageRequired');
      return;
    }
    setError(undefined);
    mutation.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{t('whatsapp.sendTitle', { name: donor.name })}</DialogTitle>
          <DialogDescription>
            {donor.number}
            {provider && (
              <Badge tone="success" className="ml-2">
                {t(`whatsapp.provider.${provider}`)}
              </Badge>
            )}
          </DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <DialogBody>
            {!isLoading && !provider ? (
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
            ) : (
              <MessageComposer idPrefix="send" provider={provider} value={composer} onChange={setComposer} error={error} />
            )}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" loading={mutation.isPending} disabled={!provider}>
              <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />
              {t('whatsapp.send')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PlugZap, Send } from 'lucide-react';
import { errorMessage } from '@/i18n/errors';
import { PageHeader } from '@/components/layout/PageHeader';
import { ChartSkeleton, EmptyState, ErrorState } from '@/components/common/states';
import { Button } from '@/components/ui/button';
import { useWhatsAppStatus } from './api';
import { TemplatesCard } from './TemplatesCard';

/**
 * The template library under Broadcasts: your templates and their review status, a
 * set of ready-made starters, and the form to write or adapt one and submit it to Meta.
 */
export default function TemplatesPage() {
  const { t } = useTranslation();
  const { data: status, isLoading, error, refetch } = useWhatsAppStatus();
  const connected = Boolean(status?.cloud.status === 'CONNECTED' && status.cloud.numbers?.length);

  return (
    <>
      <PageHeader
        title={t('whatsapp.templates.pageTitle')}
        subtitle={t('whatsapp.templates.pageSubtitle')}
        breadcrumbs={[{ label: t('whatsapp.campaign.listTitle'), to: '/whatsapp/broadcasts' }, { label: t('nav.templates') }]}
        actions={
          <Button asChild variant="outline">
            <Link to="/whatsapp/broadcasts/new">
              <Send className="h-4 w-4" aria-hidden="true" />
              {t('whatsapp.campaign.newBroadcast')}
            </Link>
          </Button>
        }
      />

      {error ? (
        <ErrorState message={errorMessage(t, error)} onRetry={() => void refetch()} />
      ) : isLoading || !status ? (
        <ChartSkeleton height={360} />
      ) : !connected ? (
        <EmptyState
          icon={PlugZap}
          title={t('whatsapp.campaign.needCloudTitle')}
          description={t('whatsapp.templates.needCloudText')}
          action={
            <Button asChild size="sm">
              <Link to="/settings/whatsapp">{t('whatsapp.openSettings')}</Link>
            </Button>
          }
        />
      ) : (
        <TemplatesCard status={status} gallery />
      )}
    </>
  );
}

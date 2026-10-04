import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Database, Download, FileUp, Loader2, ShieldAlert } from 'lucide-react';
import { DonorImportDialog } from '@/features/donors/DonorImportDialog';
import { toast } from 'sonner';
import { api, downloadFile } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/queryClient';
import { useAuth } from '@/lib/auth/AuthProvider';
import { PageHeader } from '@/components/layout/PageHeader';
import { SectionCard } from '@/components/common/SectionCard';
import { Button } from '@/components/ui/button';
import { formatNumber } from '@/lib/utils/format';
import { useTranslation } from 'react-i18next';
import { errorMessage } from '@/i18n/errors';

interface SettingsSummary {
  organization: { name: string; slug: string };
  counts: { users: number; roles: number; auditLogs: number; expenses: number };
}

export default function DataToolsPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const [exporting, setExporting] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const { data } = useQuery({
    queryKey: queryKeys.settings,
    queryFn: () => api.get<SettingsSummary>('/settings'),
  });

  async function handleBackup() {
    setExporting(true);
    try {
      await downloadFile('/settings/backup', 'ashram-management-backup.json');
      toast.success(t('dataTools.downloaded'), { description: t('dataTools.downloadedText') });
    } catch (error) {
      toast.error(t('dataTools.failed'), { description: errorMessage(t, error) });
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <PageHeader
        title={t('settings.backupTitle')}
        subtitle={t('dataTools.subtitle')}
        breadcrumbs={[{ label: t('settings.title'), to: '/settings' }, { label: t('settings.backupTitle') }]}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title={t('dataTools.backup')} description={t('dataTools.backupText')}>
          <dl className="mb-4 grid grid-cols-2 gap-3 rounded-control bg-canvas/60 p-3 sm:grid-cols-4">
            <Stat label={t('nav.expenses')} value={data?.counts.expenses} />
            <Stat label={t('dataTools.users')} value={data?.counts.users} />
            <Stat label={t('dataTools.roles')} value={data?.counts.roles} />
            <Stat label={t('dataTools.auditEntries')} value={data?.counts.auditLogs} />
          </dl>

          <p className="mb-4 flex items-start gap-2 rounded-control border border-info/25 bg-info/5 px-3 py-2.5 text-[12px] text-info">
            <Database className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {t('dataTools.isolation')}
          </p>

          {can('settings.manage') ? (
            <Button onClick={() => void handleBackup()} loading={exporting}>
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              {t('dataTools.download')}
            </Button>
          ) : (
            <p className="flex items-center gap-2 text-[12.5px] text-ink-muted">
              <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
              {t('dataTools.needPermission')}
            </p>
          )}
        </SectionCard>

        <SectionCard title={t('dataTools.importTitle')} description={t('dataTools.importText')}>
          <div className="rounded-control border-2 border-dashed border-line bg-canvas/40 p-6 text-center">
            <FileUp className="mx-auto h-6 w-6 text-ink-muted" aria-hidden="true" />
            <p className="mt-2.5 text-[13px] font-medium text-ink">{t('donorImport.cardTitle')}</p>
            <p className="mx-auto mt-1 max-w-sm text-[12px] leading-relaxed text-ink-muted">{t('donorImport.cardText')}</p>
            {can('donor.manage') ? (
              <Button size="sm" className="mt-4" onClick={() => setImportOpen(true)}>
                <FileUp className="h-3.5 w-3.5" aria-hidden="true" />
                {t('donorImport.open')}
              </Button>
            ) : (
              <p className="mt-4 flex items-center justify-center gap-2 text-[12.5px] text-ink-muted">
                <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
                {t('donorImport.needPermission')}
              </p>
            )}
          </div>
        </SectionCard>
      </div>

      <DonorImportDialog open={importOpen} onOpenChange={setImportOpen} />
    </>
  );
}

function Stat({ label, value }: { label: string; value?: number }) {
  return (
    <div>
      <dt className="text-[10.5px] uppercase tracking-wide text-ink-muted">{label}</dt>
      <dd className="mt-0.5 text-[15px] font-semibold text-ink tnum">
        {value === undefined ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : formatNumber(value)}
      </dd>
    </div>
  );
}

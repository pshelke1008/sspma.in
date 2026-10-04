import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, FileSpreadsheet, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/auth/AuthProvider';
import { errorMessage } from '@/i18n/errors';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EXPORT_MAX_ROWS, exportRows, type ExportColumn, type ExportFormat, type ExportResult } from '@/lib/export';

export interface ExportMenuProps<T> {
  /** File name stem: `donations` → `donations-2026-10-04.xlsx`. */
  fileBase: string;
  /** Workbook title (already translated). */
  title: string;
  /** Optional second line in the workbook, e.g. the active tab or period. */
  subtitle?: string;
  columns: ExportColumn<T>[];
  /** Collects every row matching the current filters (paged lists). */
  fetchRows?: () => Promise<ExportResult<T>>;
  /** Rows already held in memory (unpaged lists). Used when `fetchRows` is absent. */
  rows?: T[];
  disabled?: boolean;
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * "Export ▾" → CSV / Excel. Hidden without the `report.export` permission;
 * the API enforces the same permission on the Excel endpoint.
 */
export function ExportMenu<T>({
  fileBase,
  title,
  subtitle,
  columns,
  fetchRows,
  rows,
  disabled,
  size = 'md',
  className,
}: ExportMenuProps<T>) {
  const { t } = useTranslation();
  const { can } = useAuth();
  const [busy, setBusy] = useState<ExportFormat | null>(null);

  if (!can('report.export')) return null;

  async function run(format: ExportFormat) {
    setBusy(format);
    const toastId = toast.loading(t('dataExport.preparing'));
    try {
      const result: ExportResult<T> = fetchRows
        ? await fetchRows()
        : { rows: rows ?? [], total: rows?.length ?? 0, capped: false };

      if (result.rows.length === 0) {
        toast.info(t('dataExport.empty'), { id: toastId });
        return;
      }

      await exportRows({ format, fileBase, title, subtitle, columns, rows: result.rows });

      if (result.capped) {
        toast.warning(t('dataExport.done', { count: result.rows.length }), {
          id: toastId,
          description: t('dataExport.capped', { max: EXPORT_MAX_ROWS.toLocaleString('en-IN'), total: result.total.toLocaleString('en-IN') }),
          duration: 10_000,
        });
      } else {
        toast.success(t('dataExport.done', { count: result.rows.length }), { id: toastId });
      }
    } catch (err) {
      toast.error(t('dataExport.failed'), { id: toastId, description: errorMessage(t, err) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size={size}
          className={className}
          disabled={disabled}
          loading={busy !== null}
          aria-label={t('dataExport.ariaLabel')}
        >
          {busy === null && <Download className="h-3.5 w-3.5" aria-hidden="true" />}
          {t('dataExport.button')}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>{t('dataExport.menuLabel')}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={busy !== null} onSelect={() => void run('csv')}>
          <FileText className="h-3.5 w-3.5" aria-hidden="true" />
          {t('dataExport.csv')}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={busy !== null} onSelect={() => void run('xlsx')}>
          <FileSpreadsheet className="h-3.5 w-3.5" aria-hidden="true" />
          {t('dataExport.excel')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

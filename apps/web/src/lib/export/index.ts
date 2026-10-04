import { downloadPost, saveBlob } from '@/lib/api/client';
import { todayLocal } from '@/lib/utils/format';
import { rowsToMatrix, toCsv } from './csv';
import type { ExportColumn } from './types';

export * from './types';
export { EXPORT_MAX_ROWS, fetchAllPages } from './fetchAll';
export { isoDate, neutraliseFormula, toCsv } from './csv';

export type ExportFormat = 'csv' | 'xlsx';

/** Content type the export route parses with its own (larger) body limit. */
const EXPORT_CONTENT_TYPE = 'application/vnd.ashram.export+json';
/** Matches the API's per-cell limit. */
const MAX_CELL = 4000;

/** `donations` → `donations-2026-10-04.csv` */
export function exportFileName(base: string, format: ExportFormat): string {
  const safe = base.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'export';
  return `${safe}-${todayLocal()}.${format}`;
}

export async function exportRows<T>({
  format,
  fileBase,
  title,
  subtitle,
  columns,
  rows,
}: {
  format: ExportFormat;
  fileBase: string;
  title: string;
  subtitle?: string;
  columns: ExportColumn<T>[];
  rows: T[];
}): Promise<void> {
  const fileName = exportFileName(fileBase, format);

  if (format === 'csv') {
    saveBlob(new Blob([toCsv(columns, rows)], { type: 'text/csv;charset=utf-8' }), fileName);
    return;
  }

  await downloadPost(
    '/exports/xlsx',
    {
      title,
      subtitle,
      fileName: fileName.replace(/\.xlsx$/, ''),
      columns: columns.map((column) => ({ header: column.header, type: column.type ?? 'text' })),
      rows: rowsToMatrix(columns, rows).map((values) =>
        values.map((value) => (typeof value === 'string' && value.length > MAX_CELL ? value.slice(0, MAX_CELL) : value)),
      ),
    },
    fileName,
    { contentType: EXPORT_CONTENT_TYPE },
  );
}

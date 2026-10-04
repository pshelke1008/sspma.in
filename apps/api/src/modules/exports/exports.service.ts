import ExcelJS from 'exceljs';
import type { ExportCell, XlsxExportInput } from './exports.schema';

const BRAND = 'FF0657D6';
const INK = 'FF1B2232';
const MUTED = 'FF626F84';
const ZEBRA = 'FFF5F7FA';

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Date-only strings become UTC midnight so Excel shows the same calendar day everywhere. */
function toDate(raw: ExportCell): Date | null {
  if (raw === null || raw === '' || typeof raw === 'boolean') return null;
  if (typeof raw === 'string') {
    const match = DATE_ONLY.exec(raw);
    if (match) return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function displayLength(raw: ExportCell): number {
  if (raw === null) return 0;
  return String(raw).length;
}

/**
 * Builds a single-sheet workbook from an already-filtered list: a title band,
 * a branded header row with auto-filter, typed number/date formats and
 * zebra striping — the same look as the report exports.
 */
export async function buildListWorkbook(input: XlsxExportInput, organizationName: string): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Ashram Management';
  workbook.created = new Date();

  const headerRowNumber = 4;
  const columnCount = input.columns.length;
  const sheet = workbook.addWorksheet(input.title.replace(/[\\/*?:[\]]/g, ' ').slice(0, 30) || 'Export', {
    views: [{ state: 'frozen', ySplit: headerRowNumber }],
  });

  sheet.mergeCells(1, 1, 1, Math.max(1, columnCount));
  sheet.getCell(1, 1).value = input.title;
  sheet.getCell(1, 1).font = { size: 14, bold: true, color: { argb: BRAND } };

  sheet.mergeCells(2, 1, 2, Math.max(1, columnCount));
  sheet.getCell(2, 1).value = [organizationName, input.subtitle].filter(Boolean).join('   •   ');
  sheet.getCell(2, 1).font = { size: 10, color: { argb: MUTED } };

  const headerRow = sheet.getRow(headerRowNumber);
  input.columns.forEach((column, index) => {
    const cell = headerRow.getCell(index + 1);
    cell.value = column.header;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } };
    cell.alignment = {
      horizontal: column.type === 'number' || column.type === 'currency' ? 'right' : 'left',
      vertical: 'middle',
    };
  });
  headerRow.height = 20;

  input.rows.forEach((row, rowIndex) => {
    const excelRow = sheet.getRow(headerRowNumber + 1 + rowIndex);
    input.columns.forEach((column, columnIndex) => {
      const cell = excelRow.getCell(columnIndex + 1);
      const raw = row[columnIndex] ?? null;
      const numeric = column.type === 'number' || column.type === 'currency';

      if (numeric) {
        const value = typeof raw === 'number' ? raw : raw === null || raw === '' ? null : Number(raw);
        cell.value = value === null || Number.isNaN(value) ? (raw === null ? '' : String(raw)) : value;
        cell.numFmt = column.type === 'currency' ? '#,##0.00' : '#,##0.##';
        cell.alignment = { horizontal: 'right' };
      } else if (column.type === 'date') {
        const date = toDate(raw);
        cell.value = date ?? (raw === null ? '' : String(raw));
        if (date) cell.numFmt = 'dd mmm yyyy';
      } else {
        // Always written as a plain string, never a formula.
        cell.value = raw === null ? '' : String(raw);
      }
      cell.font = { size: 10, color: { argb: INK } };
      if (rowIndex % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ZEBRA } };
    });
  });

  if (input.rows.length > 0) {
    sheet.autoFilter = {
      from: { row: headerRowNumber, column: 1 },
      to: { row: headerRowNumber + input.rows.length, column: columnCount },
    };
  }

  // Width from a sample so very long exports stay cheap to size.
  const sample = input.rows.slice(0, 500);
  input.columns.forEach((column, index) => {
    const longest = sample.reduce((max, row) => Math.max(max, displayLength(row[index] ?? null)), column.header.length);
    const floor = column.type === 'date' ? 13 : 10;
    sheet.getColumn(index + 1).width = Math.min(48, Math.max(floor, longest + 3));
  });

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

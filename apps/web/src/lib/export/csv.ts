import type { ExportColumn, ExportValue } from './types';

/** Leading characters spreadsheet apps treat as the start of a formula. */
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

/** Neutralises CSV/formula injection the same way the API's report CSV does. */
export function neutraliseFormula(value: string): string {
  return FORMULA_PREFIX.test(value) ? `'${value}` : value;
}

function cellText(value: ExportValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  // Real numbers are safe as-is (a negative amount is not a formula).
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  return neutraliseFormula(value);
}

/** RFC 4180: every field quoted, embedded quotes doubled, CRLF line breaks. */
function quote(text: string): string {
  return `"${text.replace(/"/g, '""')}"`;
}

/** Normalises any date-ish value to YYYY-MM-DD, which Excel recognises in every locale. */
export function isoDate(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return null;
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function rowsToMatrix<T>(columns: ExportColumn<T>[], rows: T[]): (string | number | boolean | null)[][] {
  return rows.map((row) =>
    columns.map((column) => {
      const raw = column.value(row);
      if (raw === undefined || raw === null || raw === '') return null;
      if (column.type === 'date' && typeof raw === 'string') return isoDate(raw);
      if ((column.type === 'number' || column.type === 'currency') && typeof raw === 'string') {
        const parsed = Number(raw);
        return Number.isFinite(parsed) ? parsed : raw;
      }
      return raw;
    }),
  );
}

/**
 * CSV text with a UTF-8 byte-order mark so Excel opens Marathi correctly.
 */
export function toCsv<T>(columns: ExportColumn<T>[], rows: T[]): string {
  const lines = [columns.map((column) => quote(neutraliseFormula(column.header))).join(',')];
  for (const values of rowsToMatrix(columns, rows)) {
    lines.push(values.map((value) => quote(cellText(value))).join(','));
  }
  return `﻿${lines.join('\r\n')}\r\n`;
}

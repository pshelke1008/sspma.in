/**
 * Reading a spreadsheet of phone numbers for a broadcast.
 *
 * The sheet only chooses *who*: each number is matched to a donor, and a number
 * that belongs to no donor is reported and left out, because consent to
 * WhatsApp messages is recorded on the donor and cannot be assumed for anyone
 * else. Other columns can fill template variables.
 */
import ExcelJS from 'exceljs';
import { WhatsAppError, WhatsAppErrorCode } from './errors';
import { normalizePhone } from './phone';

export const UPLOAD_MAX_ROWS = 5000;
const UPLOAD_MAX_COLUMNS = 30;
const UPLOAD_MAX_CELL_CHARS = 200;
const PHONE_HEADER = /phone|mobile|whatsapp|contact|number|मोबाइल|फोन/i;

export interface SheetRow {
  /** 1-based row number in the sheet, for pointing at a problem. */
  rowNumber: number;
  /** Normalised number, or null when the cell is not a plausible phone number. */
  phone: string | null;
  rawPhone: string;
  values: Record<string, string>;
}

export interface ParsedSheet {
  columns: string[];
  phoneColumn: string;
  rows: SheetRow[];
}

const pad = (value: number) => String(value).padStart(2, '0');

/** A cell's value as the text a person would read in the sheet. */
export function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return `${pad(value.getUTCDate())}-${pad(value.getUTCMonth() + 1)}-${value.getUTCFullYear()}`;
  if (typeof value === 'object') {
    if ('richText' in value) return value.richText.map((part) => part.text).join('');
    if ('result' in value) return cellText(value.result as ExcelJS.CellValue);
    if ('text' in value) return cellText(value.text as ExcelJS.CellValue);
    if ('error' in value) return '';
    return '';
  }
  return String(value);
}

const clean = (value: ExcelJS.CellValue) => cellText(value).trim().slice(0, UPLOAD_MAX_CELL_CHARS);

export async function parseRecipientSheet(buffer: Buffer): Promise<ParsedSheet> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  } catch {
    throw new WhatsAppError(WhatsAppErrorCode.UPLOAD_INVALID);
  }

  const sheet = workbook.worksheets.find((candidate) => candidate.rowCount > 0);
  if (!sheet) throw new WhatsAppError(WhatsAppErrorCode.UPLOAD_INVALID);

  // The header is the first row with anything in it.
  let headerRowNumber = 0;
  const headers = new Map<number, string>();
  for (let rowNumber = 1; rowNumber <= sheet.rowCount && !headerRowNumber; rowNumber += 1) {
    sheet.getRow(rowNumber).eachCell({ includeEmpty: false }, (cell, column) => {
      const text = clean(cell.value);
      if (text) headers.set(column, text);
    });
    if (headers.size) headerRowNumber = rowNumber;
  }
  if (!headerRowNumber) throw new WhatsAppError(WhatsAppErrorCode.UPLOAD_INVALID);

  const columns: string[] = [];
  const columnAt = new Map<number, string>();
  for (const [index, text] of [...headers.entries()].sort((a, b) => a[0] - b[0]).slice(0, UPLOAD_MAX_COLUMNS)) {
    // Repeated headers get a suffix so every column stays addressable.
    let name = text;
    for (let suffix = 2; columns.includes(name); suffix += 1) name = `${text} (${suffix})`;
    columns.push(name);
    columnAt.set(index, name);
  }

  const phoneColumn = columns.find((name) => PHONE_HEADER.test(name));
  if (!phoneColumn) throw new WhatsAppError(WhatsAppErrorCode.UPLOAD_INVALID);
  const phoneIndex = [...columnAt.entries()].find(([, name]) => name === phoneColumn)![0];

  const rows: SheetRow[] = [];
  for (let rowNumber = headerRowNumber + 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const rawPhone = clean(row.getCell(phoneIndex).value);
    const values: Record<string, string> = {};
    let hasContent = Boolean(rawPhone);
    for (const [index, name] of columnAt) {
      const text = clean(row.getCell(index).value);
      values[name] = text;
      if (text) hasContent = true;
    }
    if (!hasContent) continue; // blank line
    if (rows.length >= UPLOAD_MAX_ROWS) throw new WhatsAppError(WhatsAppErrorCode.UPLOAD_INVALID, `Use at most ${UPLOAD_MAX_ROWS} rows per upload.`);
    rows.push({ rowNumber, phone: normalizePhone(rawPhone), rawPhone, values });
  }

  return { columns, phoneColumn, rows };
}

/** The spreadsheet offered as an example: phone, name, and one column per template variable. */
export async function buildRecipientTemplate(variableCount: number): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Recipients');
  const headers = ['Phone', 'Name', ...Array.from({ length: variableCount }, (_, index) => `Variable ${index + 1}`)];
  sheet.addRow(headers).font = { bold: true };
  sheet.addRow(['9820011223', 'Ramesh Kale', ...Array.from({ length: variableCount }, (_, index) => `Sample ${index + 1}`)]);
  sheet.columns.forEach((column) => {
    column.width = 18;
  });
  // Phone numbers are text, so a leading 0 or +91 survives.
  sheet.getColumn(1).numFmt = '@';
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

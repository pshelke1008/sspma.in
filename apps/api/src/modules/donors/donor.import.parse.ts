/**
 * Pure helpers behind the bulk donor import: a small RFC 4180 CSV reader,
 * mapping of spreadsheet rows onto `donorSchema`, and duplicate detection.
 * Nothing here touches the database, so it is unit tested directly.
 */
import { DONOR_CATEGORIES, type DonorCategoryKey } from '@ashram/types';
import type { ZodIssue } from 'zod';
import { normalizePhone } from '../whatsapp/phone';
import { donorSchema, type DonorInput } from './donor.schema';

export const IMPORT_MAX_BYTES = 2 * 1024 * 1024;
export const IMPORT_MAX_ROWS = 5000;

/** Columns in the downloadable template, in order. */
export const TEMPLATE_COLUMNS = [
  'name',
  'category',
  'phone',
  'whatsappNumber',
  'email',
  'panNumber',
  'addressLine1',
  'addressLine2',
  'state',
  'district',
  'village',
  'postalCode',
  'preferredLanguage',
  'tags',
  'notes',
  'whatsappOptIn',
] as const;

/** Also understood when present, though not in the template. */
const EXTRA_COLUMNS = ['alternatePhone', 'country'] as const;

export type ImportColumn = (typeof TEMPLATE_COLUMNS)[number] | (typeof EXTRA_COLUMNS)[number];

const KNOWN_COLUMNS: readonly ImportColumn[] = [...TEMPLATE_COLUMNS, ...EXTRA_COLUMNS];

/** Error raised for a file that cannot be read at all (as opposed to a bad row). */
export class ImportFileError extends Error {
  constructor(
    public readonly code:
      | 'IMPORT_EMPTY'
      | 'IMPORT_NOT_UTF8'
      | 'IMPORT_MALFORMED'
      | 'IMPORT_NO_NAME_COLUMN'
      | 'IMPORT_TOO_MANY_ROWS'
      | 'IMPORT_TOO_LARGE',
    message: string,
  ) {
    super(message);
    this.name = 'ImportFileError';
  }
}

// ------------------------------------------------------------------ CSV ----

/** Decodes bytes as strict UTF-8 and drops a leading byte-order mark. */
export function decodeCsv(buffer: Uint8Array): string {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    throw new ImportFileError('IMPORT_NOT_UTF8', 'The file is not UTF-8 encoded. Save it as "CSV UTF-8" and try again.');
  }
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Parses CSV text into records of fields. Handles quoted fields (with `""`
 * escapes and embedded commas / line breaks), CRLF, LF and lone CR endings,
 * and a leading BOM. A trailing line break does not produce an empty record.
 */
export function parseCsv(input: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let inQuotes = false;
  let fieldStarted = false;
  let i = 0;

  const endField = () => {
    record.push(field);
    field = '';
    fieldStarted = false;
  };
  const endRecord = () => {
    endField();
    records.push(record);
    record = [];
  };

  while (i < text.length) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }

    if (char === '"' && !fieldStarted) {
      inQuotes = true;
      fieldStarted = true;
      i += 1;
      continue;
    }
    if (char === ',') {
      endField();
      i += 1;
      continue;
    }
    if (char === '\r' || char === '\n') {
      endRecord();
      i += char === '\r' && text[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    // Text after a closing quote ("ab"c) is kept as-is, as spreadsheets do.
    field += char;
    fieldStarted = true;
    i += 1;
  }

  if (inQuotes) {
    throw new ImportFileError('IMPORT_MALFORMED', 'A quoted value is never closed. Check the file for a stray quote mark.');
  }
  // Flush the final record unless the input ended on a line break.
  if (fieldStarted || field !== '' || record.length > 0) endRecord();

  return records;
}

/** "WhatsApp Number", "whatsapp_number" and "whatsappNumber" all mean the same column. */
/** Lower-cased letters and digits only; Devanagari letters and vowel signs are kept for Marathi headers. */
function headerKey(value: string): string {
  return value.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]/gu, '');
}

const HEADER_ALIASES: Record<string, ImportColumn> = {
  ...Object.fromEntries(KNOWN_COLUMNS.map((column) => [headerKey(column), column])),
  donorname: 'name',
  fullname: 'name',
  mobile: 'phone',
  mobilenumber: 'phone',
  phonenumber: 'phone',
  whatsapp: 'whatsappNumber',
  pan: 'panNumber',
  address: 'addressLine1',
  address1: 'addressLine1',
  address2: 'addressLine2',
  pincode: 'postalCode',
  // Spreadsheets made from the old template, or by hand, say "City" or "Gaon".
  city: 'district',
  town: 'district',
  gaon: 'village',
  gav: 'village',
  gram: 'village',
  locality: 'village',
  गाव: 'village',
  गांव: 'village',
  जिल्हा: 'district',
  राज्य: 'state',
  नाव: 'name',
  मोबाईल: 'phone',
  pin: 'postalCode',
  language: 'preferredLanguage',
  optin: 'whatsappOptIn',
  whatsappoptin: 'whatsappOptIn',
};

// ------------------------------------------------------------ rows -------

export type RowErrorCode =
  | 'NAME_REQUIRED'
  | 'INVALID_PHONE'
  | 'INVALID_PAN'
  | 'INVALID_EMAIL'
  | 'INVALID_CATEGORY'
  | 'INVALID_LANGUAGE'
  | 'INVALID_OPT_IN'
  | 'TOO_LONG'
  | 'TOO_MANY_TAGS'
  | 'INVALID';

export interface RowError {
  field: string;
  code: RowErrorCode;
  message: string;
}

export interface ParsedRow {
  /** Spreadsheet row number: the header is row 1, so data starts at 2. */
  rowNumber: number;
  raw: Partial<Record<ImportColumn, string>>;
  /** Present only when the row passed `donorSchema`. */
  data: DonorInput | null;
  /** Columns that had a non-blank value, so an update never blanks a field. */
  provided: ImportColumn[];
  errors: RowError[];
}

export interface ParsedFile {
  columns: ImportColumn[];
  unknownColumns: string[];
  rows: ParsedRow[];
}

const YES = new Set(['yes', 'y', 'true', '1', 'हो', 'होय']);
const NO = new Set(['no', 'n', 'false', '0', 'नाही']);

const LANGUAGE_ALIASES: Record<string, 'en' | 'mr'> = {
  en: 'en',
  english: 'en',
  mr: 'mr',
  marathi: 'mr',
  'मराठी': 'mr',
};

function issueToError(issue: ZodIssue): RowError {
  const field = String(issue.path[0] ?? 'name');
  let code: RowErrorCode = 'INVALID';
  if (field === 'name' && issue.code === 'too_small') code = 'NAME_REQUIRED';
  else if (issue.code === 'too_big') code = field === 'tags' ? 'TOO_MANY_TAGS' : 'TOO_LONG';
  else if (field === 'phone' || field === 'whatsappNumber' || field === 'alternatePhone') code = 'INVALID_PHONE';
  else if (field === 'panNumber') code = 'INVALID_PAN';
  else if (field === 'email') code = 'INVALID_EMAIL';
  else if (field === 'tags') code = issue.code === 'too_small' ? 'INVALID' : 'TOO_LONG';
  return { field, code, message: issue.message };
}

/** Maps one CSV record (already keyed by column) onto a donor, validating it. */
export function toDonorRow(rowNumber: number, raw: Partial<Record<ImportColumn, string>>): ParsedRow {
  const errors: RowError[] = [];
  const value = (column: ImportColumn) => (raw[column] ?? '').trim();
  const provided = KNOWN_COLUMNS.filter((column) => value(column) !== '');

  const candidate: Record<string, unknown> = {};
  for (const column of KNOWN_COLUMNS) {
    const text = value(column);
    if (!text) continue;
    switch (column) {
      case 'category': {
        const key = text.toUpperCase().replace(/[\s-]+/g, '_');
        if ((DONOR_CATEGORIES as readonly string[]).includes(key)) candidate.category = key as DonorCategoryKey;
        else
          errors.push({
            field: column,
            code: 'INVALID_CATEGORY',
            message: `Category must be one of ${DONOR_CATEGORIES.join(', ')}`,
          });
        break;
      }
      case 'preferredLanguage': {
        const language = LANGUAGE_ALIASES[text.toLowerCase()];
        if (language) candidate.preferredLanguage = language;
        else errors.push({ field: column, code: 'INVALID_LANGUAGE', message: 'Language must be en or mr' });
        break;
      }
      case 'whatsappOptIn': {
        const answer = text.toLowerCase();
        if (YES.has(answer)) candidate.whatsappOptIn = true;
        else if (NO.has(answer)) candidate.whatsappOptIn = false;
        else errors.push({ field: column, code: 'INVALID_OPT_IN', message: 'WhatsApp opt-in must be yes or no' });
        break;
      }
      case 'tags':
        candidate.tags = Array.from(
          new Set(
            text
              .split(';')
              .map((tag) => tag.trim())
              .filter(Boolean),
          ),
        );
        break;
      default:
        candidate[column] = text;
    }
  }

  const result = donorSchema.safeParse(candidate);
  if (!result.success) {
    for (const issue of result.error.issues) {
      const error = issueToError(issue);
      if (!errors.some((existing) => existing.field === error.field)) errors.push(error);
    }
  }

  return {
    rowNumber,
    raw,
    data: result.success && errors.length === 0 ? result.data : null,
    provided,
    errors,
  };
}

/** Decoded CSV text → validated rows. Throws `ImportFileError` for unreadable files. */
export function parseDonorCsv(text: string, maxRows = IMPORT_MAX_ROWS): ParsedFile {
  // Blank lines are dropped, but each record keeps its original position so
  // row numbers match what the spreadsheet shows.
  const records = parseCsv(text)
    .map((fields, index) => ({ fields, rowNumber: index + 1 }))
    .filter((record) => record.fields.some((field) => field.trim() !== ''));
  if (records.length === 0) throw new ImportFileError('IMPORT_EMPTY', 'The file is empty.');

  const [header, ...body] = records;
  const columnFor: (ImportColumn | null)[] = header.fields.map((title) => HEADER_ALIASES[headerKey(title)] ?? null);
  const unknownColumns = header.fields
    .filter((title, index) => title.trim() && columnFor[index] === null)
    .map((title) => title.trim());
  if (!columnFor.includes('name')) {
    throw new ImportFileError('IMPORT_NO_NAME_COLUMN', 'The first row must be a header row with a "name" column.');
  }
  if (body.length === 0) throw new ImportFileError('IMPORT_EMPTY', 'The file has a header row but no donors.');
  if (body.length > maxRows) {
    throw new ImportFileError('IMPORT_TOO_MANY_ROWS', `A file can contain at most ${maxRows} donors.`);
  }

  const rows = body.map(({ fields, rowNumber }) => {
    const raw: Partial<Record<ImportColumn, string>> = {};
    fields.forEach((field, column) => {
      const key = columnFor[column];
      // First occurrence wins if a column is repeated.
      if (key && raw[key] === undefined) raw[key] = field;
    });
    return toDonorRow(rowNumber, raw);
  });

  return {
    columns: Array.from(new Set(columnFor.filter((column): column is ImportColumn => column !== null))),
    unknownColumns,
    rows,
  };
}

/**
 * The downloadable template: a BOM (so Excel opens it as UTF-8 and Marathi
 * names survive) and the header row. No sample row, so importing the template
 * unchanged can never create a placeholder donor.
 */
export function templateCsv(): string {
  return `\uFEFF${TEMPLATE_COLUMNS.join(',')}\r\n`;
}

// ------------------------------------------------------- duplicates -------

export interface ExistingDonorRef {
  id: string;
  code: string;
  name: string;
  phone: string | null;
  whatsappNumber: string | null;
  panNumber: string | null;
  isActive?: boolean;
}

export type DuplicateField = 'phone' | 'pan';

export type DuplicateMatch =
  | { source: 'existing'; field: DuplicateField; donorId: string; code: string; name: string; isActive: boolean }
  | { source: 'file'; field: DuplicateField; rowNumber: number };

export function normalizePan(value: string | null | undefined): string | null {
  const pan = (value ?? '').trim().toUpperCase();
  return pan || null;
}

function phoneKeys(record: { phone?: string | null; whatsappNumber?: string | null }): string[] {
  const keys = [normalizePhone(record.phone), normalizePhone(record.whatsappNumber)].filter(
    (key): key is string => Boolean(key),
  );
  return Array.from(new Set(keys));
}

/**
 * Flags each valid row that matches an existing donor or an earlier row in
 * the same file, by normalized phone (against both phone and WhatsApp number)
 * or by PAN. An earlier row in the file takes precedence, and an existing
 * donor can be claimed by only one row — later rows that would update the
 * same donor are reported as duplicates of the row that claimed it.
 */
export function detectDuplicates(
  rows: Pick<ParsedRow, 'rowNumber' | 'data'>[],
  existing: ExistingDonorRef[],
): Map<number, DuplicateMatch> {
  const existingByPhone = new Map<string, ExistingDonorRef>();
  const existingByPan = new Map<string, ExistingDonorRef>();
  for (const donor of existing) {
    for (const key of phoneKeys(donor)) if (!existingByPhone.has(key)) existingByPhone.set(key, donor);
    const pan = normalizePan(donor.panNumber);
    if (pan && !existingByPan.has(pan)) existingByPan.set(pan, donor);
  }

  const fileByPhone = new Map<string, number>();
  const fileByPan = new Map<string, number>();
  const claimedBy = new Map<string, number>();
  const matches = new Map<number, DuplicateMatch>();

  for (const row of rows) {
    if (!row.data) continue;
    const phones = phoneKeys(row.data);
    const pan = normalizePan(row.data.panNumber);

    let match: DuplicateMatch | null = null;
    const filePhone = phones.find((key) => fileByPhone.has(key));
    if (filePhone) match = { source: 'file', field: 'phone', rowNumber: fileByPhone.get(filePhone)! };
    else if (pan && fileByPan.has(pan)) match = { source: 'file', field: 'pan', rowNumber: fileByPan.get(pan)! };
    else {
      const existingPhone = phones.find((key) => existingByPhone.has(key));
      const donor = existingPhone ? existingByPhone.get(existingPhone) : pan ? existingByPan.get(pan) : undefined;
      if (donor) {
        const field: DuplicateField = existingPhone ? 'phone' : 'pan';
        const claimant = claimedBy.get(donor.id);
        if (claimant !== undefined) {
          match = { source: 'file', field, rowNumber: claimant };
        } else {
          claimedBy.set(donor.id, row.rowNumber);
          match = {
            source: 'existing',
            field,
            donorId: donor.id,
            code: donor.code,
            name: donor.name,
            isActive: donor.isActive ?? true,
          };
        }
      }
    }

    if (match) matches.set(row.rowNumber, match);
    for (const key of phones) if (!fileByPhone.has(key)) fileByPhone.set(key, row.rowNumber);
    if (pan && !fileByPan.has(pan)) fileByPan.set(pan, row.rowNumber);
  }

  return matches;
}

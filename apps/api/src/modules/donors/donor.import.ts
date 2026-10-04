/**
 * Bulk donor import from CSV.
 *
 *   GET  /donors/import/template  → the CSV template
 *   POST /donors/import/preview   → multipart `file`; per-row valid / invalid / duplicate
 *   POST /donors/import/commit    → multipart `file` + `duplicates=skip|update`; writes in one transaction
 *
 * Commit re-reads the same file and repeats every check, so nothing the
 * browser says about the preview is trusted, and donors added between preview
 * and commit are still caught as duplicates.
 */
import { Router, type Request, type RequestHandler } from 'express';
import multer, { MulterError } from 'multer';
import { z } from 'zod';
import { prisma } from '../../db';
import { AppError, badRequest } from '../../lib/errors';
import { asyncHandler } from '../../lib/http';
import { nextMasterCode } from '../../lib/sequence';
import { AUDIT_ACTIONS, recordAudit } from '../../lib/audit';
import { getCurrentUser, requirePermission, type AuthContext } from '../../middleware/auth';
import { uploadLimiter } from '../../middleware/rateLimit';
import {
  IMPORT_MAX_BYTES,
  ImportFileError,
  decodeCsv,
  detectDuplicates,
  parseDonorCsv,
  templateCsv,
  type DuplicateMatch,
  type ImportColumn,
  type ParsedRow,
  type RowError,
} from './donor.import.parse';
import { tidyPlace } from './donor.service';

const DONOR_IMPORTED = AUDIT_ACTIONS.DONOR_IMPORTED;

export type ImportRowStatus = 'valid' | 'invalid' | 'duplicate';

export interface ImportPreviewRow {
  rowNumber: number;
  status: ImportRowStatus;
  name: string;
  phone: string | null;
  whatsappNumber: string | null;
  panNumber: string | null;
  email: string | null;
  village: string | null;
  district: string | null;
  state: string | null;
  errors: RowError[];
  match: DuplicateMatch | null;
}

export interface ImportPreview {
  fileName: string;
  totalRows: number;
  counts: { valid: number; invalid: number; duplicate: number; duplicateExisting: number; duplicateInFile: number };
  columns: ImportColumn[];
  unknownColumns: string[];
  rows: ImportPreviewRow[];
}

export interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  total: number;
}

const commitSchema = z.object({ duplicates: z.enum(['skip', 'update']).default('skip') });

// --------------------------------------------------------------- analysis --

interface Analysed {
  fileName: string;
  columns: ImportColumn[];
  unknownColumns: string[];
  rows: ParsedRow[];
  matches: Map<number, DuplicateMatch>;
}

async function analyse(organizationId: string, file: Express.Multer.File): Promise<Analysed> {
  let parsed;
  try {
    parsed = parseDonorCsv(decodeCsv(file.buffer));
  } catch (error) {
    if (error instanceof ImportFileError) throw new AppError(400, error.code, error.message);
    throw error;
  }

  // Phones are stored as typed, so normalisation happens here rather than in SQL.
  const existing = await prisma.donor.findMany({
    where: { organizationId },
    select: { id: true, code: true, name: true, phone: true, whatsappNumber: true, panNumber: true, isActive: true },
    orderBy: { createdAt: 'asc' },
  });

  return {
    fileName: file.originalname,
    columns: parsed.columns,
    unknownColumns: parsed.unknownColumns,
    rows: parsed.rows,
    matches: detectDuplicates(parsed.rows, existing),
  };
}

export async function previewImport(organizationId: string, file: Express.Multer.File): Promise<ImportPreview> {
  const analysed = await analyse(organizationId, file);
  const counts = { valid: 0, invalid: 0, duplicate: 0, duplicateExisting: 0, duplicateInFile: 0 };

  const rows = analysed.rows.map((row): ImportPreviewRow => {
    const match = analysed.matches.get(row.rowNumber) ?? null;
    const status: ImportRowStatus = !row.data ? 'invalid' : match ? 'duplicate' : 'valid';
    counts[status] += 1;
    if (match?.source === 'existing') counts.duplicateExisting += 1;
    if (match?.source === 'file') counts.duplicateInFile += 1;
    const text = (column: ImportColumn) => row.raw[column]?.trim() || null;
    return {
      rowNumber: row.rowNumber,
      status,
      name: text('name') ?? '',
      phone: text('phone'),
      whatsappNumber: text('whatsappNumber'),
      panNumber: text('panNumber')?.toUpperCase() ?? null,
      email: text('email'),
      village: text('village'),
      district: text('district'),
      state: text('state'),
      errors: row.errors,
      match,
    };
  });

  return {
    fileName: analysed.fileName,
    totalRows: rows.length,
    counts,
    columns: analysed.columns,
    unknownColumns: analysed.unknownColumns,
    rows,
  };
}

// ----------------------------------------------------------------- commit --

const blank = (value: unknown) => (value === '' || value === undefined || value === null ? null : value);

/** Same shape `createDonor` writes, with blanks stored as nulls. */
function createData(data: NonNullable<ParsedRow['data']>) {
  return {
    name: data.name,
    category: data.category,
    email: blank(data.email) as string | null,
    phone: blank(data.phone) as string | null,
    whatsappNumber: blank(data.whatsappNumber) as string | null,
    alternatePhone: blank(data.alternatePhone) as string | null,
    panNumber: blank(data.panNumber) as string | null,
    addressLine1: blank(data.addressLine1) as string | null,
    addressLine2: blank(data.addressLine2) as string | null,
    state: tidyPlace(data.state),
    district: tidyPlace(data.district),
    village: tidyPlace(data.village),
    postalCode: blank(data.postalCode) as string | null,
    country: data.country || 'India',
    preferredLanguage: data.preferredLanguage,
    tags: data.tags,
    notes: blank(data.notes) as string | null,
    whatsappOptIn: data.whatsappOptIn,
  };
}

/**
 * An update only writes the columns the file actually filled in, so a sparse
 * spreadsheet never wipes details already on the donor. Tags are merged.
 */
function updateData(row: ParsedRow, existingTags: string[]) {
  const full = createData(row.data!);
  const data: Record<string, unknown> = {};
  for (const column of row.provided) {
    if (column === 'tags') data.tags = Array.from(new Set([...existingTags, ...full.tags]));
    else data[column] = full[column];
  }
  return data;
}

export async function commitImport(
  auth: AuthContext,
  file: Express.Multer.File,
  duplicates: 'skip' | 'update',
  req: Request,
): Promise<ImportResult> {
  const { organizationId } = auth;
  const analysed = await analyse(organizationId, file);

  const toCreate: ParsedRow[] = [];
  const toUpdate: { row: ParsedRow; donorId: string }[] = [];
  let skipped = 0;
  let failed = 0;

  for (const row of analysed.rows) {
    const match = analysed.matches.get(row.rowNumber);
    if (!row.data) failed += 1;
    else if (!match) toCreate.push(row);
    else if (match.source === 'existing' && duplicates === 'update') toUpdate.push({ row, donorId: match.donorId });
    else skipped += 1;
  }

  const result: ImportResult = { created: 0, updated: 0, skipped, failed, total: analysed.rows.length };
  if (toCreate.length === 0 && toUpdate.length === 0) return result;

  const now = new Date();
  const codes: string[] = [];

  await prisma.$transaction(
    async (tx) => {
      for (const row of toCreate) {
        const data = createData(row.data!);
        const code = await nextMasterCode(tx, organizationId, 'DONOR', 'DNR');
        await tx.donor.create({
          data: {
            ...data,
            organizationId,
            code,
            whatsappOptInAt: data.whatsappOptIn ? now : null,
            createdById: auth.userId,
          },
        });
        codes.push(code);
        result.created += 1;
      }

      if (toUpdate.length > 0) {
        const current = await tx.donor.findMany({
          where: { organizationId, id: { in: toUpdate.map((item) => item.donorId) } },
          select: { id: true, tags: true, whatsappOptIn: true, whatsappOptInAt: true },
        });
        const byId = new Map(current.map((donor) => [donor.id, donor]));

        for (const { row, donorId } of toUpdate) {
          const existing = byId.get(donorId);
          if (!existing) {
            result.failed += 1;
            continue;
          }
          const data = updateData(row, existing.tags);
          if ('whatsappOptIn' in data && data.whatsappOptIn !== existing.whatsappOptIn) {
            data.whatsappOptInAt = data.whatsappOptIn ? now : null;
          }
          await tx.donor.updateMany({ where: { id: donorId, organizationId }, data });
          result.updated += 1;
        }
      }

      await recordAudit(
        {
          organizationId,
          userId: auth.userId,
          action: DONOR_IMPORTED,
          entityType: 'Donor',
          entityLabel: `CSV import: ${analysed.fileName}`,
          newValue: {
            fileName: analysed.fileName,
            duplicates,
            ...result,
            firstCode: codes[0] ?? null,
            lastCode: codes[codes.length - 1] ?? null,
            updatedDonorIds: toUpdate.map((item) => item.donorId),
          },
          req,
        },
        tx,
      );
    },
    // Thousands of rows each allocate a code under a row lock; allow time for it.
    { maxWait: 10_000, timeout: 5 * 60_000 },
  );

  return result;
}

// ----------------------------------------------------------------- routes --

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: IMPORT_MAX_BYTES, files: 1 },
  // Browsers label CSV inconsistently (text/csv, application/vnd.ms-excel, or
  // nothing), so the extension decides; the strict UTF-8 decode and the
  // parser reject anything that is not really CSV text.
  fileFilter(_req, file, callback) {
    callback(null, /\.csv$/i.test(file.originalname));
  },
});

/** Single-file upload whose size error names the import limit, not the attachment one. */
const csvUpload: RequestHandler = (req, res, next) => {
  upload.single('file')(req, res, (error: unknown) => {
    if (error instanceof MulterError && error.code === 'LIMIT_FILE_SIZE') {
      return next(new AppError(413, 'IMPORT_TOO_LARGE', `The file is larger than ${IMPORT_MAX_BYTES / 1024 / 1024} MB.`));
    }
    next(error as Error | undefined);
  });
};

function requireCsv(req: Request): Express.Multer.File {
  if (!req.file) throw new AppError(400, 'IMPORT_NOT_CSV', 'Choose a .csv file to import.');
  return req.file;
}

export const donorImportRouter = Router();

donorImportRouter.get('/template', requirePermission('donor.manage'), (_req, res) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="donor-import-template.csv"');
  res.send(templateCsv());
});

donorImportRouter.post(
  '/preview',
  requirePermission('donor.manage'),
  uploadLimiter,
  csvUpload,
  asyncHandler(async (req, res) => {
    const auth = getCurrentUser(req);
    res.json({ data: await previewImport(auth.organizationId, requireCsv(req)) });
  }),
);

donorImportRouter.post(
  '/commit',
  requirePermission('donor.manage'),
  uploadLimiter,
  csvUpload,
  asyncHandler(async (req, res) => {
    const parsed = commitSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw badRequest('Choose whether to skip or update duplicates');
    const file = requireCsv(req);
    res.json({ data: await commitImport(getCurrentUser(req), file, parsed.data.duplicates, req) });
  }),
);

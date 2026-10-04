import express, { Router } from 'express';
import { prisma } from '../../db';
import { asyncHandler } from '../../lib/http';
import { AUDIT_ACTIONS, recordAudit } from '../../lib/audit';
import { validate } from '../../middleware/validate';
import { getCurrentUser, requirePermission } from '../../middleware/auth';
import { EXPORT_CONTENT_TYPE, EXPORT_LIMITS, xlsxExportSchema, type XlsxExportInput } from './exports.schema';
import { buildListWorkbook } from './exports.service';

export const exportsRouter = Router();

/**
 * List exports can be larger than the global 2 MB JSON limit, so the client
 * sends them with a dedicated content type that only this parser accepts.
 */
const exportBodyParser = express.json({ limit: EXPORT_LIMITS.bodyLimit, type: EXPORT_CONTENT_TYPE });

/**
 * POST /api/exports/xlsx
 * Turns rows the client has already fetched (through the normal, permission-
 * checked list endpoints) into a styled Excel workbook.
 */
exportsRouter.post(
  '/xlsx',
  requirePermission('report.export'),
  exportBodyParser,
  validate(xlsxExportSchema),
  asyncHandler(async (req, res) => {
    const auth = getCurrentUser(req);
    const input = req.body as XlsxExportInput;

    const organization = await prisma.organization.findUniqueOrThrow({
      where: { id: auth.organizationId },
      select: { name: true },
    });

    const buffer = await buildListWorkbook(input, organization.name);

    await recordAudit({
      organizationId: auth.organizationId,
      userId: auth.userId,
      action: AUDIT_ACTIONS.REPORT_EXPORTED,
      entityType: 'ListExport',
      entityId: null,
      entityLabel: input.title,
      newValue: { format: 'xlsx', rowCount: input.rows.length, columns: input.columns.length },
      req,
    });

    const base = input.fileName?.replace(/\.xlsx$/i, '') || `export-${new Date().toISOString().slice(0, 10)}`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${base}.xlsx"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(buffer);
  }),
);

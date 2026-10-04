import { Router } from 'express';
import { z } from 'zod';
import { REPORT_DEFINITIONS } from '@ashram/types';
import { prisma } from '../../db';
import { asyncHandler } from '../../lib/http';
import { notFound } from '../../lib/errors';
import { AUDIT_ACTIONS, recordAudit } from '../../lib/audit';
import { notify } from '../../lib/notifications';
import { validate, validated } from '../../middleware/validate';
import { getCurrentOrganization, getCurrentUser, requirePermission } from '../../middleware/auth';
import { generateReport } from './report.service';
import { toCsv, toExcel, toPdf } from './report.export';
import type { ReportFilters } from './report.types';
import { asLocale, localizeReport } from '../../lib/i18n';

export const reportsRouter = Router();

const filterSchema = z.object({
  lang: z.enum(['en', 'mr']).optional(),
  financialYear: z.string().trim().regex(/^\d{4}-\d{4}$/, 'Use the format 2026-2027').optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  departmentId: z.string().trim().optional(),
  fundId: z.string().trim().optional(),
  categoryId: z.string().trim().optional(),
  supplierId: z.string().trim().optional(),
  accountId: z.string().trim().optional(),
  donorId: z.string().trim().optional(),
});

const generateSchema = filterSchema.extend({
  key: z.string().trim().min(1, 'Select a report'),
  save: z.boolean().optional().default(false),
});

const exportQuerySchema = filterSchema.extend({
  format: z.enum(['pdf', 'excel', 'csv']).default('pdf'),
});

/** Catalog for the Reports Center. */
reportsRouter.get(
  '/',
  requirePermission('report.view'),
  asyncHandler(async (req, res) => {
    const organizationId = getCurrentOrganization(req);
    const recent = await prisma.report.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: { generatedBy: { select: { id: true, name: true } } },
    });
    res.json({ data: REPORT_DEFINITIONS, recent });
  }),
);

reportsRouter.post(
  '/generate',
  requirePermission('report.view'),
  validate(generateSchema),
  asyncHandler(async (req, res) => {
    const auth = getCurrentUser(req);
    const { key, save, lang, ...filters } = req.body as z.infer<typeof generateSchema>;

    const report = localizeReport(
      await generateReport(auth.organizationId, key, filters as ReportFilters),
      asLocale(lang ?? auth.locale),
    );

    if (save) {
      const saved = await prisma.report.create({
        data: {
          organizationId: auth.organizationId,
          key,
          name: report.name,
          filters: JSON.parse(JSON.stringify(filters)),
          status: 'READY',
          rowCount: report.rows.length,
          summary: JSON.parse(JSON.stringify(report.summary)),
          generatedById: auth.userId,
        },
      });

      await recordAudit({
        organizationId: auth.organizationId,
        userId: auth.userId,
        action: AUDIT_ACTIONS.REPORT_GENERATED,
        entityType: 'Report',
        entityId: saved.id,
        entityLabel: report.name,
        newValue: { key, rowCount: report.rows.length },
        req,
      });

      await notify({
        organizationId: auth.organizationId,
        userIds: [auth.userId],
        type: 'REPORT_GENERATED',
        title: 'Report generated',
        message: `${report.name} is ready with ${report.rows.length} rows.`,
        link: `/reports/${key}`,
        entityType: 'Report',
        entityId: saved.id,
      });

      return res.json({ ...report, savedReportId: saved.id });
    }

    res.json(report);
  }),
);

/** Live data for a single report page. */
reportsRouter.get(
  '/:key/data',
  requirePermission('report.view'),
  validate(filterSchema, 'query'),
  asyncHandler(async (req, res) => {
    const auth = getCurrentUser(req);
    const { lang, ...filters } = validated<ReportFilters & { lang?: 'en' | 'mr' }>(req);
    const report = await generateReport(auth.organizationId, req.params.key, filters);
    res.json(localizeReport(report, asLocale(lang ?? auth.locale)));
  }),
);

reportsRouter.get(
  '/:key/export',
  requirePermission('report.export'),
  validate(exportQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const auth = getCurrentUser(req);
    const { format, lang, ...filters } = validated<ReportFilters & { format: 'pdf' | 'excel' | 'csv'; lang?: 'en' | 'mr' }>(req);
    const locale = asLocale(lang ?? auth.locale);

    const organization = await prisma.organization.findUniqueOrThrow({ where: { id: auth.organizationId } });
    const report = localizeReport(await generateReport(auth.organizationId, req.params.key, filters), locale);

    await recordAudit({
      organizationId: auth.organizationId,
      userId: auth.userId,
      action: AUDIT_ACTIONS.REPORT_EXPORTED,
      entityType: 'Report',
      entityId: null,
      entityLabel: report.name,
      newValue: { key: req.params.key, format, rowCount: report.rows.length },
      req,
    });

    const base = `${req.params.key}-${new Date().toISOString().slice(0, 10)}`;

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${base}.csv"`);
      return res.send(toCsv(report, locale));
    }

    if (format === 'excel') {
      const buffer = await toExcel(report, organization.name, locale);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${base}.xlsx"`);
      return res.send(buffer);
    }

    const buffer = await toPdf(report, organization.name, locale);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${base}.pdf"`);
    res.send(buffer);
  }),
);

/** Re-export a previously saved report run with its stored filters. */
reportsRouter.get(
  '/saved/:id/export',
  requirePermission('report.export'),
  asyncHandler(async (req, res) => {
    const auth = getCurrentUser(req);
    const saved = await prisma.report.findFirst({
      where: { id: req.params.id, organizationId: auth.organizationId },
    });
    if (!saved) throw notFound('Saved report not found');

    const organization = await prisma.organization.findUniqueOrThrow({ where: { id: auth.organizationId } });
    const filters = saved.filters as ReportFilters;
    const normalized: ReportFilters = {
      ...filters,
      from: filters.from ? new Date(filters.from) : undefined,
      to: filters.to ? new Date(filters.to) : undefined,
    };

    const locale = asLocale(req.query.lang ?? auth.locale);
    const report = localizeReport(await generateReport(auth.organizationId, saved.key, normalized), locale);
    const format = (req.query.format as string) === 'excel' ? 'excel' : (req.query.format as string) === 'csv' ? 'csv' : 'pdf';
    const base = `${saved.key}-${new Date().toISOString().slice(0, 10)}`;

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${base}.csv"`);
      return res.send(toCsv(report, locale));
    }
    if (format === 'excel') {
      const buffer = await toExcel(report, organization.name, locale);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${base}.xlsx"`);
      return res.send(buffer);
    }
    const buffer = await toPdf(report, organization.name, locale);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${base}.pdf"`);
    res.send(buffer);
  }),
);

import { Router } from 'express';
import multer from 'multer';
import { prisma } from '../../db';
import { env } from '../../env';
import { asyncHandler } from '../../lib/http';
import { badRequest, notFound } from '../../lib/errors';
import { readFile, removeFile, storeFile } from '../../lib/storage';
import { recordAudit } from '../../lib/audit';
import { validate, validated } from '../../middleware/validate';
import { getCurrentOrganization, getCurrentUser, requirePermission } from '../../middleware/auth';
import { uploadLimiter } from '../../middleware/rateLimit';
import {
  approveSchema,
  createExpenseSchema,
  listExpensesQuerySchema,
  paySchema,
  rejectSchema,
  reviseSchema,
  submitSchema,
  updateExpenseSchema,
  type ListExpensesQuery,
} from './expense.schema';
import * as service from './expense.service';
import { buildExpensePdf } from './expense.pdf';
import { asLocale } from '../../lib/i18n';

export const expenseRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.maxUploadBytes, files: 5 },
});

expenseRouter.get(
  '/',
  requirePermission('expense.view'),
  validate(listExpensesQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const auth = getCurrentUser(req);
    const result = await service.listExpenses(auth.organizationId, validated<ListExpensesQuery>(req), auth.userId);
    res.json(result);
  }),
);

expenseRouter.post(
  '/',
  requirePermission('expense.create'),
  validate(createExpenseSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(await service.createExpense(getCurrentUser(req), req.body, req));
  }),
);

expenseRouter.get(
  '/:id',
  requirePermission('expense.view'),
  asyncHandler(async (req, res) => {
    const auth = getCurrentUser(req);
    res.json(await service.getExpense(auth.organizationId, req.params.id, auth));
  }),
);

expenseRouter.put(
  '/:id',
  requirePermission('expense.edit'),
  validate(updateExpenseSchema),
  asyncHandler(async (req, res) => {
    res.json(await service.updateExpense(getCurrentUser(req), req.params.id, req.body, req));
  }),
);

expenseRouter.delete(
  '/:id',
  requirePermission('expense.delete'),
  asyncHandler(async (req, res) => {
    res.json(await service.deleteExpense(getCurrentUser(req), req.params.id, req));
  }),
);

expenseRouter.post(
  '/:id/submit',
  requirePermission('expense.submit'),
  validate(submitSchema),
  asyncHandler(async (req, res) => {
    res.json(await service.submitExpense(getCurrentUser(req), req.params.id, req.body.comments, req));
  }),
);

expenseRouter.post(
  '/:id/recall',
  requirePermission('expense.edit', 'expense.approve'),
  asyncHandler(async (req, res) => {
    res.json(await service.recallExpense(getCurrentUser(req), req.params.id, req));
  }),
);

expenseRouter.post(
  '/:id/approve',
  requirePermission('expense.approve'),
  validate(approveSchema),
  asyncHandler(async (req, res) => {
    res.json(await service.approveExpense(getCurrentUser(req), req.params.id, req.body.comments, req));
  }),
);

expenseRouter.post(
  '/:id/reject',
  requirePermission('expense.reject'),
  validate(rejectSchema),
  asyncHandler(async (req, res) => {
    res.json(await service.rejectExpense(getCurrentUser(req), req.params.id, req.body.reason, req));
  }),
);

expenseRouter.post(
  '/:id/pay',
  requirePermission('expense.pay'),
  validate(paySchema),
  asyncHandler(async (req, res) => {
    res.json(await service.recordPayment(getCurrentUser(req), req.params.id, req.body, req));
  }),
);

expenseRouter.post(
  '/:id/post-accounting',
  requirePermission('expense.pay'),
  asyncHandler(async (req, res) => {
    res.json(await service.postAccounting(getCurrentUser(req), req.params.id, req));
  }),
);

expenseRouter.post(
  '/:id/revise',
  requirePermission('expense.edit'),
  validate(reviseSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(await service.reviseExpense(getCurrentUser(req), req.params.id, req.body.reason, req));
  }),
);

expenseRouter.post(
  '/:id/duplicate',
  requirePermission('expense.create'),
  asyncHandler(async (req, res) => {
    res.status(201).json(await service.duplicateExpense(getCurrentUser(req), req.params.id, req));
  }),
);

expenseRouter.get(
  '/:id/activity',
  requirePermission('expense.view'),
  asyncHandler(async (req, res) => {
    res.json({ data: await service.getActivity(getCurrentOrganization(req), req.params.id) });
  }),
);

// ----------------------------- Attachments ---------------------------------

expenseRouter.post(
  '/:id/attachments',
  requirePermission('expense.create', 'expense.edit'),
  uploadLimiter,
  upload.array('files', 5),
  asyncHandler(async (req, res) => {
    const organizationId = getCurrentOrganization(req);
    const auth = getCurrentUser(req);
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (files.length === 0) throw badRequest('Select at least one file to upload');

    const expense = await prisma.expense.findFirst({
      where: { id: req.params.id, organizationId },
      select: { id: true, expenseNumber: true },
    });
    if (!expense) throw notFound('Expense not found');

    const kind = (req.body.kind as string | undefined)?.toUpperCase();
    const allowedKinds = ['INVOICE', 'BILL', 'RECEIPT', 'SUPPORTING'];

    const created = [];
    for (const file of files) {
      const stored = await storeFile(organizationId, `expenses/${expense.id}`, file);
      created.push(
        await prisma.attachment.create({
          data: {
            organizationId,
            expenseId: expense.id,
            kind: (allowedKinds.includes(kind ?? '') ? kind : 'SUPPORTING') as never,
            fileName: stored.fileName,
            storageKey: stored.key,
            mimeType: stored.mimeType,
            size: stored.size,
            uploadedById: auth.userId,
          },
          include: { uploadedBy: { select: { id: true, name: true } } },
        }),
      );
    }

    await recordAudit({
      organizationId,
      userId: auth.userId,
      action: 'expense.attachment_added',
      entityType: 'Expense',
      entityId: expense.id,
      entityLabel: expense.expenseNumber,
      newValue: { files: created.map((a) => a.fileName) },
      req,
    });

    res.status(201).json({ data: created });
  }),
);

expenseRouter.get(
  '/:id/attachments/:attachmentId',
  requirePermission('expense.view'),
  asyncHandler(async (req, res) => {
    const organizationId = getCurrentOrganization(req);
    const attachment = await prisma.attachment.findFirst({
      where: { id: req.params.attachmentId, expenseId: req.params.id, organizationId },
    });
    if (!attachment) throw notFound('Attachment not found');

    const buffer = await readFile(attachment.storageKey);
    res.setHeader('Content-Type', attachment.mimeType);
    res.setHeader('Content-Length', String(buffer.length));
    res.setHeader(
      'Content-Disposition',
      `${req.query.download === '1' ? 'attachment' : 'inline'}; filename="${attachment.fileName}"`,
    );
    res.send(buffer);
  }),
);

expenseRouter.delete(
  '/:id/attachments/:attachmentId',
  requirePermission('expense.edit'),
  asyncHandler(async (req, res) => {
    const organizationId = getCurrentOrganization(req);
    const auth = getCurrentUser(req);
    const attachment = await prisma.attachment.findFirst({
      where: { id: req.params.attachmentId, expenseId: req.params.id, organizationId },
    });
    if (!attachment) throw notFound('Attachment not found');

    await prisma.attachment.delete({ where: { id: attachment.id } });
    await removeFile(attachment.storageKey).catch(() => undefined);

    await recordAudit({
      organizationId,
      userId: auth.userId,
      action: 'expense.attachment_removed',
      entityType: 'Expense',
      entityId: req.params.id,
      oldValue: { fileName: attachment.fileName },
      req,
    });

    res.json({ success: true });
  }),
);

// ----------------------------- Print / PDF ---------------------------------

expenseRouter.get(
  '/:id/pdf',
  requirePermission('expense.view'),
  asyncHandler(async (req, res) => {
    const auth = getCurrentUser(req);
    const expense = await service.getExpense(auth.organizationId, req.params.id, auth);
    const organization = await prisma.organization.findUniqueOrThrow({ where: { id: auth.organizationId } });

    const pdf = await buildExpensePdf(expense, organization, asLocale(req.query.lang ?? auth.locale));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `${req.query.download === '1' ? 'attachment' : 'inline'}; filename="${expense.expenseNumber}.pdf"`,
    );
    res.send(pdf);
  }),
);

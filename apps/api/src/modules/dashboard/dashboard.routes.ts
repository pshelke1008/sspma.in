import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/http';
import { validate, validated } from '../../middleware/validate';
import { getCurrentOrganization, requirePermission } from '../../middleware/auth';
import { getDashboard, getFinanceOverview, type DashboardQuery } from './dashboard.service';

export const dashboardRouter = Router();
export const financeRouter = Router();

const periodQuery = z.object({
  financialYear: z.string().trim().regex(/^\d{4}-\d{4}$/, 'Invalid financial year').optional(),
  month: z.string().trim().optional(),
});

dashboardRouter.get(
  '/',
  requirePermission('dashboard.view'),
  validate(periodQuery, 'query'),
  asyncHandler(async (req, res) => {
    res.json(await getDashboard(getCurrentOrganization(req), validated<DashboardQuery>(req)));
  }),
);

financeRouter.get(
  '/overview',
  requirePermission('finance.view'),
  validate(periodQuery, 'query'),
  asyncHandler(async (req, res) => {
    res.json(await getFinanceOverview(getCurrentOrganization(req), validated<DashboardQuery>(req)));
  }),
);

import { Router } from 'express';
import { asyncHandler } from '../../lib/http';
import { validate, validated } from '../../middleware/validate';
import { getCurrentOrganization, getCurrentUser, requirePermission } from '../../middleware/auth';
import { donorSchema, listDonorsQuerySchema, type ListDonorsQuery } from './donor.schema';
import * as service from './donor.service';

export const donorsRouter = Router();

donorsRouter.get(
  '/',
  requirePermission('donor.view'),
  validate(listDonorsQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    res.json(await service.listDonors(getCurrentOrganization(req), validated<ListDonorsQuery>(req)));
  }),
);

donorsRouter.get(
  '/summary',
  requirePermission('donor.view'),
  asyncHandler(async (req, res) => {
    res.json(await service.donorSummary(getCurrentOrganization(req)));
  }),
);

/** Ids of every donor matching the filters, for "select all" across pages. */
donorsRouter.get(
  '/ids',
  requirePermission('donor.view'),
  validate(listDonorsQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const ids = await service.matchingDonorIds(getCurrentOrganization(req), validated<ListDonorsQuery>(req));
    res.json({ data: ids, total: ids.length });
  }),
);

donorsRouter.get(
  '/:id',
  requirePermission('donor.view'),
  asyncHandler(async (req, res) => {
    res.json(await service.getDonorProfile(getCurrentOrganization(req), req.params.id));
  }),
);

donorsRouter.post(
  '/',
  requirePermission('donor.manage'),
  validate(donorSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json({ data: await service.createDonor(getCurrentUser(req), req.body, req) });
  }),
);

donorsRouter.put(
  '/:id',
  requirePermission('donor.manage'),
  validate(donorSchema),
  asyncHandler(async (req, res) => {
    res.json({ data: await service.updateDonor(getCurrentUser(req), req.params.id, req.body, req) });
  }),
);

donorsRouter.delete(
  '/:id',
  requirePermission('donor.manage'),
  asyncHandler(async (req, res) => {
    res.json({ data: await service.setDonorActive(getCurrentUser(req), req.params.id, false, req) });
  }),
);

donorsRouter.post(
  '/:id/restore',
  requirePermission('donor.manage'),
  asyncHandler(async (req, res) => {
    res.json({ data: await service.setDonorActive(getCurrentUser(req), req.params.id, true, req) });
  }),
);

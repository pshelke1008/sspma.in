import { Router } from 'express';
import { asyncHandler } from '../../lib/http';
import { validate, validated } from '../../middleware/validate';
import { getCurrentOrganization, getCurrentUser, hasPermission, requirePermission } from '../../middleware/auth';
import { forbidden } from '../../lib/errors';
import {
  donorWithDonationSchema,
  listDonorsQuerySchema,
  locationsQuerySchema,
  type DonorWithDonationInput,
  type ListDonorsQuery,
  type LocationsQuery,
} from './donor.schema';
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

/** States, districts and villages in use, for the location filters. */
donorsRouter.get(
  '/locations',
  requirePermission('donor.view'),
  validate(locationsQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    res.json({ data: await service.donorLocations(getCurrentOrganization(req), validated<LocationsQuery>(req)) });
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

/** A donation sent with the donor form needs the same right as the Donations page. */
function formDonation(req: Parameters<typeof hasPermission>[0]) {
  const { donation } = req.body as DonorWithDonationInput;
  if (donation && !hasPermission(req, 'donation.create')) {
    throw forbidden('You do not have permission to record donations');
  }
  return donation ?? undefined;
}

donorsRouter.post(
  '/',
  requirePermission('donor.manage'),
  validate(donorWithDonationSchema),
  asyncHandler(async (req, res) => {
    const donation = formDonation(req);
    res.status(201).json({ data: await service.createDonor(getCurrentUser(req), req.body, req, donation) });
  }),
);

donorsRouter.put(
  '/:id',
  requirePermission('donor.manage'),
  validate(donorWithDonationSchema),
  asyncHandler(async (req, res) => {
    const donation = formDonation(req);
    res.json({ data: await service.updateDonor(getCurrentUser(req), req.params.id, req.body, req, donation) });
  }),
);

donorsRouter.delete(
  '/:id',
  requirePermission('donor.manage'),
  asyncHandler(async (req, res) => {
    res.json({ data: await service.setDonorActive(getCurrentUser(req), req.params.id, false, req) });
  }),
);

/** Permanent delete — only for donors with no donations; others are deactivated. */
donorsRouter.delete(
  '/:id/permanent',
  requirePermission('donor.delete'),
  asyncHandler(async (req, res) => {
    await service.deleteDonor(getCurrentUser(req), req.params.id, req);
    res.status(204).end();
  }),
);

donorsRouter.post(
  '/:id/restore',
  requirePermission('donor.manage'),
  asyncHandler(async (req, res) => {
    res.json({ data: await service.setDonorActive(getCurrentUser(req), req.params.id, true, req) });
  }),
);

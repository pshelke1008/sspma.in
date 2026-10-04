import { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { prisma } from '../../db';
import { conflict, notFound } from '../../lib/errors';
import { round2, toNumber } from '../../lib/money';
import { nextMasterCode } from '../../lib/sequence';
import { AUDIT_ACTIONS, recordAudit } from '../../lib/audit';
import type { AuthContext } from '../../middleware/auth';
import { maskAadhaar, normalizeAadhaar } from '@ashram/types';
import { normalizePhone } from '../whatsapp/phone';
import type { DonorInput, DonorWithDonationInput, ListDonorsQuery, LocationsQuery } from './donor.schema';
import { auditDonation, recordDonation } from '../donations/donation.service';
import { linkConversationsToDonor } from '../whatsapp/link';

export interface DonorStats {
  totalDonated: number;
  donationCount: number;
  lastDonationAt: Date | null;
}

/**
 * Place names are filtered on exactly, so stray spaces would split one village
 * into two filter options. Case is left as typed (Marathi has none anyway).
 */
export function tidyPlace(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const tidy = value.trim().replace(/\s+/g, ' ');
  return tidy || null;
}

/**
 * A donor as the API returns it: the Aadhaar number replaced by its masked
 * form. Every response that carries a donor row goes through this.
 */
export function publicDonor<T extends { aadhaarNumber?: string | null }>(donor: T) {
  const { aadhaarNumber, ...rest } = donor;
  return { ...rest, aadhaarMasked: maskAadhaar(aadhaarNumber) };
}

/**
 * Aadhaar on save: undefined leaves the stored number as it is (the form never
 * receives it back, so an untouched field must not wipe it); an empty string
 * removes it.
 */
function aadhaarData(value: string | null | undefined) {
  if (value === undefined) return {};
  return { aadhaarNumber: value ? normalizeAadhaar(value) : null };
}

/** Blank strings from forms become nulls; dates arrive already coerced. */
function toData(input: DonorInput) {
  const blank = (value: unknown) => (value === '' || value === undefined ? null : value);
  return {
    name: input.name,
    category: input.category,
    email: blank(input.email) as string | null,
    phone: blank(input.phone) as string | null,
    whatsappNumber: blank(input.whatsappNumber) as string | null,
    alternatePhone: blank(input.alternatePhone) as string | null,
    panNumber: blank(input.panNumber) as string | null,
    ...aadhaarData(input.aadhaarNumber),
    addressLine1: blank(input.addressLine1) as string | null,
    addressLine2: blank(input.addressLine2) as string | null,
    state: tidyPlace(input.state),
    district: tidyPlace(input.district),
    village: tidyPlace(input.village),
    postalCode: blank(input.postalCode) as string | null,
    country: input.country || 'India',
    dateOfBirth: (blank(input.dateOfBirth) as Date | null) ?? null,
    anniversaryDate: (blank(input.anniversaryDate) as Date | null) ?? null,
    preferredLanguage: input.preferredLanguage,
    tags: Array.from(new Set(input.tags.map((tag) => tag.trim()).filter(Boolean))),
    notes: blank(input.notes) as string | null,
    whatsappOptIn: input.whatsappOptIn,
  };
}

/** The number a WhatsApp message would go to: the dedicated one, else the main phone. */
export function messagingNumber(donor: { whatsappNumber: string | null; phone: string | null }): string | null {
  return normalizePhone(donor.whatsappNumber) ?? normalizePhone(donor.phone);
}

export async function statsFor(organizationId: string, donorIds: string[]): Promise<Map<string, DonorStats>> {
  if (donorIds.length === 0) return new Map();
  const groups = await prisma.donation.groupBy({
    by: ['donorId'],
    where: { organizationId, donorId: { in: donorIds } },
    _sum: { amount: true },
    _count: { _all: true },
    _max: { date: true },
  });
  return new Map(
    groups
      .filter((group) => group.donorId)
      .map((group) => [
        group.donorId as string,
        {
          totalDonated: toNumber(group._sum.amount),
          donationCount: group._count._all,
          lastDonationAt: group._max.date,
        },
      ]),
  );
}

function buildWhere(organizationId: string, query: ListDonorsQuery): Prisma.DonorWhereInput {
  return {
    organizationId,
    ...(query.status === 'active' ? { isActive: true } : query.status === 'inactive' ? { isActive: false } : {}),
    ...(query.category ? { category: query.category } : {}),
    ...(query.tag ? { tags: { has: query.tag } } : {}),
    ...(query.optIn ? { whatsappOptIn: query.optIn === 'yes' } : {}),
    ...(query.state ? { state: { equals: query.state, mode: 'insensitive' } } : {}),
    ...(query.district ? { district: { equals: query.district, mode: 'insensitive' } } : {}),
    ...(query.village ? { village: { equals: query.village, mode: 'insensitive' } } : {}),
    ...(query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' } },
            { code: { contains: query.search, mode: 'insensitive' } },
            { phone: { contains: query.search } },
            { whatsappNumber: { contains: query.search } },
            { email: { contains: query.search, mode: 'insensitive' } },
            { village: { contains: query.search, mode: 'insensitive' } },
            { district: { contains: query.search, mode: 'insensitive' } },
            { panNumber: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };
}

export async function listDonors(organizationId: string, query: ListDonorsQuery) {
  const where = buildWhere(organizationId, query);

  // Numbers are stored as typed ("+91 98200 11223"), so a plain `contains`
  // misses "9820011223". Match the digits alone as well, with or without the
  // country code / trunk zero the person searching may have typed.
  const digits = query.search?.replace(/\D/g, '') ?? '';
  if (digits.length >= 4 && Array.isArray(where.OR)) {
    const variants = new Set([digits]);
    if (digits.length > 10 && digits.startsWith('91')) variants.add(digits.slice(2));
    if (digits.length > 10 && digits.startsWith('0')) variants.add(digits.slice(1));
    const patterns = Array.from(variants).map((variant) => `%${variant}%`);
    const phoneMatches = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Donor"
      WHERE "organizationId" = ${organizationId}
        AND (
          regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g') LIKE ANY(${patterns})
          OR regexp_replace(COALESCE("whatsappNumber", ''), '[^0-9]', '', 'g') LIKE ANY(${patterns})
          OR regexp_replace(COALESCE("alternatePhone", ''), '[^0-9]', '', 'g') LIKE ANY(${patterns})
        )
      LIMIT 500
    `;
    if (phoneMatches.length > 0) where.OR = [...where.OR, { id: { in: phoneMatches.map((row) => row.id) } }];
  }

  const skip = (query.page - 1) * query.pageSize;
  const total = await prisma.donor.count({ where });

  let pageIds: string[];

  if (query.sortBy === 'totalDonated' || query.sortBy === 'lastDonation') {
    // Aggregate sorts are ordered in SQL across the whole filtered set, not
    // just the current page, so page two genuinely follows page one.
    const matching = await prisma.donor.findMany({ where, select: { id: true } });
    const ids = matching.map((row) => row.id);
    if (ids.length === 0) {
      pageIds = [];
    } else {
      const direction = query.sortDir === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`;
      const orderExpr =
        query.sortBy === 'totalDonated'
          ? Prisma.sql`COALESCE(agg.total, 0) ${direction}`
          : Prisma.sql`agg.last ${direction} NULLS LAST`;
      const rows = await prisma.$queryRaw<{ id: string }[]>`
        SELECT d.id
        FROM "Donor" d
        LEFT JOIN (
          SELECT "donorId", SUM(amount) AS total, MAX(date) AS last
          FROM "Donation"
          WHERE "organizationId" = ${organizationId}
          GROUP BY "donorId"
        ) agg ON agg."donorId" = d.id
        WHERE d.id = ANY(${ids})
        ORDER BY ${orderExpr}, d.name ASC
        LIMIT ${query.pageSize} OFFSET ${skip}
      `;
      pageIds = rows.map((row) => row.id);
    }
  } else {
    const rows = await prisma.donor.findMany({
      where,
      select: { id: true },
      orderBy: { [query.sortBy]: query.sortDir },
      skip,
      take: query.pageSize,
    });
    pageIds = rows.map((row) => row.id);
  }

  const [donors, stats] = await Promise.all([
    prisma.donor.findMany({ where: { id: { in: pageIds } } }),
    statsFor(organizationId, pageIds),
  ]);
  const byId = new Map(donors.map((donor) => [donor.id, donor]));

  const data = pageIds
    .map((id) => byId.get(id))
    .filter((donor): donor is NonNullable<typeof donor> => Boolean(donor))
    .map((donor) => {
      const number = messagingNumber(donor);
      return {
        ...publicDonor(donor),
        stats: stats.get(donor.id) ?? { totalDonated: 0, donationCount: 0, lastDonationAt: null },
        messaging: { number, canMessage: donor.isActive && donor.whatsappOptIn && Boolean(number) },
      };
    });

  return {
    data,
    meta: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.max(1, Math.ceil(total / query.pageSize)) },
  };
}

/**
 * Every donor id matching the filters — backs "select all N donors" so a
 * broadcast can reach the whole filtered list, not just the visible page.
 */
export async function matchingDonorIds(organizationId: string, query: ListDonorsQuery): Promise<string[]> {
  const rows = await prisma.donor.findMany({ where: buildWhere(organizationId, query), select: { id: true } });
  return rows.map((row) => row.id);
}

export async function donorSummary(organizationId: string) {
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [total, optedIn, newThisMonth, donated, linkedDonors, tagRows] = await Promise.all([
    prisma.donor.count({ where: { organizationId, isActive: true } }),
    prisma.donor.count({ where: { organizationId, isActive: true, whatsappOptIn: true } }),
    prisma.donor.count({ where: { organizationId, isActive: true, createdAt: { gte: monthStart } } }),
    prisma.donation.aggregate({ where: { organizationId, donorId: { not: null } }, _sum: { amount: true } }),
    prisma.donation.groupBy({ by: ['donorId'], where: { organizationId, donorId: { not: null } } }),
    prisma.donor.findMany({ where: { organizationId }, select: { tags: true } }),
  ]);

  const tags = Array.from(new Set(tagRows.flatMap((row) => row.tags))).sort((a, b) => a.localeCompare(b));

  return {
    totalDonors: total,
    optedIn,
    newThisMonth,
    donorsWhoGave: linkedDonors.length,
    totalDonated: toNumber(donated._sum.amount),
    tags,
  };
}

export async function getDonorProfile(organizationId: string, id: string) {
  const donor = await prisma.donor.findFirst({
    where: { id, organizationId },
    include: { createdBy: { select: { id: true, name: true } } },
  });
  if (!donor) throw notFound('Donor not found');

  const [aggregate, firstLast, byFund, recentDonations, messages, funds] = await Promise.all([
    prisma.donation.aggregate({ where: { organizationId, donorId: id }, _sum: { amount: true }, _count: { _all: true } }),
    prisma.donation.aggregate({ where: { organizationId, donorId: id }, _min: { date: true }, _max: { date: true } }),
    prisma.donation.groupBy({
      by: ['fundId'],
      where: { organizationId, donorId: id },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    prisma.donation.findMany({
      where: { organizationId, donorId: id },
      orderBy: { date: 'desc' },
      take: 50,
      include: { fund: { select: { id: true, name: true } }, bankAccount: { select: { id: true, name: true } } },
    }),
    prisma.whatsAppMessage.findMany({
      where: { organizationId, donorId: id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { sentBy: { select: { id: true, name: true } } },
    }),
    prisma.fund.findMany({ where: { organizationId }, select: { id: true, name: true } }),
  ]);

  const fundNames = new Map(funds.map((fund) => [fund.id, fund.name]));
  const totalDonated = toNumber(aggregate._sum.amount);
  const donationCount = aggregate._count._all;

  // Year-on-year giving, oldest first, for the profile chart.
  const byYearMap = new Map<string, number>();
  for (const donation of recentDonations) {
    const year = String(donation.date.getFullYear());
    byYearMap.set(year, round2((byYearMap.get(year) ?? 0) + toNumber(donation.amount)));
  }

  const number = messagingNumber(donor);

  return {
    ...publicDonor(donor),
    stats: {
      totalDonated,
      donationCount,
      averageDonation: donationCount ? round2(totalDonated / donationCount) : 0,
      firstDonationAt: firstLast._min.date,
      lastDonationAt: firstLast._max.date,
      byFund: byFund
        .map((row) => ({
          fundId: row.fundId,
          name: fundNames.get(row.fundId) ?? 'Unknown',
          amount: toNumber(row._sum.amount),
          count: row._count._all,
        }))
        .sort((a, b) => b.amount - a.amount),
      byYear: Array.from(byYearMap.entries())
        .map(([year, amount]) => ({ year, amount }))
        .sort((a, b) => a.year.localeCompare(b.year)),
    },
    donations: recentDonations.map((donation) => ({ ...donation, amount: toNumber(donation.amount) })),
    messages,
    messaging: {
      number,
      canMessage: donor.isActive && donor.whatsappOptIn && Boolean(number),
      reason: !donor.isActive
        ? 'INACTIVE'
        : !number
          ? 'NO_NUMBER'
          : !donor.whatsappOptIn
            ? 'NOT_OPTED_IN'
            : null,
    },
  };
}

/** The donation part of a donor-form save, recorded against the donor just written. */
type FormDonation = DonorWithDonationInput['donation'];

export async function createDonor(auth: AuthContext, input: DonorInput, req: Request, donationInput?: FormDonation) {
  const data = toData(input);
  // Donor and donation are one save: if the donation is refused, the donor is
  // not created either, so retrying never produces a duplicate donor.
  const { donor, donation } = await prisma.$transaction(async (tx) => {
    const code = await nextMasterCode(tx, auth.organizationId, 'DONOR', 'DNR');
    const created = await tx.donor.create({
      data: {
        ...data,
        organizationId: auth.organizationId,
        code,
        whatsappOptInAt: data.whatsappOptIn ? new Date() : null,
        createdById: auth.userId,
      },
    });
    const gift = donationInput
      ? await recordDonation(tx, auth, { ...donationInput, donorId: created.id, donorName: created.name })
      : null;
    return { donor: created, donation: gift };
  });

  await recordAudit({
    organizationId: auth.organizationId,
    userId: auth.userId,
    action: AUDIT_ACTIONS.DONOR_CREATED,
    entityType: 'Donor',
    entityId: donor.id,
    entityLabel: `${donor.code} ${donor.name}`,
    newValue: { name: donor.name, whatsappOptIn: donor.whatsappOptIn },
    req,
  });
  if (donation) await auditDonation(auth, donation, req);
  // Earlier WhatsApp messages from this donor's numbers join their profile.
  await linkConversationsToDonor(auth.organizationId, donor.id, [donor.whatsappNumber, donor.phone, donor.alternatePhone]);

  return { ...publicDonor(donor), donation: donation ? { id: donation.id, receiptNumber: donation.receiptNumber } : null };
}

export async function updateDonor(auth: AuthContext, id: string, input: DonorInput, req: Request, donationInput?: FormDonation) {
  const existing = await prisma.donor.findFirst({ where: { id, organizationId: auth.organizationId } });
  if (!existing) throw notFound('Donor not found');

  const data = toData(input);
  // The consent timestamp records when permission was given, so it only moves
  // when the answer changes.
  const whatsappOptInAt =
    data.whatsappOptIn === existing.whatsappOptIn
      ? existing.whatsappOptInAt
      : data.whatsappOptIn
        ? new Date()
        : null;

  const { donor, donation } = await prisma.$transaction(async (tx) => {
    const updated = await tx.donor.update({ where: { id }, data: { ...data, whatsappOptInAt } });
    const gift = donationInput
      ? await recordDonation(tx, auth, { ...donationInput, donorId: updated.id, donorName: updated.name })
      : null;
    return { donor: updated, donation: gift };
  });

  await recordAudit({
    organizationId: auth.organizationId,
    userId: auth.userId,
    action: AUDIT_ACTIONS.DONOR_UPDATED,
    entityType: 'Donor',
    entityId: donor.id,
    entityLabel: `${donor.code} ${donor.name}`,
    oldValue: { name: existing.name, phone: existing.phone, whatsappOptIn: existing.whatsappOptIn },
    newValue: { name: donor.name, phone: donor.phone, whatsappOptIn: donor.whatsappOptIn },
    req,
  });
  if (donation) await auditDonation(auth, donation, req);
  // Earlier WhatsApp messages from this donor's numbers join their profile.
  await linkConversationsToDonor(auth.organizationId, donor.id, [donor.whatsappNumber, donor.phone, donor.alternatePhone]);

  return { ...publicDonor(donor), donation: donation ? { id: donation.id, receiptNumber: donation.receiptNumber } : null };
}

/** Donors are deactivated, never deleted — their receipts must stay attributable. */
export async function setDonorActive(auth: AuthContext, id: string, isActive: boolean, req: Request) {
  const existing = await prisma.donor.findFirst({ where: { id, organizationId: auth.organizationId } });
  if (!existing) throw notFound('Donor not found');

  const donor = await prisma.donor.update({ where: { id }, data: { isActive } });

  await recordAudit({
    organizationId: auth.organizationId,
    userId: auth.userId,
    action: isActive ? AUDIT_ACTIONS.DONOR_UPDATED : AUDIT_ACTIONS.DONOR_DEACTIVATED,
    entityType: 'Donor',
    entityId: donor.id,
    entityLabel: `${donor.code} ${donor.name}`,
    newValue: { isActive },
    req,
  });

  return publicDonor(donor);
}

/**
 * Permanently removes a donor who has no donations. A donor with donations is
 * refused: receipts and 80G records must stay attributable, so those donors are
 * deactivated instead. Messages sent to the donor keep their history with the
 * donor link cleared.
 */
export async function deleteDonor(auth: AuthContext, id: string, req: Request) {
  const existing = await prisma.donor.findFirst({
    where: { id, organizationId: auth.organizationId },
    include: { _count: { select: { donations: true } } },
  });
  if (!existing) throw notFound('Donor not found');

  const donationCount = existing._count.donations;
  if (donationCount > 0) {
    throw conflict(
      `This donor has ${donationCount} donation${donationCount === 1 ? '' : 's'} on record, so they can't be deleted. Deactivate them instead.`,
      { reason: 'HAS_DONATIONS', donationCount },
    );
  }

  await prisma.donor.delete({ where: { id: existing.id } });

  await recordAudit({
    organizationId: auth.organizationId,
    userId: auth.userId,
    action: AUDIT_ACTIONS.DONOR_DELETED,
    entityType: 'Donor',
    entityId: existing.id,
    entityLabel: `${existing.code} ${existing.name}`,
    oldValue: { name: existing.name, code: existing.code, phone: existing.phone, panNumber: existing.panNumber },
    req,
  });
}

/**
 * States, districts and villages already recorded for this organization, with
 * donor counts — the options for the location filters and form suggestions.
 * Districts are narrowed to the chosen state and villages to the chosen
 * district, so each list stays short.
 */
export async function donorLocations(organizationId: string, query: LocationsQuery) {
  const base: Prisma.DonorWhereInput = { organizationId };
  const inState: Prisma.DonorWhereInput = query.state
    ? { ...base, state: { equals: query.state, mode: 'insensitive' } }
    : base;
  const inDistrict: Prisma.DonorWhereInput = query.district
    ? { ...inState, district: { equals: query.district, mode: 'insensitive' } }
    : inState;

  const [states, districts, villages] = await Promise.all([
    prisma.donor.groupBy({ by: ['state'], where: { ...base, state: { not: null } }, _count: { _all: true } }),
    prisma.donor.groupBy({ by: ['district'], where: { ...inState, district: { not: null } }, _count: { _all: true } }),
    prisma.donor.groupBy({ by: ['village'], where: { ...inDistrict, village: { not: null } }, _count: { _all: true } }),
  ]);

  const options = <T extends Record<string, unknown>>(rows: (T & { _count: { _all: number } })[], key: keyof T) =>
    rows
      .map((row) => ({ value: row[key] as string, count: row._count._all }))
      .sort((a, b) => a.value.localeCompare(b.value, 'en', { sensitivity: 'base' }));

  return {
    states: options(states, 'state'),
    districts: options(districts, 'district'),
    villages: options(villages, 'village'),
  };
}

import { z } from 'zod';
import { DONOR_CATEGORIES, SUPPORTED_LOCALES } from '@ashram/types';
import { normalizePhone } from '../whatsapp/phone';

const optionalText = (max: number) => z.string().trim().max(max).optional().nullable().or(z.literal(''));

const phoneField = z
  .string()
  .trim()
  .max(20)
  .optional()
  .nullable()
  .or(z.literal(''))
  .refine((value) => !value || normalizePhone(value) !== null, 'Enter a valid mobile number');

export const donorSchema = z.object({
  name: z.string().trim().min(2, 'Donor name is required').max(160),
  category: z.enum(DONOR_CATEGORIES).default('INDIVIDUAL'),
  email: z.string().trim().email('Enter a valid email address').optional().nullable().or(z.literal('')),
  phone: phoneField,
  whatsappNumber: phoneField,
  alternatePhone: phoneField,
  panNumber: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, 'Enter a valid PAN')
    .optional()
    .nullable()
    .or(z.literal('')),
  addressLine1: optionalText(200),
  addressLine2: optionalText(200),
  city: optionalText(80),
  state: optionalText(80),
  postalCode: optionalText(12),
  country: z.string().trim().max(80).optional(),
  dateOfBirth: z.coerce.date().optional().nullable().or(z.literal('')),
  anniversaryDate: z.coerce.date().optional().nullable().or(z.literal('')),
  preferredLanguage: z.enum(SUPPORTED_LOCALES).default('mr'),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  notes: optionalText(2000),
  whatsappOptIn: z.boolean().default(false),
});

export type DonorInput = z.infer<typeof donorSchema>;

export const listDonorsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  search: z.string().trim().max(120).optional(),
  category: z.enum(DONOR_CATEGORIES).optional(),
  tag: z.string().trim().max(40).optional(),
  optIn: z.enum(['yes', 'no']).optional(),
  status: z.enum(['active', 'inactive', 'all']).default('active'),
  sortBy: z.enum(['name', 'createdAt', 'totalDonated', 'lastDonation']).default('name'),
  sortDir: z.enum(['asc', 'desc']).default('asc'),
});

export type ListDonorsQuery = z.infer<typeof listDonorsQuerySchema>;

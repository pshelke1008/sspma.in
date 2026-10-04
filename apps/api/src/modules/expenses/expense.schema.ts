import { z } from 'zod';
import { EXPENSE_STATUSES, PAYMENT_METHODS, UNITS } from '@ashram/types';

const money = z.coerce.number().min(0, 'Must be zero or more').max(9_999_999_999, 'Amount is too large');

export const expenseItemSchema = z.object({
  id: z.string().optional(),
  description: z.string().trim().min(1, 'Description is required').max(300),
  quantity: z.coerce.number().gt(0, 'Quantity must be greater than zero').max(1_000_000),
  unit: z.enum(UNITS).default('NOS'),
  rate: money,
  taxRate: z.coerce.number().min(0, 'Tax cannot be negative').max(100, 'Tax cannot exceed 100%').default(0),
});

const baseExpense = z.object({
  date: z.coerce
    .date({ invalid_type_error: 'Enter a valid expense date' })
    .refine((d) => d.getTime() <= Date.now() + 24 * 60 * 60 * 1000, 'Expense date cannot be in the future')
    .refine((d) => d.getFullYear() >= 2000, 'Expense date is too far in the past'),
  title: z.string().trim().min(2, 'Enter what this expense is for').max(160),
  departmentId: z.string().min(1, 'Select a department'),
  fundId: z.string().min(1, 'Select a fund'),
  costCenterId: z.string().min(1).optional().nullable(),
  categoryId: z.string().min(1, 'Select an expense category'),
  supplierId: z.string().min(1).optional().nullable(),
  /** The user this expense is raised for, when keyed in by someone else. */
  onBehalfOfId: z.string().min(1).optional().nullable(),
  description: z.string().trim().max(2000).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  items: z.array(expenseItemSchema).min(1, 'Add at least one line item').max(100),
  payImmediately: z.boolean().default(false),
  paymentMethod: z.enum(PAYMENT_METHODS).optional().nullable(),
  paymentAccountId: z.string().min(1).optional().nullable(),
  referenceNumber: z.string().trim().max(80).optional().nullable(),
  paymentDate: z.coerce.date().optional().nullable(),
});

/** When the entry is flagged as already paid, the payment details are required. */
const withPaymentRules = <T extends typeof baseExpense>(schema: T) =>
  schema.superRefine((data, ctx) => {
    if (!data.payImmediately) return;
    if (!data.paymentMethod) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['paymentMethod'], message: 'Select a payment method' });
    }
    if (data.paymentMethod && data.paymentMethod !== 'CASH' && !data.paymentAccountId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['paymentAccountId'], message: 'Select a payment account' });
    }
    if ((data.paymentMethod === 'CHEQUE' || data.paymentMethod === 'BANK_TRANSFER') && !data.referenceNumber) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['referenceNumber'],
        message: 'Reference number is required for this payment method',
      });
    }
  });

export const createExpenseSchema = withPaymentRules(baseExpense);
export const updateExpenseSchema = withPaymentRules(baseExpense);

export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;

export const listExpensesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(120).optional(),
  status: z
    .union([z.enum(EXPENSE_STATUSES), z.array(z.enum(EXPENSE_STATUSES))])
    .optional()
    .transform((v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v])),
  departmentId: z.string().optional(),
  fundId: z.string().optional(),
  categoryId: z.string().optional(),
  supplierId: z.string().optional(),
  paymentStatus: z.enum(['UNPAID', 'PARTIAL', 'PAID']).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  minAmount: z.coerce.number().optional(),
  maxAmount: z.coerce.number().optional(),
  sortBy: z.enum(['date', 'total', 'expenseNumber', 'status', 'createdAt']).default('date'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
  mine: z.coerce.boolean().optional(),
});

export type ListExpensesQuery = z.infer<typeof listExpensesQuerySchema>;

export const submitSchema = z.object({
  comments: z.string().trim().max(1000).optional(),
});

export const approveSchema = z.object({
  comments: z.string().trim().max(1000).optional(),
});

export const rejectSchema = z.object({
  reason: z
    .string({ required_error: 'A reason is required to reject' })
    .trim()
    .min(5, 'Please give a reason of at least 5 characters')
    .max(1000),
});

export const paySchema = z
  .object({
    amount: z.coerce.number().gt(0, 'Payment amount must be greater than zero'),
    method: z.enum(PAYMENT_METHODS, { required_error: 'Select a payment method' }),
    bankAccountId: z.string().min(1).optional().nullable(),
    referenceNumber: z.string().trim().max(80).optional().nullable(),
    paymentDate: z.coerce.date({ required_error: 'Select a payment date' }),
    notes: z.string().trim().max(1000).optional().nullable(),
  })
  .superRefine((data, ctx) => {
    if (data.method !== 'CASH' && !data.bankAccountId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['bankAccountId'], message: 'Select a payment account' });
    }
    if ((data.method === 'CHEQUE' || data.method === 'BANK_TRANSFER') && !data.referenceNumber) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['referenceNumber'],
        message: 'Reference number is required for this payment method',
      });
    }
  });

export const reviseSchema = z.object({
  reason: z.string().trim().min(5, 'Explain why this approved expense is being reopened').max(1000),
});

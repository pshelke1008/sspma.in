import { z } from 'zod';
import { PAYMENT_METHODS, UNITS } from '@ashram/types';

/** Mirrors the API contract so the client and server agree on every rule. */
export const lineItemSchema = z.object({
  description: z.string().trim().min(1, 'validation.descriptionRequired').max(300),
  quantity: z.coerce.number().gt(0, 'validation.positive'),
  unit: z.enum(UNITS),
  rate: z.coerce.number().min(0, 'validation.nonNegative'),
  taxRate: z.coerce.number().min(0, 'validation.nonNegative').max(100, 'validation.max100'),
});

export const basicInfoSchema = z.object({
  date: z.string().min(1, 'validation.selectDate'),
  title: z.string().trim().min(2, 'validation.titleRequired').max(160),
  departmentId: z.string().min(1, 'validation.selectDepartment'),
  fundId: z.string().min(1, 'validation.selectFund'),
  costCenterId: z.string().optional(),
  categoryId: z.string().min(1, 'validation.selectCategory'),
  supplierId: z.string().optional(),
  onBehalfOfId: z.string().optional(),
  description: z.string().max(2000).optional(),
});

export const itemsSchema = z.object({
  items: z.array(lineItemSchema).min(1, 'validation.itemsRequired'),
});

export const paymentSchema = z
  .object({
    payImmediately: z.boolean(),
    paymentMethod: z.enum(PAYMENT_METHODS).optional(),
    paymentAccountId: z.string().optional(),
    referenceNumber: z.string().optional(),
    paymentDate: z.string().optional(),
    notes: z.string().max(2000).optional(),
  })
  .superRefine((data, ctx) => {
    if (!data.payImmediately) return;
    if (!data.paymentMethod) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['paymentMethod'], message: 'validation.selectMethod' });
    }
    if (data.paymentMethod && data.paymentMethod !== 'CASH' && !data.paymentAccountId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['paymentAccountId'], message: 'validation.selectAccount' });
    }
    if ((data.paymentMethod === 'CHEQUE' || data.paymentMethod === 'BANK_TRANSFER') && !data.referenceNumber?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['referenceNumber'],
        message: 'validation.referenceRequired',
      });
    }
    if (!data.paymentDate) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['paymentDate'], message: 'validation.paymentDate' });
    }
  });

export const expenseFormSchema = basicInfoSchema.merge(itemsSchema).and(paymentSchema);

export type LineItemValues = z.infer<typeof lineItemSchema>;
export type ExpenseFormValues = z.infer<typeof basicInfoSchema> &
  z.infer<typeof itemsSchema> & {
    payImmediately: boolean;
    paymentMethod?: (typeof PAYMENT_METHODS)[number];
    paymentAccountId?: string;
    referenceNumber?: string;
    paymentDate?: string;
    notes?: string;
  };

export const emptyItem: LineItemValues = {
  description: '',
  quantity: 1,
  unit: 'NOS',
  rate: 0,
  taxRate: 0,
};

/** Line and document totals, computed the same way the API computes them. */
export function computeLine(item: { quantity: number; rate: number; taxRate: number }) {
  const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
  const base = round((Number(item.quantity) || 0) * (Number(item.rate) || 0));
  const taxAmount = round((base * (Number(item.taxRate) || 0)) / 100);
  return { base, taxAmount, amount: round(base + taxAmount) };
}

export function computeTotals(items: { quantity: number; rate: number; taxRate: number }[]) {
  const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
  let subtotal = 0;
  let tax = 0;
  for (const item of items) {
    const line = computeLine(item);
    subtotal = round(subtotal + line.base);
    tax = round(tax + line.taxAmount);
  }
  return { subtotal, tax, total: round(subtotal + tax) };
}

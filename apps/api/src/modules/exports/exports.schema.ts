import { z } from 'zod';

/** Hard ceilings so a single request cannot ask the server to build an unbounded workbook. */
export const EXPORT_LIMITS = {
  maxRows: 10_000,
  maxColumns: 40,
  maxCellLength: 4_000,
  /** Body limit for this route only; the global JSON parser stays at 2 MB. */
  bodyLimit: '15mb',
} as const;

/** Content type the client uses so the larger, route-scoped body parser handles the request. */
export const EXPORT_CONTENT_TYPE = 'application/vnd.ashram.export+json';

const cellSchema = z.union([
  z.string().max(EXPORT_LIMITS.maxCellLength),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

export const xlsxExportSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    subtitle: z.string().trim().max(300).optional(),
    /** Base name for the download, without extension (ASCII only). */
    fileName: z
      .string()
      .regex(/^[A-Za-z0-9._-]{1,100}$/)
      .optional(),
    columns: z
      .array(
        z.object({
          header: z.string().trim().max(120),
          type: z.enum(['text', 'number', 'currency', 'date']).default('text'),
        }),
      )
      .min(1)
      .max(EXPORT_LIMITS.maxColumns),
    rows: z.array(z.array(cellSchema).max(EXPORT_LIMITS.maxColumns)).max(EXPORT_LIMITS.maxRows),
  })
  .superRefine((value, ctx) => {
    const width = value.columns.length;
    const index = value.rows.findIndex((row) => row.length > width);
    if (index !== -1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['rows', index],
        message: `Row has more cells than the ${width} declared columns`,
      });
    }
  });

export type XlsxExportInput = z.infer<typeof xlsxExportSchema>;
export type ExportCell = z.infer<typeof cellSchema>;

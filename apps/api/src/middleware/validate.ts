import type { RequestHandler } from 'express';
import { ZodError, type ZodSchema } from 'zod';
import { AppError } from '../lib/errors';

type Source = 'body' | 'query' | 'params';

function formatZodError(error: ZodError) {
  return error.issues.map((issue) => ({
    field: issue.path.join('.') || '(root)',
    message: issue.message,
  }));
}

/** Parses and replaces the request segment with the typed, coerced result. */
export function validate(schema: ZodSchema, source: Source = 'body'): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      return next(
        new AppError(422, 'VALIDATION_ERROR', 'Please correct the highlighted fields', formatZodError(result.error)),
      );
    }
    if (source === 'query') {
      // Express 5 exposes req.query as a getter; assign onto a cached field.
      (req as unknown as Record<string, unknown>).validatedQuery = result.data;
    } else {
      req[source] = result.data as never;
    }
    next();
  };
}

/** Reads the output of `validate(schema, 'query')`. */
export function validated<T>(req: unknown): T {
  return (req as { validatedQuery: T }).validatedQuery;
}

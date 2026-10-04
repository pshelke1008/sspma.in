import type { ErrorRequestHandler, RequestHandler } from 'express';
import { Prisma } from '@prisma/client';
import { MulterError } from 'multer';
import { AppError } from '../lib/errors';
import { env } from '../env';

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: `No route matches ${req.method} ${req.originalUrl}` },
  });
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    return res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
  }

  if (err instanceof MulterError) {
    const message =
      err.code === 'LIMIT_FILE_SIZE'
        ? `File is larger than the ${Math.round(env.maxUploadBytes / 1024 / 1024)}MB limit.`
        : err.message;
    return res.status(400).json({ error: { code: 'UPLOAD_ERROR', message } });
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      const target = (err.meta?.target as string[] | undefined)?.join(', ') ?? 'value';
      return res.status(409).json({
        error: { code: 'DUPLICATE', message: `A record with this ${target} already exists.` },
      });
    }
    if (err.code === 'P2025') {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Record not found.' } });
    }
    if (err.code === 'P2003') {
      return res.status(409).json({
        error: { code: 'IN_USE', message: 'This record is referenced elsewhere and cannot be changed.' },
      });
    }
  }

  console.error('[error]', err);
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: env.isProduction ? 'Something went wrong. Please try again.' : String(err?.message ?? err),
    },
  });
};

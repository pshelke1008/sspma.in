import rateLimit from 'express-rate-limit';
import { env } from '../env';

const disabled = env.isTest;

/** Brute-force protection on credential endpoints. */
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: disabled ? 100000 : 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many login attempts. Try again in 15 minutes.' } },
});

/** Broad ceiling for the authenticated API surface. */
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: disabled ? 100000 : 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many requests. Please slow down.' } },
});

export const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: disabled ? 100000 : 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many uploads. Please wait a moment.' } },
});

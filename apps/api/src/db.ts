import { PrismaClient } from '@prisma/client';
import { env } from './env';

/**
 * A single Prisma client for the process. `tsx watch` reloads the module on
 * every change, so the instance is cached on globalThis to avoid exhausting
 * the Postgres connection pool during development.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: env.isProduction ? ['warn', 'error'] : ['warn', 'error'],
  });

if (!env.isProduction) globalForPrisma.prisma = prisma;

export type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

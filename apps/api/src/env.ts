import path from 'node:path';
import dotenv from 'dotenv';

// The monorepo keeps a single .env at the repository root.
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

function required(key: string, fallback?: string): string {
  const value = process.env[key] ?? fallback;
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function int(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const nodeEnv = process.env.NODE_ENV ?? 'development';

export const env = {
  nodeEnv,
  isProduction: nodeEnv === 'production',
  isTest: nodeEnv === 'test',
  port: int('API_PORT', 4300),
  databaseUrl: required('DATABASE_URL'),
  sessionSecret: required('SESSION_SECRET', 'ashram-management-development-secret'),
  sessionTtlHours: int('SESSION_TTL_HOURS', 12),
  webOrigin: (process.env.WEB_ORIGIN ?? 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
  cookieName: 'ashram_session',
  cookieDomain: process.env.COOKIE_DOMAIN || undefined,
  maxUploadBytes: int('MAX_UPLOAD_MB', 10) * 1024 * 1024,
  whatsapp: {
    encryptionKey: process.env.WHATSAPP_ENCRYPTION_KEY || undefined,
    webEnabled: (process.env.WHATSAPP_WEB_ENABLED ?? 'true') === 'true',
    monthlyLimit: int('WHATSAPP_MONTHLY_LIMIT', 250),
    graphUrl: process.env.WHATSAPP_GRAPH_URL ?? 'https://graph.facebook.com',
    graphVersion: process.env.WHATSAPP_GRAPH_VERSION ?? 'v21.0',
    webhookVerifyToken: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || undefined,
    appSecret: process.env.WHATSAPP_APP_SECRET || undefined,
  },
  storage: {
    driver: (process.env.STORAGE_DRIVER ?? 'local') as 'local' | 's3',
    localDir: path.resolve(
      __dirname,
      '../../../',
      process.env.STORAGE_LOCAL_DIR ?? './storage',
    ),
    endpoint: process.env.S3_ENDPOINT || undefined,
    region: process.env.S3_REGION ?? 'ap-south-1',
    bucket: process.env.S3_BUCKET ?? 'ashram-management',
    accessKeyId: process.env.S3_ACCESS_KEY_ID || undefined,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || undefined,
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true') === 'true',
  },
};

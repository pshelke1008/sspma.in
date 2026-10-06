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

const DEV_SESSION_SECRET = 'ashram-management-development-secret';

/**
 * Sessions are HMAC-signed with this secret, so a guessable one lets anyone
 * forge a login. Development falls back to a fixed value; production refuses
 * to start without a real secret of reasonable length.
 */
function sessionSecret(): string {
  const value = process.env.SESSION_SECRET;
  if (nodeEnv !== 'production') return value || DEV_SESSION_SECRET;
  if (!value || value === DEV_SESSION_SECRET || /change-?me/i.test(value) || value.length < 32) {
    throw new Error(
      'SESSION_SECRET must be set to a random value of at least 32 characters in production (openssl rand -base64 48)',
    );
  }
  return value;
}

export const env = {
  nodeEnv,
  isProduction: nodeEnv === 'production',
  isTest: nodeEnv === 'test',
  port: int('API_PORT', 4300),
  databaseUrl: required('DATABASE_URL'),
  sessionSecret: sessionSecret(),
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
    /** How often scheduled broadcasts are checked for being due. */
    schedulerIntervalMs: int('WHATSAPP_SCHEDULER_INTERVAL_MS', 30_000),
    graphUrl: process.env.WHATSAPP_GRAPH_URL ?? 'https://graph.facebook.com',
    graphVersion: process.env.WHATSAPP_GRAPH_VERSION ?? 'v21.0',
    webhookVerifyToken: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || undefined,
    /**
     * Meta app secret(s). Several, comma-separated, are accepted for the webhook: one
     * WhatsApp account can be subscribed by more than one Meta app (for example when it
     * is shared with another product), and each app signs its callbacks with its own secret.
     * The first is the one used for Facebook login and token checks.
     */
    appSecrets: (process.env.WHATSAPP_APP_SECRET || process.env.META_APP_SECRET || '')
      .split(',')
      .map((secret) => secret.trim())
      .filter(Boolean),
    get appSecret(): string | undefined {
      return this.appSecrets[0];
    },
    /** Meta app ID, for "Connect with Facebook". Without it only manual token entry is offered. */
    appId: process.env.WHATSAPP_APP_ID || process.env.META_APP_ID || undefined,
    /**
     * When this server shares a Meta app with another product (e.g. CAThrives),
     * the app-level webhook URL points there. With this on, each business
     * account connected here is subscribed with its own callback URL
     * (${API_PUBLIC_URL}/api/webhooks/whatsapp), so its messages come here.
     */
    webhookOverride: (process.env.WHATSAPP_WEBHOOK_OVERRIDE ?? 'false') === 'true',
  },
  /**
   * Where this API is reachable from the internet — Meta redirects the browser
   * back to `${publicApiUrl}/api/whatsapp/oauth/callback`, and that exact URL
   * must be listed under "Valid OAuth Redirect URIs" in the Meta app.
   */
  publicApiUrl: (process.env.API_PUBLIC_URL || `http://localhost:${int('API_PORT', 4300)}`).replace(/\/+$/, ''),
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

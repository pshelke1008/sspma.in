import { createApp } from './app';
import { env } from './env';
import { prisma } from './db';
import { purgeExpiredSessions } from './modules/auth/auth.service';
import { hasEncryptionKey } from './modules/whatsapp/crypto';
import { restoreAllConnections } from './modules/whatsapp/connectionManager';
import { registerLinkedDeviceHandlers, resumeBroadcasts } from './modules/whatsapp/messaging.service';

async function main() {
  await prisma.$connect();

  const app = createApp();
  const server = app.listen(env.port, () => {
    console.log(`\n  Ashram Management API  →  http://localhost:${env.port}/api`);
    console.log(`  Environment     →  ${env.nodeEnv}`);
    console.log(`  Storage driver  →  ${env.storage.driver}\n`);
  });

  // WhatsApp: restore linked phones and pick up interrupted broadcasts. A
  // missing key disables the integration rather than taking the API down.
  registerLinkedDeviceHandlers();
  if (!hasEncryptionKey()) {
    console.warn('  WhatsApp        →  disabled (WHATSAPP_ENCRYPTION_KEY not set)');
  } else if (!env.isTest) {
    if (env.whatsapp.webEnabled) {
      restoreAllConnections().catch((error) => console.error('[whatsapp] restore failed', error));
    }
    resumeBroadcasts();
  }

  // Housekeeping: drop expired sessions hourly.
  const cleanup = setInterval(() => {
    purgeExpiredSessions().catch((error) => console.error('[sessions] cleanup failed', error));
  }, 60 * 60 * 1000);
  cleanup.unref();

  const shutdown = async (signal: string) => {
    console.log(`\n${signal} received, shutting down.`);
    clearInterval(cleanup);
    server.close();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error) => {
  console.error('Failed to start Ashram Management API', error);
  process.exit(1);
});

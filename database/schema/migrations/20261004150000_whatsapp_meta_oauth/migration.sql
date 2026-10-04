-- "Connect with Facebook" for the WhatsApp Cloud API: how the channel was
-- connected, when its token expires, its quality rating and whether the
-- business account is subscribed to the webhook; plus sign-ins awaiting a
-- choice of number.
ALTER TABLE "WhatsAppChannel"
  ADD COLUMN "cloudConnectMethod" TEXT,
  ADD COLUMN "cloudTokenExpiresAt" TIMESTAMP(3),
  ADD COLUMN "cloudQualityRating" TEXT,
  ADD COLUMN "cloudWebhookSubscribed" BOOLEAN NOT NULL DEFAULT false;

UPDATE "WhatsAppChannel" SET "cloudConnectMethod" = 'MANUAL' WHERE "cloudStatus" = 'CONNECTED';

CREATE TABLE "WhatsAppPendingConnection" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenCiphertext" BYTEA NOT NULL,
    "tokenIv" BYTEA NOT NULL,
    "tokenTag" BYTEA NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3),
    "businessAccounts" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppPendingConnection_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WhatsAppPendingConnection_organizationId_idx" ON "WhatsAppPendingConnection"("organizationId");
CREATE INDEX "WhatsAppPendingConnection_expiresAt_idx" ON "WhatsAppPendingConnection"("expiresAt");

ALTER TABLE "WhatsAppPendingConnection" ADD CONSTRAINT "WhatsAppPendingConnection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- WhatsApp integration, CAThrives-style: several Cloud API numbers per
-- organization, and an inbox (conversations with media, unread tracking and
-- contact names) built on the existing message log.

-- 1. Numbers get their own table.
CREATE TABLE "WhatsAppNumber" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "phoneNumberId" TEXT NOT NULL,
    "businessAccountId" TEXT NOT NULL,
    "displayNumber" TEXT,
    "verifiedName" TEXT,
    "qualityRating" TEXT,
    "tokenCiphertext" BYTEA NOT NULL,
    "tokenIv" BYTEA NOT NULL,
    "tokenTag" BYTEA NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3),
    "connectMethod" TEXT NOT NULL,
    "webhookSubscribed" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "connectedById" TEXT,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppNumber_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WhatsAppNumber_phoneNumberId_key" ON "WhatsAppNumber"("phoneNumberId");
CREATE INDEX "WhatsAppNumber_organizationId_isActive_idx" ON "WhatsAppNumber"("organizationId", "isActive");
ALTER TABLE "WhatsAppNumber" ADD CONSTRAINT "WhatsAppNumber_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2. Carry over the single number each organization had connected.
INSERT INTO "WhatsAppNumber" (
    "id", "organizationId", "phoneNumberId", "businessAccountId", "displayNumber", "verifiedName",
    "qualityRating", "tokenCiphertext", "tokenIv", "tokenTag", "tokenExpiresAt", "connectMethod",
    "webhookSubscribed", "isActive", "connectedAt", "updatedAt"
)
SELECT
    'wan_' || "id", "organizationId", "cloudPhoneNumberId", COALESCE("cloudBusinessAccountId", ''), "cloudDisplayNumber",
    "cloudVerifiedName", "cloudQualityRating", "cloudTokenCiphertext", "cloudTokenIv", "cloudTokenTag",
    "cloudTokenExpiresAt", COALESCE("cloudConnectMethod", 'MANUAL'), "cloudWebhookSubscribed", true,
    COALESCE("cloudConnectedAt", CURRENT_TIMESTAMP), CURRENT_TIMESTAMP
FROM "WhatsAppChannel"
WHERE "cloudStatus" = 'CONNECTED'
  AND "cloudPhoneNumberId" IS NOT NULL
  AND "cloudTokenCiphertext" IS NOT NULL
  AND "cloudTokenIv" IS NOT NULL
  AND "cloudTokenTag" IS NOT NULL;

-- 3. The channel keeps provider choice, QR session and limits only.
DROP INDEX "WhatsAppChannel_cloudPhoneNumberId_idx";
ALTER TABLE "WhatsAppChannel" DROP COLUMN "cloudBusinessAccountId",
DROP COLUMN "cloudConnectMethod",
DROP COLUMN "cloudConnectedAt",
DROP COLUMN "cloudDisplayNumber",
DROP COLUMN "cloudPhoneNumberId",
DROP COLUMN "cloudQualityRating",
DROP COLUMN "cloudStatus",
DROP COLUMN "cloudTokenCiphertext",
DROP COLUMN "cloudTokenExpiresAt",
DROP COLUMN "cloudTokenIv",
DROP COLUMN "cloudTokenTag",
DROP COLUMN "cloudVerifiedName",
DROP COLUMN "cloudWebhookSubscribed";

-- 4. Messages: which number, contact name, media, and when staff saw it.
ALTER TABLE "WhatsAppMessage" ADD COLUMN "contactName" TEXT,
ADD COLUMN "mediaFileName" TEXT,
ADD COLUMN "mediaMimeType" TEXT,
ADD COLUMN "mediaStorageKey" TEXT,
ADD COLUMN "mediaType" TEXT,
ADD COLUMN "seenAt" TIMESTAMP(3),
ADD COLUMN "whatsappNumberId" TEXT;
CREATE INDEX "WhatsAppMessage_organizationId_phone_createdAt_idx" ON "WhatsAppMessage"("organizationId", "phone", "createdAt");
ALTER TABLE "WhatsAppMessage" ADD CONSTRAINT "WhatsAppMessage_whatsappNumberId_fkey" FOREIGN KEY ("whatsappNumberId") REFERENCES "WhatsAppNumber"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Inbound messages already in the log count as seen, so the new inbox starts clean.
UPDATE "WhatsAppMessage" SET "seenAt" = "createdAt" WHERE "direction" = 'INBOUND';
UPDATE "WhatsAppMessage" m SET "whatsappNumberId" = n."id"
FROM "WhatsAppNumber" n WHERE m."organizationId" = n."organizationId" AND m."provider" = 'CLOUD_API';

-- 5. Inbox access (CAThrives' "full inbox access" toggle, as a role permission).
INSERT INTO "Permission" ("id", "key", "label", "group")
VALUES ('perm_whatsapp_inbox', 'whatsapp.inbox', 'View and reply in the WhatsApp inbox', 'WhatsApp')
ON CONFLICT ("key") DO NOTHING;
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id" FROM "Role" r CROSS JOIN "Permission" p
WHERE r."key" IN ('ADMIN', 'FINANCE_MANAGER') AND p."key" = 'whatsapp.inbox'
ON CONFLICT DO NOTHING;

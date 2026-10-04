-- CreateEnum
CREATE TYPE "DonorCategory" AS ENUM ('INDIVIDUAL', 'FAMILY', 'TRUST', 'CORPORATE', 'ORGANIZATION');

-- CreateEnum
CREATE TYPE "WhatsAppProvider" AS ENUM ('CLOUD_API', 'WEB_QR');

-- CreateEnum
CREATE TYPE "WhatsAppConnectionStatus" AS ENUM ('DISCONNECTED', 'CONNECTING', 'QR_REQUIRED', 'CONNECTED', 'FAILED');

-- CreateEnum
CREATE TYPE "WhatsAppMessageStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'SKIPPED', 'RECEIVED');

-- CreateEnum
CREATE TYPE "WhatsAppDirection" AS ENUM ('OUTBOUND', 'INBOUND');

-- CreateEnum
CREATE TYPE "WhatsAppBroadcastStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'CANCELLED');

-- Vendor → Supplier is a rename, not a drop-and-recreate: every existing
-- record, and every expense and purchase order pointing at one, is kept.
ALTER TABLE "Vendor" RENAME TO "Supplier";
ALTER TABLE "Supplier" RENAME CONSTRAINT "Vendor_pkey" TO "Supplier_pkey";
ALTER TABLE "Supplier" RENAME CONSTRAINT "Vendor_organizationId_fkey" TO "Supplier_organizationId_fkey";
ALTER INDEX "Vendor_organizationId_idx" RENAME TO "Supplier_organizationId_idx";
ALTER INDEX "Vendor_organizationId_name_idx" RENAME TO "Supplier_organizationId_name_idx";
ALTER INDEX "Vendor_organizationId_code_key" RENAME TO "Supplier_organizationId_code_key";

ALTER TABLE "Expense" RENAME COLUMN "vendorId" TO "supplierId";
ALTER TABLE "Expense" RENAME CONSTRAINT "Expense_vendorId_fkey" TO "Expense_supplierId_fkey";
ALTER INDEX "Expense_organizationId_vendorId_idx" RENAME TO "Expense_organizationId_supplierId_idx";

ALTER TABLE "PurchaseOrder" RENAME COLUMN "vendorId" TO "supplierId";
ALTER TABLE "PurchaseOrder" RENAME CONSTRAINT "PurchaseOrder_vendorId_fkey" TO "PurchaseOrder_supplierId_fkey";

-- AlterTable
ALTER TABLE "Donor" ADD COLUMN     "addressLine2" TEXT,
ADD COLUMN     "alternatePhone" TEXT,
ADD COLUMN     "anniversaryDate" TIMESTAMP(3),
ADD COLUMN     "category" "DonorCategory" NOT NULL DEFAULT 'INDIVIDUAL',
ADD COLUMN     "country" TEXT NOT NULL DEFAULT 'India',
ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "dateOfBirth" TIMESTAMP(3),
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "postalCode" TEXT,
ADD COLUMN     "preferredLanguage" TEXT NOT NULL DEFAULT 'mr',
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "whatsappNumber" TEXT,
ADD COLUMN     "whatsappOptIn" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "whatsappOptInAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "onBehalfOfId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "locale" TEXT NOT NULL DEFAULT 'en';

-- CreateTable
CREATE TABLE "WhatsAppChannel" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "activeProvider" "WhatsAppProvider",
    "cloudPhoneNumberId" TEXT,
    "cloudBusinessAccountId" TEXT,
    "cloudTokenCiphertext" BYTEA,
    "cloudTokenIv" BYTEA,
    "cloudTokenTag" BYTEA,
    "cloudDisplayNumber" TEXT,
    "cloudVerifiedName" TEXT,
    "cloudStatus" "WhatsAppConnectionStatus" NOT NULL DEFAULT 'DISCONNECTED',
    "cloudLastError" TEXT,
    "cloudConnectedAt" TIMESTAMP(3),
    "webStatus" "WhatsAppConnectionStatus" NOT NULL DEFAULT 'DISCONNECTED',
    "webPhoneNumber" TEXT,
    "webDisplayName" TEXT,
    "webSessionCiphertext" BYTEA,
    "webSessionIv" BYTEA,
    "webSessionTag" BYTEA,
    "webConnectedAt" TIMESTAMP(3),
    "webLastActiveAt" TIMESTAMP(3),
    "webLastError" TEXT,
    "monthlyLimit" INTEGER NOT NULL DEFAULT 250,
    "messagesSent" INTEGER NOT NULL DEFAULT 0,
    "countedMonth" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppBroadcast" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider" "WhatsAppProvider" NOT NULL,
    "body" TEXT,
    "templateName" TEXT,
    "templateLanguage" TEXT,
    "templateParams" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "WhatsAppBroadcastStatus" NOT NULL DEFAULT 'QUEUED',
    "totalRecipients" INTEGER NOT NULL DEFAULT 0,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "WhatsAppBroadcast_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppMessage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "donorId" TEXT,
    "broadcastId" TEXT,
    "direction" "WhatsAppDirection" NOT NULL DEFAULT 'OUTBOUND',
    "provider" "WhatsAppProvider" NOT NULL,
    "phone" TEXT NOT NULL,
    "body" TEXT,
    "templateName" TEXT,
    "status" "WhatsAppMessageStatus" NOT NULL DEFAULT 'QUEUED',
    "providerMessageId" TEXT,
    "error" TEXT,
    "sentById" TEXT,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppChannel_organizationId_key" ON "WhatsAppChannel"("organizationId");

-- CreateIndex
CREATE INDEX "WhatsAppChannel_cloudPhoneNumberId_idx" ON "WhatsAppChannel"("cloudPhoneNumberId");

-- CreateIndex
CREATE INDEX "WhatsAppChannel_webStatus_idx" ON "WhatsAppChannel"("webStatus");

-- CreateIndex
CREATE INDEX "WhatsAppBroadcast_organizationId_createdAt_idx" ON "WhatsAppBroadcast"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "WhatsAppBroadcast_status_idx" ON "WhatsAppBroadcast"("status");

-- CreateIndex
CREATE INDEX "WhatsAppMessage_organizationId_createdAt_idx" ON "WhatsAppMessage"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "WhatsAppMessage_organizationId_donorId_idx" ON "WhatsAppMessage"("organizationId", "donorId");

-- CreateIndex
CREATE INDEX "WhatsAppMessage_broadcastId_status_idx" ON "WhatsAppMessage"("broadcastId", "status");

-- CreateIndex
CREATE INDEX "WhatsAppMessage_providerMessageId_idx" ON "WhatsAppMessage"("providerMessageId");

-- CreateIndex
CREATE INDEX "Donor_organizationId_name_idx" ON "Donor"("organizationId", "name");

-- CreateIndex
CREATE INDEX "Donor_organizationId_whatsappOptIn_idx" ON "Donor"("organizationId", "whatsappOptIn");

-- CreateIndex
CREATE INDEX "Expense_organizationId_onBehalfOfId_idx" ON "Expense"("organizationId", "onBehalfOfId");

-- AddForeignKey
ALTER TABLE "Donor" ADD CONSTRAINT "Donor_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_onBehalfOfId_fkey" FOREIGN KEY ("onBehalfOfId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppChannel" ADD CONSTRAINT "WhatsAppChannel_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppBroadcast" ADD CONSTRAINT "WhatsAppBroadcast_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppBroadcast" ADD CONSTRAINT "WhatsAppBroadcast_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppMessage" ADD CONSTRAINT "WhatsAppMessage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppMessage" ADD CONSTRAINT "WhatsAppMessage_donorId_fkey" FOREIGN KEY ("donorId") REFERENCES "Donor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppMessage" ADD CONSTRAINT "WhatsAppMessage_broadcastId_fkey" FOREIGN KEY ("broadcastId") REFERENCES "WhatsAppBroadcast"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppMessage" ADD CONSTRAINT "WhatsAppMessage_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


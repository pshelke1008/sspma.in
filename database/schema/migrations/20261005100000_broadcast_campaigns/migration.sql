-- Broadcast wizard: scheduled sends, template variable mapping, media headers,
-- delivered/read counts, and the values each recipient's message was filled with.

ALTER TYPE "WhatsAppBroadcastStatus" ADD VALUE 'SCHEDULED';

ALTER TABLE "WhatsAppBroadcast"
  ADD COLUMN "deliveredCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "readCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "scheduledAt" TIMESTAMP(3),
  ADD COLUMN "audienceMode" TEXT,
  ADD COLUMN "variableMapping" JSONB,
  ADD COLUMN "templateCategory" TEXT,
  ADD COLUMN "estimatedCost" DECIMAL(10,2),
  ADD COLUMN "headerFormat" TEXT,
  ADD COLUMN "headerMediaId" TEXT,
  ADD COLUMN "headerMediaName" TEXT;

CREATE INDEX "WhatsAppBroadcast_status_scheduledAt_idx" ON "WhatsAppBroadcast"("status", "scheduledAt");

ALTER TABLE "WhatsAppMessage" ADD COLUMN "templateParams" TEXT[] DEFAULT ARRAY[]::TEXT[];

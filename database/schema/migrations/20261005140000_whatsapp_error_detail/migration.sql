-- Keep Meta's own explanation of a failed message (code and details), not only our summary code.
ALTER TABLE "WhatsAppMessage" ADD COLUMN "errorDetail" TEXT;

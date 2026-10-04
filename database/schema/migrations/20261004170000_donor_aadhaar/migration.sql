-- Aadhaar number on donor profiles. Stored as 12 digits; the API only ever
-- returns it masked (XXXX XXXX 1234).
ALTER TABLE "Donor" ADD COLUMN "aadhaarNumber" TEXT;

-- Donor addresses are recorded the way rural India writes them: state, then
-- district, then village (gaon). The old "city" values were districts or
-- towns, so they carry over as the district.
ALTER TABLE "Donor" RENAME COLUMN "city" TO "district";
ALTER TABLE "Donor" ADD COLUMN "village" TEXT;

CREATE INDEX "Donor_organizationId_state_district_village_idx" ON "Donor"("organizationId", "state", "district", "village");

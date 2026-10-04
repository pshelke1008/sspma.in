import { prisma } from '../../db';
import { normalizePhone } from './phone';

/**
 * Attaches earlier WhatsApp messages from these numbers to a donor — used when
 * an unknown contact is saved as a donor, or a donor's number is added later,
 * so the conversation and the donor profile show the same history.
 */
export async function linkConversationsToDonor(organizationId: string, donorId: string, numbers: (string | null | undefined)[]) {
  const phones = Array.from(new Set(numbers.map((value) => normalizePhone(value)).filter((value): value is string => Boolean(value))));
  if (phones.length === 0) return 0;
  const result = await prisma.whatsAppMessage.updateMany({
    where: { organizationId, donorId: null, phone: { in: phones } },
    data: { donorId },
  });
  return result.count;
}

/**
 * The donor whose number this is. Numbers are stored as typed ("098200 11999",
 * "+91 98200-11999"), so candidates are found on digits alone and confirmed by
 * normalising both sides.
 */
export async function findDonorByPhone(organizationId: string, phone: string) {
  const tail = phone.replace(/\D/g, '').slice(-10);
  if (tail.length < 8) return null;
  const candidates = await prisma.$queryRaw<{ id: string; phone: string | null; whatsappNumber: string | null; alternatePhone: string | null }[]>`
    SELECT id, phone, "whatsappNumber", "alternatePhone" FROM "Donor"
    WHERE "organizationId" = ${organizationId}
      AND (
        regexp_replace(COALESCE("whatsappNumber", ''), '[^0-9]', '', 'g') LIKE ${'%' + tail}
        OR regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g') LIKE ${'%' + tail}
        OR regexp_replace(COALESCE("alternatePhone", ''), '[^0-9]', '', 'g') LIKE ${'%' + tail}
      )
    ORDER BY "isActive" DESC, "createdAt" ASC
    LIMIT 5
  `;
  const target = normalizePhone(phone) ?? phone;
  return (
    candidates.find((donor) =>
      [donor.whatsappNumber, donor.phone, donor.alternatePhone].some((value) => normalizePhone(value) === target),
    ) ?? null
  );
}

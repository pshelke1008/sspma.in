/**
 * Phone normalisation for WhatsApp. Adapted from the CAThrives integration.
 *
 * Donor numbers are typed by hand — "+91 98200 11223", "098200 11223",
 * "9820011223" — and WhatsApp needs digits with a country code. This is the
 * single place that decides what a stored number means.
 */

/** Digits only, defaulting a bare 10-digit number to India (+91); null if implausible. */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = String(raw).replace(/\D/g, '');
  if (!digits) return null;

  // Trunk-prefix 0 on an otherwise domestic number.
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  if (digits.length === 10) digits = `91${digits}`;

  if (digits.length < 10 || digits.length > 15) return null;
  return digits;
}

/** Baileys addresses an individual account as `<digits>@s.whatsapp.net`. */
export function toWhatsAppJid(normalizedPhone: string): string {
  return `${normalizedPhone}@s.whatsapp.net`;
}

/** Shown in logs and lists without exposing the whole number. */
export function maskPhone(normalizedPhone: string | null): string {
  if (!normalizedPhone) return '—';
  return `${normalizedPhone.slice(0, 4)}••••${normalizedPhone.slice(-2)}`;
}

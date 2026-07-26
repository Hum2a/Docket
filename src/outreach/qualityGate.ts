/**
 * Quality gates for outbound outreach copy — hard blocks that apply to
 * manual and forced sends as well as auto-send (same class as PECR/freemail).
 */

/** Hostname-shaped TLDs that indicate businessName is a domain, not a trading name. */
const DOMAINISH_TLD =
  /\.(co\.uk|org\.uk|ac\.uk|gov\.uk|com|net|org|uk|io|biz|info|me|co)$/i;

/** UK postcode (outward + inward), case-insensitive. */
export const UK_POSTCODE_RE = /\b[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}\b/i;

export const QUALITY_HARD_REASONS = [
  "business_name_is_domain",
  "generic_observation",
  "industry_unknown",
  "postal_address_invalid",
] as const;

export type QualityHardReason = (typeof QUALITY_HARD_REASONS)[number];

/** True when `businessName` looks like a hostname rather than a trading name. */
export function isBusinessNameDomain(name: string | null | undefined): boolean {
  const n = (name || "").trim();
  if (!n) return false;
  if (DOMAINISH_TLD.test(n)) return true;
  // No space + contains a dot → hostname-like (e.g. foo.example)
  if (!/\s/.test(n) && n.includes(".")) return true;
  return false;
}

/**
 * Postal address must include digits and a UK postcode pattern.
 * Placeholders like "Humza Butt, United Kingdom" fail (no digits / no postcode).
 */
export function isValidUkPostalAddress(address: string | null | undefined): boolean {
  const a = (address || "").trim();
  if (!a) return false;
  if (!/\d/.test(a)) return false;
  if (!UK_POSTCODE_RE.test(a)) return false;
  return true;
}

export function isQualityHardReason(reason: string): boolean {
  return (QUALITY_HARD_REASONS as readonly string[]).includes(reason);
}

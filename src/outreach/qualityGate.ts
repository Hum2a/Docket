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
  "business_name_implausible",
  "business_name_is_domain", // legacy alias — normalised to implausible in canAutoSend
  "generic_observation",
  "industry_unknown",
  "postal_address_invalid",
  "location_invalid",
] as const;

export type QualityHardReason = (typeof QUALITY_HARD_REASONS)[number];

/** Hostname-shaped TLDs that indicate businessName is a domain, not a trading name. */
export function isBusinessNameDomain(name: string | null | undefined): boolean {
  const n = (name || "").trim();
  if (!n) return false;
  if (DOMAINISH_TLD.test(n)) return true;
  // No space + contains a dot → hostname-like (e.g. foo.example)
  if (!/\s/.test(n) && n.includes(".")) return true;
  return false;
}

const SERVICE_VERB_IN_NAME =
  /\b(provides?|offers?|serving|specialising|specializing|expertise)\b/i;

/**
 * Trading name is implausible for outreach — SEO sentence, domain, or no capitals.
 * Review-queue reason (blocks send until a human edits the name).
 */
export function isBusinessNameImplausible(
  name: string | null | undefined,
  location?: string | null
): boolean {
  const n = (name || "").trim();
  if (!n) return false;
  if (isBusinessNameDomain(n)) return true;

  const words = n.split(/\s+/).filter(Boolean);
  if (words.length > 5) return true;
  if (SERVICE_VERB_IN_NAME.test(n)) return true;

  const town = (location || "").trim();
  if (town) {
    const inTown = new RegExp(`\\bin\\s+${escapeRe(town)}\\b`, "i");
    if (inTown.test(n)) return true;
  }

  // No capitalised word at all
  if (!words.some((w) => /^[A-Z]/.test(w))) return true;

  return false;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Partition / batch filenames mistaken for places — must never appear in copy.
 * Matches: contains sweep|partition|yell|batch, or four or more words.
 */
export function isPartitionShapedLocation(location: string | null | undefined): boolean {
  const v = (location || "").trim();
  if (!v) return false;
  const lower = v.toLowerCase();
  if (/\bsweep\b/.test(lower)) return true;
  if (/\bpartition\b/.test(lower)) return true;
  if (/\byell\b/.test(lower)) return true;
  if (/\bbatch\b/.test(lower)) return true;
  if (v.split(/\s+/).filter(Boolean).length >= 4) return true;
  return false;
}

/** Location safe to interpolate into copy; null → use "like yours" omission. */
export function usableLocation(location: string | null | undefined): string | null {
  const v = (location || "").trim();
  if (!v) return null;
  if (isPartitionShapedLocation(v)) return null;
  return v;
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

/**
 * Auto-enable PECR / email-verified flags.
 * Freemail addresses stay unverified and are still blocked by canAutoSend.
 * Corporate subscriber is inferred from Companies House / entity type only —
 * never from a business-domain email (sole traders often have those).
 */

import { isFreemail } from "../../shared/freemail";

const CORPORATE_ENTITY_TYPES = new Set([
  "ltd",
  "llp",
  "scottish_partnership",
  "public_body",
]);

const INDIVIDUAL_ENTITY_TYPES = new Set(["sole_trader", "partnership"]);

export type SendFlagLead = {
  contactEmail?: string | null;
  emailVerified?: boolean;
  corporateSubscriber?: boolean;
  entityType?: string | null;
  companiesHouseNumber?: string | null;
  chStatus?: string | null;
  hasWebsite?: boolean;
};

export type SendFlagPatch = {
  emailVerified?: boolean;
  corporateSubscriber?: boolean;
};

export function isIndividualSubscriber(entityType?: string | null): boolean {
  return INDIVIDUAL_ENTITY_TYPES.has((entityType ?? "unknown").toLowerCase());
}

export function isActiveChStatus(chStatus?: string | null): boolean {
  return (chStatus ?? "").trim().toLowerCase() === "active";
}

/** Non-freemail contact emails scraped from a business site count as verified. */
export function shouldAutoVerifyEmail(contactEmail: string | null | undefined): boolean {
  const email = contactEmail?.trim() || "";
  return Boolean(email) && !isFreemail(email);
}

/**
 * Corporate subscriber only when CH number + active status, or a corporate
 * entity type. Caller-supplied corporateSubscriber is ignored. Sole traders
 * and unincorporated partnerships are always false.
 */
export function shouldAutoCorporate(lead: SendFlagLead): boolean {
  if (isIndividualSubscriber(lead.entityType)) return false;
  if (lead.companiesHouseNumber?.trim() && isActiveChStatus(lead.chStatus)) return true;
  const entity = (lead.entityType ?? "unknown").toLowerCase();
  return CORPORATE_ENTITY_TYPES.has(entity);
}

/** Fields to PATCH so send gates pass without manual checkbox clicks. */
export function sendFlagPatch(lead: SendFlagLead): SendFlagPatch {
  const patch: SendFlagPatch = {};
  if (!lead.emailVerified && shouldAutoVerifyEmail(lead.contactEmail)) {
    patch.emailVerified = true;
  }
  if (!lead.corporateSubscriber && shouldAutoCorporate(lead)) {
    patch.corporateSubscriber = true;
  }
  return patch;
}

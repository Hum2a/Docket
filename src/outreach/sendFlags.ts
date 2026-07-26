/**
 * Auto-enable PECR / email-verified flags for business-domain contacts.
 * Freemail addresses stay unverified and are still blocked by canAutoSend.
 */

import { isFreemail } from "../../shared/freemail";

const CORPORATE_ENTITY_TYPES = new Set([
  "ltd",
  "llp",
  "scottish_partnership",
  "public_body",
]);

export type SendFlagLead = {
  contactEmail?: string | null;
  emailVerified?: boolean;
  corporateSubscriber?: boolean;
  entityType?: string | null;
  companiesHouseNumber?: string | null;
  hasWebsite?: boolean;
};

export type SendFlagPatch = {
  emailVerified?: boolean;
  corporateSubscriber?: boolean;
};

/** Non-freemail contact emails scraped from a business site count as verified. */
export function shouldAutoVerifyEmail(contactEmail: string | null | undefined): boolean {
  const email = contactEmail?.trim() || "";
  return Boolean(email) && !isFreemail(email);
}

/**
 * Corporate subscriber when CH / entity type says so, or when the lead has a
 * business-domain email (pipeline rebuild leads). Sole traders on freemail stay false.
 */
export function shouldAutoCorporate(lead: SendFlagLead): boolean {
  if (lead.corporateSubscriber) return true;
  if (lead.companiesHouseNumber?.trim()) return true;
  const entity = (lead.entityType ?? "unknown").toLowerCase();
  if (CORPORATE_ENTITY_TYPES.has(entity)) return true;
  return shouldAutoVerifyEmail(lead.contactEmail);
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

/**
 * Auto-enable email-verified when the contact is a non-freemail address.
 * Freemail stays unverified and is still blocked by canAutoSend.
 */

import { isFreemail } from "../../shared/freemail";

export type SendFlagLead = {
  contactEmail?: string | null;
  emailVerified?: boolean;
};

export type SendFlagPatch = {
  emailVerified?: boolean;
};

/** Non-freemail contact emails scraped from a business site count as verified. */
export function shouldAutoVerifyEmail(contactEmail: string | null | undefined): boolean {
  const email = contactEmail?.trim() || "";
  return Boolean(email) && !isFreemail(email);
}

/** Fields to PATCH so send gates pass without a manual checkbox click. */
export function sendFlagPatch(lead: SendFlagLead): SendFlagPatch {
  const patch: SendFlagPatch = {};
  if (!lead.emailVerified && shouldAutoVerifyEmail(lead.contactEmail)) {
    patch.emailVerified = true;
  }
  return patch;
}

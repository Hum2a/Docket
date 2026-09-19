/**
 * Manual / Approve send: operational deferrals are skipped; quality reasons
 * become acknowledgable warnings. Suppressions, missing recipient,
 * demo-not-ready, and the postal/unsubscribe footer are never skippable.
 */

export const OPERATIONAL_SKIP_REASONS = [
  "auto_send_disabled",
  "sending_paused",
  "dry_run",
  "daily_cap_reached",
] as const;

/** @deprecated Use OPERATIONAL_SKIP_REASONS. Quality flags are warnings, not silent skips. */
export const MANUAL_SKIP_REASONS = OPERATIONAL_SKIP_REASONS;

export type ManualSkipReason = (typeof MANUAL_SKIP_REASONS)[number];

export const WARNING_REASONS = [
  "generic_observation",
  "priority_below_threshold",
  "email_unverified",
  "demo_audit_score_low",
  "business_name_implausible",
  "business_name_is_domain",
  "industry_unknown",
  "location_invalid",
] as const;

export type WarningReason = (typeof WARNING_REASONS)[number];

const WARNING_SET = new Set<string>(WARNING_REASONS);
const OPERATIONAL_SET = new Set<string>(OPERATIONAL_SKIP_REASONS);

export function filterManualHardReasons(reasons: string[]): string[] {
  return reasons.filter((r) => !OPERATIONAL_SET.has(r));
}

export type ClassifiedGateReasons = {
  blocking: string[];
  warnings: string[];
};

export function classifyGateReasons(
  reasons: string[],
  opts: { hasConsent?: boolean; skipOperational?: boolean } = {}
): ClassifiedGateReasons {
  const skipOperational = opts.skipOperational !== false;
  const blocking: string[] = [];
  const warnings: string[] = [];
  for (const r of reasons) {
    if (skipOperational && OPERATIONAL_SET.has(r)) continue;
    if (r === "freemail_address") {
      if (opts.hasConsent) warnings.push(r);
      else blocking.push(r);
      continue;
    }
    if (WARNING_SET.has(r)) warnings.push(r);
    else blocking.push(r);
  }
  return { blocking, warnings };
}

export function unacknowledgedWarnings(
  warnings: string[],
  acknowledged: string[] | undefined
): string[] {
  if (warnings.length === 0) return [];
  const ack = new Set((acknowledged ?? []).map((s) => s.trim()).filter(Boolean));
  if (ack.has("all")) return [];
  return warnings.filter((w) => !ack.has(w));
}

/** Reasons that still refuse a manual send after operational skips. */
export function manualSendRefusal(
  classified: ClassifiedGateReasons,
  acknowledged?: string[]
): string[] {
  if (classified.blocking.length > 0) return classified.blocking;
  return unacknowledgedWarnings(classified.warnings, acknowledged);
}

/** Plain-language labels: one line saying what to do. */
export const GATE_REASON_LABELS: Record<string, string> = {
  auto_send_disabled: "Auto-send is off — use a manual send from the lead page.",
  sending_paused: "Sending is paused in settings. Unpause before sending.",
  dry_run: "Dry run is on — messages queue instead of going live.",
  daily_cap_reached: "Daily send cap reached. Wait until tomorrow or raise the cap.",
  priority_below_threshold: "Priority is below the auto-send threshold. Tick I've checked this if you still want to send.",
  not_corporate_subscriber:
    "Legacy flag — this no longer blocks sending.",
  freemail_address:
    "Freemail address: use a work domain for cold send, or record consent and send on the warm lane.",
  email_unverified:
    "Email isn't verified: tick I've checked this if you confirmed it, or record consent.",
  missing_contact_email:
    "No recipient: add a work email, or record consent with the address they gave you.",
  lead_suppressed: "This address is unsubscribed or suppressed — do not send.",
  demo_not_ready: "Publish the demo before sending.",
  status_not_sendable: "Move the lead to demo ready or queued before sending.",
  sending_identity_not_configured: "Set the outreach From address in settings or secrets.",
  sending_domain_is_primary: "From-address is on the primary portfolio domain. Use the outreach subdomain.",
  postal_address_not_configured: "Set a real UK postal address for the email footer.",
  postal_address_invalid: "Postal address must include a street number and a UK postcode.",
  unsubscribe_key_not_configured: "Set UNSUBSCRIBE_SIGNING_KEY via secrets:sync.",
  from_domain_not_primary: "From-address is on the primary portfolio domain.",
  sending_domain_set: "Set the sending domain in outreach settings.",
  from_address_set: "Set the outreach From address.",
  postal_address_set: "Set a postal address for the footer.",
  unsubscribe_key_set: "Set the unsubscribe signing key.",
  resend_key_set: "Set RESEND_API_KEY.",
  personal_from_set: "Set OUTREACH_PERSONAL_FROM for warm sends.",
  personal_from_domain_verified: "Verify the personal From domain in Resend.",
  consent_none: "No recorded consent. Use Got consent on a call, then send on the warm lane.",
  missing_consent_email: "Consent needs an email address to send to.",
  draft_missing: "Warm send needs a custom subject and body.",
  consent_stale: "Consent is older than 30 days. Record it again before sending.",
  warm_followup_already_sent: "Warm follow-up already sent for this lead.",
  business_name_implausible:
    "Business name looks like SEO copy or a domain. Edit the trading name, or tick I've checked this.",
  business_name_is_domain: "Business name looks like a domain. Use the trading name, or tick I've checked this.",
  generic_observation: "Observation is generic: write a custom draft, or fill Observation override.",
  industry_unknown: "Industry is unknown and this template needs a trade phrase. Set industry, or tick I've checked this.",
  location_invalid: "Location is missing or looks like a partition filename. Fix it, or tick I've checked this.",
  demo_audit_score_low: "Demo PageSpeed is below 90. Recheck the demo, or tick I've checked this.",
  warnings_not_acknowledged: "Tick I've checked this (or pass --ack-warnings) before sending.",
};

export function labelGateReason(reason: string): string {
  return GATE_REASON_LABELS[reason] ?? reason.replaceAll("_", " ");
}

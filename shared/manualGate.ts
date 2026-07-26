/**
 * Manual send skips operational deferrals only.
 * PECR / freemail / suppression / verified-email / demo-ready are never skipped.
 */

export const MANUAL_SKIP_REASONS = [
  "auto_send_disabled",
  "sending_paused",
  "dry_run",
  "daily_cap_reached",
  "priority_below_threshold",
] as const;

export type ManualSkipReason = (typeof MANUAL_SKIP_REASONS)[number];

export function filterManualHardReasons(reasons: string[]): string[] {
  const skip = new Set<string>(MANUAL_SKIP_REASONS);
  return reasons.filter((r) => !skip.has(r));
}

/** Plain-language labels for UI tooltips and CLI gate output. */
export const GATE_REASON_LABELS: Record<string, string> = {
  auto_send_disabled: "auto-send is disabled",
  sending_paused: "sending is paused",
  dry_run: "dry run is on",
  daily_cap_reached: "daily send cap reached",
  priority_below_threshold: "priority below auto-send threshold",
  not_corporate_subscriber: "not a corporate subscriber (PECR)",
  freemail_address: "contact address is freemail",
  email_unverified: "no verified email",
  missing_contact_email: "no contact email",
  lead_suppressed: "address is suppressed",
  demo_not_ready: "demo not published",
  status_not_sendable: "lead status is not sendable",
  sending_identity_not_configured: "from-address not configured",
  sending_domain_is_primary: "from-address is on the primary portfolio domain",
  postal_address_not_configured: "postal address not configured",
  postal_address_invalid: "postal address is not a real UK address",
  unsubscribe_key_not_configured: "unsubscribe signing key not configured",
  from_domain_not_primary: "from-address is on the primary portfolio domain",
  sending_domain_set: "sending domain not configured",
  from_address_set: "from-address not set",
  postal_address_set: "postal address not set",
  unsubscribe_key_set: "unsubscribe key not set",
  resend_key_set: "Resend API key not set",
  business_name_is_domain: "business name looks like a domain, not a trading name",
  generic_observation: "observation line is generic — no specific fault stated",
  industry_unknown: "industry unknown and template requires a trade phrase",
  location_invalid: "location is missing or looks like a partition filename",
};

export function labelGateReason(reason: string): string {
  return GATE_REASON_LABELS[reason] ?? reason.replaceAll("_", " ");
}

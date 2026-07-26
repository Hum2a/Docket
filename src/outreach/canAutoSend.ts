/** PECR corporate auto-send gate. Freemail helpers live in shared/freemail.ts. */

export {
  FREEMAIL_DOMAINS,
  emailDomain,
  isFreemail,
} from "../../shared/freemail";

import { isFreemail } from "../../shared/freemail";
import {
  isBusinessNameImplausible,
  isPartitionShapedLocation,
  isValidUkPostalAddress,
} from "./qualityGate";

export type LeadGateInput = {
  priorityScore: number | null;
  corporateSubscriber: boolean;
  emailVerified: boolean;
  contactEmail: string | null;
  suppressed: boolean;
  demoStatus: string;
  demoUrl: string | null;
  status: string;
  /** Trading name — domain-shaped names are blocked. */
  businessName?: string | null;
  /** Resolved observation signal from pickObservation (null = missing). */
  observationSignal?: string | null;
  /** Industry slug; null is fine when templates omit the trade phrase. */
  industry?: string | null;
  /**
   * When true, a null/empty industry blocks with industry_unknown.
   * Current initial/followup/final templates fall back to "local businesses" — leave false.
   */
  templateRequiresIndustry?: boolean;
  /**
   * When true, a null/empty location blocks with location_invalid.
   * Current templates fall back to "like yours" — leave false.
   * Partition-shaped locations always block regardless.
   */
  templateRequiresLocation?: boolean;
  /** Outreach location field — partition filenames always hard-block. */
  location?: string | null;
  /**
   * Resolved postal address (settings/env). When set but invalid → postal_address_invalid.
   * Omit / null when not yet resolved (caller handles postal_address_not_configured).
   */
  postalAddress?: string | null;
};
export type OutreachSettingsGateInput = {
  autoSendEnabled: boolean;
  dryRun: boolean;
  autoSendThreshold: number;
  dailySendCap: number;
  pausedUntil: string | Date | null;
};

export type AutoSendResult = {
  ok: boolean;
  /** True when failure is operational (retry later), not a review-queue failure. */
  deferred: boolean;
  reasons: string[];
};

/**
 * PECR (UK): unsolicited marketing email may be sent to corporate subscribers
 * (limited companies, LLPs, Scottish partnerships, public bodies) without prior
 * consent. Sole traders and unincorporated partnerships are individual
 * subscribers and require consent or soft opt-in. Never auto-send unless
 * `corporateSubscriber` is confirmed true — do not "simplify" this rule away.
 */
export function canAutoSend(
  lead: LeadGateInput,
  settings: OutreachSettingsGateInput,
  todaySentCount: number,
  now: Date = new Date()
): AutoSendResult {
  const reasons: string[] = [];
  let deferred = false;

  // 1 — auto_send enabled + not paused
  if (!settings.autoSendEnabled) {
    reasons.push("auto_send_disabled");
    deferred = true;
  }
  if (settings.pausedUntil) {
    const until = new Date(settings.pausedUntil);
    if (!Number.isNaN(until.getTime()) && until > now) {
      reasons.push("sending_paused");
      deferred = true;
    }
  }

  // 2 — dry run
  if (settings.dryRun) {
    reasons.push("dry_run");
    deferred = true;
  }

  // 3 — priority threshold
  if (lead.priorityScore == null || Number(lead.priorityScore) < Number(settings.autoSendThreshold)) {
    reasons.push("priority_below_threshold");
  }

  // 4 — corporate subscriber (PECR)
  if (!lead.corporateSubscriber) {
    reasons.push("not_corporate_subscriber");
  }

  // 5 — verified non-freemail email
  const email = lead.contactEmail?.trim() || "";
  if (!email) {
    reasons.push("missing_contact_email");
  } else if (!lead.emailVerified) {
    reasons.push("email_unverified");
  } else if (isFreemail(email)) {
    reasons.push("freemail_address");
  }

  // 6 — not suppressed (caller must also check suppressions table)
  if (lead.suppressed) {
    reasons.push("lead_suppressed");
  }

  // 7 — demo ready
  if (lead.demoStatus !== "ready" || !lead.demoUrl?.trim()) {
    reasons.push("demo_not_ready");
  }

  // 8 — status gate
  if (lead.status !== "demo_ready" && lead.status !== "queued") {
    reasons.push("status_not_sendable");
  }

  // 9 — daily cap
  if (todaySentCount >= settings.dailySendCap) {
    reasons.push("daily_cap_reached");
    deferred = true;
  }

  // 10 — quality hard blocks (auto-send / force). Manual/Approve may skip
  // business_name_implausible via filterManualHardReasons.
  if (isBusinessNameImplausible(lead.businessName, lead.location)) {
    reasons.push("business_name_implausible");
  }
  if (lead.observationSignal === "generic") {
    reasons.push("generic_observation");
  }
  if (
    lead.templateRequiresIndustry &&
    !(lead.industry && lead.industry.trim())
  ) {
    reasons.push("industry_unknown");
  }
  if (isPartitionShapedLocation(lead.location)) {
    reasons.push("location_invalid");
  } else if (
    lead.templateRequiresLocation &&
    !(lead.location && lead.location.trim())
  ) {
    reasons.push("location_invalid");
  }
  const postal = lead.postalAddress?.trim();
  if (postal && !isValidUkPostalAddress(postal)) {
    reasons.push("postal_address_invalid");
  }

  const reviewReasons = reasons.filter(
    (r) =>
      ![
        "auto_send_disabled",
        "sending_paused",
        "dry_run",
        "daily_cap_reached",
      ].includes(r)
  );

  const ok = reasons.length === 0;
  if (!ok && reviewReasons.length === 0) {
    deferred = true;
  } else if (reviewReasons.length > 0 && !deferred) {
    deferred = false;
  }

  return { ok, deferred, reasons };
}

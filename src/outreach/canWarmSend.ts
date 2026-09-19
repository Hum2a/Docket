import { isFreemail } from "../../shared/freemail";
import { demoAuditScore, MIN_DEMO_AUDIT_SCORE } from "./qualityGate";

/** Consent / warm-lane gate. Separate from canAutoSend — never a back door. */

export const CONSENT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export type WarmLeadInput = {
  consentStatus: string;
  consentEmail: string | null;
  consentAt: string | Date | null;
  suppressed: boolean;
  demoStatus: string;
  demoUrl: string | null;
  customSubject: string | null;
  customBody: string | null;
};

export type WarmSendExtras = {
  /** suppressions table hit on consent_email or its domain. */
  emailOrDomainSuppressed: boolean;
  /** Successful warm outbound messages already sent. */
  warmOutboundCount: number;
};

export type WarmSendResult = {
  ok: boolean;
  reasons: string[];
};

export function canWarmSend(
  lead: WarmLeadInput,
  extras: WarmSendExtras,
  now: Date = new Date()
): WarmSendResult {
  const reasons: string[] = [];

  if (!lead.consentStatus || lead.consentStatus === "none") {
    reasons.push("consent_none");
  }
  const email = lead.consentEmail?.trim() || "";
  if (!email) {
    reasons.push("missing_consent_email");
  }
  if (lead.suppressed || extras.emailOrDomainSuppressed) {
    reasons.push("lead_suppressed");
  }
  if (lead.demoStatus !== "ready" || !lead.demoUrl?.trim()) {
    reasons.push("demo_not_ready");
  }
  if (!lead.customSubject?.trim() || !lead.customBody?.trim()) {
    reasons.push("draft_missing");
  }

  if (lead.consentAt) {
    const at = lead.consentAt instanceof Date ? lead.consentAt : new Date(lead.consentAt);
    if (!Number.isNaN(at.getTime()) && now.getTime() - at.getTime() > CONSENT_MAX_AGE_MS) {
      reasons.push("consent_stale");
    }
  } else if (lead.consentStatus && lead.consentStatus !== "none") {
    reasons.push("consent_stale");
  }

  if (extras.warmOutboundCount >= 2) {
    reasons.push("warm_followup_already_sent");
  }

  return { ok: reasons.length === 0, reasons };
}

export function hasRecordedConsent(lead: { consentStatus?: string | null }): boolean {
  return Boolean(lead.consentStatus && lead.consentStatus !== "none");
}

/** Quality warnings on the warm lane (freemail + low demo score). Consent is already recorded. */
export function warmLaneWarnings(lead: {
  consentEmail?: string | null;
  audit?: Record<string, unknown> | null;
}): string[] {
  const warnings: string[] = [];
  if (isFreemail(lead.consentEmail || "")) warnings.push("freemail_address");
  const score = demoAuditScore(lead.audit ?? null);
  if (score != null && score < MIN_DEMO_AUDIT_SCORE) warnings.push("demo_audit_score_low");
  return warnings;
}

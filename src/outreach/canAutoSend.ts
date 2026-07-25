/** Freemail / consumer mailbox domains — not valid for PECR corporate auto-send. */
export const FREEMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "yahoo.co.uk",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "protonmail.com",
  "proton.me",
  "btinternet.com",
  "sky.com",
  "mail.com",
  "gmx.com",
  "gmx.co.uk",
]);

export type LeadGateInput = {
  priorityScore: number | null;
  corporateSubscriber: boolean;
  emailVerified: boolean;
  contactEmail: string | null;
  suppressed: boolean;
  demoStatus: string;
  demoUrl: string | null;
  status: string;
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

export function emailDomain(email: string): string | null {
  const at = email.trim().toLowerCase().lastIndexOf("@");
  if (at < 0) return null;
  return email.trim().toLowerCase().slice(at + 1);
}

export function isFreemail(email: string): boolean {
  const domain = emailDomain(email);
  return Boolean(domain && FREEMAIL_DOMAINS.has(domain));
}

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

  const reviewReasons = reasons.filter(
    (r) =>
      ![
        "auto_send_disabled",
        "sending_paused",
        "dry_run",
        "daily_cap_reached",
      ].includes(r)
  );

  // Deferred-only failures (1,2,9) → deferred; mix with review → still not ok
  const ok = reasons.length === 0;
  if (!ok && reviewReasons.length === 0) {
    deferred = true;
  } else if (reviewReasons.length > 0 && !deferred) {
    deferred = false;
  }

  return { ok, deferred, reasons };
}

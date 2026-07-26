import type { Env } from "./schema";
import type { Sql } from "./db";
import type { Lead, OutreachSettings } from "../shared/outreach";
import {
  countSentToday,
  createLeadReminder,
  getInitialOutboundProviderId,
  getLeadMessageByIdempotency,
  insertLeadMessage,
  isSuppressed,
  leadGateInput,
  MAX_MESSAGE_SEND_ATTEMPTS,
  setLeadReviewReasons,
  settingsGateInput,
  updateLead,
  updateLeadMessageAttempt,
} from "./outreach-db";
import { canAutoSend, emailDomain } from "./outreach/canAutoSend";
import { filterManualHardReasons } from "../shared/manualGate";
import {
  absoluteFollowupAt,
  applyCustomInitialCopy,
  renderOutreachCopy,
  resolvePostalAddress,
  resolveTemplateId,
  type CopyLeadInput,
} from "./outreach/copy";
import { sendResendEmail } from "./email";

const PRIMARY_SENDING_ROOT = "humza-butt.space";

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function makeIdempotencyKey(
  leadId: number,
  templateId: string,
  followupStep: number
): Promise<string> {
  return sha256Hex(`${leadId}:${templateId}:${followupStep}`);
}

export { resolvePostalAddress };

/** Strip `Name <addr@domain>` to bare address, then parse with emailDomain. */
export function extractFromAddress(from: string): string {
  const trimmed = from.trim();
  const angle = trimmed.match(/<([^>]+)>/);
  return (angle ? angle[1] : trimmed).trim();
}

/** True if from-address domain is humza-butt.space or any subdomain. */
export function isPrimarySendingDomain(from: string): boolean {
  const domain = emailDomain(extractFromAddress(from));
  if (!domain) return false;
  return domain === PRIMARY_SENDING_ROOT || domain.endsWith(`.${PRIMARY_SENDING_ROOT}`);
}

/** Constant-time hex compare: length check, then XOR-accumulate. */
export function constantTimeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let acc = 0;
  for (let i = 0; i < a.length; i++) {
    acc |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return acc === 0;
}

function toCopyLead(lead: Lead): CopyLeadInput {
  return {
    id: lead.id,
    businessName: lead.businessName,
    slug: lead.slug,
    industry: lead.industry,
    location: lead.location,
    contactName: lead.contactName,
    websiteUrl: lead.websiteUrl,
    demoUrl: lead.demoUrl,
    demoExpiresAt: lead.demoExpiresAt,
    offerAmount: Number(lead.offerAmount || 500),
    audit: lead.audit || {},
  };
}

function messageIdHeader(providerId: string): string {
  const id = providerId.trim();
  if (id.startsWith("<") && id.endsWith(">")) return id;
  return `<${id}>`;
}

export async function signUnsubscribeToken(
  secret: string,
  leadId: number,
  email: string
): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365;
  const payload = `${leadId}.${email.toLowerCase()}.${exp}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${payload}.${hex}`;
}

export async function verifyUnsubscribeToken(
  secret: string,
  token: string
): Promise<{ leadId: number; email: string } | null> {
  // Format: {leadId}.{email}.{exp}.{sig} — email may contain dots, so do not split on every ".".
  const lastDot = token.lastIndexOf(".");
  if (lastDot <= 0) return null;
  const sig = token.slice(lastDot + 1);
  const withoutSig = token.slice(0, lastDot);
  const expDot = withoutSig.lastIndexOf(".");
  if (expDot <= 0) return null;
  const expStr = withoutSig.slice(expDot + 1);
  const withoutExp = withoutSig.slice(0, expDot);
  const firstDot = withoutExp.indexOf(".");
  if (firstDot <= 0) return null;
  const idStr = withoutExp.slice(0, firstDot);
  const email = withoutExp.slice(firstDot + 1);

  const leadId = Number(idStr);
  const exp = Number(expStr);
  if (!Number.isInteger(leadId) || !email || !Number.isFinite(exp)) return null;
  if (Math.floor(Date.now() / 1000) > exp) return null;
  // signUnsubscribeToken embeds a fresh exp each call — rebuild payload from this token's exp.
  const payload = `${leadId}.${email.toLowerCase()}.${exp}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const raw = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  const hex = [...new Uint8Array(raw)].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (!constantTimeEqualHex(hex, sig)) return null;
  return { leadId, email: email.toLowerCase() };
}

export type SendLeadResult = {
  sent: boolean;
  dryRun: boolean;
  deferred: boolean;
  reasons: string[];
  messageId?: number;
};

export async function sendLeadOutreach(opts: {
  sql: Sql;
  env: Env;
  lead: Lead;
  settings: OutreachSettings;
  origin: string;
  /** Skip auto_send_disabled / paused / daily_cap. Does not affect dry_run. */
  force?: boolean;
  /**
   * Manual send from CLI/UI: like force, and also skips priority_below_threshold.
   * Never skips PECR, freemail, suppression, verified-email, or demo-ready.
   */
  manual?: boolean;
  /** Only flag that allows a live Resend send while settings.dryRun is true. */
  overrideDryRun?: boolean;
  templateId?: string;
}): Promise<SendLeadResult> {
  const { sql, env, lead, settings, origin, force, manual, overrideDryRun } = opts;
  const templateId = resolveTemplateId(lead.followupStep, opts.templateId);
  const todayCount = await countSentToday(sql);
  const dryRunFlag = Boolean(settings.dryRun) && !overrideDryRun;

  const postal = resolvePostalAddress(settings, env);
  if (!postal) {
    const reasons = ["postal_address_not_configured"];
    await setLeadReviewReasons(sql, lead.id, reasons);
    return { sent: false, dryRun: dryRunFlag, deferred: false, reasons };
  }

  let suppressedExtra = false;
  if (lead.contactEmail) suppressedExtra = await isSuppressed(sql, lead.contactEmail);

  const gateLead = leadGateInput(lead);
  if (suppressedExtra) gateLead.suppressed = true;

  // Follow-ups/final are already past the initial status gate
  if (templateId !== "initial") {
    gateLead.status = "queued";
  }

  const gate = canAutoSend(gateLead, settingsGateInput(settings), todayCount);

  const reviewBlockers = gate.reasons.filter(
    (r) => !["auto_send_disabled", "sending_paused", "dry_run", "daily_cap_reached"].includes(r)
  );

  if (!force && reviewBlockers.length > 0) {
    await setLeadReviewReasons(sql, lead.id, reviewBlockers);
    return { sent: false, dryRun: dryRunFlag, deferred: gate.deferred, reasons: gate.reasons };
  }

  if (
    !force &&
    (gate.reasons.includes("daily_cap_reached") ||
      gate.reasons.includes("sending_paused") ||
      gate.reasons.includes("auto_send_disabled"))
  ) {
    return { sent: false, dryRun: dryRunFlag, deferred: true, reasons: gate.reasons };
  }

  if (force || manual) {
    const hard = canAutoSend(
      gateLead,
      { ...settingsGateInput(settings), autoSendEnabled: true, dryRun: false, pausedUntil: null },
      0
    );
    const hardReview = manual
      ? filterManualHardReasons(hard.reasons)
      : hard.reasons.filter((r) => r !== "daily_cap_reached");
    if (hardReview.length > 0) {
      await setLeadReviewReasons(sql, lead.id, hardReview);
      return { sent: false, dryRun: dryRunFlag, deferred: false, reasons: hardReview };
    }
  }

  if (!lead.contactEmail) {
    return { sent: false, dryRun: dryRunFlag, deferred: false, reasons: ["missing_contact_email"] };
  }

  const from = (settings.fromAddress || env.OUTREACH_FROM || "").trim();
  if (!from) {
    const reasons = ["sending_identity_not_configured"];
    await setLeadReviewReasons(sql, lead.id, reasons);
    return { sent: false, dryRun: dryRunFlag, deferred: false, reasons };
  }
  if (isPrimarySendingDomain(from)) {
    if (!settings.allowPrimarySendingDomain) {
      const reasons = ["sending_domain_is_primary"];
      await setLeadReviewReasons(sql, lead.id, reasons);
      return { sent: false, dryRun: dryRunFlag, deferred: false, reasons };
    }
    console.warn(
      JSON.stringify({
        level: "warn",
        msg: "primary_sending_domain_allowed",
        leadId: lead.id,
        fromDomain: emailDomain(extractFromAddress(from)),
        hint: "allow_primary_sending_domain is enabled — cold outreach from portfolio domain",
      })
    );
  }

  const secret = env.UNSUBSCRIBE_SIGNING_KEY?.trim();
  if (!secret) {
    const reasons = ["unsubscribe_key_not_configured"];
    await setLeadReviewReasons(sql, lead.id, reasons);
    return { sent: false, dryRun: dryRunFlag, deferred: false, reasons };
  }

  const step = lead.followupStep;
  const token = await signUnsubscribeToken(secret, lead.id, lead.contactEmail);
  const unsubUrl = `${origin}/api/unsubscribe?token=${encodeURIComponent(token)}`;

  const generated = renderOutreachCopy({
    lead: toCopyLead(lead),
    postalAddress: postal,
    unsubscribeUrl: unsubUrl,
    templateId,
  });
  const rendered =
    templateId === "initial"
      ? applyCustomInitialCopy(
          generated,
          lead.customBody,
          lead.customSubject,
          postal,
          unsubUrl
        )
      : generated;
  const messageTemplateId = rendered.templateId;
  const subject = rendered.subject;
  const text = rendered.text;

  const idempotencyKey = await makeIdempotencyKey(lead.id, messageTemplateId, step);
  const existing = await getLeadMessageByIdempotency(sql, idempotencyKey);
  /** When set, persist via UPDATE in place (failed/queued retry) rather than INSERT. */
  let retryMessageId: number | null = null;
  if (existing) {
    const status = existing.status;
    const blocking = ["sent", "delivered", "bounced", "complained"].includes(status);
    if (blocking) {
      return {
        sent: status === "sent" || status === "delivered",
        dryRun: dryRunFlag,
        deferred: false,
        reasons: ["already_sent"],
        messageId: existing.id,
      };
    }
    if (status === "failed" || status === "queued") {
      if (existing.attempts >= MAX_MESSAGE_SEND_ATTEMPTS) {
        return {
          sent: false,
          dryRun: dryRunFlag,
          deferred: false,
          reasons: ["too_many_attempts"],
          messageId: existing.id,
        };
      }
      retryMessageId = existing.id;
    } else {
      return {
        sent: false,
        dryRun: dryRunFlag,
        deferred: false,
        reasons: ["already_sent"],
        messageId: existing.id,
      };
    }
  }

  const replyTo = settings.replyTo || env.OUTREACH_REPLY_TO || undefined;

  const threadHeaders: Record<string, string> = {
    "List-Unsubscribe": `<${unsubUrl}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
  if (templateId !== "initial") {
    const initialProviderId = await getInitialOutboundProviderId(sql, lead.id);
    if (initialProviderId) {
      const mid = messageIdHeader(initialProviderId);
      threadHeaders["In-Reply-To"] = mid;
      threadHeaders.References = mid;
    }
  }

  async function persistAuditOnInitial() {
    if (templateId !== "initial") return;
    const variant = rendered.variant ?? generated.variant;
    if (!variant) return;
    const audit = {
      ...lead.audit,
      outreach: {
        signal: rendered.signal,
        subjectVariant: variant,
        originalSubject: subject,
      },
    };
    await updateLead(sql, lead.id, { audit });
  }

  async function persistOutbound(input: {
    subject: string;
    body: string;
    templateId: string;
    variant: string | null | undefined;
    providerMessageId?: string | null;
    status: string;
    sentAt?: string | null;
    error?: string | null;
  }) {
    const payload = {
      subject: input.subject,
      body: input.body,
      templateId: input.templateId,
      variant: input.variant ?? null,
      providerMessageId: input.providerMessageId ?? null,
      status: input.status,
      sentAt: input.sentAt ?? null,
      error: input.error ?? null,
    };
    if (retryMessageId != null) {
      return updateLeadMessageAttempt(sql, retryMessageId, payload);
    }
    return insertLeadMessage(sql, {
      leadId: lead.id,
      direction: "out",
      channel: "email",
      idempotencyKey,
      ...payload,
    });
  }

  if (dryRunFlag) {
    await persistAuditOnInitial();
    const row = await persistOutbound({
      subject,
      body: text,
      templateId: messageTemplateId,
      variant: rendered.variant,
      status: "queued",
    });
    return {
      sent: false,
      dryRun: true,
      deferred: false,
      reasons: ["dry_run"],
      messageId: row.id,
    };
  }

  const result = await sendResendEmail({
    apiKey: env.RESEND_API_KEY,
    to: lead.contactEmail,
    from,
    replyTo,
    subject,
    text,
    headers: threadHeaders,
    disableTracking: true,
  });

  if (!result.sent) {
    const row = await persistOutbound({
      subject,
      body: text,
      templateId: messageTemplateId,
      variant: rendered.variant,
      status: "failed",
      error: result.reason ?? "send_failed",
    });
    return {
      sent: false,
      dryRun: false,
      deferred: false,
      reasons: [result.reason ?? "send_failed"],
      messageId: row.id,
    };
  }

  await persistAuditOnInitial();

  const row = await persistOutbound({
    subject,
    body: text,
    templateId: messageTemplateId,
    variant: rendered.variant,
    providerMessageId: result.id ?? null,
    status: "sent",
    sentAt: new Date().toISOString(),
    error: null,
  });

  const offsets = settings.followupOffsetsDays.length ? settings.followupOffsetsDays : [3, 7];
  const nextStep = step + 1;
  const sentAtIso = lead.sentAt || new Date().toISOString();
  const isFinal = templateId === "final";

  let nextFollowup: string | null = null;
  let status: string;
  if (isFinal) {
    status = "lost";
    nextFollowup = null;
  } else {
    // Absolute days since initial send: offsets[0]=3 → followup, offsets[1]=7 → final
    const absoluteDay = offsets[step];
    nextFollowup =
      absoluteDay != null ? absoluteFollowupAt(sentAtIso, absoluteDay) : null;
    status = step === 0 ? "sent" : "followed_up";
  }

  await opts.sql`
    UPDATE leads SET
      status = ${status},
      sent_at = COALESCE(sent_at, now()),
      last_touch_at = now(),
      followup_step = ${nextStep},
      next_followup_at = ${nextFollowup},
      review_reasons = '{}',
      updated_at = now()
    WHERE id = ${lead.id}
  `;

  if (nextFollowup && !isFinal) {
    const due = nextFollowup.slice(0, 10);
    await createLeadReminder(
      sql,
      lead.id,
      due,
      `Outreach ${nextStep === 1 ? "follow-up" : "final"} for ${lead.businessName}`
    );
  }

  return {
    sent: true,
    dryRun: false,
    deferred: false,
    reasons: [],
    messageId: Number(row.id),
  };
}

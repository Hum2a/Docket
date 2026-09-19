import type { Env } from "../schema";
import type { Sql } from "../db";
import type { Lead, OutreachSettings } from "../../shared/outreach";
import { sendResendEmail } from "../email";
import {
  extractFromAddress,
  isPrimarySendingDomain,
  makeIdempotencyKey,
  signUnsubscribeToken,
  type SendLeadResult,
} from "../outreach-send";
import { emailDomain } from "./canAutoSend";
import { canWarmSend, warmLaneWarnings } from "./canWarmSend";
import { unacknowledgedWarnings } from "../../shared/manualGate";
import { appendFooter, resolvePostalAddress } from "./copy";
import { warmFollowupAt } from "./warmQueue";
import {
  countWarmOutbound,
  getLeadById,
  getLeadMessageByIdempotency,
  getOutreachSettings,
  insertLeadMessage,
  isSuppressed,
  listDueWarmSends,
  setWarmSendAt,
  updateLeadMessageAttempt,
  MAX_MESSAGE_SEND_ATTEMPTS,
  getInitialOutboundProviderId,
} from "../outreach-db";
import { getSql } from "../db";

export const DEFAULT_PERSONAL_FROM = "Humza Butt <humza@humza-butt.space>";
export const DEFAULT_PERSONAL_REPLY_TO = "humza@humza-butt.space";

export function resolvePersonalFrom(env: Pick<Env, "OUTREACH_PERSONAL_FROM">): string {
  return (env.OUTREACH_PERSONAL_FROM || DEFAULT_PERSONAL_FROM).trim();
}

export function resolvePersonalReplyTo(env: Pick<Env, "OUTREACH_PERSONAL_REPLY_TO">): string {
  return (env.OUTREACH_PERSONAL_REPLY_TO || DEFAULT_PERSONAL_REPLY_TO).trim();
}

export async function warmGateExtras(
  sql: Sql,
  lead: Lead
): Promise<{ emailOrDomainSuppressed: boolean; warmOutboundCount: number }> {
  const emailOrDomainSuppressed = lead.consentEmail
    ? await isSuppressed(sql, lead.consentEmail)
    : false;
  const warmOutboundCount = await countWarmOutbound(sql, lead.id);
  return { emailOrDomainSuppressed, warmOutboundCount };
}

function messageIdHeader(providerId: string): string {
  const id = providerId.trim();
  if (id.startsWith("<") && id.endsWith(">")) return id;
  return `<${id}>`;
}

export function renderWarmCopy(opts: {
  lead: Lead;
  postalAddress: string;
  unsubscribeUrl: string;
  warmOutboundCount: number;
}): { subject: string; text: string; templateId: string } {
  const subject = (opts.lead.customSubject || "").trim();
  const body = (opts.lead.customBody || "").trim();
  const templateId = opts.warmOutboundCount >= 1 ? "warm_followup" : "warm_initial";
  return {
    subject,
    text: appendFooter(body, opts.postalAddress, opts.unsubscribeUrl),
    templateId,
  };
}

export async function sendWarmOutreach(opts: {
  sql: Sql;
  env: Env;
  lead: Lead;
  settings: OutreachSettings;
  origin: string;
  /** Only set by CLI --override-dry-run. Cron never sets this. */
  overrideDryRun?: boolean;
  acknowledgedWarnings?: string[];
  /** Cron draining a previously queued send — warnings were checked at queue time. */
  skipWarningAck?: boolean;
}): Promise<SendLeadResult> {
  const { sql, env, lead, settings, origin } = opts;
  const extras = await warmGateExtras(sql, lead);
  const gate = canWarmSend(lead, extras);
  if (!gate.ok) {
    return { sent: false, dryRun: false, deferred: false, reasons: gate.reasons };
  }
  const warnings = opts.skipWarningAck ? [] : warmLaneWarnings(lead);
  const unacked = unacknowledgedWarnings(warnings, opts.acknowledgedWarnings);
  if (unacked.length > 0) {
    return { sent: false, dryRun: false, deferred: false, reasons: unacked };
  }
  if (settings.dryRun && !opts.overrideDryRun) {
    return { sent: false, dryRun: true, deferred: true, reasons: ["dry_run"] };
  }

  const postal = resolvePostalAddress(settings, env);
  if (!postal) {
    return { sent: false, dryRun: false, deferred: false, reasons: ["postal_address_not_configured"] };
  }

  const from = resolvePersonalFrom(env);
  const replyTo = resolvePersonalReplyTo(env);
  if (isPrimarySendingDomain(from)) {
    console.warn(
      JSON.stringify({
        level: "warn",
        msg: "primary_domain_warm_send",
        leadId: lead.id,
        fromDomain: emailDomain(extractFromAddress(from)),
      })
    );
  }

  const secret = env.UNSUBSCRIBE_SIGNING_KEY?.trim();
  if (!secret) {
    return { sent: false, dryRun: false, deferred: false, reasons: ["unsubscribe_key_not_configured"] };
  }

  const to = lead.consentEmail!.trim();
  const token = await signUnsubscribeToken(secret, lead.id, to);
  const unsubUrl = `${origin}/api/unsubscribe?token=${encodeURIComponent(token)}`;
  const rendered = renderWarmCopy({
    lead,
    postalAddress: postal,
    unsubscribeUrl: unsubUrl,
    warmOutboundCount: extras.warmOutboundCount,
  });

  const step = extras.warmOutboundCount;
  const idempotencyKey = await makeIdempotencyKey(lead.id, rendered.templateId, step);
  const existing = await getLeadMessageByIdempotency(sql, idempotencyKey);
  let retryMessageId: number | null = null;
  if (existing) {
    const status = existing.status;
    if (["sent", "delivered", "bounced", "complained"].includes(status)) {
      return {
        sent: status === "sent" || status === "delivered",
        dryRun: false,
        deferred: false,
        reasons: ["already_sent"],
        messageId: existing.id,
      };
    }
    if (status === "failed" || status === "queued") {
      if (existing.attempts >= MAX_MESSAGE_SEND_ATTEMPTS) {
        return {
          sent: false,
          dryRun: false,
          deferred: false,
          reasons: ["too_many_attempts"],
          messageId: existing.id,
        };
      }
      retryMessageId = existing.id;
    }
  }

  const threadHeaders: Record<string, string> = {
    "List-Unsubscribe": `<${unsubUrl}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
  if (rendered.templateId === "warm_followup") {
    const initialProviderId = await getInitialOutboundProviderId(sql, lead.id);
    if (initialProviderId) {
      const mid = messageIdHeader(initialProviderId);
      threadHeaders["In-Reply-To"] = mid;
      threadHeaders.References = mid;
    }
  }

  async function persistOutbound(input: {
    status: string;
    providerMessageId?: string | null;
    sentAt?: string | null;
    error?: string | null;
  }) {
    const payload = {
      subject: rendered.subject,
      body: rendered.text,
      templateId: rendered.templateId,
      variant: null as string | null,
      providerMessageId: input.providerMessageId ?? null,
      status: input.status,
      sentAt: input.sentAt ?? null,
      error: input.error ?? null,
      acknowledgedWarnings: opts.acknowledgedWarnings ?? [],
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

  const result = await sendResendEmail({
    apiKey: env.RESEND_API_KEY,
    to,
    from,
    replyTo,
    subject: rendered.subject,
    text: rendered.text,
    headers: threadHeaders,
    disableTracking: true,
  });

  if (!result.sent) {
    const row = await persistOutbound({
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

  const row = await persistOutbound({
    status: "sent",
    providerMessageId: result.id ?? null,
    sentAt: new Date().toISOString(),
    error: null,
  });

  const isFollowup = extras.warmOutboundCount >= 1;
  const nextFollowup = isFollowup ? null : warmFollowupAt();
  const nextStep = lead.followupStep + 1;
  await sql`
    UPDATE leads SET
      status = ${isFollowup ? "followed_up" : "sent"},
      sent_at = COALESCE(sent_at, now()),
      last_touch_at = now(),
      followup_step = ${nextStep},
      next_followup_at = ${nextFollowup},
      warm_send_at = NULL,
      review_reasons = '{}',
      updated_at = now()
    WHERE id = ${lead.id}
  `;

  return {
    sent: true,
    dryRun: false,
    deferred: false,
    reasons: [],
    messageId: Number(row.id),
  };
}

export async function runQueuedWarmSends(env: Env, origin: string): Promise<void> {
  const sql = getSql(env.DATABASE_URL);
  const settings = await getOutreachSettings(sql);
  if (settings.dryRun) return;
  const due = await listDueWarmSends(sql);
  for (const lead of due) {
    const extras = await warmGateExtras(sql, lead);
    const gate = canWarmSend(lead, extras);
    if (!gate.ok) continue;
    const fresh = (await getLeadById(sql, lead.id)) ?? lead;
    await sendWarmOutreach({ sql, env, lead: fresh, settings, origin, skipWarningAck: true });
  }
}

export { setWarmSendAt };

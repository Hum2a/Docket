import type { Env } from "./schema";
import type { Sql } from "./db";
import type { Lead, OutreachSettings } from "../shared/outreach";
import {
  countSentToday,
  createLeadReminder,
  getLeadMessageByIdempotency,
  insertLeadMessage,
  isSuppressed,
  leadGateInput,
  setLeadReviewReasons,
  settingsGateInput,
  updateLead,
} from "./outreach-db";
import { canAutoSend } from "./outreach/canAutoSend";
import { sendResendEmail } from "./email";
import { escapeHtml } from "./email";

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

function renderOutreachEmail(lead: Lead, settings: OutreachSettings, step: number) {
  const subject =
    step === 0
      ? `A fresh site idea for ${lead.businessName}`
      : `Quick follow-up — ${lead.businessName}`;
  const unsubHint = "You can unsubscribe using the link below.";
  const postal = settings.postalAddress || "Postal address not configured";
  const html = `
    <div style="font-family:system-ui,sans-serif;color:#1a2332;max-width:560px;margin:0 auto">
      <p>Hi${lead.contactName ? ` ${escapeHtml(lead.contactName)}` : ""},</p>
      <p>I put together a quick demo for <strong>${escapeHtml(lead.businessName)}</strong>${
        lead.scoreReason ? ` — ${escapeHtml(lead.scoreReason)}` : ""
      }.</p>
      ${
        lead.demoUrl
          ? `<p><a href="${escapeHtml(lead.demoUrl)}" style="color:#0f6e56">Preview the demo</a></p>`
          : ""
      }
      <p>If useful, I build and launch a clean site for a flat £${Number(lead.offerAmount || 500)}.</p>
      <hr style="border:none;border-top:1px solid #d5dde8;margin:24px 0" />
      <p style="font-size:12px;color:#5a6578">
        ${escapeHtml(postal)}<br/>
        ${escapeHtml(unsubHint)}
        · <a href="{{UNSUBSCRIBE_URL}}" style="color:#0f6e56">Unsubscribe</a>
      </p>
    </div>
  `;
  const text = `Hi${lead.contactName ? ` ${lead.contactName}` : ""},\n\nDemo for ${lead.businessName}${
    lead.demoUrl ? `: ${lead.demoUrl}` : ""
  }\n\nFlat £${lead.offerAmount || 500}.\n\n${postal}\nUnsubscribe: {{UNSUBSCRIBE_URL}}\n`;
  return { subject, html, text };
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
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [idStr, email, expStr, sig] = parts;
  const leadId = Number(idStr);
  const exp = Number(expStr);
  if (!Number.isInteger(leadId) || !email || !Number.isFinite(exp)) return null;
  if (Math.floor(Date.now() / 1000) > exp) return null;
  const expected = await signUnsubscribeToken(secret, leadId, email);
  // compare only signature portion by re-signing same payload
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
  if (hex !== sig) return null;
  void expected;
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
  force?: boolean;
  templateId?: string;
}): Promise<SendLeadResult> {
  const { sql, env, lead, settings, origin, force } = opts;
  const templateId = opts.templateId ?? (lead.followupStep === 0 ? "initial" : `followup_${lead.followupStep}`);
  const todayCount = await countSentToday(sql);

  let suppressedExtra = false;
  if (lead.contactEmail) suppressedExtra = await isSuppressed(sql, lead.contactEmail);

  const gateLead = leadGateInput(lead);
  if (suppressedExtra) gateLead.suppressed = true;

  const gate = canAutoSend(gateLead, settingsGateInput(settings), todayCount);

  // Manual "Send now" / Approve can bypass auto_send_disabled + dry_run operational flags
  // but never PECR / suppression / demo / email rules unless force is only for approve path.
  const reviewBlockers = gate.reasons.filter(
    (r) => !["auto_send_disabled", "sending_paused", "dry_run", "daily_cap_reached"].includes(r)
  );

  if (!force && reviewBlockers.length > 0) {
    await setLeadReviewReasons(sql, lead.id, reviewBlockers);
    return { sent: false, dryRun: settings.dryRun, deferred: gate.deferred, reasons: gate.reasons };
  }

  if (!force && (gate.reasons.includes("daily_cap_reached") || gate.reasons.includes("sending_paused"))) {
    return { sent: false, dryRun: settings.dryRun, deferred: true, reasons: gate.reasons };
  }

  // Still enforce hard PECR / suppression even when force (approve) — only skip auto_send/dry_run/cap deferrals
  if (force) {
    const hard = canAutoSend(
      gateLead,
      { ...settingsGateInput(settings), autoSendEnabled: true, dryRun: false, pausedUntil: null },
      0
    );
    const hardReview = hard.reasons.filter((r) => r !== "daily_cap_reached");
    if (hardReview.length > 0) {
      await setLeadReviewReasons(sql, lead.id, hardReview);
      return { sent: false, dryRun: settings.dryRun, deferred: false, reasons: hardReview };
    }
  }

  if (!lead.contactEmail) {
    return { sent: false, dryRun: settings.dryRun, deferred: false, reasons: ["missing_contact_email"] };
  }

  const step = lead.followupStep;
  const idempotencyKey = await makeIdempotencyKey(lead.id, templateId, step);
  const existing = await getLeadMessageByIdempotency(sql, idempotencyKey);
  if (existing) {
    return {
      sent: existing.status === "sent" || existing.status === "delivered",
      dryRun: settings.dryRun,
      deferred: false,
      reasons: ["idempotent_replay"],
      messageId: Number(existing.id),
    };
  }

  const secret = env.UNSUBSCRIBE_SIGNING_KEY || env.API_KEY;
  const token = await signUnsubscribeToken(secret, lead.id, lead.contactEmail);
  const unsubUrl = `${origin}/api/unsubscribe?token=${encodeURIComponent(token)}`;
  const rendered = renderOutreachEmail(lead, settings, step);
  const html = rendered.html.replaceAll("{{UNSUBSCRIBE_URL}}", unsubUrl);
  const text = rendered.text.replaceAll("{{UNSUBSCRIBE_URL}}", unsubUrl);

  const from =
    settings.fromAddress ||
    env.OUTREACH_FROM ||
    "Outreach <outreach@mail.humza-butt.space>";
  const replyTo = settings.replyTo || env.OUTREACH_REPLY_TO || undefined;

  const dryRun = force ? false : settings.dryRun;
  if (dryRun) {
    const row = await insertLeadMessage(sql, {
      leadId: lead.id,
      direction: "out",
      channel: "email",
      subject: rendered.subject,
      body: text,
      templateId,
      idempotencyKey,
      status: "queued",
    });
    return {
      sent: false,
      dryRun: true,
      deferred: false,
      reasons: ["dry_run"],
      messageId: Number(row.id),
    };
  }

  const result = await sendResendEmail({
    apiKey: env.RESEND_API_KEY,
    to: lead.contactEmail,
    from,
    replyTo,
    subject: rendered.subject,
    html,
    text,
    headers: {
      "List-Unsubscribe": `<${unsubUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  });

  if (!result.sent) {
    const row = await insertLeadMessage(sql, {
      leadId: lead.id,
      direction: "out",
      channel: "email",
      subject: rendered.subject,
      body: text,
      templateId,
      idempotencyKey,
      status: "failed",
      error: result.reason ?? "send_failed",
    });
    return {
      sent: false,
      dryRun: false,
      deferred: false,
      reasons: [result.reason ?? "send_failed"],
      messageId: Number(row.id),
    };
  }

  const row = await insertLeadMessage(sql, {
    leadId: lead.id,
    direction: "out",
    channel: "email",
    subject: rendered.subject,
    body: text,
    templateId,
    idempotencyKey,
    status: "sent",
    sentAt: new Date().toISOString(),
  });

  const offsets = settings.followupOffsetsDays.length ? settings.followupOffsetsDays : [3, 7];
  const nextStep = step + 1;
  const nextOffset = offsets[step];
  const nextFollowup =
    nextOffset != null
      ? new Date(Date.now() + nextOffset * 24 * 60 * 60 * 1000).toISOString()
      : null;

  await opts.sql`
    UPDATE leads SET
      status = ${step === 0 ? "sent" : "followed_up"},
      sent_at = COALESCE(sent_at, now()),
      last_touch_at = now(),
      followup_step = ${nextStep},
      next_followup_at = ${nextFollowup},
      review_reasons = '{}',
      updated_at = now()
    WHERE id = ${lead.id}
  `;

  if (nextFollowup) {
    const due = nextFollowup.slice(0, 10);
    await createLeadReminder(
      sql,
      lead.id,
      due,
      `Outreach follow-up step ${nextStep} for ${lead.businessName}`
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


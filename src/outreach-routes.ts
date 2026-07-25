import { Hono } from "hono";
import type { Context, Next } from "hono";
import { getSql } from "./db";
import type { Env } from "./schema";
import {
  bulkLeadsSchema,
  createLeadSchema,
  updateLeadSchema,
  slugifyName,
} from "../shared/outreach";
import { createNoteSchema, createReminderSchema } from "./schema";
import {
  addSuppression,
  bulkUpsertLeads,
  cancelLeadFollowupReminders,
  countSentToday,
  createLead,
  createLeadNote,
  createLeadReminder,
  deleteLead,
  deleteLeadNote,
  deleteLeadReminder,
  findLeadByEmail,
  getLeadById,
  getLeadStats,
  getOutreachSettings,
  insertLeadMessage,
  listLeadMessages,
  listLeadNotes,
  listLeadReminders,
  listLeads,
  listLeadsPage,
  setLeadReminderCompleted,
  updateLead,
  updateOutreachSettings,
} from "./outreach-db";
import { sendLeadOutreach, verifyUnsubscribeToken } from "./outreach-send";
import { resolveNotifyRecipients } from "./db";
import { DEFAULT_FROM, sendResendEmail } from "./email";
import { bareDomain } from "./outreach/copy";
import { emailDomain } from "./outreach/canAutoSend";
import { buildOutreachPreflight } from "./outreach/preflight";

type AppContext = { Bindings: Env };

async function requireApiKey(c: Context<AppContext>, next: Next) {
  const key = c.req.header("X-Api-Key");
  if (!key || key !== c.env.API_KEY) {
    return c.json({ error: "unauthorized: missing or invalid X-Api-Key header" }, 401);
  }
  await next();
}

export const outreachApp = new Hono<AppContext>();

outreachApp.get("/api/leads", async (c) => {
  const sql = getSql(c.env.DATABASE_URL);
  const corporate =
    c.req.query("corporate_only") === "true" ||
    c.req.query("corporate_only") === "1" ||
    c.req.query("corporate") === "1" ||
    c.req.query("corporate") === "true";
  const page = await listLeadsPage(sql, {
    status: c.req.query("status") || undefined,
    industry: c.req.query("industry") || undefined,
    minPriority: c.req.query("min_priority") ? Number(c.req.query("min_priority")) : undefined,
    corporateOnly: corporate,
    limit: c.req.query("limit") ? Number(c.req.query("limit")) : 50,
    cursor: c.req.query("cursor") || undefined,
  });
  return c.json(page);
});

outreachApp.get("/api/leads/stats", async (c) => {
  const sql = getSql(c.env.DATABASE_URL);
  return c.json(await getLeadStats(sql));
});

outreachApp.get("/api/leads/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "id must be an integer" }, 400);
  const sql = getSql(c.env.DATABASE_URL);
  const lead = await getLeadById(sql, id);
  if (!lead) return c.json({ error: "not found" }, 404);
  return c.json(lead);
});

outreachApp.post("/api/leads", requireApiKey, async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "body must be valid JSON" }, 400);
  }
  const parsed = createLeadSchema.safeParse({
    ...(body as object),
    slug:
      (body as { slug?: string }).slug ||
      slugifyName((body as { businessName?: string }).businessName || "lead"),
  });
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  const sql = getSql(c.env.DATABASE_URL);
  const lead = await createLead(sql, parsed.data);
  return c.json(lead, 201);
});

outreachApp.post("/api/leads/bulk", requireApiKey, async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "body must be valid JSON" }, 400);
  }
  const parsed = bulkLeadsSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  const sql = getSql(c.env.DATABASE_URL);
  const normalized = parsed.data.leads.map((l) => ({
    ...l,
    slug: l.slug || slugifyName(l.businessName),
  }));
  const result = await bulkUpsertLeads(sql, normalized);
  return c.json(result, 201);
});

outreachApp.patch("/api/leads/:id", requireApiKey, async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "id must be an integer" }, 400);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "body must be valid JSON" }, 400);
  }
  const parsed = updateLeadSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  const sql = getSql(c.env.DATABASE_URL);
  try {
    const lead = await updateLead(sql, id, parsed.data);
    if (!lead) return c.json({ error: "not found" }, 404);
    return c.json(lead);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(JSON.stringify({ msg: "patch_lead_failed", id, message }));
    return c.json({ error: "update_failed", message }, 500);
  }
});

outreachApp.delete("/api/leads/:id", requireApiKey, async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "id must be an integer" }, 400);
  const sql = getSql(c.env.DATABASE_URL);
  const ok = await deleteLead(sql, id);
  if (!ok) return c.json({ error: "not found" }, 404);
  return c.json({ ok: true });
});

outreachApp.get("/api/leads/:id/notes", async (c) => {
  const id = Number(c.req.param("id"));
  const sql = getSql(c.env.DATABASE_URL);
  return c.json(await listLeadNotes(sql, id));
});

outreachApp.post("/api/leads/:id/notes", requireApiKey, async (c) => {
  const id = Number(c.req.param("id"));
  const body = createNoteSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ error: body.error.flatten() }, 400);
  const sql = getSql(c.env.DATABASE_URL);
  if (!(await getLeadById(sql, id))) return c.json({ error: "not found" }, 404);
  return c.json(await createLeadNote(sql, id, body.data.body), 201);
});

outreachApp.delete("/api/lead-notes/:id", requireApiKey, async (c) => {
  const id = Number(c.req.param("id"));
  const sql = getSql(c.env.DATABASE_URL);
  if (!(await deleteLeadNote(sql, id))) return c.json({ error: "not found" }, 404);
  return c.json({ ok: true });
});

outreachApp.get("/api/leads/:id/reminders", async (c) => {
  const id = Number(c.req.param("id"));
  const sql = getSql(c.env.DATABASE_URL);
  return c.json(await listLeadReminders(sql, id));
});

outreachApp.post("/api/leads/:id/reminders", requireApiKey, async (c) => {
  const id = Number(c.req.param("id"));
  const body = createReminderSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ error: body.error.flatten() }, 400);
  const sql = getSql(c.env.DATABASE_URL);
  if (!(await getLeadById(sql, id))) return c.json({ error: "not found" }, 404);
  return c.json(await createLeadReminder(sql, id, body.data.dueDate, body.data.message), 201);
});

outreachApp.patch("/api/lead-reminders/:id", requireApiKey, async (c) => {
  const id = Number(c.req.param("id"));
  const body = (await c.req.json()) as { completed?: boolean };
  if (typeof body.completed !== "boolean") return c.json({ error: "completed boolean required" }, 400);
  const sql = getSql(c.env.DATABASE_URL);
  const rem = await setLeadReminderCompleted(sql, id, body.completed);
  if (!rem) return c.json({ error: "not found" }, 404);
  return c.json(rem);
});

outreachApp.delete("/api/lead-reminders/:id", requireApiKey, async (c) => {
  const id = Number(c.req.param("id"));
  const sql = getSql(c.env.DATABASE_URL);
  if (!(await deleteLeadReminder(sql, id))) return c.json({ error: "not found" }, 404);
  return c.json({ ok: true });
});

outreachApp.get("/api/leads/:id/messages", async (c) => {
  const id = Number(c.req.param("id"));
  const sql = getSql(c.env.DATABASE_URL);
  return c.json(await listLeadMessages(sql, id));
});

outreachApp.post("/api/leads/:id/send", requireApiKey, async (c) => {
  const id = Number(c.req.param("id"));
  const sql = getSql(c.env.DATABASE_URL);
  const lead = await getLeadById(sql, id);
  if (!lead) return c.json({ error: "not found" }, 404);
  const settings = await getOutreachSettings(sql);
  const origin = new URL(c.req.url).origin;
  const result = await sendLeadOutreach({ sql, env: c.env, lead, settings, origin, force: true });
  return c.json(result);
});

outreachApp.post("/api/leads/:id/approve", requireApiKey, async (c) => {
  const id = Number(c.req.param("id"));
  const sql = getSql(c.env.DATABASE_URL);
  const lead = await updateLead(sql, id, { status: "queued" });
  if (!lead) return c.json({ error: "not found" }, 404);
  await sql`UPDATE leads SET review_reasons = '{}', updated_at = now() WHERE id = ${id}`;
  const settings = await getOutreachSettings(sql);
  const origin = new URL(c.req.url).origin;
  const fresh = await getLeadById(sql, id);
  const result = await sendLeadOutreach({
    sql,
    env: c.env,
    lead: fresh!,
    settings,
    origin,
    force: true,
  });
  return c.json({ approved: true, ...result });
});

outreachApp.get("/api/outreach/settings", async (c) => {
  const sql = getSql(c.env.DATABASE_URL);
  const settings = await getOutreachSettings(sql);
  const sentToday = await countSentToday(sql);
  return c.json({ ...settings, sentToday });
});

outreachApp.get("/api/outreach/preflight", async (c) => {
  const sql = getSql(c.env.DATABASE_URL);
  const settings = await getOutreachSettings(sql);
  return c.json(buildOutreachPreflight(settings, c.env));
});

outreachApp.patch("/api/outreach/settings", requireApiKey, async (c) => {
  const body = (await c.req.json()) as Record<string, unknown>;
  const sql = getSql(c.env.DATABASE_URL);
  const patch: Parameters<typeof updateOutreachSettings>[1] = {};
  if (typeof body.autoSendEnabled === "boolean") patch.autoSendEnabled = body.autoSendEnabled;
  if (typeof body.dryRun === "boolean") patch.dryRun = body.dryRun;
  if (typeof body.allowPrimarySendingDomain === "boolean") {
    patch.allowPrimarySendingDomain = body.allowPrimarySendingDomain;
  }
  if (typeof body.autoSendThreshold === "number") patch.autoSendThreshold = body.autoSendThreshold;
  if (typeof body.dailySendCap === "number") patch.dailySendCap = body.dailySendCap;
  if ("sendingDomain" in body) patch.sendingDomain = (body.sendingDomain as string) || null;
  if ("fromAddress" in body) patch.fromAddress = (body.fromAddress as string) || null;
  if ("replyTo" in body) patch.replyTo = (body.replyTo as string) || null;
  if ("postalAddress" in body) patch.postalAddress = (body.postalAddress as string) || null;
  if (Array.isArray(body.followupOffsetsDays)) {
    patch.followupOffsetsDays = body.followupOffsetsDays.map(Number);
  }
  if (body.pause === true) {
    patch.pausedUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  }
  if (body.pause === false) patch.pausedUntil = null;
  if ("pausedUntil" in body) patch.pausedUntil = (body.pausedUntil as string) || null;

  const settings = await updateOutreachSettings(sql, patch);
  const sentToday = await countSentToday(sql);
  return c.json({ ...settings, sentToday });
});

outreachApp.get("/api/outreach/export.csv", async (c) => {
  const sql = getSql(c.env.DATABASE_URL);
  const leads = await listLeads(sql, {
    status: c.req.query("status") || undefined,
    industry: c.req.query("industry") || undefined,
    minPriority: c.req.query("min_priority") ? Number(c.req.query("min_priority")) : undefined,
    corporateOnly: c.req.query("corporate") === "1",
  });
  const header =
    "name,contact,industry,location,need score,likelihood score,priority score,demo URL,outreach status,follow-up date";
  const lines = leads.map((l) => {
    const contact = l.contactEmail || l.contactPhone || "form only";
    const cells = [
      l.businessName,
      contact,
      l.industry ?? "",
      l.location ?? "",
      l.needScore ?? "",
      l.likelihoodScore ?? "",
      l.priorityScore ?? "",
      l.demoUrl ?? "",
      l.status,
      l.nextFollowupAt?.slice(0, 10) ?? "",
    ].map((v) => `"${String(v).replaceAll('"', '""')}"`);
    return cells.join(",");
  });
  return new Response([header, ...lines].join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="outreach-leads.csv"',
    },
  });
});

outreachApp.post("/api/suppressions", requireApiKey, async (c) => {
  const body = (await c.req.json()) as { value?: string; kind?: string; reason?: string };
  if (!body.value || (body.kind !== "email" && body.kind !== "domain")) {
    return c.json({ error: "value and kind (email|domain) required" }, 400);
  }
  const sql = getSql(c.env.DATABASE_URL);
  await addSuppression(sql, body.value, body.kind, body.reason);
  return c.json({ ok: true }, 201);
});

outreachApp.post("/api/outreach/autosend", requireApiKey, async (c) => {
  const sql = getSql(c.env.DATABASE_URL);
  const settings = await getOutreachSettings(sql);
  const origin = new URL(c.req.url).origin;
  const leads = await listLeads(sql, { limit: 500 });
  const candidates = leads
    .filter((l) => l.status === "demo_ready" || l.status === "queued")
    .sort((a, b) => (b.priorityScore ?? 0) - (a.priorityScore ?? 0));

  const results = [];
  for (const lead of candidates) {
    const sentToday = await countSentToday(sql);
    if (sentToday >= settings.dailySendCap) break;
    const r = await sendLeadOutreach({ sql, env: c.env, lead, settings, origin, force: false });
    results.push({ id: lead.id, ...r });
  }
  return c.json({ processed: results.length, results });
});

outreachApp.post("/api/outreach/sequence", requireApiKey, async (c) => {
  const sql = getSql(c.env.DATABASE_URL);
  const settings = await getOutreachSettings(sql);
  const origin = new URL(c.req.url).origin;
  const leads = await listLeads(sql, { limit: 500 });
  const due = leads.filter(
    (l) =>
      (l.status === "sent" || l.status === "followed_up") &&
      l.nextFollowupAt &&
      new Date(l.nextFollowupAt) <= new Date()
  );

  const results = [];
  for (const lead of due) {
    const offsets = settings.followupOffsetsDays.length
      ? settings.followupOffsetsDays
      : [3, 7];
    // followupStep 1 → first FU, 2 → final; past that → lost
    if (lead.followupStep > offsets.length) {
      await updateLead(sql, lead.id, { status: "lost" });
      await sql`UPDATE leads SET next_followup_at = NULL WHERE id = ${lead.id}`;
      results.push({ id: lead.id, status: "lost" });
      continue;
    }
    const templateId = lead.followupStep >= offsets.length ? "final" : "followup";
    const r = await sendLeadOutreach({
      sql,
      env: c.env,
      lead,
      settings,
      origin,
      force: false,
      templateId,
    });
    results.push({ id: lead.id, ...r });
  }
  return c.json({ processed: results.length, results });
});

outreachApp.get("/api/unsubscribe", async (c) => {
  const token = c.req.query("token");
  if (!token) return c.json({ error: "token required" }, 400);
  const secret = c.env.UNSUBSCRIBE_SIGNING_KEY || c.env.API_KEY;
  const verified = await verifyUnsubscribeToken(secret, token);
  if (!verified) return c.json({ error: "invalid token" }, 401);
  const sql = getSql(c.env.DATABASE_URL);
  await addSuppression(sql, verified.email, "email", "unsubscribe_link");
  await sql`
    UPDATE leads SET suppressed = true, suppression_reason = 'unsubscribe',
      status = 'unsubscribed', next_followup_at = NULL, updated_at = now()
    WHERE id = ${verified.leadId}
  `;
  await cancelLeadFollowupReminders(sql, verified.leadId);
  return c.html(
    `<html><body style="font-family:system-ui;padding:2rem"><h1>Unsubscribed</h1><p>You will not receive further outreach emails.</p></body></html>`
  );
});

outreachApp.post("/api/unsubscribe", async (c) => {
  const token =
    c.req.query("token") ||
    (await c.req.parseBody().then((b) => String(b.token || b["List-Unsubscribe"] || "")).catch(() => ""));
  if (!token) return c.json({ error: "token required" }, 400);
  const secret = c.env.UNSUBSCRIBE_SIGNING_KEY || c.env.API_KEY;
  const verified = await verifyUnsubscribeToken(secret, token);
  if (!verified) return c.json({ error: "invalid token" }, 401);
  const sql = getSql(c.env.DATABASE_URL);
  await addSuppression(sql, verified.email, "email", "list_unsubscribe_post");
  await sql`
    UPDATE leads SET suppressed = true, suppression_reason = 'unsubscribe',
      status = 'unsubscribed', next_followup_at = NULL, updated_at = now()
    WHERE id = ${verified.leadId}
  `;
  await cancelLeadFollowupReminders(sql, verified.leadId);
  return c.json({ ok: true });
});

outreachApp.post("/api/webhooks/resend", async (c) => {
  // Delivery events — best-effort update by provider id; signature optional for v1
  const body = (await c.req.json().catch(() => null)) as {
    type?: string;
    data?: { email_id?: string; created_at?: string };
  } | null;
  if (!body?.data?.email_id) return c.json({ ok: true });
  const sql = getSql(c.env.DATABASE_URL);
  const type = body.type || "";
  if (type.includes("delivered")) {
    await sql`
      UPDATE lead_messages SET status = 'delivered', delivered_at = now()
      WHERE provider_message_id = ${body.data.email_id}
    `;
  } else if (type.includes("bounced")) {
    await sql`
      UPDATE lead_messages SET status = 'bounced' WHERE provider_message_id = ${body.data.email_id}
    `;
  } else if (type.includes("complained")) {
    await sql`
      UPDATE lead_messages SET status = 'complained' WHERE provider_message_id = ${body.data.email_id}
    `;
  }
  return c.json({ ok: true });
});

outreachApp.post("/api/webhooks/inbound", async (c) => {
  const secret = c.env.RESEND_INBOUND_SECRET;
  if (secret) {
    const hdr = c.req.header("X-Resend-Secret") || c.req.header("Authorization");
    if (hdr !== secret && hdr !== `Bearer ${secret}`) {
      return c.json({ error: "unauthorized" }, 401);
    }
  }
  const body = (await c.req.json()) as {
    from?: string;
    subject?: string;
    text?: string;
    html?: string;
  };
  const from = (body.from || "").replace(/.*<([^>]+)>.*/, "$1").trim().toLowerCase();
  if (!from) return c.json({ error: "from required" }, 400);
  const sql = getSql(c.env.DATABASE_URL);
  const lead = await findLeadByEmail(sql, from);
  if (!lead) return c.json({ ok: true, matched: false });

  const text = body.text || body.html || "";
  const lower = text.toLowerCase();
  let sentiment: string = "neutral";
  if (/unsubscribe|remove me|stop emailing/.test(lower)) sentiment = "unsubscribe";
  else if (/out of office|ooo|away from/.test(lower)) sentiment = "ooo";
  else if (/not interested|no thanks|don't contact/.test(lower)) sentiment = "negative";
  else if (/interested|sounds good|let'?s talk|call me|pricing/.test(lower)) sentiment = "positive";

  await insertLeadMessage(sql, {
    leadId: lead.id,
    direction: "in",
    channel: "email",
    subject: body.subject ?? null,
    body: text,
    status: "delivered",
  });

  if (sentiment === "unsubscribe") {
    await addSuppression(sql, from, "email", "inbound_unsubscribe");
    const domain = bareDomain(lead.websiteUrl) || emailDomain(from);
    if (domain) await addSuppression(sql, domain, "domain", "inbound_unsubscribe");
    await sql`
      UPDATE leads SET status = 'unsubscribed', suppressed = true,
        suppression_reason = 'inbound_unsubscribe', replied_at = now(),
        reply_sentiment = ${sentiment}, next_followup_at = NULL, updated_at = now()
      WHERE id = ${lead.id}
    `;
  } else if (sentiment === "negative") {
    await addSuppression(sql, from, "email", "negative_reply");
    const domain = bareDomain(lead.websiteUrl) || emailDomain(from);
    if (domain) await addSuppression(sql, domain, "domain", "negative_reply");
    await sql`
      UPDATE leads SET status = 'not_interested', suppressed = true,
        suppression_reason = 'negative_reply', replied_at = now(),
        reply_sentiment = ${sentiment}, next_followup_at = NULL, updated_at = now()
      WHERE id = ${lead.id}
    `;
  } else {
    await sql`
      UPDATE leads SET status = 'replied', replied_at = now(),
        reply_sentiment = ${sentiment}, next_followup_at = NULL, updated_at = now()
      WHERE id = ${lead.id}
    `;
  }
  await cancelLeadFollowupReminders(sql, lead.id);

  const recipients = await resolveNotifyRecipients(sql, c.env.DIGEST_TO);
  if (c.env.RESEND_API_KEY && recipients.length) {
    await sendResendEmail({
      apiKey: c.env.RESEND_API_KEY,
      to: recipients,
      from: c.env.DIGEST_FROM || DEFAULT_FROM,
      subject: `Docket Outreach: reply from ${lead.businessName}`,
      html: `<p><strong>${lead.businessName}</strong> replied (${sentiment}).</p><pre>${text.slice(0, 2000)}</pre>`,
      text: `${lead.businessName} replied (${sentiment})\n\n${text.slice(0, 2000)}`,
    });
  }

  return c.json({ ok: true, matched: true, leadId: lead.id, sentiment });
});

export async function runOutreachAutosend(env: Env, origin: string) {
  const sql = getSql(env.DATABASE_URL);
  const settings = await getOutreachSettings(sql);
  const leads = await listLeads(sql, { limit: 500 });
  const candidates = leads
    .filter((l) => l.status === "demo_ready" || l.status === "queued")
    .sort((a, b) => (b.priorityScore ?? 0) - (a.priorityScore ?? 0));
  for (const lead of candidates) {
    const sentToday = await countSentToday(sql);
    if (sentToday >= settings.dailySendCap) break;
    await sendLeadOutreach({ sql, env, lead, settings, origin, force: false });
  }
}

export async function runOutreachSequence(env: Env, origin: string) {
  const sql = getSql(env.DATABASE_URL);
  const settings = await getOutreachSettings(sql);
  const leads = await listLeads(sql, { limit: 500 });
  const due = leads.filter(
    (l) =>
      (l.status === "sent" || l.status === "followed_up") &&
      l.nextFollowupAt &&
      new Date(l.nextFollowupAt) <= new Date()
  );
  for (const lead of due) {
    const offsets = settings.followupOffsetsDays.length
      ? settings.followupOffsetsDays
      : [3, 7];
    if (lead.followupStep > offsets.length) {
      await updateLead(sql, lead.id, { status: "lost" });
      await sql`UPDATE leads SET next_followup_at = NULL WHERE id = ${lead.id}`;
      continue;
    }
    const templateId = lead.followupStep >= offsets.length ? "final" : "followup";
    await sendLeadOutreach({
      sql,
      env,
      lead,
      settings,
      origin,
      force: false,
      templateId,
    });
  }
}

import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Context, Next } from "hono";
import {
  getSql,
  listApplications,
  getApplicationById,
  createApplication,
  updateApplication,
  deleteApplication,
  listNotes,
  createNote,
  deleteNote,
  listReminders,
  createReminder,
  setReminderCompleted,
  deleteReminder,
  listDocuments,
  getDocumentById,
  createDocument,
  deleteDocument,
  getStats,
  getSetting,
  setSetting,
  SETTING_NOTIFY_TO,
  resolveNotifyRecipients,
} from "./db";
import {
  createApplicationSchema,
  updateApplicationSchema,
  createNoteSchema,
  createReminderSchema,
  importPayloadSchema,
  documentTypeSchema,
  type Env,
} from "./schema";
import { createDownloadToken, verifyDownloadToken } from "./signed-url";
import { runDigest } from "./digest";
import {
  notifyApplicationCreated,
  notifyStatusChanged,
  sendTestEventEmail,
} from "./notify";
import { DEFAULT_FROM, parseEmailList } from "./email";
import {
  outreachApp,
  runOutreachAutosend,
  runOutreachSequence,
} from "./outreach-routes";

type AppContext = { Bindings: Env };

const app = new Hono<AppContext>();

function background(c: Context<AppContext>, task: Promise<unknown>) {
  const safe = task.catch((err) => {
    console.error("background task failed", err);
  });
  try {
    c.executionCtx.waitUntil(safe);
  } catch {
    void safe;
  }
}

app.use("/api/*", cors());
app.route("/", outreachApp);

async function requireApiKey(c: Context<AppContext>, next: Next) {
  const key = c.req.header("X-Api-Key");
  if (!key || key !== c.env.API_KEY) {
    return c.json({ error: "unauthorized: missing or invalid X-Api-Key header" }, 401);
  }
  await next();
}

app.get("/api/health", async (c) => {
  try {
    const sql = getSql(c.env.DATABASE_URL);
    await sql`SELECT 1`;
    return c.json({ ok: true, db: "connected" });
  } catch (err) {
    return c.json({ ok: false, db: "error", message: String(err) }, 500);
  }
});

// ── Applications ──────────────────────────────────────────────

app.get("/api/applications", async (c) => {
  const sql = getSql(c.env.DATABASE_URL);
  let rows = await listApplications(sql);

  const status = c.req.query("status");
  const industry = c.req.query("industry");
  const position = c.req.query("position");
  const q = c.req.query("q")?.toLowerCase();
  const from = c.req.query("from");
  const to = c.req.query("to");

  if (status) rows = rows.filter((r) => r.status === status);
  if (industry) rows = rows.filter((r) => r.industry === industry);
  if (position) rows = rows.filter((r) => r.roleTitle === position);
  if (from) rows = rows.filter((r) => (r.appliedDate ?? "") >= from);
  if (to) rows = rows.filter((r) => (r.appliedDate ?? "") <= to);
  if (q) {
    rows = rows.filter((r) => {
      const hay = [
        r.company,
        r.roleTitle,
        r.industry,
        r.location ?? "",
        r.source ?? "",
        r.salaryRange ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }

  return c.json(rows);
});

app.get("/api/applications/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "id must be an integer" }, 400);
  const sql = getSql(c.env.DATABASE_URL);
  const row = await getApplicationById(sql, id);
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json(row);
});

app.post("/api/applications", requireApiKey, async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "body must be valid JSON" }, 400);
  }

  const parsed = createApplicationSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const sql = getSql(c.env.DATABASE_URL);
  const created = await createApplication(sql, parsed.data);
  background(c, notifyApplicationCreated(c.env, sql, created));
  return c.json(created, 201);
});

app.patch("/api/applications/:id", requireApiKey, async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "id must be an integer" }, 400);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "body must be valid JSON" }, 400);
  }

  const parsed = updateApplicationSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const sql = getSql(c.env.DATABASE_URL);
  const existing = await getApplicationById(sql, id);
  if (!existing) return c.json({ error: "not found" }, 404);

  const updated = await updateApplication(sql, id, parsed.data);
  if (!updated) return c.json({ error: "not found" }, 404);

  if (parsed.data.status && parsed.data.status !== existing.status) {
    background(
      c,
      notifyStatusChanged(c.env, sql, { app: updated, previousStatus: existing.status })
    );
  }

  return c.json(updated);
});

app.delete("/api/applications/:id", requireApiKey, async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "id must be an integer" }, 400);

  const sql = getSql(c.env.DATABASE_URL);
  const docs = await listDocuments(sql, id);
  for (const doc of docs) {
    try {
      await c.env.DOCS.delete(doc.storageKey);
    } catch {
      /* best-effort */
    }
  }
  const ok = await deleteApplication(sql, id);
  if (!ok) return c.json({ error: "not found" }, 404);
  return c.json({ ok: true });
});

// ── Bulk import ───────────────────────────────────────────────

app.post("/api/import", requireApiKey, async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "body must be valid JSON" }, 400);
  }

  const parsed = importPayloadSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const sql = getSql(c.env.DATABASE_URL);
  const ids: number[] = [];

  for (const item of parsed.data.applications) {
    const appRow = await createApplication(sql, {
      company: item.company,
      roleTitle: item.roleTitle,
      industry: item.industry,
      status: item.status,
      location: item.location,
      jobUrl: item.jobUrl,
      appliedDate: item.appliedDate,
      salaryRange: item.salaryRange,
      source: item.source,
    });
    ids.push(appRow.id);

    for (const note of item.notes ?? []) {
      if (note.trim()) await createNote(sql, appRow.id, note);
    }
    for (const rem of item.reminders ?? []) {
      await createReminder(sql, appRow.id, rem.dueDate, rem.message);
    }
  }

  return c.json({ inserted: ids }, 201);
});

// ── Notes ─────────────────────────────────────────────────────

app.get("/api/applications/:id/notes", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "id must be an integer" }, 400);
  const sql = getSql(c.env.DATABASE_URL);
  return c.json(await listNotes(sql, id));
});

app.post("/api/applications/:id/notes", requireApiKey, async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "id must be an integer" }, 400);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "body must be valid JSON" }, 400);
  }
  const parsed = createNoteSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const sql = getSql(c.env.DATABASE_URL);
  const appRow = await getApplicationById(sql, id);
  if (!appRow) return c.json({ error: "not found" }, 404);

  const note = await createNote(sql, id, parsed.data.body);
  return c.json(note, 201);
});

app.delete("/api/notes/:id", requireApiKey, async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "id must be an integer" }, 400);
  const sql = getSql(c.env.DATABASE_URL);
  const ok = await deleteNote(sql, id);
  if (!ok) return c.json({ error: "not found" }, 404);
  return c.json({ ok: true });
});

// ── Reminders ─────────────────────────────────────────────────

app.get("/api/applications/:id/reminders", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "id must be an integer" }, 400);
  const sql = getSql(c.env.DATABASE_URL);
  return c.json(await listReminders(sql, id));
});

app.post("/api/applications/:id/reminders", requireApiKey, async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "id must be an integer" }, 400);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "body must be valid JSON" }, 400);
  }
  const parsed = createReminderSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const sql = getSql(c.env.DATABASE_URL);
  const appRow = await getApplicationById(sql, id);
  if (!appRow) return c.json({ error: "not found" }, 404);

  const rem = await createReminder(sql, id, parsed.data.dueDate, parsed.data.message);
  return c.json(rem, 201);
});

app.patch("/api/reminders/:id", requireApiKey, async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "id must be an integer" }, 400);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "body must be valid JSON" }, 400);
  }
  const completed = (body as { completed?: unknown }).completed;
  if (typeof completed !== "boolean") {
    return c.json({ error: "completed boolean required" }, 400);
  }

  const sql = getSql(c.env.DATABASE_URL);
  const rem = await setReminderCompleted(sql, id, completed);
  if (!rem) return c.json({ error: "not found" }, 404);
  return c.json(rem);
});

app.delete("/api/reminders/:id", requireApiKey, async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "id must be an integer" }, 400);
  const sql = getSql(c.env.DATABASE_URL);
  const ok = await deleteReminder(sql, id);
  if (!ok) return c.json({ error: "not found" }, 404);
  return c.json({ ok: true });
});

// ── Documents ─────────────────────────────────────────────────

app.get("/api/documents", async (c) => {
  const sql = getSql(c.env.DATABASE_URL);
  const appId = c.req.query("applicationId");
  if (appId === undefined || appId === "null" || appId === "") {
    return c.json(await listDocuments(sql, null));
  }
  const id = Number(appId);
  if (!Number.isInteger(id)) return c.json({ error: "applicationId must be an integer" }, 400);
  return c.json(await listDocuments(sql, id));
});

app.post("/api/documents", requireApiKey, async (c) => {
  const form = await c.req.formData();
  const file = form.get("file");
  const typeRaw = form.get("type");
  const appIdRaw = form.get("applicationId");

  if (!file || typeof file === "string" || !("arrayBuffer" in file)) {
    return c.json({ error: "file required" }, 400);
  }
  const upload = file as File;
  const typeParsed = documentTypeSchema.safeParse(typeRaw);
  if (!typeParsed.success) {
    return c.json({ error: "type must be resume or cover_letter" }, 400);
  }

  let applicationId: number | null = null;
  if (appIdRaw != null && String(appIdRaw) !== "" && String(appIdRaw) !== "null") {
    applicationId = Number(appIdRaw);
    if (!Number.isInteger(applicationId)) {
      return c.json({ error: "applicationId must be an integer" }, 400);
    }
  }

  const storageKey = `docs/${crypto.randomUUID()}-${upload.name}`;
  await c.env.DOCS.put(storageKey, await upload.arrayBuffer(), {
    httpMetadata: { contentType: upload.type || "application/octet-stream" },
  });

  const sql = getSql(c.env.DATABASE_URL);
  const doc = await createDocument(sql, {
    type: typeParsed.data,
    filename: upload.name,
    storageKey,
    applicationId,
  });
  return c.json(doc, 201);
});

app.get("/api/documents/:id/url", requireApiKey, async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "id must be an integer" }, 400);

  const sql = getSql(c.env.DATABASE_URL);
  const doc = await getDocumentById(sql, id);
  if (!doc) return c.json({ error: "not found" }, 404);

  const { token, expires } = await createDownloadToken(c.env.API_KEY, id);
  const url = new URL(c.req.url);
  return c.json({
    url: `${url.origin}/api/documents/download?token=${encodeURIComponent(token)}`,
    expires,
  });
});

app.get("/api/documents/download", async (c) => {
  const token = c.req.query("token");
  if (!token) return c.json({ error: "token required" }, 400);

  const verified = await verifyDownloadToken(c.env.API_KEY, token);
  if (!verified) return c.json({ error: "invalid or expired token" }, 401);

  const sql = getSql(c.env.DATABASE_URL);
  const doc = await getDocumentById(sql, verified.documentId);
  if (!doc) return c.json({ error: "not found" }, 404);

  const obj = await c.env.DOCS.get(doc.storageKey);
  if (!obj) return c.json({ error: "file missing" }, 404);

  const headers = new Headers();
  headers.set("Content-Type", obj.httpMetadata?.contentType || "application/octet-stream");
  headers.set("Content-Disposition", `attachment; filename="${doc.filename.replaceAll('"', "")}"`);
  return new Response(obj.body, { headers });
});

app.delete("/api/documents/:id", requireApiKey, async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "id must be an integer" }, 400);

  const sql = getSql(c.env.DATABASE_URL);
  const doc = await deleteDocument(sql, id);
  if (!doc) return c.json({ error: "not found" }, 404);
  try {
    await c.env.DOCS.delete(doc.storageKey);
  } catch {
    /* best-effort */
  }
  return c.json({ ok: true });
});

// ── Stats + digest ────────────────────────────────────────────

app.get("/api/stats", async (c) => {
  const sql = getSql(c.env.DATABASE_URL);
  return c.json(await getStats(sql));
});

app.get("/api/settings", async (c) => {
  const sql = getSql(c.env.DATABASE_URL);
  const stored = await getSetting(sql, SETTING_NOTIFY_TO);
  const recipients = await resolveNotifyRecipients(sql, c.env.DIGEST_TO);
  return c.json({
    notifyTo: stored ?? "",
    effectiveNotifyTo: recipients,
    from: c.env.DIGEST_FROM || DEFAULT_FROM,
  });
});

app.patch("/api/settings", requireApiKey, async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "body must be valid JSON" }, 400);
  }

  const notifyTo = (body as { notifyTo?: unknown }).notifyTo;
  if (typeof notifyTo !== "string") {
    return c.json({ error: "notifyTo string required" }, 400);
  }

  const emails = parseEmailList(notifyTo);
  for (const email of emails) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return c.json({ error: `Invalid email: ${email}` }, 400);
    }
  }

  const sql = getSql(c.env.DATABASE_URL);
  const normalized = emails.join(", ");
  await setSetting(sql, SETTING_NOTIFY_TO, normalized);

  return c.json({
    notifyTo: normalized,
    effectiveNotifyTo: emails.length > 0 ? emails : await resolveNotifyRecipients(sql, c.env.DIGEST_TO),
    from: c.env.DIGEST_FROM || DEFAULT_FROM,
  });
});

app.post("/api/digest/run", requireApiKey, async (c) => {
  const sql = getSql(c.env.DATABASE_URL);
  const result = await runDigest({
    sql,
    resendApiKey: c.env.RESEND_API_KEY,
    digestToFallback: c.env.DIGEST_TO,
    from: c.env.DIGEST_FROM || DEFAULT_FROM,
  });
  return c.json(result);
});

app.post("/api/email/test", requireApiKey, async (c) => {
  const sql = getSql(c.env.DATABASE_URL);
  const result = await sendTestEventEmail(c.env, sql);
  return c.json(result);
});

// SPA fallback for non-API routes is handled by assets binding + not_found_handling

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    const cron = event.cron;
    ctx.waitUntil(
      (async () => {
        if (cron === "0 9 * * 1-5") {
          await runOutreachAutosend(env, "https://jobtracker.humza-butt.space");
          return;
        }
        if (cron === "0 10 * * 1-5") {
          await runOutreachSequence(env, "https://jobtracker.humza-butt.space");
          return;
        }
        // Default: daily reminder digest (0 8 * * *)
        const sql = getSql(env.DATABASE_URL);
        await runDigest({
          sql,
          resendApiKey: env.RESEND_API_KEY,
          digestToFallback: env.DIGEST_TO,
          from: env.DIGEST_FROM || DEFAULT_FROM,
        });
      })()
    );
  },
};

import type { Sql } from "./db";
import { toDateOnly } from "./db";
import type { CreateLead, Lead, LeadStatus, OutreachSettings, UpdateLead } from "../shared/outreach";
import { demoExpiresAtFrom, slugifyName } from "../shared/outreach";
import { contactRoute } from "../shared/contactRoute";
import { statusAfterDemoReady } from "../shared/demoStatus";
import { normalizeBusinessKey, planBulkUpserts } from "./outreach/bulkUpsert";
import { canAutoSend } from "./outreach/canAutoSend";
import { getPersistedOutreach, pickObservation } from "./outreach/copy";
import {
  clampLeadLimit,
  decodeLeadCursor,
  encodeLeadCursor,
} from "./outreach/leadCursor";
import {
  clampMessageLimit,
  decodeMessageCursor,
  encodeMessageCursor,
  truncateBodyPreview,
} from "./outreach/messageCursor";
import {
  computeOutreachAnalytics,
  type AnalyticsLead,
  type AnalyticsMessage,
  type OutreachAnalytics,
} from "./outreach/analytics";

type LeadRow = Record<string, unknown>;

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function mapLead(row: LeadRow): Lead {
  const audit = row.audit;
  return {
    id: Number(row.id),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    businessName: String(row.business_name),
    slug: String(row.slug),
    industry: (row.industry as string) ?? null,
    location: (row.location as string) ?? null,
    postcode: (row.postcode as string) ?? null,
    address: (row.address as string) ?? null,
    contactName: (row.contact_name as string) ?? null,
    contactEmail: (row.contact_email as string) ?? null,
    contactPhone: (row.contact_phone as string) ?? null,
    contactFormUrl: (row.contact_form_url as string) ?? null,
    emailSource: (row.email_source as string) ?? null,
    emailVerified: Boolean(row.email_verified),
    websiteUrl: (row.website_url as string) ?? null,
    hasWebsite: Boolean(row.has_website),
    companiesHouseNumber: (row.companies_house_number as string) ?? null,
    entityType: String(row.entity_type ?? "unknown"),
    corporateSubscriber: Boolean(row.corporate_subscriber),
    chStatus: (row.ch_status as string) ?? null,
    incorporatedOn: toDateOnly(row.incorporated_on),
    audit: (typeof audit === "object" && audit ? audit : {}) as Record<string, unknown>,
    needScore: num(row.need_score),
    likelihoodScore: num(row.likelihood_score),
    priorityScore: num(row.priority_score),
    scoreReason: (row.score_reason as string) ?? null,
    demoUrl: (row.demo_url as string) ?? null,
    demoBuiltAt: row.demo_built_at ? String(row.demo_built_at) : null,
    demoExpiresAt: row.demo_expires_at ? String(row.demo_expires_at) : null,
    demoStatus: String(row.demo_status ?? "none"),
    status: String(row.status) as LeadStatus,
    sentAt: row.sent_at ? String(row.sent_at) : null,
    lastTouchAt: row.last_touch_at ? String(row.last_touch_at) : null,
    nextFollowupAt: row.next_followup_at ? String(row.next_followup_at) : null,
    followupStep: Number(row.followup_step ?? 0),
    repliedAt: row.replied_at ? String(row.replied_at) : null,
    replySentiment: (row.reply_sentiment as string) ?? null,
    suppressed: Boolean(row.suppressed),
    suppressionReason: (row.suppression_reason as string) ?? null,
    offerAmount: Number(row.offer_amount ?? 500),
    source: (row.source as string) ?? null,
    sourceRef: (row.source_ref as string) ?? null,
    reviewReasons: Array.isArray(row.review_reasons) ? (row.review_reasons as string[]) : [],
    customSubject: (row.custom_subject as string) ?? null,
    customBody: (row.custom_body as string) ?? null,
    draftUpdatedAt: row.draft_updated_at ? String(row.draft_updated_at) : null,
    contactRoute: contactRoute({
      contactEmail: (row.contact_email as string) ?? null,
      contactPhone: (row.contact_phone as string) ?? null,
      contactFormUrl: (row.contact_form_url as string) ?? null,
    }),
  };
}

function mapSettings(row: LeadRow): OutreachSettings {
  const offsets = row.followup_offsets_days;
  return {
    id: 1,
    autoSendEnabled: Boolean(row.auto_send_enabled),
    autoSendThreshold: Number(row.auto_send_threshold ?? 8),
    dailySendCap: Number(row.daily_send_cap ?? 20),
    sendingDomain: (row.sending_domain as string) ?? null,
    fromAddress: (row.from_address as string) ?? null,
    replyTo: (row.reply_to as string) ?? null,
    postalAddress: (row.postal_address as string) ?? null,
    followupOffsetsDays: Array.isArray(offsets) ? offsets.map(Number) : [3, 7],
    dryRun: Boolean(row.dry_run),
    pausedUntil: row.paused_until ? String(row.paused_until) : null,
    allowPrimarySendingDomain: Boolean(row.allow_primary_sending_domain),
    updatedAt: String(row.updated_at),
  };
}

export async function getOutreachSettings(sql: Sql): Promise<OutreachSettings> {
  const rows = (await sql`SELECT * FROM outreach_settings WHERE id = 1`) as LeadRow[];
  if (!rows[0]) throw new Error("outreach_settings row missing");
  return mapSettings(rows[0]);
}

export async function updateOutreachSettings(
  sql: Sql,
  patch: Partial<{
    autoSendEnabled: boolean;
    autoSendThreshold: number;
    dailySendCap: number;
    sendingDomain: string | null;
    fromAddress: string | null;
    replyTo: string | null;
    postalAddress: string | null;
    followupOffsetsDays: number[];
    dryRun: boolean;
    pausedUntil: string | null;
    allowPrimarySendingDomain: boolean;
  }>
): Promise<OutreachSettings> {
  const cur = await getOutreachSettings(sql);
  const next = {
    autoSendEnabled: patch.autoSendEnabled ?? cur.autoSendEnabled,
    autoSendThreshold: patch.autoSendThreshold ?? cur.autoSendThreshold,
    dailySendCap: patch.dailySendCap ?? cur.dailySendCap,
    sendingDomain: patch.sendingDomain !== undefined ? patch.sendingDomain : cur.sendingDomain,
    fromAddress: patch.fromAddress !== undefined ? patch.fromAddress : cur.fromAddress,
    replyTo: patch.replyTo !== undefined ? patch.replyTo : cur.replyTo,
    postalAddress: patch.postalAddress !== undefined ? patch.postalAddress : cur.postalAddress,
    followupOffsetsDays: patch.followupOffsetsDays ?? cur.followupOffsetsDays,
    dryRun: patch.dryRun ?? cur.dryRun,
    pausedUntil: patch.pausedUntil !== undefined ? patch.pausedUntil : cur.pausedUntil,
    allowPrimarySendingDomain:
      patch.allowPrimarySendingDomain ?? cur.allowPrimarySendingDomain,
  };
  const rows = (await sql`
    UPDATE outreach_settings SET
      auto_send_enabled = ${next.autoSendEnabled},
      auto_send_threshold = ${next.autoSendThreshold},
      daily_send_cap = ${next.dailySendCap},
      sending_domain = ${next.sendingDomain},
      from_address = ${next.fromAddress},
      reply_to = ${next.replyTo},
      postal_address = ${next.postalAddress},
      followup_offsets_days = ${next.followupOffsetsDays},
      dry_run = ${next.dryRun},
      paused_until = ${next.pausedUntil},
      allow_primary_sending_domain = ${next.allowPrimarySendingDomain},
      updated_at = now()
    WHERE id = 1
    RETURNING *
  `) as LeadRow[];
  return mapSettings(rows[0]);
}

export async function listLeads(
  sql: Sql,
  opts: {
    status?: string;
    industry?: string;
    minPriority?: number;
    corporateOnly?: boolean;
    sort?: string;
    limit?: number;
  } = {}
): Promise<Lead[]> {
  const limit = Math.min(opts.limit ?? 500, 1000);
  const rows = (await sql`
    SELECT * FROM leads
    ORDER BY priority_score DESC NULLS LAST, id DESC
    LIMIT ${limit}
  `) as LeadRow[];

  let leads = rows.map(mapLead);
  if (opts.status) leads = leads.filter((l) => l.status === opts.status);
  if (opts.industry) leads = leads.filter((l) => l.industry === opts.industry);
  if (opts.minPriority != null) {
    leads = leads.filter((l) => (l.priorityScore ?? 0) >= opts.minPriority!);
  }
  if (opts.corporateOnly) leads = leads.filter((l) => l.corporateSubscriber);

  if (opts.sort === "name") leads.sort((a, b) => a.businessName.localeCompare(b.businessName));
  if (opts.sort === "status") leads.sort((a, b) => a.status.localeCompare(b.status));

  return leads;
}

export type LeadsPage = {
  leads: Lead[];
  nextCursor: string | null;
  total: number;
};

/**
 * Keyset page for GET /api/leads.
 * Filters applied in SQL; cursor is (priority_score DESC NULLS LAST, id DESC).
 */
export async function listLeadsPage(
  sql: Sql,
  opts: {
    status?: string;
    industry?: string;
    minPriority?: number;
    corporateOnly?: boolean;
    limit?: number;
    cursor?: string | null;
  } = {}
): Promise<LeadsPage> {
  const limit = clampLeadLimit(opts.limit);
  const cursor = decodeLeadCursor(opts.cursor ?? null);
  const status = opts.status?.trim() || null;
  const industry = opts.industry?.trim() || null;
  const minPriority = opts.minPriority ?? null;
  const corporateOnly = Boolean(opts.corporateOnly);

  const countRows = (await sql`
    SELECT COUNT(*)::int AS n FROM leads
    WHERE (${status}::text IS NULL OR status = ${status})
      AND (${industry}::text IS NULL OR industry = ${industry})
      AND (${minPriority}::float8 IS NULL OR priority_score >= ${minPriority})
      AND (${corporateOnly} = false OR corporate_subscriber = true)
  `) as { n: number }[];
  const total = Number(countRows[0]?.n ?? 0);

  let rows: LeadRow[];
  if (!cursor) {
    rows = (await sql`
      SELECT * FROM leads
      WHERE (${status}::text IS NULL OR status = ${status})
        AND (${industry}::text IS NULL OR industry = ${industry})
        AND (${minPriority}::float8 IS NULL OR priority_score >= ${minPriority})
        AND (${corporateOnly} = false OR corporate_subscriber = true)
      ORDER BY priority_score DESC NULLS LAST, id DESC
      LIMIT ${limit}
    `) as LeadRow[];
  } else if (cursor.p != null) {
    const score = cursor.p;
    const id = cursor.i;
    rows = (await sql`
      SELECT * FROM leads
      WHERE (${status}::text IS NULL OR status = ${status})
        AND (${industry}::text IS NULL OR industry = ${industry})
        AND (${minPriority}::float8 IS NULL OR priority_score >= ${minPriority})
        AND (${corporateOnly} = false OR corporate_subscriber = true)
        AND (
          priority_score < ${score}
          OR (priority_score = ${score} AND id < ${id})
          OR priority_score IS NULL
        )
      ORDER BY priority_score DESC NULLS LAST, id DESC
      LIMIT ${limit}
    `) as LeadRow[];
  } else {
    const id = cursor.i;
    rows = (await sql`
      SELECT * FROM leads
      WHERE (${status}::text IS NULL OR status = ${status})
        AND (${industry}::text IS NULL OR industry = ${industry})
        AND (${minPriority}::float8 IS NULL OR priority_score >= ${minPriority})
        AND (${corporateOnly} = false OR corporate_subscriber = true)
        AND priority_score IS NULL
        AND id < ${id}
      ORDER BY priority_score DESC NULLS LAST, id DESC
      LIMIT ${limit}
    `) as LeadRow[];
  }

  const leads = rows.map(mapLead);
  const nextCursor =
    leads.length === limit
      ? encodeLeadCursor({
          p: leads[leads.length - 1]!.priorityScore,
          i: leads[leads.length - 1]!.id,
        })
      : null;

  return { leads, nextCursor, total };
}

export async function getLeadById(sql: Sql, id: number): Promise<Lead | null> {
  const rows = (await sql`SELECT * FROM leads WHERE id = ${id}`) as LeadRow[];
  return rows[0] ? mapLead(rows[0]) : null;
}

function uniqueSlug(base: string, suffix: string): string {
  const s = `${base}-${suffix}`.replace(/--+/g, "-").slice(0, 80);
  return s;
}

export async function createLead(sql: Sql, input: CreateLead): Promise<Lead> {
  const slug = input.slug || slugifyName(input.businessName);
  const entityType = input.entityType ?? "unknown";
  const corporate =
    input.corporateSubscriber ??
    ["ltd", "llp", "scottish_partnership", "public_body"].includes(entityType);
  const demoStatus = input.demoStatus ?? "none";
  const demoExpiresAt = demoStatus === "ready" ? demoExpiresAtFrom() : null;

  const rows = (await sql`
    INSERT INTO leads (
      business_name, slug, industry, location, postcode, address,
      contact_name, contact_email, contact_phone, contact_form_url,
      email_source, email_verified, website_url, has_website,
      companies_house_number, entity_type, corporate_subscriber, ch_status, incorporated_on,
      audit, need_score, likelihood_score, priority_score, score_reason,
      demo_url, demo_built_at, demo_expires_at, demo_status, status, offer_amount, source, source_ref
    ) VALUES (
      ${input.businessName}, ${slug}, ${input.industry ?? null}, ${input.location ?? null},
      ${input.postcode ?? null}, ${input.address ?? null},
      ${input.contactName ?? null}, ${input.contactEmail ?? null}, ${input.contactPhone ?? null},
      ${input.contactFormUrl ?? null}, ${input.emailSource ?? null}, ${input.emailVerified ?? false},
      ${input.websiteUrl ?? null}, ${input.hasWebsite ?? false},
      ${input.companiesHouseNumber ?? null}, ${entityType}, ${corporate},
      ${input.chStatus ?? null}, ${input.incorporatedOn ?? null},
      ${JSON.stringify(input.audit ?? {})}::jsonb,
      ${input.needScore ?? null}, ${input.likelihoodScore ?? null}, ${input.priorityScore ?? null},
      ${input.scoreReason ?? null}, ${input.demoUrl ?? null}, ${input.demoBuiltAt ?? null},
      ${demoExpiresAt}, ${demoStatus}, ${input.status ?? "sourced"}, ${input.offerAmount ?? 500},
      ${input.source ?? null}, ${input.sourceRef ?? null}
    )
    RETURNING *
  `) as LeadRow[];
  return mapLead(rows[0]);
}

export async function updateLead(sql: Sql, id: number, updates: UpdateLead): Promise<Lead | null> {
  const existing = await getLeadById(sql, id);
  if (!existing) return null;

  const nextDemoStatus = updates.demoStatus ?? existing.demoStatus;
  const becomingReady = nextDemoStatus === "ready" && existing.demoStatus !== "ready";
  // Explicit demoStatus:ready in the patch (publish / re-publish) may advance pipeline status.
  const publishingReady = updates.demoStatus === "ready";

  // Partial UPDATE — only touch fields present on `updates` (plus demo expiry when
  // becoming ready). Avoids rewriting every column and the fragile `${json}::jsonb`
  // cast on the Workers neon HTTP driver when audit is unchanged.
  const sets: string[] = [];
  const values: unknown[] = [];
  const add = (col: string, value: unknown) => {
    values.push(value);
    sets.push(`${col} = $${values.length}`);
  };

  if (updates.businessName !== undefined) add("business_name", updates.businessName);
  if (updates.slug !== undefined) add("slug", updates.slug);
  if (updates.industry !== undefined) add("industry", updates.industry);
  if (updates.location !== undefined) add("location", updates.location);
  if (updates.postcode !== undefined) add("postcode", updates.postcode);
  if (updates.address !== undefined) add("address", updates.address);
  if (updates.contactName !== undefined) add("contact_name", updates.contactName);
  if (updates.contactEmail !== undefined) add("contact_email", updates.contactEmail);
  if (updates.contactPhone !== undefined) add("contact_phone", updates.contactPhone);
  if (updates.contactFormUrl !== undefined) add("contact_form_url", updates.contactFormUrl);
  if (updates.emailSource !== undefined) add("email_source", updates.emailSource);
  if (updates.emailVerified !== undefined) add("email_verified", updates.emailVerified);
  if (updates.websiteUrl !== undefined) add("website_url", updates.websiteUrl);
  if (updates.hasWebsite !== undefined) add("has_website", updates.hasWebsite);
  if (updates.companiesHouseNumber !== undefined) {
    add("companies_house_number", updates.companiesHouseNumber);
  }
  if (updates.entityType !== undefined) add("entity_type", updates.entityType);
  if (updates.corporateSubscriber !== undefined) {
    add("corporate_subscriber", updates.corporateSubscriber);
  }
  if (updates.chStatus !== undefined) add("ch_status", updates.chStatus);
  if (updates.incorporatedOn !== undefined) add("incorporated_on", updates.incorporatedOn);
  if (updates.audit !== undefined) {
    values.push(JSON.stringify(updates.audit));
    sets.push(`audit = $${values.length}::jsonb`);
  }
  if (updates.needScore !== undefined) add("need_score", updates.needScore);
  if (updates.likelihoodScore !== undefined) add("likelihood_score", updates.likelihoodScore);
  if (updates.priorityScore !== undefined) add("priority_score", updates.priorityScore);
  if (updates.scoreReason !== undefined) add("score_reason", updates.scoreReason);
  if (updates.demoUrl !== undefined) add("demo_url", updates.demoUrl);
  if (updates.demoBuiltAt !== undefined) add("demo_built_at", updates.demoBuiltAt);
  if (updates.demoStatus !== undefined) add("demo_status", updates.demoStatus);
  if (updates.status !== undefined) add("status", updates.status);
  if (updates.offerAmount !== undefined) add("offer_amount", updates.offerAmount);
  if (updates.source !== undefined) add("source", updates.source);
  if (updates.sourceRef !== undefined) add("source_ref", updates.sourceRef);
  if (updates.customSubject !== undefined || updates.customBody !== undefined) {
    if (updates.customSubject !== undefined) {
      add("custom_subject", updates.customSubject);
    }
    if (updates.customBody !== undefined) {
      add("custom_body", updates.customBody);
    }
    add("draft_updated_at", new Date().toISOString());
  }

  if (becomingReady) {
    add("demo_expires_at", demoExpiresAtFrom());
  }

  if (publishingReady && updates.status === undefined) {
    const advanced = statusAfterDemoReady(existing.status);
    if (advanced) add("status", advanced);
  }

  if (sets.length === 0) {
    return existing;
  }

  sets.push("updated_at = now()");
  values.push(id);

  // neon() also supports ordinary function usage: sql(query, params)
  const query = `UPDATE leads SET ${sets.join(", ")} WHERE id = $${values.length} RETURNING id`;
  await sql(query, values);

  return getLeadById(sql, id);
}

export async function deleteLead(sql: Sql, id: number): Promise<boolean> {
  const rows = (await sql`DELETE FROM leads WHERE id = ${id} RETURNING id`) as { id: number }[];
  return rows.length > 0;
}

export async function setLeadReviewReasons(
  sql: Sql,
  id: number,
  reasons: string[]
): Promise<void> {
  await sql`UPDATE leads SET review_reasons = ${reasons}, updated_at = now() WHERE id = ${id}`;
}

export async function bulkUpsertLeads(
  sql: Sql,
  incoming: CreateLead[]
): Promise<{ created: number[]; updated: number[]; skipped: number; errors: string[] }> {
  const all = await listLeads(sql, { limit: 1000 });
  const byRef = new Map<string, { id: number; row: Record<string, unknown> }>();
  const byName = new Map<string, { id: number; row: Record<string, unknown> }>();
  for (const l of all) {
    if (l.sourceRef) byRef.set(l.sourceRef, { id: l.id, row: l as unknown as Record<string, unknown> });
    byName.set(normalizeBusinessKey(l.businessName, l.postcode), {
      id: l.id,
      row: l as unknown as Record<string, unknown>,
    });
  }

  const plans = planBulkUpserts(
    incoming.map((i) => ({
      ...i,
      source_ref: i.sourceRef,
      business_name: i.businessName,
      postcode: i.postcode,
    })),
    byRef,
    byName
  );

  const created: number[] = [];
  const updated: number[] = [];
  const errors: string[] = [];
  let skipped = 0;

  for (const plan of plans) {
    try {
      if (plan.action === "skip") {
        skipped++;
        continue;
      }
      const raw = plan.incoming as CreateLead & { business_name?: string; source_ref?: string };
      const input: CreateLead = {
        businessName: raw.businessName || String(raw.business_name || ""),
        slug: raw.slug || slugifyName(raw.businessName || String(raw.business_name || "lead")),
        industry: raw.industry,
        location: raw.location,
        postcode: raw.postcode,
        address: raw.address,
        contactName: raw.contactName,
        contactEmail: raw.contactEmail,
        contactPhone: raw.contactPhone,
        contactFormUrl: raw.contactFormUrl,
        emailSource: raw.emailSource,
        emailVerified: raw.emailVerified,
        websiteUrl: raw.websiteUrl,
        hasWebsite: raw.hasWebsite,
        companiesHouseNumber: raw.companiesHouseNumber,
        entityType: raw.entityType,
        corporateSubscriber: raw.corporateSubscriber,
        chStatus: raw.chStatus,
        incorporatedOn: raw.incorporatedOn,
        audit: raw.audit,
        needScore: raw.needScore,
        likelihoodScore: raw.likelihoodScore,
        priorityScore: raw.priorityScore,
        scoreReason: raw.scoreReason,
        demoUrl: raw.demoUrl,
        demoBuiltAt: raw.demoBuiltAt,
        demoStatus: raw.demoStatus,
        offerAmount: raw.offerAmount,
        source: raw.source,
        sourceRef: raw.sourceRef || (raw as { source_ref?: string }).source_ref,
      };

      if (plan.action === "create") {
        // ensure unique slug
        let slug = input.slug;
        const clash = (await sql`SELECT id FROM leads WHERE slug = ${slug} LIMIT 1`) as { id: number }[];
        if (clash[0]) slug = uniqueSlug(slug, crypto.randomUUID().slice(0, 8));
        const lead = await createLead(sql, { ...input, slug });
        created.push(lead.id);
      } else {
        // update without protected fields — updateLead schema path omits status if not passed
        const { status: _s, ...safe } = input;
        const lead = await updateLead(sql, plan.existingId, safe);
        if (lead) updated.push(lead.id);
      }
    } catch (e) {
      const ref =
        (plan.incoming as CreateLead).sourceRef ||
        (plan.incoming as { source_ref?: string }).source_ref ||
        (plan.incoming as CreateLead).businessName ||
        "unknown";
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${ref}: ${msg}`);
    }
  }

  return { created, updated, skipped, errors };
}

export async function countSentToday(sql: Sql): Promise<number> {
  const rows = (await sql`
    SELECT count(*)::int AS n FROM lead_messages
    WHERE direction = 'out' AND status IN ('sent','delivered','queued')
      AND created_at::date = CURRENT_DATE
  `) as { n: number }[];
  return rows[0]?.n ?? 0;
}

export async function isSuppressed(sql: Sql, email: string | null): Promise<boolean> {
  if (!email?.trim()) return false;
  const value = email.trim().toLowerCase();
  const domain = value.includes("@") ? value.split("@")[1] : null;
  const rows = (await sql`
    SELECT id FROM suppressions
    WHERE (kind = 'email' AND value = ${value})
       OR (${domain}::text IS NOT NULL AND kind = 'domain' AND value = ${domain})
    LIMIT 1
  `) as { id: number }[];
  return rows.length > 0;
}

export async function addSuppression(
  sql: Sql,
  value: string,
  kind: "email" | "domain",
  reason?: string
): Promise<void> {
  const v = value.trim().toLowerCase();
  await sql`
    INSERT INTO suppressions (value, kind, reason)
    VALUES (${v}, ${kind}, ${reason ?? null})
    ON CONFLICT (kind, value) DO NOTHING
  `;
}

export async function listLeadNotes(sql: Sql, leadId: number) {
  const rows = (await sql`
    SELECT id, lead_id, body, created_at FROM lead_notes
    WHERE lead_id = ${leadId} ORDER BY created_at ASC
  `) as { id: number; lead_id: number; body: string; created_at: string }[];
  return rows.map((r) => ({
    id: r.id,
    leadId: r.lead_id,
    body: r.body,
    createdAt: r.created_at,
  }));
}

export async function createLeadNote(sql: Sql, leadId: number, body: string) {
  const rows = (await sql`
    INSERT INTO lead_notes (lead_id, body) VALUES (${leadId}, ${body}) RETURNING *
  `) as { id: number; lead_id: number; body: string; created_at: string }[];
  const r = rows[0];
  return { id: r.id, leadId: r.lead_id, body: r.body, createdAt: r.created_at };
}

export async function deleteLeadNote(sql: Sql, id: number): Promise<boolean> {
  const rows = (await sql`DELETE FROM lead_notes WHERE id = ${id} RETURNING id`) as { id: number }[];
  return rows.length > 0;
}

export async function listLeadReminders(sql: Sql, leadId: number) {
  const rows = (await sql`
    SELECT * FROM lead_reminders WHERE lead_id = ${leadId} ORDER BY due_date ASC
  `) as LeadRow[];
  return rows.map((r) => ({
    id: Number(r.id),
    leadId: Number(r.lead_id),
    dueDate: toDateOnly(r.due_date) ?? String(r.due_date).slice(0, 10),
    message: String(r.message),
    completed: Boolean(r.completed),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  }));
}

export async function createLeadReminder(
  sql: Sql,
  leadId: number,
  dueDate: string,
  message: string
) {
  const rows = (await sql`
    INSERT INTO lead_reminders (lead_id, due_date, message)
    VALUES (${leadId}, ${dueDate}, ${message})
    RETURNING *
  `) as LeadRow[];
  const r = rows[0];
  return {
    id: Number(r.id),
    leadId: Number(r.lead_id),
    dueDate: toDateOnly(r.due_date) ?? String(r.due_date).slice(0, 10),
    message: String(r.message),
    completed: Boolean(r.completed),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

export async function setLeadReminderCompleted(sql: Sql, id: number, completed: boolean) {
  const rows = (await sql`
    UPDATE lead_reminders SET completed = ${completed}, updated_at = now()
    WHERE id = ${id} RETURNING *
  `) as LeadRow[];
  if (!rows[0]) return null;
  const r = rows[0];
  return {
    id: Number(r.id),
    leadId: Number(r.lead_id),
    dueDate: toDateOnly(r.due_date) ?? String(r.due_date).slice(0, 10),
    message: String(r.message),
    completed: Boolean(r.completed),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

export async function deleteLeadReminder(sql: Sql, id: number): Promise<boolean> {
  const rows = (await sql`DELETE FROM lead_reminders WHERE id = ${id} RETURNING id`) as {
    id: number;
  }[];
  return rows.length > 0;
}

export async function cancelLeadFollowupReminders(sql: Sql, leadId: number): Promise<void> {
  await sql`
    UPDATE lead_reminders SET completed = true, updated_at = now()
    WHERE lead_id = ${leadId} AND completed = false
      AND message LIKE 'Outreach follow-up%'
  `;
}

export type LeadMessageRow = {
  id: number;
  leadId: number;
  direction: string;
  channel: string;
  subject: string | null;
  body: string | null;
  templateId: string | null;
  variant: string | null;
  providerMessageId: string | null;
  idempotencyKey: string | null;
  status: string;
  sentAt: string | null;
  deliveredAt: string | null;
  openedAt: string | null;
  error: string | null;
  createdAt: string;
  attempts: number;
  lastAttemptAt: string | null;
};

/** Cap on retries for the same idempotency key (failed/queued). */
export const MAX_MESSAGE_SEND_ATTEMPTS = 5;

function mapLeadMessage(r: LeadRow): LeadMessageRow {
  return {
    id: Number(r.id),
    leadId: Number(r.lead_id),
    direction: String(r.direction),
    channel: String(r.channel),
    subject: (r.subject as string) ?? null,
    body: (r.body as string) ?? null,
    templateId: (r.template_id as string) ?? null,
    variant: (r.variant as string) ?? null,
    providerMessageId: (r.provider_message_id as string) ?? null,
    idempotencyKey: (r.idempotency_key as string) ?? null,
    status: String(r.status),
    sentAt: r.sent_at ? String(r.sent_at) : null,
    deliveredAt: r.delivered_at ? String(r.delivered_at) : null,
    openedAt: r.opened_at ? String(r.opened_at) : null,
    error: (r.error as string) ?? null,
    createdAt: String(r.created_at),
    attempts: Number(r.attempts ?? 1),
    lastAttemptAt: r.last_attempt_at ? String(r.last_attempt_at) : null,
  };
}

export async function listLeadMessages(sql: Sql, leadId: number) {
  const rows = (await sql`
    SELECT * FROM lead_messages WHERE lead_id = ${leadId} ORDER BY created_at ASC
  `) as LeadRow[];
  return rows.map(mapLeadMessage);
}

export type OutreachMessageListItem = {
  id: number;
  leadId: number;
  businessName: string;
  industry: string | null;
  direction: string;
  channel: string;
  subject: string | null;
  templateId: string | null;
  variant: string | null;
  status: string;
  sentAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
  error: string | null;
  bodyPreview: string | null;
};

export type OutreachMessagesPage = {
  messages: OutreachMessageListItem[];
  nextCursor: string | null;
  total: number;
};

export type OutreachMessageFilters = {
  direction?: string;
  status?: string;
  templateId?: string;
  variant?: string;
  industry?: string;
  leadId?: number;
  from?: string;
  to?: string;
  q?: string;
  limit?: number;
  cursor?: string | null;
};

function mapOutreachMessageRow(r: LeadRow): OutreachMessageListItem {
  return {
    id: Number(r.id),
    leadId: Number(r.lead_id),
    businessName: String(r.business_name ?? ""),
    industry: (r.industry as string) ?? null,
    direction: String(r.direction),
    channel: String(r.channel),
    subject: (r.subject as string) ?? null,
    templateId: (r.template_id as string) ?? null,
    variant: (r.variant as string) ?? null,
    status: String(r.status),
    sentAt: r.sent_at ? String(r.sent_at) : null,
    deliveredAt: r.delivered_at ? String(r.delivered_at) : null,
    createdAt: String(r.created_at),
    error: (r.error as string) ?? null,
    bodyPreview: truncateBodyPreview((r.body_preview as string) ?? (r.body as string) ?? null),
  };
}

export async function listOutreachMessagesPage(
  sql: Sql,
  opts: OutreachMessageFilters = {}
): Promise<OutreachMessagesPage> {
  const limit = clampMessageLimit(opts.limit);
  const cursor = decodeMessageCursor(opts.cursor ?? null);
  const direction = opts.direction?.trim() || null;
  const status = opts.status?.trim() || null;
  const templateId = opts.templateId?.trim() || null;
  const variant = opts.variant?.trim() || null;
  const industry = opts.industry?.trim() || null;
  const leadId = opts.leadId != null && Number.isInteger(opts.leadId) ? opts.leadId : null;
  const from = opts.from?.trim() || null;
  const to = opts.to?.trim() || null;
  const q = opts.q?.trim() ? `%${opts.q.trim().toLowerCase()}%` : null;

  const countRows = (await sql`
    SELECT COUNT(*)::int AS n
    FROM lead_messages m
    JOIN leads l ON l.id = m.lead_id
    WHERE (${direction}::text IS NULL OR m.direction = ${direction})
      AND (${status}::text IS NULL OR m.status = ${status})
      AND (${templateId}::text IS NULL OR m.template_id = ${templateId})
      AND (${variant}::text IS NULL OR m.variant = ${variant})
      AND (${industry}::text IS NULL OR l.industry = ${industry})
      AND (${leadId}::int IS NULL OR m.lead_id = ${leadId})
      AND (${from}::timestamptz IS NULL OR m.created_at >= ${from}::timestamptz)
      AND (${to}::timestamptz IS NULL OR m.created_at <= ${to}::timestamptz)
      AND (
        ${q}::text IS NULL
        OR lower(l.business_name) LIKE ${q}
        OR lower(coalesce(m.subject, '')) LIKE ${q}
      )
  `) as { n: number }[];
  const total = Number(countRows[0]?.n ?? 0);

  let rows: LeadRow[];
  if (!cursor) {
    rows = (await sql`
      SELECT
        m.id, m.lead_id, l.business_name, l.industry, m.direction, m.channel,
        m.subject, m.template_id, m.variant, m.status, m.sent_at, m.delivered_at,
        m.created_at, m.error, left(coalesce(m.body, ''), 140) AS body_preview
      FROM lead_messages m
      JOIN leads l ON l.id = m.lead_id
      WHERE (${direction}::text IS NULL OR m.direction = ${direction})
        AND (${status}::text IS NULL OR m.status = ${status})
        AND (${templateId}::text IS NULL OR m.template_id = ${templateId})
        AND (${variant}::text IS NULL OR m.variant = ${variant})
        AND (${industry}::text IS NULL OR l.industry = ${industry})
        AND (${leadId}::int IS NULL OR m.lead_id = ${leadId})
        AND (${from}::timestamptz IS NULL OR m.created_at >= ${from}::timestamptz)
        AND (${to}::timestamptz IS NULL OR m.created_at <= ${to}::timestamptz)
        AND (
          ${q}::text IS NULL
          OR lower(l.business_name) LIKE ${q}
          OR lower(coalesce(m.subject, '')) LIKE ${q}
        )
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT ${limit}
    `) as LeadRow[];
  } else {
    const ts = cursor.t;
    const id = cursor.i;
    rows = (await sql`
      SELECT
        m.id, m.lead_id, l.business_name, l.industry, m.direction, m.channel,
        m.subject, m.template_id, m.variant, m.status, m.sent_at, m.delivered_at,
        m.created_at, m.error, left(coalesce(m.body, ''), 140) AS body_preview
      FROM lead_messages m
      JOIN leads l ON l.id = m.lead_id
      WHERE (${direction}::text IS NULL OR m.direction = ${direction})
        AND (${status}::text IS NULL OR m.status = ${status})
        AND (${templateId}::text IS NULL OR m.template_id = ${templateId})
        AND (${variant}::text IS NULL OR m.variant = ${variant})
        AND (${industry}::text IS NULL OR l.industry = ${industry})
        AND (${leadId}::int IS NULL OR m.lead_id = ${leadId})
        AND (${from}::timestamptz IS NULL OR m.created_at >= ${from}::timestamptz)
        AND (${to}::timestamptz IS NULL OR m.created_at <= ${to}::timestamptz)
        AND (
          ${q}::text IS NULL
          OR lower(l.business_name) LIKE ${q}
          OR lower(coalesce(m.subject, '')) LIKE ${q}
        )
        AND (
          m.created_at < ${ts}::timestamptz
          OR (m.created_at = ${ts}::timestamptz AND m.id < ${id})
        )
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT ${limit}
    `) as LeadRow[];
  }

  const messages = rows.map(mapOutreachMessageRow);
  const nextCursor =
    messages.length === limit
      ? encodeMessageCursor({
          t: messages[messages.length - 1]!.createdAt,
          i: messages[messages.length - 1]!.id,
        })
      : null;

  return { messages, nextCursor, total };
}

export async function getOutreachMessageById(sql: Sql, id: number) {
  const rows = (await sql`
    SELECT
      m.*, l.business_name, l.industry
    FROM lead_messages m
    JOIN leads l ON l.id = m.lead_id
    WHERE m.id = ${id}
    LIMIT 1
  `) as LeadRow[];
  const r = rows[0];
  if (!r) return null;
  return {
    id: Number(r.id),
    leadId: Number(r.lead_id),
    businessName: String(r.business_name ?? ""),
    industry: (r.industry as string) ?? null,
    direction: String(r.direction),
    channel: String(r.channel),
    subject: (r.subject as string) ?? null,
    body: (r.body as string) ?? null,
    templateId: (r.template_id as string) ?? null,
    variant: (r.variant as string) ?? null,
    status: String(r.status),
    sentAt: r.sent_at ? String(r.sent_at) : null,
    deliveredAt: r.delivered_at ? String(r.delivered_at) : null,
    error: (r.error as string) ?? null,
    createdAt: String(r.created_at),
  };
}

export async function getOutreachAnalytics(sql: Sql): Promise<OutreachAnalytics> {
  const msgRows = (await sql`
    SELECT id, lead_id, direction, status, template_id, variant, sent_at, created_at
    FROM lead_messages
    ORDER BY id ASC
  `) as LeadRow[];
  const messages: AnalyticsMessage[] = msgRows.map((r) => ({
    id: Number(r.id),
    leadId: Number(r.lead_id),
    direction: String(r.direction),
    status: String(r.status),
    templateId: (r.template_id as string) ?? null,
    variant: (r.variant as string) ?? null,
    sentAt: r.sent_at ? String(r.sent_at) : null,
    createdAt: String(r.created_at),
  }));

  const leadRows = (await sql`
    SELECT id, industry, replied_at, reply_sentiment, status, offer_amount, audit
    FROM leads
  `) as LeadRow[];
  const leads: AnalyticsLead[] = leadRows.map((r) => {
    const audit = r.audit;
    return {
      id: Number(r.id),
      industry: (r.industry as string) ?? null,
      repliedAt: r.replied_at ? String(r.replied_at) : null,
      replySentiment: (r.reply_sentiment as string) ?? null,
      status: String(r.status),
      offerAmount: Number(r.offer_amount ?? 0),
      audit: (typeof audit === "object" && audit ? audit : {}) as Record<string, unknown>,
    };
  });

  return computeOutreachAnalytics(messages, leads);
}

/** Provider id from the first successful initial outbound, for threading headers. */
export async function getInitialOutboundProviderId(
  sql: Sql,
  leadId: number
): Promise<string | null> {
  const rows = (await sql`
    SELECT provider_message_id FROM lead_messages
    WHERE lead_id = ${leadId}
      AND direction = 'out'
      AND template_id IN ('initial', 'custom')
      AND provider_message_id IS NOT NULL
      AND provider_message_id <> ''
    ORDER BY created_at ASC
    LIMIT 1
  `) as { provider_message_id: string }[];
  return rows[0]?.provider_message_id ?? null;
}

export async function getLeadMessageByIdempotency(
  sql: Sql,
  key: string
): Promise<LeadMessageRow | null> {
  const rows = (await sql`
    SELECT * FROM lead_messages WHERE idempotency_key = ${key} LIMIT 1
  `) as LeadRow[];
  return rows[0] ? mapLeadMessage(rows[0]) : null;
}

export async function insertLeadMessage(
  sql: Sql,
  input: {
    leadId: number;
    direction: "out" | "in";
    channel: "email" | "form" | "phone";
    subject?: string | null;
    body?: string | null;
    templateId?: string | null;
    variant?: string | null;
    providerMessageId?: string | null;
    idempotencyKey?: string | null;
    status: string;
    sentAt?: string | null;
    error?: string | null;
  }
): Promise<LeadMessageRow> {
  const rows = (await sql`
    INSERT INTO lead_messages (
      lead_id, direction, channel, subject, body, template_id, variant,
      provider_message_id, idempotency_key, status, sent_at, error,
      attempts, last_attempt_at
    ) VALUES (
      ${input.leadId}, ${input.direction}, ${input.channel}, ${input.subject ?? null},
      ${input.body ?? null}, ${input.templateId ?? null}, ${input.variant ?? null},
      ${input.providerMessageId ?? null}, ${input.idempotencyKey ?? null}, ${input.status},
      ${input.sentAt ?? null}, ${input.error ?? null},
      1, now()
    )
    RETURNING *
  `) as LeadRow[];
  return mapLeadMessage(rows[0]!);
}

/** Update an existing message in place on retry (unique idempotency_key). */
export async function updateLeadMessageAttempt(
  sql: Sql,
  id: number,
  input: {
    subject?: string | null;
    body?: string | null;
    templateId?: string | null;
    variant?: string | null;
    providerMessageId?: string | null;
    status: string;
    sentAt?: string | null;
    error?: string | null;
  }
): Promise<LeadMessageRow> {
  const rows = (await sql`
    UPDATE lead_messages SET
      subject = ${input.subject ?? null},
      body = ${input.body ?? null},
      template_id = ${input.templateId ?? null},
      variant = ${input.variant ?? null},
      provider_message_id = ${input.providerMessageId ?? null},
      status = ${input.status},
      sent_at = ${input.sentAt ?? null},
      error = ${input.error ?? null},
      attempts = attempts + 1,
      last_attempt_at = now()
    WHERE id = ${id}
    RETURNING *
  `) as LeadRow[];
  if (!rows[0]) throw new Error(`lead_messages ${id} not found for retry`);
  return mapLeadMessage(rows[0]);
}

export async function findLeadByEmail(sql: Sql, email: string): Promise<Lead | null> {
  const value = email.trim().toLowerCase();
  const rows = (await sql`
    SELECT * FROM leads WHERE lower(contact_email) = ${value} ORDER BY updated_at DESC LIMIT 1
  `) as LeadRow[];
  return rows[0] ? mapLead(rows[0]) : null;
}

export async function getLeadStats(sql: Sql) {
  const leads = await listLeads(sql, { limit: 1000 });
  const byStatus: Record<string, number> = {};
  for (const l of leads) byStatus[l.status] = (byStatus[l.status] ?? 0) + 1;
  const sent = leads.filter((l) => ["sent", "followed_up", "replied", "interested", "won", "lost"].includes(l.status)).length;
  const replied = leads.filter((l) => l.repliedAt).length;
  const interested = leads.filter((l) => l.status === "interested" || l.replySentiment === "positive").length;
  const won = leads.filter((l) => l.status === "won");
  const revenue = won.reduce((s, l) => s + Number(l.offerAmount || 0), 0);
  return {
    total: leads.length,
    byStatus,
    funnel: {
      sourced: leads.length,
      sent,
      replied,
      interested,
      won: won.length,
    },
    replyRate: sent === 0 ? 0 : Math.round((replied / sent) * 1000) / 10,
    positiveReplyRate: replied === 0 ? 0 : Math.round((interested / replied) * 1000) / 10,
    revenue,
    reviewQueue: leads.filter((l) => l.reviewReasons.length > 0 && ["queued", "demo_ready", "scored"].includes(l.status)).length,
  };
}

export function leadGateInput(
  lead: Lead,
  extras?: { postalAddress?: string | null }
) {
  const audit = (lead.audit as Record<string, unknown>) || {};
  const persisted = getPersistedOutreach(audit);
  const observationSignal =
    persisted?.signal ??
    pickObservation({
      websiteUrl: lead.websiteUrl,
      audit,
    }).signal;
  return {
    priorityScore: lead.priorityScore,
    corporateSubscriber: lead.corporateSubscriber,
    emailVerified: lead.emailVerified,
    contactEmail: lead.contactEmail,
    suppressed: lead.suppressed,
    demoStatus: lead.demoStatus,
    demoUrl: lead.demoUrl,
    status: lead.status,
    businessName: lead.businessName,
    industry: lead.industry,
    observationSignal,
    templateRequiresIndustry: false,
    templateRequiresLocation: false,
    location: lead.location,
    postalAddress: extras?.postalAddress ?? null,
  };
}

export function settingsGateInput(s: OutreachSettings) {
  return {
    autoSendEnabled: s.autoSendEnabled,
    dryRun: s.dryRun,
    autoSendThreshold: s.autoSendThreshold,
    dailySendCap: s.dailySendCap,
    pausedUntil: s.pausedUntil,
  };
}

export { canAutoSend, mapLead };

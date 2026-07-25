import type { Sql } from "./db";
import { toDateOnly } from "./db";
import type { CreateLead, Lead, LeadStatus, OutreachSettings, UpdateLead } from "../shared/outreach";
import { demoExpiresAtFrom, slugifyName } from "../shared/outreach";
import { normalizeBusinessKey, planBulkUpserts } from "./outreach/bulkUpsert";
import { canAutoSend } from "./outreach/canAutoSend";

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
    ORDER BY priority_score DESC NULLS LAST, updated_at DESC
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

  const merged = {
    businessName: updates.businessName ?? existing.businessName,
    slug: updates.slug ?? existing.slug,
    industry: updates.industry !== undefined ? updates.industry : existing.industry,
    location: updates.location !== undefined ? updates.location : existing.location,
    postcode: updates.postcode !== undefined ? updates.postcode : existing.postcode,
    address: updates.address !== undefined ? updates.address : existing.address,
    contactName: updates.contactName !== undefined ? updates.contactName : existing.contactName,
    contactEmail: updates.contactEmail !== undefined ? updates.contactEmail : existing.contactEmail,
    contactPhone: updates.contactPhone !== undefined ? updates.contactPhone : existing.contactPhone,
    contactFormUrl:
      updates.contactFormUrl !== undefined ? updates.contactFormUrl : existing.contactFormUrl,
    emailSource: updates.emailSource !== undefined ? updates.emailSource : existing.emailSource,
    emailVerified: updates.emailVerified ?? existing.emailVerified,
    websiteUrl: updates.websiteUrl !== undefined ? updates.websiteUrl : existing.websiteUrl,
    hasWebsite: updates.hasWebsite ?? existing.hasWebsite,
    companiesHouseNumber:
      updates.companiesHouseNumber !== undefined
        ? updates.companiesHouseNumber
        : existing.companiesHouseNumber,
    entityType: updates.entityType ?? existing.entityType,
    corporateSubscriber: updates.corporateSubscriber ?? existing.corporateSubscriber,
    chStatus: updates.chStatus !== undefined ? updates.chStatus : existing.chStatus,
    incorporatedOn:
      updates.incorporatedOn !== undefined ? updates.incorporatedOn : existing.incorporatedOn,
    audit: updates.audit ?? existing.audit,
    needScore: updates.needScore !== undefined ? updates.needScore : existing.needScore,
    likelihoodScore:
      updates.likelihoodScore !== undefined ? updates.likelihoodScore : existing.likelihoodScore,
    priorityScore:
      updates.priorityScore !== undefined ? updates.priorityScore : existing.priorityScore,
    scoreReason: updates.scoreReason !== undefined ? updates.scoreReason : existing.scoreReason,
    demoUrl: updates.demoUrl !== undefined ? updates.demoUrl : existing.demoUrl,
    demoBuiltAt: updates.demoBuiltAt !== undefined ? updates.demoBuiltAt : existing.demoBuiltAt,
    demoStatus: updates.demoStatus ?? existing.demoStatus,
    status: updates.status ?? existing.status,
    offerAmount: updates.offerAmount ?? existing.offerAmount,
    source: updates.source !== undefined ? updates.source : existing.source,
    sourceRef: updates.sourceRef !== undefined ? updates.sourceRef : existing.sourceRef,
  };

  const becomingReady =
    merged.demoStatus === "ready" && existing.demoStatus !== "ready";
  const demoExpiresAt = becomingReady
    ? demoExpiresAtFrom()
    : existing.demoExpiresAt;

  const rows = (await sql`
    UPDATE leads SET
      business_name = ${merged.businessName},
      slug = ${merged.slug},
      industry = ${merged.industry},
      location = ${merged.location},
      postcode = ${merged.postcode},
      address = ${merged.address},
      contact_name = ${merged.contactName},
      contact_email = ${merged.contactEmail},
      contact_phone = ${merged.contactPhone},
      contact_form_url = ${merged.contactFormUrl},
      email_source = ${merged.emailSource},
      email_verified = ${merged.emailVerified},
      website_url = ${merged.websiteUrl},
      has_website = ${merged.hasWebsite},
      companies_house_number = ${merged.companiesHouseNumber},
      entity_type = ${merged.entityType},
      corporate_subscriber = ${merged.corporateSubscriber},
      ch_status = ${merged.chStatus},
      incorporated_on = ${merged.incorporatedOn},
      audit = ${JSON.stringify(merged.audit)}::jsonb,
      need_score = ${merged.needScore},
      likelihood_score = ${merged.likelihoodScore},
      priority_score = ${merged.priorityScore},
      score_reason = ${merged.scoreReason},
      demo_url = ${merged.demoUrl},
      demo_built_at = ${merged.demoBuiltAt},
      demo_expires_at = ${demoExpiresAt},
      demo_status = ${merged.demoStatus},
      status = ${merged.status},
      offer_amount = ${merged.offerAmount},
      source = ${merged.source},
      source_ref = ${merged.sourceRef},
      updated_at = now()
    WHERE id = ${id}
    RETURNING *
  `) as LeadRow[];
  return rows[0] ? mapLead(rows[0]) : null;
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
      errors.push(e instanceof Error ? e.message : String(e));
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

export async function listLeadMessages(sql: Sql, leadId: number) {
  const rows = (await sql`
    SELECT * FROM lead_messages WHERE lead_id = ${leadId} ORDER BY created_at ASC
  `) as LeadRow[];
  return rows.map((r) => ({
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
  }));
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
      AND template_id = 'initial'
      AND provider_message_id IS NOT NULL
      AND provider_message_id <> ''
    ORDER BY created_at ASC
    LIMIT 1
  `) as { provider_message_id: string }[];
  return rows[0]?.provider_message_id ?? null;
}

export async function getLeadMessageByIdempotency(sql: Sql, key: string) {
  const rows = (await sql`
    SELECT * FROM lead_messages WHERE idempotency_key = ${key} LIMIT 1
  `) as LeadRow[];
  return rows[0] ?? null;
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
) {
  const rows = (await sql`
    INSERT INTO lead_messages (
      lead_id, direction, channel, subject, body, template_id, variant,
      provider_message_id, idempotency_key, status, sent_at, error
    ) VALUES (
      ${input.leadId}, ${input.direction}, ${input.channel}, ${input.subject ?? null},
      ${input.body ?? null}, ${input.templateId ?? null}, ${input.variant ?? null},
      ${input.providerMessageId ?? null}, ${input.idempotencyKey ?? null}, ${input.status},
      ${input.sentAt ?? null}, ${input.error ?? null}
    )
    RETURNING *
  `) as LeadRow[];
  return rows[0];
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

export function leadGateInput(lead: Lead) {
  return {
    priorityScore: lead.priorityScore,
    corporateSubscriber: lead.corporateSubscriber,
    emailVerified: lead.emailVerified,
    contactEmail: lead.contactEmail,
    suppressed: lead.suppressed,
    demoStatus: lead.demoStatus,
    demoUrl: lead.demoUrl,
    status: lead.status,
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

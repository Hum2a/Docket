import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import type { Application, Note, Reminder, Document, Stats, Status } from "../shared/schema";
import { isDueSoon } from "../shared/schema";
import type { CreateApplication, UpdateApplication } from "../shared/schema";
import { parseEmailList } from "./email";

export type Sql = NeonQueryFunction<false, false>;

export function getSql(databaseUrl: string): Sql {
  return neon(databaseUrl);
}

type AppRow = {
  id: number;
  company: string;
  role_title: string;
  industry: string;
  location: string | null;
  job_url: string | null;
  status: Status;
  applied_date: string | Date | null;
  salary_range: string | null;
  source: string | null;
  created_at: string;
  updated_at: string;
};

/** Normalize DB date/timestamp values to YYYY-MM-DD (never "Mon Jul 20"). */
export function toDateOnly(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    return value.slice(0, 10);
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const parsed = new Date(String(value));
  if (!Number.isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, "0");
    const d = String(parsed.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return null;
}

function mapApp(row: AppRow, dueSoon = false): Application {
  return {
    id: row.id,
    company: row.company,
    roleTitle: row.role_title,
    industry: row.industry,
    location: row.location,
    jobUrl: row.job_url,
    status: row.status,
    appliedDate: toDateOnly(row.applied_date),
    salaryRange: row.salary_range,
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    dueSoon,
  };
}

function mapNote(row: {
  id: number;
  application_id: number;
  body: string;
  created_at: string;
}): Note {
  return {
    id: row.id,
    applicationId: row.application_id,
    body: row.body,
    createdAt: row.created_at,
  };
}

function mapReminder(row: {
  id: number;
  application_id: number;
  due_date: string | Date;
  message: string;
  completed: boolean;
  created_at: string;
  updated_at: string;
}): Reminder {
  const dueDate = toDateOnly(row.due_date) ?? String(row.due_date).slice(0, 10);
  return {
    id: row.id,
    applicationId: row.application_id,
    dueDate,
    message: row.message,
    completed: row.completed,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    dueSoon: isDueSoon(dueDate, row.completed),
  };
}

function mapDoc(row: {
  id: number;
  type: "resume" | "cover_letter";
  filename: string;
  storage_key: string;
  application_id: number | null;
  created_at: string;
}): Document {
  return {
    id: row.id,
    type: row.type,
    filename: row.filename,
    storageKey: row.storage_key,
    applicationId: row.application_id,
    createdAt: row.created_at,
  };
}

export async function listApplications(sql: Sql): Promise<Application[]> {
  const rows = (await sql`
    SELECT a.*,
      EXISTS (
        SELECT 1 FROM reminders r
        WHERE r.application_id = a.id
          AND r.completed = false
          AND r.due_date <= (CURRENT_DATE + INTERVAL '3 days')
          AND r.due_date >= CURRENT_DATE
      ) AS due_soon
    FROM applications a
    ORDER BY a.updated_at DESC
  `) as (AppRow & { due_soon: boolean })[];

  return rows.map((r) => mapApp(r, Boolean(r.due_soon)));
}

export async function getApplicationById(sql: Sql, id: number): Promise<Application | null> {
  const rows = (await sql`
    SELECT a.*,
      EXISTS (
        SELECT 1 FROM reminders r
        WHERE r.application_id = a.id
          AND r.completed = false
          AND r.due_date <= (CURRENT_DATE + INTERVAL '3 days')
          AND r.due_date >= CURRENT_DATE
      ) AS due_soon
    FROM applications a
    WHERE a.id = ${id}
  `) as (AppRow & { due_soon: boolean })[];

  if (!rows[0]) return null;
  return mapApp(rows[0], Boolean(rows[0].due_soon));
}

export async function createApplication(sql: Sql, input: CreateApplication): Promise<Application> {
  const status = input.status ?? "wishlist";
  const rows = (await sql`
    INSERT INTO applications (
      company, role_title, industry, location, job_url, status,
      applied_date, salary_range, source
    ) VALUES (
      ${input.company}, ${input.roleTitle}, ${input.industry},
      ${input.location ?? null}, ${input.jobUrl ?? null}, ${status},
      ${input.appliedDate ?? null}, ${input.salaryRange ?? null}, ${input.source ?? null}
    )
    RETURNING *
  `) as AppRow[];
  return mapApp(rows[0]);
}

export async function updateApplication(
  sql: Sql,
  id: number,
  updates: UpdateApplication
): Promise<Application | null> {
  const existing = await getApplicationById(sql, id);
  if (!existing) return null;

  const merged = {
    company: updates.company ?? existing.company,
    roleTitle: updates.roleTitle ?? existing.roleTitle,
    industry: updates.industry ?? existing.industry,
    location: updates.location !== undefined ? updates.location : existing.location,
    jobUrl: updates.jobUrl !== undefined ? updates.jobUrl : existing.jobUrl,
    status: updates.status ?? existing.status,
    appliedDate: toDateOnly(
      updates.appliedDate !== undefined ? updates.appliedDate : existing.appliedDate
    ),
    salaryRange: updates.salaryRange !== undefined ? updates.salaryRange : existing.salaryRange,
    source: updates.source !== undefined ? updates.source : existing.source,
  };

  const rows = (await sql`
    UPDATE applications SET
      company = ${merged.company},
      role_title = ${merged.roleTitle},
      industry = ${merged.industry},
      location = ${merged.location},
      job_url = ${merged.jobUrl},
      status = ${merged.status},
      applied_date = ${merged.appliedDate},
      salary_range = ${merged.salaryRange},
      source = ${merged.source},
      updated_at = now()
    WHERE id = ${id}
    RETURNING *
  `) as AppRow[];

  return rows[0] ? mapApp(rows[0], existing.dueSoon) : null;
}

export async function deleteApplication(sql: Sql, id: number): Promise<boolean> {
  const rows = (await sql`DELETE FROM applications WHERE id = ${id} RETURNING id`) as { id: number }[];
  return rows.length > 0;
}

export async function listNotes(sql: Sql, applicationId: number): Promise<Note[]> {
  const rows = (await sql`
    SELECT * FROM notes WHERE application_id = ${applicationId} ORDER BY created_at ASC
  `) as Parameters<typeof mapNote>[0][];
  return rows.map(mapNote);
}

export async function createNote(sql: Sql, applicationId: number, body: string): Promise<Note> {
  const rows = (await sql`
    INSERT INTO notes (application_id, body) VALUES (${applicationId}, ${body})
    RETURNING *
  `) as Parameters<typeof mapNote>[0][];
  return mapNote(rows[0]);
}

export async function deleteNote(sql: Sql, id: number): Promise<boolean> {
  const rows = (await sql`DELETE FROM notes WHERE id = ${id} RETURNING id`) as { id: number }[];
  return rows.length > 0;
}

export async function listReminders(sql: Sql, applicationId: number): Promise<Reminder[]> {
  const rows = (await sql`
    SELECT * FROM reminders WHERE application_id = ${applicationId} ORDER BY due_date ASC
  `) as Parameters<typeof mapReminder>[0][];
  return rows.map(mapReminder);
}

export async function createReminder(
  sql: Sql,
  applicationId: number,
  dueDate: string,
  message: string
): Promise<Reminder> {
  const rows = (await sql`
    INSERT INTO reminders (application_id, due_date, message)
    VALUES (${applicationId}, ${dueDate}, ${message})
    RETURNING *
  `) as Parameters<typeof mapReminder>[0][];
  return mapReminder(rows[0]);
}

export async function setReminderCompleted(
  sql: Sql,
  id: number,
  completed: boolean
): Promise<Reminder | null> {
  const rows = (await sql`
    UPDATE reminders SET completed = ${completed}, updated_at = now()
    WHERE id = ${id}
    RETURNING *
  `) as Parameters<typeof mapReminder>[0][];
  return rows[0] ? mapReminder(rows[0]) : null;
}

export async function deleteReminder(sql: Sql, id: number): Promise<boolean> {
  const rows = (await sql`DELETE FROM reminders WHERE id = ${id} RETURNING id`) as { id: number }[];
  return rows.length > 0;
}

export async function listDueSoonReminders(sql: Sql): Promise<(Reminder & { company: string; roleTitle: string })[]> {
  const rows = (await sql`
    SELECT r.*, a.company, a.role_title
    FROM reminders r
    JOIN applications a ON a.id = r.application_id
    WHERE r.completed = false
      AND r.due_date <= (CURRENT_DATE + INTERVAL '3 days')
      AND r.due_date >= CURRENT_DATE
    ORDER BY r.due_date ASC
  `) as (Parameters<typeof mapReminder>[0] & { company: string; role_title: string })[];

  return rows.map((r) => ({
    ...mapReminder(r),
    company: r.company,
    roleTitle: r.role_title,
  }));
}

export async function listDocuments(
  sql: Sql,
  applicationId: number | null
): Promise<Document[]> {
  if (applicationId === null) {
    const rows = (await sql`
      SELECT * FROM documents WHERE application_id IS NULL ORDER BY created_at DESC
    `) as Parameters<typeof mapDoc>[0][];
    return rows.map(mapDoc);
  }
  const rows = (await sql`
    SELECT * FROM documents WHERE application_id = ${applicationId} ORDER BY created_at DESC
  `) as Parameters<typeof mapDoc>[0][];
  return rows.map(mapDoc);
}

export async function getDocumentById(sql: Sql, id: number): Promise<Document | null> {
  const rows = (await sql`SELECT * FROM documents WHERE id = ${id}`) as Parameters<typeof mapDoc>[0][];
  return rows[0] ? mapDoc(rows[0]) : null;
}

export async function createDocument(
  sql: Sql,
  input: {
    type: "resume" | "cover_letter";
    filename: string;
    storageKey: string;
    applicationId: number | null;
  }
): Promise<Document> {
  const rows = (await sql`
    INSERT INTO documents (type, filename, storage_key, application_id)
    VALUES (${input.type}, ${input.filename}, ${input.storageKey}, ${input.applicationId})
    RETURNING *
  `) as Parameters<typeof mapDoc>[0][];
  return mapDoc(rows[0]);
}

export async function deleteDocument(sql: Sql, id: number): Promise<Document | null> {
  const rows = (await sql`
    DELETE FROM documents WHERE id = ${id} RETURNING *
  `) as Parameters<typeof mapDoc>[0][];
  return rows[0] ? mapDoc(rows[0]) : null;
}

export async function listDocumentsForApplication(sql: Sql, applicationId: number): Promise<Document[]> {
  return listDocuments(sql, applicationId);
}

export async function getStats(sql: Sql): Promise<Stats> {
  const apps = await listApplications(sql);
  const reminderRows = (await sql`SELECT * FROM reminders`) as Parameters<typeof mapReminder>[0][];
  const reminders = reminderRows.map(mapReminder);

  const byStatus: Record<string, number> = {
    wishlist: 0,
    applied: 0,
    interview: 0,
    offer: 0,
    rejected: 0,
  };
  for (const a of apps) byStatus[a.status] = (byStatus[a.status] ?? 0) + 1;

  const openPipeline =
    (byStatus.wishlist ?? 0) + (byStatus.applied ?? 0) + (byStatus.interview ?? 0);

  const now = new Date();
  const weeks = new Map<string, number>();
  const months = new Map<string, number>();
  for (const a of apps) {
    const d = new Date(a.createdAt);
    if (Number.isNaN(d.getTime())) continue;
    const weekStart = new Date(d);
    weekStart.setDate(d.getDate() - d.getDay());
    const weekKey = weekStart.toISOString().slice(0, 10);
    weeks.set(weekKey, (weeks.get(weekKey) ?? 0) + 1);
    const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    months.set(monthKey, (months.get(monthKey) ?? 0) + 1);
  }

  const weekCount = Math.max(weeks.size, 1);
  const avgPerWeek = Math.round((apps.length / weekCount) * 10) / 10;

  const industryMap = new Map<string, number>();
  const sourceMap = new Map<string, number>();
  for (const a of apps) {
    industryMap.set(a.industry, (industryMap.get(a.industry) ?? 0) + 1);
    const src = a.source?.trim() || "Unknown";
    sourceMap.set(src, (sourceMap.get(src) ?? 0) + 1);
  }

  const wishlist = byStatus.wishlist ?? 0;
  const applied = byStatus.applied ?? 0;
  const interview = byStatus.interview ?? 0;
  const offer = byStatus.offer ?? 0;
  const pct = (num: number, den: number) => (den === 0 ? 0 : Math.round((num / den) * 1000) / 10);

  const open = reminders.filter((r) => !r.completed).length;
  const dueSoon = reminders.filter((r) => r.dueSoon).length;
  const completed = reminders.filter((r) => r.completed).length;
  const overdue = reminders.filter((r) => {
    if (r.completed) return false;
    const due = new Date(r.dueDate + "T23:59:59");
    return due < now;
  }).length;

  return {
    total: apps.length,
    openPipeline,
    avgPerWeek,
    remindersOpen: open,
    remindersDueSoon: dueSoon,
    byStatus,
    funnel: {
      wishlistToApplied: pct(applied + interview + offer, wishlist + applied + interview + offer),
      appliedToInterview: pct(interview + offer, applied + interview + offer),
      interviewToOffer: pct(offer, interview + offer),
    },
    byIndustry: [...industryMap.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
    bySource: [...sourceMap.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
    perWeek: [...weeks.entries()]
      .map(([week, count]) => ({ week, count }))
      .sort((a, b) => a.week.localeCompare(b.week))
      .slice(-12),
    perMonth: [...months.entries()]
      .map(([month, count]) => ({ month, count }))
      .sort((a, b) => a.month.localeCompare(b.month))
      .slice(-12),
    reminderHealth: { open, dueSoon, completed, overdue },
  };
}

export const SETTING_NOTIFY_TO = "notify_to";

export async function getSetting(sql: Sql, key: string): Promise<string | null> {
  const rows = (await sql`
    SELECT value FROM app_settings WHERE key = ${key}
  `) as { value: string }[];
  return rows[0]?.value ?? null;
}

export async function setSetting(sql: Sql, key: string, value: string): Promise<void> {
  await sql`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (${key}, ${value}, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
  `;
}

/** DB setting first, then DIGEST_TO env fallback. */
export async function resolveNotifyRecipients(
  sql: Sql,
  digestToFallback?: string
): Promise<string[]> {
  const fromDb = await getSetting(sql, SETTING_NOTIFY_TO);
  const list = parseEmailList(fromDb);
  if (list.length > 0) return list;
  return parseEmailList(digestToFallback);
}

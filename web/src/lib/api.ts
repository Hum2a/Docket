import type {
  Application,
  CreateApplication,
  UpdateApplication,
  Note,
  Reminder,
  Document,
  Stats,
  DocumentType,
} from "@shared/schema";
import type { CreateLead, Lead, OutreachSettings, UpdateLead } from "@shared/outreach";

export type LeadNote = { id: number; leadId: number; body: string; createdAt: string };
export type LeadReminder = {
  id: number;
  leadId: number;
  dueDate: string;
  message: string;
  completed: boolean;
  createdAt: string;
};
export type LeadMessage = {
  id: number;
  leadId: number;
  direction: string;
  channel: string;
  subject: string | null;
  body: string | null;
  providerMessageId: string | null;
  status: string;
  error: string | null;
  createdAt: string;
};
export type LeadStats = {
  total: number;
  byStatus: Record<string, number>;
  funnel: { sourced: number; sent: number; replied: number; interested: number; won: number };
  replyRate: number;
  positiveReplyRate: number;
  revenue: number;
  reviewQueue: number;
};
export type OutreachSettingsView = OutreachSettings & { sentToday: number };

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

export type OutreachAnalytics = {
  totals: {
    sent: number;
    delivered: number;
    bounced: number;
    complained: number;
    failed: number;
    replied: number;
    positive: number;
    unsubscribed: number;
    won: number;
    revenue: number;
  };
  rates: {
    delivery: { num: number; den: number };
    reply: { num: number; den: number };
    positive: { num: number; den: number };
  };
  bySubjectVariant: Array<{ variant: string; sent: number; replied: number }>;
  bySignal: Array<{ signal: string; sent: number; replied: number }>;
  byIndustry: Array<{ industry: string; sent: number; replied: number }>;
  byTemplate: Array<{ templateId: string; sent: number; replied: number }>;
  timeToReplyHours: { median: number | null; n: number };
  sentPerDay: Array<{ date: string; sent: number }>;
};

export type PreflightCheckKey =
  | "sending_domain_set"
  | "from_address_set"
  | "from_domain_not_primary"
  | "postal_address_set"
  | "unsubscribe_key_set"
  | "resend_key_set"
  | "reply_to_set";

export type OutreachPreflight = {
  ready: boolean;
  checks: Record<PreflightCheckKey, boolean>;
  blocking: PreflightCheckKey[];
  warnings: PreflightCheckKey[];
};

const KEY_STORAGE = "docket_api_key";

export class ApiAuthError extends Error {
  constructor(message = "Enter your API key in Settings to load outreach data.") {
    super(message);
    this.name = "ApiAuthError";
  }
}

/** Read the stored key — never logs it, never puts it in a URL. */
export function getApiKey(): string | null {
  try {
    return localStorage.getItem(KEY_STORAGE);
  } catch {
    return null;
  }
}

export function setApiKey(key: string): void {
  localStorage.setItem(KEY_STORAGE, key.trim());
}

export function clearApiKey(): void {
  localStorage.removeItem(KEY_STORAGE);
}

async function request<T>(
  path: string,
  opts: RequestInit & { auth?: boolean } = {}
): Promise<T> {
  const headers = new Headers(opts.headers);
  if (opts.auth) {
    const key = getApiKey();
    if (!key) throw new ApiAuthError();
    headers.set("X-Api-Key", key);
  }
  if (opts.body && !(opts.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(path, { ...opts, headers });
  if (res.status === 401 && opts.auth) {
    clearApiKey();
    throw new ApiAuthError("API key missing or invalid — enter it in Settings.");
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

/** Authenticated download for CSV exports (cannot use bare <a href>). */
async function downloadAuthenticated(path: string, filename: string): Promise<void> {
  const key = getApiKey();
  if (!key) throw new ApiAuthError();
  const res = await fetch(path, { headers: { "X-Api-Key": key } });
  if (res.status === 401) {
    clearApiKey();
    throw new ApiAuthError("API key missing or invalid — enter it in Settings.");
  }
  if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export const api = {
  listApplications: (params?: Record<string, string>) => {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    return request<Application[]>(`/api/applications${qs}`);
  },
  getApplication: (id: number) => request<Application>(`/api/applications/${id}`),
  createApplication: (body: CreateApplication) =>
    request<Application>("/api/applications", {
      method: "POST",
      auth: true,
      body: JSON.stringify(body),
    }),
  updateApplication: (id: number, body: UpdateApplication) =>
    request<Application>(`/api/applications/${id}`, {
      method: "PATCH",
      auth: true,
      body: JSON.stringify(body),
    }),
  deleteApplication: (id: number) =>
    request<{ ok: boolean }>(`/api/applications/${id}`, { method: "DELETE", auth: true }),

  listNotes: (id: number) => request<Note[]>(`/api/applications/${id}/notes`),
  createNote: (id: number, body: string) =>
    request<Note>(`/api/applications/${id}/notes`, {
      method: "POST",
      auth: true,
      body: JSON.stringify({ body }),
    }),
  deleteNote: (id: number) =>
    request<{ ok: boolean }>(`/api/notes/${id}`, { method: "DELETE", auth: true }),

  listReminders: (id: number) => request<Reminder[]>(`/api/applications/${id}/reminders`),
  createReminder: (id: number, dueDate: string, message: string) =>
    request<Reminder>(`/api/applications/${id}/reminders`, {
      method: "POST",
      auth: true,
      body: JSON.stringify({ dueDate, message }),
    }),
  toggleReminder: (id: number, completed: boolean) =>
    request<Reminder>(`/api/reminders/${id}`, {
      method: "PATCH",
      auth: true,
      body: JSON.stringify({ completed }),
    }),
  deleteReminder: (id: number) =>
    request<{ ok: boolean }>(`/api/reminders/${id}`, { method: "DELETE", auth: true }),

  listDocuments: (applicationId: number | null) =>
    request<Document[]>(
      `/api/documents?applicationId=${applicationId === null ? "null" : applicationId}`
    ),
  uploadDocument: async (file: File, type: DocumentType, applicationId: number | null) => {
    const form = new FormData();
    form.append("file", file);
    form.append("type", type);
    if (applicationId != null) form.append("applicationId", String(applicationId));
    return request<Document>("/api/documents", { method: "POST", auth: true, body: form });
  },
  downloadDocument: async (id: number) => {
    const { url } = await request<{ url: string; expires: number }>(`/api/documents/${id}/url`, {
      auth: true,
    });
    window.open(url, "_blank");
  },
  deleteDocument: (id: number) =>
    request<{ ok: boolean }>(`/api/documents/${id}`, { method: "DELETE", auth: true }),

  getStats: () => request<Stats>("/api/stats"),

  importApplications: (payload: unknown) =>
    request<{ inserted: number[] }>("/api/import", {
      method: "POST",
      auth: true,
      body: JSON.stringify(payload),
    }),

  getSettings: () =>
    request<{ notifyTo: string; effectiveNotifyTo: string[]; from: string }>("/api/settings"),

  updateSettings: (notifyTo: string) =>
    request<{ notifyTo: string; effectiveNotifyTo: string[]; from: string }>("/api/settings", {
      method: "PATCH",
      auth: true,
      body: JSON.stringify({ notifyTo }),
    }),

  runDigest: () =>
    request<{ sent: boolean; reason?: string; count: number }>("/api/digest/run", {
      method: "POST",
      auth: true,
    }),

  sendTestEmail: () =>
    request<{ sent: boolean; reason?: string }>("/api/email/test", {
      method: "POST",
      auth: true,
    }),

  listLeads: (params?: Record<string, string>) => {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    return request<{ leads: Lead[]; nextCursor: string | null; total: number }>(`/api/leads${qs}`, {
      auth: true,
    });
  },
  getLead: (id: number) => request<Lead>(`/api/leads/${id}`, { auth: true }),
  getOutreachPreview: (id: number) =>
    request<{
      subject: string;
      text: string;
      bodyBeforeFooter: string;
      templateId: string;
      source: "custom" | "generated";
      signal: string;
    }>(`/api/leads/${id}/outreach-preview`, { auth: true }),
  createLead: (body: CreateLead) =>
    request<Lead>("/api/leads", { method: "POST", auth: true, body: JSON.stringify(body) }),
  updateLead: (id: number, body: UpdateLead) =>
    request<Lead>(`/api/leads/${id}`, { method: "PATCH", auth: true, body: JSON.stringify(body) }),
  deleteLead: (id: number) =>
    request<{ ok: boolean }>(`/api/leads/${id}`, { method: "DELETE", auth: true }),
  bulkLeads: (leads: CreateLead[]) =>
    request<{ created: number[]; updated: number[]; skipped: number; errors: string[] }>(
      "/api/leads/bulk",
      {
        method: "POST",
        auth: true,
        body: JSON.stringify({ leads }),
      }
    ),
  getLeadStats: () => request<LeadStats>("/api/leads/stats", { auth: true }),

  listLeadNotes: (id: number) => request<LeadNote[]>(`/api/leads/${id}/notes`, { auth: true }),
  createLeadNote: (id: number, body: string) =>
    request<LeadNote>(`/api/leads/${id}/notes`, {
      method: "POST",
      auth: true,
      body: JSON.stringify({ body }),
    }),
  deleteLeadNote: (id: number) =>
    request<{ ok: boolean }>(`/api/lead-notes/${id}`, { method: "DELETE", auth: true }),

  listLeadReminders: (id: number) =>
    request<LeadReminder[]>(`/api/leads/${id}/reminders`, { auth: true }),
  createLeadReminder: (id: number, dueDate: string, message: string) =>
    request<LeadReminder>(`/api/leads/${id}/reminders`, {
      method: "POST",
      auth: true,
      body: JSON.stringify({ dueDate, message }),
    }),
  toggleLeadReminder: (id: number, completed: boolean) =>
    request<LeadReminder>(`/api/lead-reminders/${id}`, {
      method: "PATCH",
      auth: true,
      body: JSON.stringify({ completed }),
    }),
  deleteLeadReminder: (id: number) =>
    request<{ ok: boolean }>(`/api/lead-reminders/${id}`, { method: "DELETE", auth: true }),

  listLeadMessages: (id: number) =>
    request<LeadMessage[]>(`/api/leads/${id}/messages`, { auth: true }),
  sendLead: (id: number, body?: { manual?: boolean; overrideDryRun?: boolean }) =>
    request<{ ok?: boolean; sent?: boolean; dryRun?: boolean; reasons?: string[]; error?: string; messageId?: number }>(
      `/api/leads/${id}/send`,
      { method: "POST", auth: true, body: JSON.stringify(body ?? { manual: true }) }
    ),
  getSendReadiness: (id: number) =>
    request<{
      ok: boolean;
      reasons: string[];
      labels: string[];
      preflightReady: boolean;
      preflightBlocking: string[];
      dryRun: boolean;
      blocking: string[];
    }>(`/api/leads/${id}/send-readiness`, { auth: true }),
  approveLead: (id: number) =>
    request<{ approved: boolean; ok?: boolean; dryRun?: boolean; reasons?: string[] }>(
      `/api/leads/${id}/approve`,
      { method: "POST", auth: true }
    ),

  getOutreachSettings: () =>
    request<OutreachSettingsView>("/api/outreach/settings", { auth: true }),
  getOutreachPreflight: () => request<OutreachPreflight>("/api/outreach/preflight"),
  listOutreachMessages: (params?: Record<string, string>) => {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    return request<{
      messages: OutreachMessageListItem[];
      nextCursor: string | null;
      total: number;
    }>(`/api/outreach/messages${qs}`, { auth: true });
  },
  getOutreachMessage: (id: number) =>
    request<OutreachMessageListItem & { body: string | null }>(`/api/outreach/messages/${id}`, {
      auth: true,
    }),
  getOutreachAnalytics: () => request<OutreachAnalytics>("/api/outreach/analytics", { auth: true }),
  exportOutreachMessagesCsv: (params?: Record<string, string>) => {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    return downloadAuthenticated(`/api/outreach/messages.csv${qs}`, "outreach-messages.csv");
  },
  updateOutreachSettings: (body: Record<string, unknown>) =>
    request<OutreachSettingsView>("/api/outreach/settings", {
      method: "PATCH",
      auth: true,
      body: JSON.stringify(body),
    }),
  addSuppression: (value: string, kind: "email" | "domain", reason?: string) =>
    request<{ ok: boolean }>("/api/suppressions", {
      method: "POST",
      auth: true,
      body: JSON.stringify({ value, kind, reason }),
    }),
  runAutosend: () =>
    request<{ results: unknown[] }>("/api/outreach/autosend", { method: "POST", auth: true }),
  runSequence: () =>
    request<{ results: unknown[] }>("/api/outreach/sequence", { method: "POST", auth: true }),
  exportLeadsCsv: (params?: Record<string, string>) => {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    return downloadAuthenticated(`/api/outreach/export.csv${qs}`, "outreach-leads.csv");
  },
};

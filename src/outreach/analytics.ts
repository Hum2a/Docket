/**
 * Outreach analytics + small-sample display rules.
 * Threshold lives in ONE constant — lower it deliberately, not by accident.
 */

export {
  SMALL_SAMPLE_THRESHOLD,
  TIME_TO_REPLY_MIN_N,
  formatRate,
  rateIsSmallSample,
  type RateFraction,
} from "../../shared/analyticsRates";

import {
  TIME_TO_REPLY_MIN_N,
  type RateFraction,
} from "../../shared/analyticsRates";

export type BreakdownRow = {
  sent: number;
  replied: number;
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
    delivery: RateFraction;
    reply: RateFraction;
    positive: RateFraction;
  };
  bySubjectVariant: Array<{ variant: string; sent: number; replied: number }>;
  bySignal: Array<{ signal: string; sent: number; replied: number }>;
  byIndustry: Array<{ industry: string; sent: number; replied: number }>;
  byTemplate: Array<{ templateId: string; sent: number; replied: number }>;
  timeToReplyHours: { median: number | null; n: number };
  sentPerDay: Array<{ date: string; sent: number }>;
};

export type AnalyticsMessage = {
  id: number;
  leadId: number;
  direction: string;
  status: string;
  templateId: string | null;
  variant: string | null;
  sentAt: string | null;
  createdAt: string;
};

export type AnalyticsLead = {
  id: number;
  industry: string | null;
  repliedAt: string | null;
  replySentiment: string | null;
  status: string;
  offerAmount: number;
  audit: Record<string, unknown>;
};

const OUTBOUND_COUNTED = new Set(["sent", "delivered", "bounced", "complained"]);

function outreachSignal(audit: Record<string, unknown>): string | null {
  const raw = audit?.outreach;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const signal = (raw as Record<string, unknown>).signal;
  return typeof signal === "string" && signal.trim() ? signal.trim() : null;
}

function bump(
  map: Map<string, { sent: number; repliedLeadIds: Set<number> }>,
  key: string,
  leadId: number,
  leadReplied: boolean
): void {
  let row = map.get(key);
  if (!row) {
    row = { sent: 0, repliedLeadIds: new Set() };
    map.set(key, row);
  }
  row.sent += 1;
  if (leadReplied) row.repliedLeadIds.add(leadId);
}

function mapToBreakdown<T extends string>(
  map: Map<string, { sent: number; repliedLeadIds: Set<number> }>,
  keyName: T
): Array<Record<T, string> & { sent: number; replied: number }> {
  const rows = [...map.entries()].map(([key, v]) => ({
    [keyName]: key,
    sent: v.sent,
    replied: v.repliedLeadIds.size,
  })) as Array<Record<T, string> & { sent: number; replied: number }>;
  return sortBreakdownByVolume(rows);
}

/** Always sort by volume — never by rate (small samples would dominate). */
export function sortBreakdownByVolume<T extends BreakdownRow>(rows: T[]): T[] {
  return [...rows].sort((a, b) => b.sent - a.sent || b.replied - a.replied);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
}

/** Pure analytics from fixtures — used by tests and by the DB loader. */
export function computeOutreachAnalytics(
  messages: AnalyticsMessage[],
  leads: AnalyticsLead[]
): OutreachAnalytics {
  const leadById = new Map(leads.map((l) => [l.id, l]));

  let sent = 0;
  let delivered = 0;
  let bounced = 0;
  let complained = 0;
  let failed = 0;

  const outboundAttempted: AnalyticsMessage[] = [];
  const sentPerDayMap = new Map<string, number>();

  for (const m of messages) {
    if (m.direction !== "out") continue;
    if (m.status === "failed") failed += 1;
    if (m.status === "delivered") delivered += 1;
    if (m.status === "bounced") bounced += 1;
    if (m.status === "complained") complained += 1;
    if (OUTBOUND_COUNTED.has(m.status)) {
      sent += 1;
      outboundAttempted.push(m);
      const day = (m.sentAt || m.createdAt).slice(0, 10);
      sentPerDayMap.set(day, (sentPerDayMap.get(day) ?? 0) + 1);
    }
  }

  const repliedLeads = leads.filter((l) => Boolean(l.repliedAt));
  const positive = leads.filter((l) => l.replySentiment === "positive").length;
  const unsubscribed = leads.filter((l) => l.status === "unsubscribed").length;
  const wonLeads = leads.filter((l) => l.status === "won");
  const revenue = wonLeads.reduce((s, l) => s + Number(l.offerAmount || 0), 0);

  // Reply rate denominator: distinct leads with at least one counted outbound
  const leadsWithOutbound = new Set(outboundAttempted.map((m) => m.leadId));
  const repliedAmongSent = [...leadsWithOutbound].filter((id) => {
    const lead = leadById.get(id);
    return Boolean(lead?.repliedAt);
  }).length;

  const byVariant = new Map<string, { sent: number; repliedLeadIds: Set<number> }>();
  const bySignal = new Map<string, { sent: number; repliedLeadIds: Set<number> }>();
  const byIndustry = new Map<string, { sent: number; repliedLeadIds: Set<number> }>();
  const byTemplate = new Map<string, { sent: number; repliedLeadIds: Set<number> }>();

  for (const m of outboundAttempted) {
    const lead = leadById.get(m.leadId);
    const leadReplied = Boolean(lead?.repliedAt);
    if (m.variant) bump(byVariant, m.variant, m.leadId, leadReplied);
    const signal = lead ? outreachSignal(lead.audit) : null;
    if (signal) bump(bySignal, signal, m.leadId, leadReplied);
    const industry = lead?.industry?.trim() || "unknown";
    bump(byIndustry, industry, m.leadId, leadReplied);
    const templateId = m.templateId?.trim() || "unknown";
    bump(byTemplate, templateId, m.leadId, leadReplied);
  }

  const replyHours: number[] = [];
  for (const lead of repliedLeads) {
    if (!lead.repliedAt) continue;
    const firstOut = outboundAttempted
      .filter((m) => m.leadId === lead.id)
      .sort((a, b) => (a.sentAt || a.createdAt).localeCompare(b.sentAt || b.createdAt))[0];
    if (!firstOut) continue;
    const start = new Date(firstOut.sentAt || firstOut.createdAt).getTime();
    const end = new Date(lead.repliedAt).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) continue;
    replyHours.push((end - start) / (1000 * 60 * 60));
  }

  const sentPerDay = [...sentPerDayMap.entries()]
    .map(([date, n]) => ({ date, sent: n }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    totals: {
      sent,
      delivered,
      bounced,
      complained,
      failed,
      replied: repliedLeads.length,
      positive,
      unsubscribed,
      won: wonLeads.length,
      revenue,
    },
    rates: {
      delivery: { num: delivered, den: sent },
      reply: { num: repliedAmongSent, den: leadsWithOutbound.size },
      positive: { num: positive, den: repliedLeads.length },
    },
    bySubjectVariant: mapToBreakdown(byVariant, "variant"),
    bySignal: mapToBreakdown(bySignal, "signal"),
    byIndustry: mapToBreakdown(byIndustry, "industry"),
    byTemplate: mapToBreakdown(byTemplate, "templateId"),
    timeToReplyHours: {
      median: replyHours.length >= TIME_TO_REPLY_MIN_N ? median(replyHours) : null,
      n: replyHours.length,
    },
    sentPerDay,
  };
}

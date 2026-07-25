import { describe, expect, it } from "vitest";
import {
  computeOutreachAnalytics,
  formatRate,
  rateIsSmallSample,
  SMALL_SAMPLE_THRESHOLD,
  sortBreakdownByVolume,
  type AnalyticsLead,
  type AnalyticsMessage,
} from "./analytics";
import {
  encodeMessageCursor,
  pageMessagesInMemory,
  truncateBodyPreview,
} from "./messageCursor";

function msg(over: Partial<AnalyticsMessage> & { id: number }): AnalyticsMessage {
  return {
    leadId: 1,
    direction: "out",
    status: "sent",
    templateId: "initial",
    variant: "A",
    sentAt: "2026-07-20T10:00:00.000Z",
    createdAt: "2026-07-20T10:00:00.000Z",
    ...over,
  };
}

function lead(over: Partial<AnalyticsLead> & { id: number }): AnalyticsLead {
  return {
    industry: "garage",
    repliedAt: null,
    replySentiment: null,
    status: "sent",
    offerAmount: 500,
    audit: {},
    ...over,
  };
}

describe("message keyset pagination", () => {
  const rows = [
    { id: 1, createdAt: "2026-07-21T12:00:00.000Z", subject: "a" },
    { id: 2, createdAt: "2026-07-22T12:00:00.000Z", subject: "b" },
    { id: 3, createdAt: "2026-07-22T12:00:00.000Z", subject: "c" },
    { id: 4, createdAt: "2026-07-23T12:00:00.000Z", subject: "d" },
    { id: 5, createdAt: "2026-07-24T12:00:00.000Z", subject: "e" },
  ];

  it("returns stable non-overlapping pages", () => {
    const page1 = pageMessagesInMemory(rows, { limit: 2 });
    expect(page1.messages.map((m) => m.id)).toEqual([5, 4]);
    expect(page1.total).toBe(5);
    expect(page1.nextCursor).toBeTruthy();

    const page2 = pageMessagesInMemory(rows, { limit: 2, cursor: page1.nextCursor });
    expect(page2.messages.map((m) => m.id)).toEqual([3, 2]);
    const ids = new Set([...page1.messages, ...page2.messages].map((m) => m.id));
    expect(ids.size).toBe(4);

    const page3 = pageMessagesInMemory(rows, { limit: 2, cursor: page2.nextCursor });
    expect(page3.messages.map((m) => m.id)).toEqual([1]);
    expect(page3.nextCursor).toBeNull();
  });

  it("filters combine; total respects filters and ignores cursor", () => {
    const filter = (r: (typeof rows)[0]) => r.subject === "b" || r.subject === "c" || r.subject === "d";
    const page1 = pageMessagesInMemory(rows, { limit: 1, filter });
    expect(page1.total).toBe(3);
    expect(page1.messages).toHaveLength(1);
    const page2 = pageMessagesInMemory(rows, {
      limit: 1,
      cursor: page1.nextCursor,
      filter,
    });
    expect(page2.total).toBe(3);
    expect(page2.messages[0]!.id).not.toBe(page1.messages[0]!.id);
  });

  it("encode/decode round-trips", () => {
    const c = encodeMessageCursor({ t: "2026-07-25T00:00:00.000Z", i: 9 });
    const page = pageMessagesInMemory(rows, { limit: 1, cursor: c });
    expect(page.messages.every((m) => m.createdAt < "2026-07-25T00:00:00.000Z" || m.id < 9)).toBe(
      true
    );
  });
});

describe("truncateBodyPreview", () => {
  it("truncates long bodies", () => {
    expect(truncateBodyPreview("x".repeat(200))?.endsWith("…")).toBe(true);
    expect(truncateBodyPreview("short")).toBe("short");
  });
});

describe("analytics fixture", () => {
  const messages: AnalyticsMessage[] = [
    msg({
      id: 1,
      leadId: 10,
      variant: "A",
      templateId: "custom",
      status: "delivered",
      createdAt: "2026-07-20T10:00:00.000Z",
      sentAt: "2026-07-20T10:00:00.000Z",
    }),
    msg({
      id: 2,
      leadId: 11,
      variant: "B",
      templateId: "initial",
      status: "sent",
      createdAt: "2026-07-21T10:00:00.000Z",
      sentAt: "2026-07-21T10:00:00.000Z",
    }),
    msg({
      id: 3,
      leadId: 12,
      variant: "A",
      templateId: "initial",
      status: "bounced",
      createdAt: "2026-07-21T11:00:00.000Z",
      sentAt: "2026-07-21T11:00:00.000Z",
    }),
    msg({
      id: 4,
      leadId: 10,
      direction: "in",
      status: "delivered",
      templateId: null,
      variant: null,
      createdAt: "2026-07-22T10:00:00.000Z",
      sentAt: null,
    }),
  ];

  const leads: AnalyticsLead[] = [
    lead({
      id: 10,
      industry: "garage",
      repliedAt: "2026-07-22T10:00:00.000Z",
      replySentiment: "positive",
      status: "replied",
      audit: { outreach: { signal: "broken_form", subjectVariant: "A", originalSubject: "x" } },
    }),
    lead({
      id: 11,
      industry: "accountants",
      audit: { outreach: { signal: "broken_links", subjectVariant: "B", originalSubject: "y" } },
    }),
    lead({
      id: 12,
      industry: "garage",
      status: "lost",
      audit: { outreach: { signal: "broken_form", subjectVariant: "A", originalSubject: "z" } },
    }),
  ];

  it("counts match the seeded fixture exactly", () => {
    const a = computeOutreachAnalytics(messages, leads);
    expect(a.totals.sent).toBe(3);
    expect(a.totals.delivered).toBe(1);
    expect(a.totals.bounced).toBe(1);
    expect(a.totals.complained).toBe(0);
    expect(a.totals.failed).toBe(0);
    expect(a.totals.replied).toBe(1);
    expect(a.totals.positive).toBe(1);
    expect(a.rates.delivery).toEqual({ num: 1, den: 3 });
    expect(a.rates.reply).toEqual({ num: 1, den: 3 });
    expect(a.byTemplate.find((r) => r.templateId === "custom")).toEqual({
      templateId: "custom",
      sent: 1,
      replied: 1,
    });
    expect(a.byTemplate.find((r) => r.templateId === "initial")).toEqual({
      templateId: "initial",
      sent: 2,
      replied: 0,
    });
  });

  it("bySignal reads leads.audit.outreach.signal", () => {
    const a = computeOutreachAnalytics(messages, leads);
    const bf = a.bySignal.find((r) => r.signal === "broken_form");
    expect(bf).toEqual({ signal: "broken_form", sent: 2, replied: 1 });
    const bl = a.bySignal.find((r) => r.signal === "broken_links");
    expect(bl).toEqual({ signal: "broken_links", sent: 1, replied: 0 });
  });

  it("sentPerDay aggregates", () => {
    const a = computeOutreachAnalytics(messages, leads);
    expect(a.sentPerDay).toEqual([
      { date: "2026-07-20", sent: 1 },
      { date: "2026-07-21", sent: 2 },
    ]);
  });
});

describe("small-sample guard", () => {
  it("rate with den < 20 renders as fraction with no %", () => {
    const text = formatRate({ num: 1, den: 3 });
    expect(text).toBe("1 of 3");
    expect(text).not.toContain("%");
    expect(rateIsSmallSample(3)).toBe(true);
  });

  it("rate at threshold may include %", () => {
    const text = formatRate({ num: 10, den: SMALL_SAMPLE_THRESHOLD });
    expect(text).toContain("%");
    expect(text).toContain("10 of 20");
  });

  it("breakdown tables sort by volume, never by rate", () => {
    const rows = sortBreakdownByVolume([
      { signal: "a", sent: 2, replied: 2 }, // 100% but tiny
      { signal: "b", sent: 50, replied: 5 },
      { signal: "c", sent: 10, replied: 0 },
    ]);
    expect(rows.map((r) => r.signal)).toEqual(["b", "c", "a"]);
  });
});

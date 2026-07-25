import { describe, expect, it } from "vitest";
import {
  clampLeadLimit,
  decodeLeadCursor,
  encodeLeadCursor,
  isAfterLeadCursor,
  pageLeadsInMemory,
} from "./leadCursor";

describe("leadCursor", () => {
  it("clamps limit above 200 and defaults invalid", () => {
    expect(clampLeadLimit(500)).toBe(200);
    expect(clampLeadLimit(0)).toBe(50);
    expect(clampLeadLimit(undefined)).toBe(50);
    expect(clampLeadLimit(25)).toBe(25);
  });

  it("round-trips cursor encode/decode", () => {
    const c = { p: 9.5, i: 42 };
    expect(decodeLeadCursor(encodeLeadCursor(c))).toEqual(c);
    expect(decodeLeadCursor(encodeLeadCursor({ p: null, i: 7 }))).toEqual({ p: null, i: 7 });
  });

  it("keyset pages are stable and non-overlapping when a row is inserted mid-flight", () => {
    const base = [
      { id: 1, priorityScore: 10 },
      { id: 2, priorityScore: 9 },
      { id: 3, priorityScore: 8 },
      { id: 4, priorityScore: 7 },
      { id: 5, priorityScore: 6 },
    ];
    const page1 = pageLeadsInMemory(base, { limit: 2 });
    expect(page1.leads.map((l) => l.id)).toEqual([1, 2]);
    expect(page1.total).toBe(5);
    expect(page1.nextCursor).not.toBeNull();

    // Insert between pages after page1 was taken
    const withInsert = [
      ...base,
      { id: 99, priorityScore: 8.5 }, // would sit between 2 and 3 in full sort
    ];
    const page2 = pageLeadsInMemory(withInsert, {
      limit: 2,
      cursor: page1.nextCursor,
    });
    const ids1 = new Set(page1.leads.map((l) => l.id));
    const ids2 = page2.leads.map((l) => l.id);
    for (const id of ids2) expect(ids1.has(id)).toBe(false);
    // Inserted row appears on page2 (after cursor at id=2 / score=9)
    expect(ids2).toContain(99);
  });

  it("filters combine with cursor; total ignores cursor", () => {
    const rows = [
      { id: 1, priorityScore: 10, status: "sent" },
      { id: 2, priorityScore: 9, status: "queued" },
      { id: 3, priorityScore: 8, status: "sent" },
      { id: 4, priorityScore: 7, status: "sent" },
    ];
    const page1 = pageLeadsInMemory(rows, {
      limit: 1,
      filter: (r) => r.status === "sent",
    });
    expect(page1.total).toBe(3);
    expect(page1.leads[0]!.id).toBe(1);
    const page2 = pageLeadsInMemory(rows, {
      limit: 1,
      cursor: page1.nextCursor,
      filter: (r) => r.status === "sent",
    });
    expect(page2.total).toBe(3);
    expect(page2.leads[0]!.id).toBe(3);
  });

  it("isAfterLeadCursor matches DESC NULLS LAST semantics", () => {
    const cursor = { p: 8, i: 10 };
    expect(isAfterLeadCursor({ priorityScore: 7, id: 1 }, cursor)).toBe(true);
    expect(isAfterLeadCursor({ priorityScore: 8, id: 9 }, cursor)).toBe(true);
    expect(isAfterLeadCursor({ priorityScore: 8, id: 11 }, cursor)).toBe(false);
    expect(isAfterLeadCursor({ priorityScore: 9, id: 1 }, cursor)).toBe(false);
    expect(isAfterLeadCursor({ priorityScore: null, id: 1 }, cursor)).toBe(true);
  });
});

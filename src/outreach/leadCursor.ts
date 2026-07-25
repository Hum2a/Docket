/** Keyset pagination helpers for GET /api/leads (priority DESC, id DESC). */

export type LeadCursor = { p: number | null; i: number };

export function clampLeadLimit(limit: number | undefined): number {
  const n = Number.isFinite(limit) ? Math.floor(Number(limit)) : 50;
  if (!Number.isFinite(n) || n < 1) return 50;
  return Math.min(n, 200);
}

export function encodeLeadCursor(c: LeadCursor): string {
  const json = JSON.stringify({ p: c.p, i: c.i });
  // btoa works in Workers; Buffer in Node tests
  if (typeof btoa === "function") {
    return btoa(json).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  return Buffer.from(json, "utf8").toString("base64url");
}

export function decodeLeadCursor(raw: string | undefined | null): LeadCursor | null {
  if (!raw?.trim()) return null;
  try {
    let json: string;
    const s = raw.replace(/-/g, "+").replace(/_/g, "/");
    const pad = s + "=".repeat((4 - (s.length % 4)) % 4);
    if (typeof atob === "function") {
      json = atob(pad);
    } else {
      json = Buffer.from(raw, "base64url").toString("utf8");
    }
    const parsed = JSON.parse(json) as { p?: unknown; i?: unknown };
    const i = Number(parsed.i);
    if (!Number.isInteger(i)) return null;
    const p =
      parsed.p === null || parsed.p === undefined
        ? null
        : Number.isFinite(Number(parsed.p))
          ? Number(parsed.p)
          : null;
    if (parsed.p !== null && parsed.p !== undefined && p === null) return null;
    return { p, i };
  } catch {
    return null;
  }
}

/**
 * Sort key for priority_score DESC NULLS LAST, id DESC.
 * Returns negative if a should appear before b (higher priority / higher id).
 */
export function compareLeadSort(
  a: { priorityScore: number | null; id: number },
  b: { priorityScore: number | null; id: number }
): number {
  const ap = a.priorityScore;
  const bp = b.priorityScore;
  if (ap != null && bp != null && ap !== bp) return bp - ap; // DESC
  if (ap != null && bp == null) return -1; // non-null before null
  if (ap == null && bp != null) return 1;
  return b.id - a.id; // DESC
}

/** True if row comes strictly after cursor in DESC NULLS LAST, id DESC order. */
export function isAfterLeadCursor(
  row: { priorityScore: number | null; id: number },
  cursor: LeadCursor
): boolean {
  return compareLeadSort(row, { priorityScore: cursor.p, id: cursor.i }) > 0;
}

/** In-memory keyset page — used in tests and as reference for SQL semantics. */
export function pageLeadsInMemory<T extends { priorityScore: number | null; id: number }>(
  rows: T[],
  opts: {
    limit?: number;
    cursor?: string | null;
    filter?: (row: T) => boolean;
  } = {}
): { leads: T[]; nextCursor: string | null; total: number } {
  const limit = clampLeadLimit(opts.limit);
  const filtered = (opts.filter ? rows.filter(opts.filter) : rows).slice();
  filtered.sort(compareLeadSort);
  const total = filtered.length;
  const cursor = decodeLeadCursor(opts.cursor ?? null);
  const after = cursor ? filtered.filter((r) => isAfterLeadCursor(r, cursor)) : filtered;
  const leads = after.slice(0, limit);
  const nextCursor =
    leads.length === limit && leads.length > 0
      ? encodeLeadCursor({
          p: leads[leads.length - 1]!.priorityScore,
          i: leads[leads.length - 1]!.id,
        })
      : null;
  return { leads, nextCursor, total };
}

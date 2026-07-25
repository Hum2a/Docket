/** Keyset pagination for GET /api/outreach/messages (created_at DESC, id DESC). */

export type MessageCursor = { t: string; i: number };

export function clampMessageLimit(limit: number | undefined): number {
  const n = Number.isFinite(limit) ? Math.floor(Number(limit)) : 50;
  if (!Number.isFinite(n) || n < 1) return 50;
  return Math.min(n, 200);
}

export function encodeMessageCursor(c: MessageCursor): string {
  const json = JSON.stringify({ t: c.t, i: c.i });
  if (typeof btoa === "function") {
    return btoa(json).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  return Buffer.from(json, "utf8").toString("base64url");
}

export function decodeMessageCursor(raw: string | undefined | null): MessageCursor | null {
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
    const parsed = JSON.parse(json) as { t?: unknown; i?: unknown };
    const i = Number(parsed.i);
    const t = typeof parsed.t === "string" ? parsed.t : null;
    if (!Number.isInteger(i) || !t) return null;
    return { t, i };
  } catch {
    return null;
  }
}

export function compareMessageSort(
  a: { createdAt: string; id: number },
  b: { createdAt: string; id: number }
): number {
  if (a.createdAt !== b.createdAt) {
    return a.createdAt < b.createdAt ? 1 : -1; // DESC
  }
  return b.id - a.id;
}

export function isAfterMessageCursor(
  row: { createdAt: string; id: number },
  cursor: MessageCursor
): boolean {
  if (row.createdAt < cursor.t) return true;
  if (row.createdAt > cursor.t) return false;
  return row.id < cursor.i;
}

export function pageMessagesInMemory<T extends { createdAt: string; id: number }>(
  rows: T[],
  opts: {
    limit?: number;
    cursor?: string | null;
    filter?: (row: T) => boolean;
  } = {}
): { messages: T[]; nextCursor: string | null; total: number } {
  const limit = clampMessageLimit(opts.limit);
  const filtered = (opts.filter ? rows.filter(opts.filter) : rows).slice();
  filtered.sort(compareMessageSort);
  const total = filtered.length;
  const cursor = decodeMessageCursor(opts.cursor ?? null);
  const after = cursor ? filtered.filter((r) => isAfterMessageCursor(r, cursor)) : filtered;
  const messages = after.slice(0, limit);
  const nextCursor =
    messages.length === limit && messages.length > 0
      ? encodeMessageCursor({
          t: messages[messages.length - 1]!.createdAt,
          i: messages[messages.length - 1]!.id,
        })
      : null;
  return { messages, nextCursor, total };
}

export function truncateBodyPreview(body: string | null | undefined, max = 140): string | null {
  if (body == null) return null;
  const trimmed = body.trim();
  if (!trimmed) return null;
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}…`;
}

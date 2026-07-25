/**
 * Pure merge rules for POST /api/leads/bulk.
 * Pipeline may re-run; never overwrite send/reply history or closed workflow status.
 */

export const PROTECTED_LEAD_FIELDS = [
  "status",
  "sentAt",
  "sent_at",
  "repliedAt",
  "replied_at",
  "lastTouchAt",
  "last_touch_at",
  "nextFollowupAt",
  "next_followup_at",
  "followupStep",
  "followup_step",
  "replySentiment",
  "reply_sentiment",
  "suppressed",
  "suppressionReason",
  "suppression_reason",
] as const;

const PROTECTED = new Set<string>(PROTECTED_LEAD_FIELDS);

export type BulkLeadIncoming = Record<string, unknown> & {
  sourceRef?: string | null;
  source_ref?: string | null;
  businessName?: string;
  business_name?: string;
  postcode?: string | null;
};

export function normalizeBusinessKey(name: string, postcode?: string | null): string {
  return `${name.trim().toLowerCase()}|${(postcode ?? "").trim().toLowerCase()}`;
}

/** Fields the pipeline may update on an existing lead. */
export function mergeLeadUpdate(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...existing };
  for (const [key, value] of Object.entries(incoming)) {
    if (value === undefined) continue;
    if (PROTECTED.has(key)) continue;
    out[key] = value;
  }
  return out;
}

export type BulkPlanItem =
  | { action: "create"; incoming: BulkLeadIncoming }
  | { action: "update"; existingId: number; incoming: BulkLeadIncoming }
  | { action: "skip"; reason: string; incoming: BulkLeadIncoming };

/**
 * Plan bulk upserts given an in-memory index of existing leads.
 * Lookup order: source_ref, then (lower(business_name), postcode).
 */
export function planBulkUpserts(
  incoming: BulkLeadIncoming[],
  existingBySourceRef: Map<string, { id: number; row: Record<string, unknown> }>,
  existingByNamePostcode: Map<string, { id: number; row: Record<string, unknown> }>
): BulkPlanItem[] {
  const plans: BulkPlanItem[] = [];

  for (const item of incoming) {
    const ref = (item.sourceRef ?? item.source_ref ?? "").toString().trim();
    const name = (item.businessName ?? item.business_name ?? "").toString().trim();
    const postcode = (item.postcode ?? null) as string | null;

    if (!name && !ref) {
      plans.push({ action: "skip", reason: "missing_business_name_and_source_ref", incoming: item });
      continue;
    }

    if (ref && existingBySourceRef.has(ref)) {
      const hit = existingBySourceRef.get(ref)!;
      plans.push({ action: "update", existingId: hit.id, incoming: item });
      continue;
    }

    if (name) {
      const key = normalizeBusinessKey(name, postcode);
      if (existingByNamePostcode.has(key)) {
        const hit = existingByNamePostcode.get(key)!;
        plans.push({ action: "update", existingId: hit.id, incoming: item });
        continue;
      }
    }

    if (!name) {
      plans.push({ action: "skip", reason: "missing_business_name", incoming: item });
      continue;
    }

    plans.push({ action: "create", incoming: item });
  }

  return plans;
}

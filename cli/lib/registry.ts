/**
 * Lead / settings CLI helpers.
 *
 * Intentionally has NO send capability — no /send, /approve, /autosend, or /sequence.
 * Sending stays a deliberate action in the review queue where the rendered email
 * (with footer) is visible before approval.
 */

export const LEAD_COMMANDS = ["list", "get", "patch", "draft", "preflight"] as const;
export type LeadCommand = (typeof LEAD_COMMANDS)[number];

/** Verbs that must never appear in the lead CLI command registry. */
export const FORBIDDEN_SEND_VERBS = [
  "send",
  "approve",
  "autosend",
  "sequence",
  "auto-send",
] as const;

/** Mirrors updateLeadSchema / createLeadSchema field names. */
export const LEAD_PATCH_FIELDS = [
  "businessName",
  "slug",
  "industry",
  "location",
  "postcode",
  "address",
  "contactName",
  "contactEmail",
  "contactPhone",
  "contactFormUrl",
  "emailSource",
  "emailVerified",
  "websiteUrl",
  "hasWebsite",
  "companiesHouseNumber",
  "entityType",
  "corporateSubscriber",
  "chStatus",
  "incorporatedOn",
  "audit",
  "needScore",
  "likelihoodScore",
  "priorityScore",
  "scoreReason",
  "demoUrl",
  "demoBuiltAt",
  "demoStatus",
  "status",
  "offerAmount",
  "source",
  "sourceRef",
  "customSubject",
  "customBody",
] as const;

export const SETTINGS_FIELDS = [
  "autoSendEnabled",
  "autoSendThreshold",
  "dailySendCap",
  "sendingDomain",
  "fromAddress",
  "replyTo",
  "postalAddress",
  "followupOffsetsDays",
  "dryRun",
  "pausedUntil",
  "allowPrimarySendingDomain",
  "pause",
] as const;

export function leadEndpointFor(
  command: LeadCommand,
  id?: number
): { method: "GET" | "PATCH"; path: string } {
  switch (command) {
    case "list":
      return { method: "GET", path: "/api/leads" };
    case "get":
      return { method: "GET", path: `/api/leads/${id}` };
    case "patch":
    case "draft":
      return { method: "PATCH", path: `/api/leads/${id}` };
    case "preflight":
      return { method: "GET", path: "/api/outreach/preflight" };
  }
}

export function assertNoSendInRegistry(): void {
  for (const cmd of LEAD_COMMANDS) {
    if ((FORBIDDEN_SEND_VERBS as readonly string[]).includes(cmd)) {
      throw new Error(`forbidden send verb registered: ${cmd}`);
    }
    const { path } = leadEndpointFor(cmd, 1);
    for (const bad of ["/send", "/approve", "/autosend", "/sequence"]) {
      if (path.includes(bad)) {
        throw new Error(`command ${cmd} maps to send endpoint ${path}`);
      }
    }
  }
}

/**
 * Lead / settings CLI helpers.
 *
 * `send` is deliberately single-lead with typed confirmation — see cli/lib/manualSend.ts.
 * No batch / autosend / sequence from this CLI.
 */

export const LEAD_COMMANDS = [
  "list",
  "get",
  "patch",
  "draft",
  "preflight",
  "send",
] as const;
export type LeadCommand = (typeof LEAD_COMMANDS)[number];

/** Batch / cron send verbs that must not appear in the lead CLI. */
export const FORBIDDEN_BATCH_SEND_VERBS = [
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
): { method: "GET" | "POST" | "PATCH"; path: string } {
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
    case "send":
      return { method: "POST", path: `/api/leads/${id}/send` };
  }
}

export function assertNoBatchSendInRegistry(): void {
  for (const cmd of LEAD_COMMANDS) {
    if ((FORBIDDEN_BATCH_SEND_VERBS as readonly string[]).includes(cmd)) {
      throw new Error(`forbidden batch send verb registered: ${cmd}`);
    }
  }
  for (const cmd of LEAD_COMMANDS) {
    if (cmd === "send") continue;
    const { path } = leadEndpointFor(cmd, 1);
    for (const bad of ["/approve", "/autosend", "/sequence"]) {
      if (path.includes(bad)) {
        throw new Error(`command ${cmd} maps to batch send endpoint ${path}`);
      }
    }
  }
}

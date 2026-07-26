/**
 * Paths that expose third-party personal data and must require X-Api-Key.
 * Keep in sync with requireApiKey middleware on these handlers.
 */
export const OUTREACH_READS_REQUIRING_KEY = [
  "/api/leads",
  "/api/leads/stats",
  "/api/leads/1",
  "/api/leads/1/notes",
  "/api/leads/1/reminders",
  "/api/leads/1/messages",
  "/api/outreach/settings",
  "/api/outreach/messages",
  "/api/outreach/messages.csv",
  "/api/outreach/messages/1",
  "/api/outreach/analytics",
  "/api/outreach/export.csv",
] as const;

/** Public endpoints that must remain reachable without an API key. */
export const OUTREACH_PUBLIC_GETS = [
  "/api/outreach/preflight",
  "/api/unsubscribe",
] as const;

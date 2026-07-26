import { z } from "zod";

export const LEAD_STATUSES = [
  "sourced",
  "qualified",
  "audited",
  "scored",
  "queued",
  "demo_ready",
  "sent",
  "followed_up",
  "replied",
  "interested",
  "not_interested",
  "unsubscribed",
  "won",
  "lost",
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const DEMO_STATUSES = ["none", "building", "ready", "failed", "expired"] as const;
export const ENTITY_TYPES = [
  "ltd",
  "llp",
  "scottish_partnership",
  "public_body",
  "sole_trader",
  "partnership",
  "unknown",
] as const;

export const leadStatusSchema = z.enum(LEAD_STATUSES);

export const createLeadSchema = z.object({
  businessName: z.string().min(1),
  slug: z.string().min(1),
  industry: z.string().optional().nullable(),
  location: z.string().optional().nullable(),
  postcode: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  contactName: z.string().optional().nullable(),
  contactEmail: z.string().optional().nullable(),
  contactPhone: z.string().optional().nullable(),
  contactFormUrl: z.string().optional().nullable(),
  emailSource: z.string().optional().nullable(),
  emailVerified: z.boolean().optional(),
  websiteUrl: z.string().optional().nullable(),
  hasWebsite: z.boolean().optional(),
  companiesHouseNumber: z.string().optional().nullable(),
  entityType: z.enum(ENTITY_TYPES).optional(),
  corporateSubscriber: z.boolean().optional(),
  chStatus: z.string().optional().nullable(),
  incorporatedOn: z.string().optional().nullable(),
  audit: z.record(z.string(), z.unknown()).optional(),
  needScore: z.number().optional().nullable(),
  likelihoodScore: z.number().optional().nullable(),
  priorityScore: z.number().optional().nullable(),
  scoreReason: z.string().optional().nullable(),
  demoUrl: z.string().optional().nullable(),
  demoBuiltAt: z.string().optional().nullable(),
  demoStatus: z.enum(DEMO_STATUSES).optional(),
  status: leadStatusSchema.optional(),
  offerAmount: z.number().optional(),
  source: z.string().optional().nullable(),
  sourceRef: z.string().optional().nullable(),
  customSubject: z.string().max(300).nullable().optional(),
  customBody: z.string().nullable().optional(),
});

export type CreateLead = z.infer<typeof createLeadSchema>;
export const updateLeadSchema = createLeadSchema.partial();
export type UpdateLead = z.infer<typeof updateLeadSchema>;

export const bulkLeadsSchema = z.object({
  leads: z.array(createLeadSchema.extend({ slug: z.string().min(1).optional() })).min(1),
});

export type Lead = {
  id: number;
  createdAt: string;
  updatedAt: string;
  businessName: string;
  slug: string;
  industry: string | null;
  location: string | null;
  postcode: string | null;
  address: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  contactFormUrl: string | null;
  emailSource: string | null;
  emailVerified: boolean;
  websiteUrl: string | null;
  hasWebsite: boolean;
  companiesHouseNumber: string | null;
  entityType: string;
  corporateSubscriber: boolean;
  chStatus: string | null;
  incorporatedOn: string | null;
  audit: Record<string, unknown>;
  needScore: number | null;
  likelihoodScore: number | null;
  priorityScore: number | null;
  scoreReason: string | null;
  demoUrl: string | null;
  demoBuiltAt: string | null;
  demoExpiresAt: string | null;
  demoStatus: string;
  status: LeadStatus;
  sentAt: string | null;
  lastTouchAt: string | null;
  nextFollowupAt: string | null;
  followupStep: number;
  repliedAt: string | null;
  replySentiment: string | null;
  suppressed: boolean;
  suppressionReason: string | null;
  offerAmount: number;
  source: string | null;
  sourceRef: string | null;
  reviewReasons: string[];
  /** Hand-written initial subject; null falls back to generated. */
  customSubject: string | null;
  /** Hand-written initial body (footer still appended by the system). */
  customBody: string | null;
  draftUpdatedAt: string | null;
  /** Derived contact channel — computed, not stored. */
  contactRoute: "email" | "freemail" | "phone" | "form" | "none";
};

export type OutreachSettings = {
  id: number;
  autoSendEnabled: boolean;
  autoSendThreshold: number;
  dailySendCap: number;
  sendingDomain: string | null;
  fromAddress: string | null;
  replyTo: string | null;
  postalAddress: string | null;
  followupOffsetsDays: number[];
  dryRun: boolean;
  pausedUntil: string | null;
  /** When true, from-addresses on humza-butt.space are allowed (logged as a warning). */
  allowPrimarySendingDomain: boolean;
  updatedAt: string;
};

export const DEMO_EXPIRY_DAYS = 30;

export function demoExpiresAtFrom(now: Date = new Date()): string {
  const d = new Date(now.getTime());
  d.setUTCDate(d.getUTCDate() + DEMO_EXPIRY_DAYS);
  return d.toISOString();
}

export function slugifyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || "lead";
}

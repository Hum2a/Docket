import type { LeadStatus } from "./outreach";
import { DEMO_STATUSES } from "./outreach";

export type DemoStatus = (typeof DEMO_STATUSES)[number];

/** Pipeline statuses that advance to demo_ready when a demo publishes. */
export const DEMO_READY_ADVANCE_FROM = [
  "sourced",
  "qualified",
  "audited",
  "scored",
] as const satisfies readonly LeadStatus[];

export type DemoReadyAdvanceFrom = (typeof DEMO_READY_ADVANCE_FROM)[number];

/** Returns `demo_ready` when status should advance; otherwise null (leave alone). */
export function statusAfterDemoReady(status: LeadStatus): LeadStatus | null {
  if ((DEMO_READY_ADVANCE_FROM as readonly string[]).includes(status)) {
    return "demo_ready";
  }
  return null;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** Show amber countdown when expiry is within this many days. */
export const DEMO_EXPIRY_WARN_DAYS = 7;

export type DemoChipInput = {
  demoStatus?: string | null;
  demoUrl?: string | null;
  demoExpiresAt?: string | null;
  now?: Date;
};

export type DemoChipView = {
  /** Visual tone / CSS suffix */
  tone: "ready" | "building" | "failed" | "expired" | "none" | "expiring";
  label: string;
  className: string;
  /** When set, chip renders as a link */
  href: string | null;
  daysLeft: number | null;
};

function daysUntil(iso: string, now: Date): number {
  const end = new Date(iso).getTime();
  return Math.ceil((end - now.getTime()) / MS_PER_DAY);
}

/**
 * Resolve chip label/tone from demoStatus + expiry.
 * Trusts demoExpiresAt over a stale `ready` status.
 */
export function resolveDemoChip(input: DemoChipInput): DemoChipView {
  const now = input.now ?? new Date();
  const raw = (input.demoStatus ?? "none") as string;
  const url = input.demoUrl?.trim() || null;
  const expiresAt = input.demoExpiresAt?.trim() || null;

  let effective: DemoStatus =
    (DEMO_STATUSES as readonly string[]).includes(raw) ? (raw as DemoStatus) : "none";

  let daysLeft: number | null = null;
  if (expiresAt && (effective === "ready" || effective === "expired")) {
    daysLeft = daysUntil(expiresAt, now);
    if (daysLeft < 0) {
      effective = "expired";
    }
  }

  if (effective === "ready" && daysLeft != null && daysLeft <= DEMO_EXPIRY_WARN_DAYS) {
    return {
      tone: "expiring",
      label: `Demo live · ${daysLeft}d left`,
      className: "demo-status demo-status-expiring",
      href: url,
      daysLeft,
    };
  }

  const META: Record<
    Exclude<DemoStatus, never>,
    { label: string; tone: DemoChipView["tone"] }
  > = {
    ready: { label: "Demo live", tone: "ready" },
    building: { label: "Demo building", tone: "building" },
    failed: { label: "Demo failed", tone: "failed" },
    expired: { label: "Demo expired", tone: "expired" },
    none: { label: "No demo", tone: "none" },
  };

  const meta = META[effective];
  return {
    tone: meta.tone,
    label: meta.label,
    className: `demo-status demo-status-${meta.tone}`,
    href: effective === "ready" || meta.tone === "expiring" ? url : null,
    daysLeft: effective === "ready" || meta.tone === "expiring" ? daysLeft : null,
  };
}

import { describe, expect, it } from "vitest";
import {
  resolveDemoChip,
  statusAfterDemoReady,
  DEMO_READY_ADVANCE_FROM,
} from "../../shared/demoStatus";
import type { LeadStatus } from "../../shared/outreach";
import { LEAD_STATUSES } from "../../shared/outreach";

describe("resolveDemoChip", () => {
  it("renders each demoStatus with the expected label and tone", () => {
    expect(resolveDemoChip({ demoStatus: "ready", demoUrl: "https://d.example/x" })).toMatchObject({
      label: "Demo live",
      tone: "ready",
      href: "https://d.example/x",
      className: "demo-status demo-status-ready",
    });
    expect(resolveDemoChip({ demoStatus: "building" })).toMatchObject({
      label: "Demo building",
      tone: "building",
      href: null,
    });
    expect(resolveDemoChip({ demoStatus: "failed" })).toMatchObject({
      label: "Demo failed",
      tone: "failed",
      href: null,
    });
    expect(resolveDemoChip({ demoStatus: "expired" })).toMatchObject({
      label: "Demo expired",
      tone: "expired",
      href: null,
    });
    expect(resolveDemoChip({ demoStatus: "none" })).toMatchObject({
      label: "No demo",
      tone: "none",
      href: null,
    });
  });

  it("ready chip links to demoUrl", () => {
    const view = resolveDemoChip({
      demoStatus: "ready",
      demoUrl: "https://demos.example/acme",
    });
    expect(view.href).toBe("https://demos.example/acme");
  });

  it("shows amber countdown within 7 days of expiry", () => {
    const now = new Date("2026-08-20T12:00:00.000Z");
    const expires = new Date("2026-08-25T12:00:00.000Z").toISOString(); // 5 days
    const view = resolveDemoChip({
      demoStatus: "ready",
      demoUrl: "https://demos.example/x",
      demoExpiresAt: expires,
      now,
    });
    expect(view.tone).toBe("expiring");
    expect(view.label).toBe("Demo live · 5d left");
    expect(view.className).toContain("expiring");
    expect(view.href).toBe("https://demos.example/x");
  });

  it("shows expired past demoExpiresAt even when demoStatus is ready", () => {
    const now = new Date("2026-08-26T12:00:00.000Z");
    const expires = new Date("2026-08-25T12:00:00.000Z").toISOString();
    const view = resolveDemoChip({
      demoStatus: "ready",
      demoUrl: "https://demos.example/x",
      demoExpiresAt: expires,
      now,
    });
    expect(view.tone).toBe("expired");
    expect(view.label).toBe("Demo expired");
    expect(view.href).toBeNull();
  });
});

describe("statusAfterDemoReady", () => {
  it("moves sourced/qualified/audited/scored to demo_ready", () => {
    for (const s of DEMO_READY_ADVANCE_FROM) {
      expect(statusAfterDemoReady(s)).toBe("demo_ready");
    }
  });

  it("does not change sent or replied", () => {
    expect(statusAfterDemoReady("sent")).toBeNull();
    expect(statusAfterDemoReady("replied")).toBeNull();
  });

  it("does not change any status past the early pipeline", () => {
    const later = LEAD_STATUSES.filter(
      (s) => !(DEMO_READY_ADVANCE_FROM as readonly string[]).includes(s)
    );
    for (const s of later) {
      expect(statusAfterDemoReady(s as LeadStatus), s).toBeNull();
    }
  });
});

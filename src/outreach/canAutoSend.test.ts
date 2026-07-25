import { describe, expect, it } from "vitest";
import { canAutoSend, type LeadGateInput, type OutreachSettingsGateInput } from "./canAutoSend";
import { mergeLeadUpdate, planBulkUpserts } from "./bulkUpsert";

const baseLead: LeadGateInput = {
  priorityScore: 9,
  corporateSubscriber: true,
  emailVerified: true,
  contactEmail: "office@acme-accountants.co.uk",
  suppressed: false,
  demoStatus: "ready",
  demoUrl: "https://acme.humza-butt.space",
  status: "demo_ready",
};

const baseSettings: OutreachSettingsGateInput = {
  autoSendEnabled: true,
  dryRun: false,
  autoSendThreshold: 8,
  dailySendCap: 20,
  pausedUntil: null,
};

describe("canAutoSend", () => {
  it("allows a fully eligible corporate lead", () => {
    const r = canAutoSend(baseLead, baseSettings, 0);
    expect(r.ok).toBe(true);
    expect(r.reasons).toEqual([]);
  });

  it("refuses a sole trader / non-corporate subscriber", () => {
    const r = canAutoSend({ ...baseLead, corporateSubscriber: false }, baseSettings, 0);
    expect(r.ok).toBe(false);
    expect(r.reasons).toContain("not_corporate_subscriber");
    expect(r.deferred).toBe(false);
  });

  it("refuses a suppressed address", () => {
    const r = canAutoSend({ ...baseLead, suppressed: true }, baseSettings, 0);
    expect(r.ok).toBe(false);
    expect(r.reasons).toContain("lead_suppressed");
  });

  it("refuses an unverified email", () => {
    const r = canAutoSend({ ...baseLead, emailVerified: false }, baseSettings, 0);
    expect(r.ok).toBe(false);
    expect(r.reasons).toContain("email_unverified");
  });

  it("refuses freemail", () => {
    const r = canAutoSend({ ...baseLead, contactEmail: "boss@gmail.com" }, baseSettings, 0);
    expect(r.ok).toBe(false);
    expect(r.reasons).toContain("freemail_address");
  });

  it("refuses a missing demo", () => {
    const r = canAutoSend({ ...baseLead, demoStatus: "none", demoUrl: null }, baseSettings, 0);
    expect(r.ok).toBe(false);
    expect(r.reasons).toContain("demo_not_ready");
  });

  it("defers when daily cap is reached", () => {
    const r = canAutoSend(baseLead, baseSettings, 20);
    expect(r.ok).toBe(false);
    expect(r.reasons).toContain("daily_cap_reached");
    expect(r.deferred).toBe(true);
  });

  it("defers when dry_run is true", () => {
    const r = canAutoSend(baseLead, { ...baseSettings, dryRun: true }, 0);
    expect(r.ok).toBe(false);
    expect(r.reasons).toContain("dry_run");
    expect(r.deferred).toBe(true);
  });
});

describe("bulk upsert merge", () => {
  it("does not overwrite protected status/sent fields", () => {
    const merged = mergeLeadUpdate(
      { status: "sent", sent_at: "2026-01-01", industry: "old" },
      { status: "sourced", sent_at: null, industry: "accountant", need_score: 8 }
    );
    expect(merged.status).toBe("sent");
    expect(merged.sent_at).toBe("2026-01-01");
    expect(merged.industry).toBe("accountant");
    expect(merged.need_score).toBe(8);
  });

  it("plans create vs update by source_ref then name+postcode", () => {
    const byRef = new Map([["p1", { id: 10, row: {} }]]);
    const byName = new Map([["acme ltd|sw1a", { id: 20, row: {} }]]);
    const plans = planBulkUpserts(
      [
        { source_ref: "p1", business_name: "Other" },
        { business_name: "Acme Ltd", postcode: "SW1A" },
        { business_name: "New Co", postcode: "E1" },
        { source_ref: "" },
      ],
      byRef,
      byName
    );
    expect(plans[0]).toMatchObject({ action: "update", existingId: 10 });
    expect(plans[1]).toMatchObject({ action: "update", existingId: 20 });
    expect(plans[2]).toMatchObject({ action: "create" });
    expect(plans[3]).toMatchObject({ action: "skip" });
  });
});

import { describe, expect, it } from "vitest";
import { canAutoSend, type LeadGateInput, type OutreachSettingsGateInput } from "./canAutoSend";
import { filterManualHardReasons } from "../../shared/manualGate";
import { industryPlural, renderOutreachCopy, type CopyLeadInput } from "./copy";
import {
  isBusinessNameDomain,
  isValidUkPostalAddress,
  QUALITY_HARD_REASONS,
} from "./qualityGate";
import { buildSendConfirmPreview, sendConfirmBlocked } from "./sendConfirm";
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
  businessName: "Acme Accountants Ltd",
  industry: "accountant",
  observationSignal: "https",
  templateRequiresIndustry: false,
  postalAddress: "12 Example Road, Croydon CR0 4JF",
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

describe("quality hard blocks (Task 17)", () => {
  it("foo.co.uk blocks with business_name_is_domain, including under force/manual", () => {
    expect(isBusinessNameDomain("foo.co.uk")).toBe(true);
    const r = canAutoSend({ ...baseLead, businessName: "foo.co.uk" }, baseSettings, 0);
    expect(r.ok).toBe(false);
    expect(r.reasons).toContain("business_name_is_domain");
    // force/manual only skip operational reasons — quality reasons remain
    const hard = filterManualHardReasons(r.reasons);
    expect(hard).toContain("business_name_is_domain");
    for (const reason of QUALITY_HARD_REASONS) {
      expect(filterManualHardReasons([reason])).toEqual([reason]);
    }
  });

  it("generic observation blocks; a specific signal does not", () => {
    const bad = canAutoSend({ ...baseLead, observationSignal: "generic" }, baseSettings, 0);
    expect(bad.reasons).toContain("generic_observation");
    expect(filterManualHardReasons(bad.reasons)).toContain("generic_observation");

    const good = canAutoSend({ ...baseLead, observationSignal: "footer_year" }, baseSettings, 0);
    expect(good.reasons).not.toContain("generic_observation");
    expect(good.ok).toBe(true);
  });

  it("postal address Humza Butt, United Kingdom blocks; real UK address passes", () => {
    expect(isValidUkPostalAddress("Humza Butt, United Kingdom")).toBe(false);
    expect(isValidUkPostalAddress("12 Example Road, Croydon CR0 4JF")).toBe(true);

    const bad = canAutoSend(
      { ...baseLead, postalAddress: "Humza Butt, United Kingdom" },
      baseSettings,
      0
    );
    expect(bad.reasons).toContain("postal_address_invalid");
    expect(filterManualHardReasons(bad.reasons)).toContain("postal_address_invalid");

    const good = canAutoSend(
      { ...baseLead, postalAddress: "12 Example Road, Croydon CR0 4JF" },
      baseSettings,
      0
    );
    expect(good.reasons).not.toContain("postal_address_invalid");
  });

  it("null industry renders local businesses and does not block", () => {
    expect(industryPlural(null)).toBe("local businesses");
    expect(industryPlural("")).toBe("local businesses");
    expect(industryPlural("garage")).toBe("garages");

    const r = canAutoSend(
      { ...baseLead, industry: null, templateRequiresIndustry: false },
      baseSettings,
      0
    );
    expect(r.reasons).not.toContain("industry_unknown");
    expect(r.ok).toBe(true);

    const copyLead: CopyLeadInput = {
      id: 1,
      businessName: "QMS Ltd",
      slug: "qms",
      industry: null,
      location: "Grimsby",
      contactName: null,
      websiteUrl: "https://qms-grimsby.co.uk",
      demoUrl: "https://qms.humza-butt.space",
      demoExpiresAt: null,
      offerAmount: 500,
      audit: { https: false },
    };
    const rendered = renderOutreachCopy({
      lead: copyLead,
      postalAddress: "12 Example Road, Croydon CR0 4JF",
      unsubscribeUrl: "https://example.com/u",
      templateId: "initial",
    });
    expect(rendered.text).toContain("local businesses");
    expect(rendered.text).not.toContain("professional-services");
  });

  it("industry_unknown only when templateRequiresIndustry", () => {
    const r = canAutoSend(
      { ...baseLead, industry: null, templateRequiresIndustry: true },
      baseSettings,
      0
    );
    expect(r.reasons).toContain("industry_unknown");
  });

  it("confirm modal preview matches renderOutreachCopy exactly", () => {
    const lead: CopyLeadInput = {
      id: 42,
      businessName: "Acme Accountants Ltd",
      slug: "acme",
      industry: "accountant",
      location: "Bristol",
      contactName: "Jane",
      websiteUrl: "https://acme.co.uk",
      demoUrl: "https://acme.humza-butt.space",
      demoExpiresAt: null,
      offerAmount: 500,
      audit: { https: false },
    };
    const postal = "12 Example Road, Croydon CR0 4JF";
    const unsub = "https://docket.example/api/unsubscribe?token=x";
    const fromRender = renderOutreachCopy({
      lead,
      postalAddress: postal,
      unsubscribeUrl: unsub,
      templateId: "initial",
    });
    const fromModal = buildSendConfirmPreview({
      lead,
      postalAddress: postal,
      unsubscribeUrl: unsub,
      followupStep: 0,
    });
    expect(fromModal.subject).toBe(fromRender.subject);
    expect(fromModal.text).toBe(fromRender.text);
    expect(fromModal.text).toContain("--\nHumza Butt ·");
    expect(sendConfirmBlocked(["business_name_is_domain"])).toBe(true);
    expect(sendConfirmBlocked([])).toBe(false);
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

import { describe, expect, it } from "vitest";
import { canWarmSend, CONSENT_MAX_AGE_MS, warmLaneWarnings, type WarmLeadInput } from "./canWarmSend";

const extras = { emailOrDomainSuppressed: false, warmOutboundCount: 0 };

function lead(over: Partial<WarmLeadInput> = {}): WarmLeadInput {
  return {
    consentStatus: "verbal_call",
    consentEmail: "leslie@silverbiketraining.com",
    consentAt: new Date().toISOString(),
    suppressed: false,
    demoStatus: "ready",
    demoUrl: "https://demo.humza-butt.space/silverbikes/",
    customSubject: "Silver Bikes demo",
    customBody: "Here's the demo.",
    ...over,
  };
}

describe("canWarmSend", () => {
  it("passes a consented ready lead with a draft", () => {
    expect(canWarmSend(lead(), extras)).toEqual({ ok: true, reasons: [] });
  });

  it("consent_none", () => {
    const r = canWarmSend(lead({ consentStatus: "none" }), extras);
    expect(r.ok).toBe(false);
    expect(r.reasons).toContain("consent_none");
  });

  it("missing_consent_email", () => {
    const r = canWarmSend(lead({ consentEmail: "" }), extras);
    expect(r.reasons).toContain("missing_consent_email");
  });

  it("lead_suppressed on the lead flag", () => {
    const r = canWarmSend(lead({ suppressed: true }), extras);
    expect(r.reasons).toContain("lead_suppressed");
  });

  it("lead_suppressed from the suppressions table", () => {
    const r = canWarmSend(lead(), { ...extras, emailOrDomainSuppressed: true });
    expect(r.reasons).toContain("lead_suppressed");
  });

  it("demo_not_ready", () => {
    const r = canWarmSend(lead({ demoStatus: "none", demoUrl: null }), extras);
    expect(r.reasons).toContain("demo_not_ready");
  });

  it("draft_missing", () => {
    const r = canWarmSend(lead({ customSubject: null, customBody: null }), extras);
    expect(r.reasons).toContain("draft_missing");
  });

  it("consent_stale after 30 days", () => {
    const now = new Date("2026-09-19T12:00:00Z");
    const at = new Date(now.getTime() - CONSENT_MAX_AGE_MS - 1000).toISOString();
    const r = canWarmSend(lead({ consentAt: at }), extras, now);
    expect(r.reasons).toContain("consent_stale");
  });

  it("consent_stale when consentAt is missing", () => {
    const r = canWarmSend(lead({ consentAt: null }), extras);
    expect(r.reasons).toContain("consent_stale");
  });

  it("allows one follow-up then blocks", () => {
    expect(canWarmSend(lead(), { ...extras, warmOutboundCount: 1 }).ok).toBe(true);
    const r = canWarmSend(lead(), { ...extras, warmOutboundCount: 2 });
    expect(r.reasons).toContain("warm_followup_already_sent");
  });
});

describe("warmLaneWarnings", () => {
  it("warns on freemail consent addresses; work domains are silent", () => {
    expect(warmLaneWarnings({ consentEmail: "leslie@silverbiketraining.com" })).toEqual([]);
    expect(warmLaneWarnings({ consentEmail: "a@gmail.com" })).toContain("freemail_address");
  });

  it("warns when demo_score is below 90", () => {
    expect(warmLaneWarnings({ consentEmail: "a@co.uk", audit: { demo_score: 70 } })).toContain(
      "demo_audit_score_low"
    );
    expect(warmLaneWarnings({ consentEmail: "a@co.uk", audit: {} })).not.toContain(
      "demo_audit_score_low"
    );
  });
});

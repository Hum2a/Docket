import { describe, expect, it } from "vitest";
import {
  formatExpiryDate,
  getPersistedOutreach,
  renderFinal,
  renderFollowup,
  renderInitial,
  renderOutreachCopy,
  type CopyLeadInput,
} from "./copy";

function baseLead(over: Partial<CopyLeadInput> = {}): CopyLeadInput {
  return {
    id: 7,
    businessName: "Acme Accountants Ltd",
    slug: "acme-accountants",
    industry: "accountants",
    location: "Bristol",
    contactName: "Jane",
    websiteUrl: "https://acme.co.uk",
    demoUrl: "https://acme.example.test",
    demoExpiresAt: null,
    offerAmount: 500,
    audit: { https: false },
    ...over,
  };
}

describe("persist + follow-up signal reuse", () => {
  it("initial render exposes signal/variant/subject for audit.outreach", () => {
    const rendered = renderInitial({
      lead: baseLead(),
      postalAddress: "UK",
      unsubscribeUrl: "https://example.com/u",
    });
    expect(rendered.variant).toMatch(/^[A-D]$/);
    expect(rendered.signal).toBe("https");
    expect(rendered.subject.length).toBeGreaterThan(0);

    const audit = {
      outreach: {
        signal: rendered.signal,
        subjectVariant: rendered.variant,
        originalSubject: rendered.subject,
      },
    };
    expect(getPersistedOutreach(audit)).toEqual({
      signal: rendered.signal,
      subjectVariant: rendered.variant,
      originalSubject: rendered.subject,
    });
  });

  it("follow-up after audit change still uses original signal and subject", () => {
    const initial = renderInitial({
      lead: baseLead(),
      postalAddress: "UK",
      unsubscribeUrl: "https://example.com/u",
    });
    const lead = baseLead({
      audit: {
        // re-audited: would pick mobile if recomputed
        https: true,
        mobile_friendly: false,
        outreach: {
          signal: initial.signal,
          subjectVariant: initial.variant,
          originalSubject: initial.subject,
        },
      },
    });
    const follow = renderOutreachCopy({
      lead,
      postalAddress: "UK",
      unsubscribeUrl: "https://example.com/u",
      templateId: "followup",
    });
    expect(follow.signal).toBe(initial.signal);
    expect(follow.subject).toBe(`Re: ${initial.subject}`);
    expect(follow.variant).toBeNull();
    expect(follow.text).toContain("Not secure");
  });

  it("lead_messages.variant is set on initial and null on follow-ups", () => {
    const initial = renderInitial({
      lead: baseLead(),
      postalAddress: "UK",
      unsubscribeUrl: "https://example.com/u",
    });
    expect(initial.variant).not.toBeNull();
    const follow = renderFollowup({
      lead: baseLead(),
      postalAddress: "UK",
      unsubscribeUrl: "https://example.com/u",
      signal: "https",
      originalSubject: initial.subject,
    });
    expect(follow.variant).toBeNull();
  });
});

describe("renderFinal demo_expires_at", () => {
  it("uses demo_expires_at when present", () => {
    const stored = "2026-09-01T12:00:00.000Z";
    const rendered = renderFinal({
      lead: baseLead({ demoExpiresAt: stored }),
      postalAddress: "UK",
      unsubscribeUrl: "https://example.com/u",
      originalSubject: "demo site for Acme",
      signal: "https",
      now: new Date("2026-07-25T12:00:00.000Z"),
    });
    expect(rendered.text).toContain(formatExpiryDate(new Date(stored), 0));
    expect(rendered.text).not.toContain(formatExpiryDate(new Date("2026-07-25T12:00:00.000Z"), 3));
  });

  it("falls back to now+3 when demo_expires_at is null", () => {
    const now = new Date("2026-07-25T12:00:00.000Z");
    const rendered = renderFinal({
      lead: baseLead({ demoExpiresAt: null }),
      postalAddress: "UK",
      unsubscribeUrl: "https://example.com/u",
      originalSubject: "demo site for Acme",
      signal: "https",
      now,
    });
    expect(rendered.text).toContain(formatExpiryDate(now, 3));
  });
});

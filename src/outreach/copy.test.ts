import { describe, expect, it } from "vitest";
import {
  absoluteFollowupAt,
  bodyWordCountBeforeFooter,
  demoUrlFor,
  greeting,
  pickObservation,
  pickSubjectVariant,
  renderInitial,
  resolvePostalAddress,
  resolveTemplateId,
  type CopyLeadInput,
} from "./copy";

function baseLead(over: Partial<CopyLeadInput> = {}): CopyLeadInput {
  return {
    id: 42,
    businessName: "Acme Accountants Ltd",
    slug: "acme-accountants",
    industry: "accountants",
    location: "Bristol",
    contactName: "Jane Smith",
    websiteUrl: "https://www.acme-accountants.co.uk",
    demoUrl: "https://acme-accountants.humza-butt.space",
    offerAmount: 500,
    audit: {},
    ...over,
  };
}

describe("pickObservation", () => {
  it("prefers no website over other signals", () => {
    const r = pickObservation({
      websiteUrl: null,
      audit: { https: false, mobile_friendly: false },
    });
    expect(r.signal).toBe("no_website");
  });

  it("prefers https false over mobile", () => {
    const r = pickObservation({
      websiteUrl: "https://example.co.uk",
      audit: { https: false, mobile_friendly: false },
    });
    expect(r.signal).toBe("https");
    expect(r.line).toContain("Not secure");
    expect(r.line).toContain("example.co.uk");
  });

  it("uses mobile when https ok", () => {
    const r = pickObservation({
      websiteUrl: "https://example.co.uk",
      audit: { https: true, mobile_friendly: false },
    });
    expect(r.signal).toBe("mobile_friendly");
  });

  it("uses lcp when above 4000ms", () => {
    const r = pickObservation({
      websiteUrl: "https://slow.co.uk",
      audit: { https: true, mobile_friendly: true, lcp_ms: 5200 },
    });
    expect(r.signal).toBe("lcp_ms");
    expect(r.line).toContain("5 seconds");
  });
});

describe("pickSubjectVariant", () => {
  it("excludes C when signal is not mobile/speed", () => {
    for (let id = 0; id < 20; id++) {
      expect(pickSubjectVariant("https", id)).not.toBe("C");
    }
  });

  it("may include C for mobile signals", () => {
    const variants = new Set(
      Array.from({ length: 20 }, (_, id) => pickSubjectVariant("mobile_friendly", id))
    );
    expect(variants.has("C")).toBe(true);
  });
});

describe("greeting + initial copy", () => {
  it("uses Hi, when name missing — never Hi there", () => {
    expect(greeting(null)).toBe("Hi,");
    expect(greeting("")).toBe("Hi,");
    expect(greeting("Sam Taylor")).toBe("Hi Sam,");
  });

  it("puts demo URL early and stays under ~100 words", () => {
    const rendered = renderInitial({
      lead: baseLead({ contactName: null }),
      postalAddress: "Humza Butt, United Kingdom",
      unsubscribeUrl: "https://example.com/unsub",
    });
    expect(rendered.text.startsWith("Hi,")).toBe(true);
    expect(rendered.text).not.toContain("Hi there");
    const beforeFooter = rendered.text.split(/\n--\n/)[0]!;
    const lines = beforeFooter.split("\n").filter((l) => l.trim());
    const demoLine = lines.findIndex((l) => l.includes("humza-butt.space"));
    expect(demoLine).toBeGreaterThanOrEqual(0);
    expect(demoLine).toBeLessThanOrEqual(8);
    expect(bodyWordCountBeforeFooter(rendered.text)).toBeLessThanOrEqual(120);
    expect(rendered.variant).toMatch(/^[ABD]$/);
    expect(rendered.text).toContain("Humza Butt · Humza Butt, United Kingdom");
    expect(rendered.text).toContain("Don't want these?");
  });

  it("demoUrl falls back to slug subdomain", () => {
    expect(demoUrlFor({ demoUrl: null, slug: "foo-bar" })).toBe(
      "https://foo-bar.humza-butt.space"
    );
  });
});

describe("scheduling helpers", () => {
  it("absoluteFollowupAt adds calendar days from sent_at", () => {
    const iso = absoluteFollowupAt("2026-07-01T10:00:00.000Z", 3);
    expect(iso.startsWith("2026-07-04")).toBe(true);
    const seven = absoluteFollowupAt("2026-07-01T10:00:00.000Z", 7);
    expect(seven.startsWith("2026-07-08")).toBe(true);
  });

  it("resolveTemplateId maps steps", () => {
    expect(resolveTemplateId(0)).toBe("initial");
    expect(resolveTemplateId(1)).toBe("followup");
    expect(resolveTemplateId(2)).toBe("final");
    expect(resolveTemplateId(1, "final")).toBe("final");
  });
});

describe("postal gate", () => {
  it("requires postal from settings or env", () => {
    expect(resolvePostalAddress({ postalAddress: null }, {})).toBeNull();
    expect(resolvePostalAddress({ postalAddress: "  1 High St  " }, {})).toBe("1 High St");
    expect(resolvePostalAddress({ postalAddress: null }, { OUTREACH_POSTAL_ADDRESS: "UK" })).toBe(
      "UK"
    );
  });
});

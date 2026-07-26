import { describe, expect, it } from "vitest";
import { contactRoute, CONTACT_ROUTE_META } from "../../shared/contactRoute";
import { filterManualHardReasons, MANUAL_SKIP_REASONS } from "../../shared/manualGate";
import {
  confirmBusinessName,
  formatEmailPreview,
  formatGateResult,
  parseSendIds,
  refuseDryRunWithoutOverride,
} from "./manualSend";
import {
  LEAD_COMMANDS,
  FORBIDDEN_BATCH_SEND_VERBS,
  assertNoBatchSendInRegistry,
  leadEndpointFor,
} from "./registry";

describe("contactRoute", () => {
  it("returns email for own-domain addresses", () => {
    expect(contactRoute({ contactEmail: "info@saundersautocare.co.uk" })).toBe("email");
  });

  it("returns freemail for consumer mailboxes", () => {
    expect(contactRoute({ contactEmail: "owner@gmail.com" })).toBe("freemail");
  });

  it("returns phone when no email", () => {
    expect(contactRoute({ contactPhone: "020 1234 5678" })).toBe("phone");
  });

  it("returns form when only form URL", () => {
    expect(contactRoute({ contactFormUrl: "https://example.com/contact" })).toBe("form");
  });

  it("returns none when empty", () => {
    expect(contactRoute({})).toBe("none");
  });

  it("freemail chip is visually distinct from email", () => {
    expect(CONTACT_ROUTE_META.email.className).not.toBe(CONTACT_ROUTE_META.freemail.className);
    expect(CONTACT_ROUTE_META.freemail.className).toContain("freemail");
    expect(CONTACT_ROUTE_META.email.className).toContain("email");
    expect(CONTACT_ROUTE_META.freemail.title).toMatch(/freemail/i);
  });
});

describe("manual send CLI helpers", () => {
  it("formats preview including footer markers", () => {
    const text = formatEmailPreview({
      from: "Outreach <a@mail.example>",
      to: "info@acme.co.uk",
      subject: "demo",
      text: "Hi,\n\nBody\n\n--\nHumza Butt · UK\nDon't want these? https://x/unsub\n",
    });
    expect(text).toContain("From:");
    expect(text).toContain("To:   info@acme.co.uk");
    expect(text).toContain("Subject: demo");
    expect(text).toContain("\n--\n");
    expect(text).toContain("Don't want these?");
  });

  it("refuses batch / multiple ids / --all", () => {
    expect(parseSendIds(["send", "5", "6"]).ok).toBe(false);
    expect(parseSendIds(["send", "--all"]).ok).toBe(false);
    expect(parseSendIds(["send", "all"]).ok).toBe(false);
    expect(parseSendIds(["send", "5"])).toEqual({ ok: true, id: 5 });
  });

  it("refuses dryRun without override", () => {
    expect(refuseDryRunWithoutOverride(true, false, false)).toMatch(/override-dry-run/);
    expect(refuseDryRunWithoutOverride(true, true, false)).toBeNull();
    expect(refuseDryRunWithoutOverride(true, false, true)).toBeNull();
  });

  it("typed confirm requires exact business name", () => {
    expect(confirmBusinessName("Saunders Autocare", "Saunders Autocare")).toBe(true);
    expect(confirmBusinessName("saunders", "Saunders Autocare")).toBe(false);
  });

  it("gate result PASS when only operational skips remain", () => {
    expect(formatGateResult(["priority_below_threshold", "auto_send_disabled"])).toBe(
      "Gate: PASS"
    );
  });

  it("--yes skip list does not include PECR / freemail / suppression / demo", () => {
    const hard = filterManualHardReasons([
      "priority_below_threshold",
      "business_name_implausible",
      "not_corporate_subscriber",
      "freemail_address",
      "lead_suppressed",
      "email_unverified",
      "demo_not_ready",
    ]);
    expect(hard).toEqual([
      "not_corporate_subscriber",
      "freemail_address",
      "lead_suppressed",
      "email_unverified",
      "demo_not_ready",
    ]);
    expect(MANUAL_SKIP_REASONS).toContain("business_name_implausible");
    for (const r of [
      "not_corporate_subscriber",
      "freemail_address",
      "lead_suppressed",
      "email_unverified",
      "demo_not_ready",
    ]) {
      expect(MANUAL_SKIP_REASONS).not.toContain(r);
    }
  });
});

describe("CLI send registry", () => {
  it("includes send as a single-lead command", () => {
    expect(LEAD_COMMANDS).toContain("send");
    expect(leadEndpointFor("send", 5).path).toBe("/api/leads/5/send");
  });

  it("has no batch autosend/approve/sequence verbs", () => {
    for (const verb of FORBIDDEN_BATCH_SEND_VERBS) {
      expect(LEAD_COMMANDS).not.toContain(verb);
    }
    expect(() => assertNoBatchSendInRegistry()).not.toThrow();
  });
});

import { describe, expect, it } from "vitest";
import { buildOutreachPreflight } from "./preflight";
import type { OutreachSettings } from "../../shared/outreach";

const emptySettings: Pick<
  OutreachSettings,
  | "sendingDomain"
  | "fromAddress"
  | "replyTo"
  | "postalAddress"
  | "allowPrimarySendingDomain"
> = {
  sendingDomain: null,
  fromAddress: null,
  replyTo: null,
  postalAddress: null,
  allowPrimarySendingDomain: false,
};

const readyEnv = {
  UNSUBSCRIBE_SIGNING_KEY: "unsub-secret",
  RESEND_API_KEY: "re_test_key",
};

describe("buildOutreachPreflight", () => {
  it("returns ready:false with correct blocking when empty", () => {
    const result = buildOutreachPreflight(emptySettings, {});
    expect(result.ready).toBe(false);
    expect(result.blocking).toEqual(
      expect.arrayContaining([
        "sending_domain_set",
        "from_address_set",
        "postal_address_set",
        "unsubscribe_key_set",
        "resend_key_set",
      ])
    );
    expect(result.blocking).not.toContain("reply_to_set");
    expect(result.checks.from_domain_not_primary).toBe(true);
    expect(result.checks.reply_to_set).toBe(false);
    expect(result.warnings).toEqual([]);
  });

  it("ready:true once every non-advisory check passes", () => {
    const result = buildOutreachPreflight(
      {
        sendingDomain: "mail.outreach.example",
        fromAddress: "Outreach <hello@mail.outreach.example>",
        replyTo: null,
        postalAddress: "Humza Butt, United Kingdom",
        allowPrimarySendingDomain: false,
      },
      readyEnv
    );
    expect(result.ready).toBe(true);
    expect(result.blocking).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.checks.reply_to_set).toBe(false);
  });

  it("from_domain_not_primary false for primary portfolio domains", () => {
    for (const fromAddress of [
      "outreach@mail.humza-butt.space",
      "Humza <humza@humza-butt.space>",
    ]) {
      const result = buildOutreachPreflight(
        {
          sendingDomain: "mail.humza-butt.space",
          fromAddress,
          replyTo: null,
          postalAddress: "UK",
          allowPrimarySendingDomain: false,
        },
        {
          UNSUBSCRIBE_SIGNING_KEY: "k",
          RESEND_API_KEY: "re_x",
        }
      );
      expect(result.checks.from_domain_not_primary).toBe(false);
      expect(result.blocking).toContain("from_domain_not_primary");
      expect(result.warnings).toEqual([]);
      expect(result.ready).toBe(false);
    }
  });

  it("with allowPrimarySendingDomain, primary domain is a warning not a block", () => {
    const result = buildOutreachPreflight(
      {
        sendingDomain: "mail.humza-butt.space",
        fromAddress: "Outreach <outreach@mail.humza-butt.space>",
        replyTo: null,
        postalAddress: "UK",
        allowPrimarySendingDomain: true,
      },
      {
        UNSUBSCRIBE_SIGNING_KEY: "k",
        RESEND_API_KEY: "re_x",
      }
    );
    expect(result.checks.from_domain_not_primary).toBe(false);
    expect(result.blocking).not.toContain("from_domain_not_primary");
    expect(result.warnings).toEqual(["from_domain_not_primary"]);
    expect(result.ready).toBe(true);
  });

  it("from_domain_not_primary true for a separate domain", () => {
    const result = buildOutreachPreflight(
      {
        sendingDomain: "outreach.example",
        fromAddress: "hello@outreach.example",
        replyTo: "hello@outreach.example",
        postalAddress: "UK",
        allowPrimarySendingDomain: false,
      },
      {
        UNSUBSCRIBE_SIGNING_KEY: "k",
        RESEND_API_KEY: "re_x",
      }
    );
    expect(result.checks.from_domain_not_primary).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(result.ready).toBe(true);
  });

  it("response contains no secret values", () => {
    const secret = "super-secret-unsub-key-xyz";
    const resend = "re_SECRETVALUE123";
    const result = buildOutreachPreflight(
      {
        sendingDomain: "outreach.example",
        fromAddress: "hello@outreach.example",
        replyTo: null,
        postalAddress: "UK",
        allowPrimarySendingDomain: false,
      },
      {
        UNSUBSCRIBE_SIGNING_KEY: secret,
        RESEND_API_KEY: resend,
        OUTREACH_FROM: "should-not-leak@example.com",
      }
    );
    const json = JSON.stringify(result);
    expect(json).not.toContain(secret);
    expect(json).not.toContain(resend);
    expect(json).not.toContain("should-not-leak");
    expect(Object.keys(result)).toEqual(["ready", "checks", "blocking", "warnings"]);
  });
});

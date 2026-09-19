import { afterEach, describe, expect, it, vi } from "vitest";
import { buildOutreachPreflight, resetResendDomainCache } from "./preflight";
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

afterEach(() => {
  resetResendDomainCache();
  vi.unstubAllGlobals();
});

function stubDomains(names: string[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: names.map((name) => ({ name, status: "verified" })),
      }),
    }))
  );
}

describe("buildOutreachPreflight", () => {
  it("returns ready:false with correct blocking when empty", async () => {
    const result = await buildOutreachPreflight(emptySettings, {});
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
    expect(result.checks.personal_from_set).toBe(true);
    expect(result.warmReady).toBe(false);
  });

  it("ready:true once every non-advisory check passes", async () => {
    stubDomains(["humza-butt.space"]);
    const result = await buildOutreachPreflight(
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
    expect(result.warmReady).toBe(true);
    expect(result.blocking).toEqual([]);
    expect(result.warmBlocking).toEqual([]);
    expect(result.checks.reply_to_set).toBe(false);
    expect(result.checks.personal_from_domain_verified).toBe(true);
  });

  it("from_domain_not_primary false for primary portfolio domains", async () => {
    stubDomains(["humza-butt.space"]);
    for (const fromAddress of [
      "outreach@mail.humza-butt.space",
      "Humza <humza@humza-butt.space>",
    ]) {
      const result = await buildOutreachPreflight(
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
      expect(result.ready).toBe(false);
      expect(result.warmReady).toBe(true);
    }
  });

  it("with allowPrimarySendingDomain, primary domain is a warning not a block", async () => {
    stubDomains(["humza-butt.space"]);
    const result = await buildOutreachPreflight(
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
    expect(result.warnings).toContain("from_domain_not_primary");
    expect(result.ready).toBe(true);
    expect(result.warmReady).toBe(true);
  });

  it("from_domain_not_primary true for a separate domain", async () => {
    stubDomains(["humza-butt.space"]);
    const result = await buildOutreachPreflight(
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
    expect(result.ready).toBe(true);
    expect(result.warmReady).toBe(true);
  });

  it("personal_from_domain_verified is a warning not a block", async () => {
    stubDomains([]);
    const result = await buildOutreachPreflight(
      {
        sendingDomain: "outreach.example",
        fromAddress: "hello@outreach.example",
        replyTo: null,
        postalAddress: "UK",
        allowPrimarySendingDomain: false,
      },
      readyEnv
    );
    expect(result.warmReady).toBe(true);
    expect(result.warnings).toContain("personal_from_domain_verified");
    expect(result.warmBlocking).toEqual([]);
  });

  it("response contains no secret values", async () => {
    stubDomains(["humza-butt.space"]);
    const secret = "super-secret-unsub-key-xyz";
    const resend = "re_SECRETVALUE123";
    const result = await buildOutreachPreflight(
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
    expect(Object.keys(result).sort()).toEqual(
      ["blocking", "checks", "ready", "warmBlocking", "warmReady", "warnings"].sort()
    );
  });
});

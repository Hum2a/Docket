import { describe, expect, it } from "vitest";
import { mergeLeadUpdate } from "./bulkUpsert";
import {
  sendFlagPatch,
  shouldAutoCorporate,
  shouldAutoVerifyEmail,
} from "./sendFlags";

describe("shouldAutoVerifyEmail", () => {
  it("accepts business-domain emails", () => {
    expect(shouldAutoVerifyEmail("info@blountaerials.co.uk")).toBe(true);
  });
  it("rejects freemail", () => {
    expect(shouldAutoVerifyEmail("me@gmail.com")).toBe(false);
  });
});

describe("shouldAutoCorporate", () => {
  it("uses entity type and CH number", () => {
    expect(shouldAutoCorporate({ entityType: "ltd" })).toBe(true);
    expect(shouldAutoCorporate({ companiesHouseNumber: "123" })).toBe(true);
  });
  it("falls back to business-domain email", () => {
    expect(
      shouldAutoCorporate({ contactEmail: "info@blountaerials.co.uk" })
    ).toBe(true);
    expect(shouldAutoCorporate({ contactEmail: "x@gmail.com" })).toBe(false);
  });
});

describe("sendFlagPatch", () => {
  it("enables both flags for business-domain contacts", () => {
    expect(
      sendFlagPatch({
        contactEmail: "info@blountaerials.co.uk",
        emailVerified: false,
        corporateSubscriber: false,
      })
    ).toEqual({ emailVerified: true, corporateSubscriber: true });
  });
  it("is a no-op when already set", () => {
    expect(
      sendFlagPatch({
        contactEmail: "info@blountaerials.co.uk",
        emailVerified: true,
        corporateSubscriber: true,
      })
    ).toEqual({});
  });
});

describe("mergeLeadUpdate PECR preserve", () => {
  it("does not downgrade corporateSubscriber or emailVerified", () => {
    const merged = mergeLeadUpdate(
      { corporateSubscriber: true, emailVerified: true, industry: "aerials" },
      { corporateSubscriber: false, emailVerified: false, industry: "tv" }
    );
    expect(merged.corporateSubscriber).toBe(true);
    expect(merged.emailVerified).toBe(true);
    expect(merged.industry).toBe("tv");
  });
});

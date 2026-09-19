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
  it("business-domain email + unknown entity is false", () => {
    expect(
      shouldAutoCorporate({ contactEmail: "info@blountaerials.co.uk" })
    ).toBe(false);
    expect(shouldAutoCorporate({ contactEmail: "x@gmail.com" })).toBe(false);
  });

  it("CH number + active status is true", () => {
    expect(
      shouldAutoCorporate({ companiesHouseNumber: "123", chStatus: "active" })
    ).toBe(true);
  });

  it("CH number without active status is false", () => {
    expect(shouldAutoCorporate({ companiesHouseNumber: "123" })).toBe(false);
    expect(
      shouldAutoCorporate({
        companiesHouseNumber: "07564911",
        chStatus: "Former company dissolved 2017",
      })
    ).toBe(false);
  });

  it("corporate entity types are true", () => {
    expect(shouldAutoCorporate({ entityType: "ltd" })).toBe(true);
    expect(shouldAutoCorporate({ entityType: "llp" })).toBe(true);
  });

  it("sole_trader + CH-less + business email is false", () => {
    expect(
      shouldAutoCorporate({
        entityType: "sole_trader",
        contactEmail: "leslie@silverbiketraining.com",
        corporateSubscriber: true,
      })
    ).toBe(false);
  });

  it("does not honour a caller-supplied corporateSubscriber true", () => {
    expect(shouldAutoCorporate({ corporateSubscriber: true })).toBe(false);
  });
});

describe("sendFlagPatch", () => {
  it("verifies business-domain email but does not flip corporate", () => {
    expect(
      sendFlagPatch({
        contactEmail: "info@blountaerials.co.uk",
        emailVerified: false,
        corporateSubscriber: false,
      })
    ).toEqual({ emailVerified: true });
  });

  it("never flips a sole trader to corporate", () => {
    expect(
      sendFlagPatch({
        contactEmail: "leslie@silverbiketraining.com",
        emailVerified: false,
        corporateSubscriber: false,
        entityType: "sole_trader",
      })
    ).toEqual({ emailVerified: true });
    expect(
      sendFlagPatch({
        contactEmail: "leslie@silverbiketraining.com",
        emailVerified: true,
        corporateSubscriber: false,
        entityType: "sole_trader",
        companiesHouseNumber: "07564911",
        chStatus: "active",
      })
    ).toEqual({});
  });

  it("enables corporate for an active ltd", () => {
    expect(
      sendFlagPatch({
        contactEmail: "info@acme-ltd.co.uk",
        emailVerified: false,
        corporateSubscriber: false,
        entityType: "ltd",
        companiesHouseNumber: "123",
        chStatus: "active",
      })
    ).toEqual({ emailVerified: true, corporateSubscriber: true });
  });

  it("is a no-op when already set", () => {
    expect(
      sendFlagPatch({
        contactEmail: "info@blountaerials.co.uk",
        emailVerified: true,
        corporateSubscriber: true,
        entityType: "ltd",
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

  it("allows corporate downgrade when incoming entity is sole_trader", () => {
    const merged = mergeLeadUpdate(
      { corporateSubscriber: true, entityType: "unknown" },
      { corporateSubscriber: false, entityType: "sole_trader" }
    );
    expect(merged.corporateSubscriber).toBe(false);
    expect(merged.entityType).toBe("sole_trader");
  });
});

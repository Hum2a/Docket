import { describe, expect, it } from "vitest";
import { mergeLeadUpdate } from "./bulkUpsert";
import { sendFlagPatch, shouldAutoVerifyEmail } from "./sendFlags";

describe("shouldAutoVerifyEmail", () => {
  it("accepts business-domain emails", () => {
    expect(shouldAutoVerifyEmail("info@blountaerials.co.uk")).toBe(true);
  });
  it("rejects freemail", () => {
    expect(shouldAutoVerifyEmail("me@gmail.com")).toBe(false);
  });
});

describe("sendFlagPatch", () => {
  it("verifies business-domain email", () => {
    expect(
      sendFlagPatch({
        contactEmail: "info@blountaerials.co.uk",
        emailVerified: false,
      })
    ).toEqual({ emailVerified: true });
  });

  it("does not verify freemail", () => {
    expect(
      sendFlagPatch({
        contactEmail: "leslie@gmail.com",
        emailVerified: false,
      })
    ).toEqual({});
  });

  it("is a no-op when already verified", () => {
    expect(
      sendFlagPatch({
        contactEmail: "info@blountaerials.co.uk",
        emailVerified: true,
      })
    ).toEqual({});
  });
});

describe("mergeLeadUpdate verified-email preserve", () => {
  it("does not downgrade emailVerified", () => {
    const merged = mergeLeadUpdate(
      { emailVerified: true, industry: "aerials" },
      { emailVerified: false, industry: "tv" }
    );
    expect(merged.emailVerified).toBe(true);
    expect(merged.industry).toBe("tv");
  });

  it("allows corporateSubscriber to change with the incoming payload", () => {
    const merged = mergeLeadUpdate(
      { corporateSubscriber: true, entityType: "unknown" },
      { corporateSubscriber: false, entityType: "sole_trader" }
    );
    expect(merged.corporateSubscriber).toBe(false);
    expect(merged.entityType).toBe("sole_trader");
  });
});

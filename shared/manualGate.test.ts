import { describe, expect, it } from "vitest";
import {
  classifyGateReasons,
  filterManualHardReasons,
  MANUAL_SKIP_REASONS,
  manualSendRefusal,
  unacknowledgedWarnings,
  WARNING_REASONS,
} from "./manualGate";

describe("classifyGateReasons", () => {
  it("keeps PECR and missing email as blocking", () => {
    const { blocking, warnings } = classifyGateReasons([
      "not_corporate_subscriber",
      "missing_contact_email",
      "generic_observation",
    ]);
    expect(blocking).toEqual(["not_corporate_subscriber", "missing_contact_email"]);
    expect(warnings).toEqual(["generic_observation"]);
  });

  it("treats freemail as blocking without consent and a warning with consent", () => {
    expect(classifyGateReasons(["freemail_address"]).blocking).toContain("freemail_address");
    expect(
      classifyGateReasons(["freemail_address"], { hasConsent: true }).warnings
    ).toContain("freemail_address");
    expect(
      classifyGateReasons(["freemail_address"], { hasConsent: true }).blocking
    ).not.toContain("freemail_address");
  });

  it("skips operational reasons by default", () => {
    const { blocking, warnings } = classifyGateReasons([
      "auto_send_disabled",
      "priority_below_threshold",
    ]);
    expect(blocking).toEqual([]);
    expect(warnings).toEqual(["priority_below_threshold"]);
  });

  it("never lets ack clear a blocker", () => {
    const classified = classifyGateReasons(["not_corporate_subscriber", "generic_observation"]);
    expect(manualSendRefusal(classified, ["all"])).toEqual(["not_corporate_subscriber"]);
    expect(manualSendRefusal(classified, ["not_corporate_subscriber", "generic_observation"])).toEqual(
      ["not_corporate_subscriber"]
    );
  });

  it("allows send when every warning is acknowledged", () => {
    const classified = classifyGateReasons(["email_unverified", "priority_below_threshold"]);
    expect(manualSendRefusal(classified, ["email_unverified"])).toEqual(["priority_below_threshold"]);
    expect(manualSendRefusal(classified, ["email_unverified", "priority_below_threshold"])).toEqual([]);
    expect(manualSendRefusal(classified, ["all"])).toEqual([]);
  });
});

describe("unacknowledgedWarnings", () => {
  it("treats all as covering the current warning list", () => {
    expect(unacknowledgedWarnings(["generic_observation"], ["all"])).toEqual([]);
  });
});

describe("operational skip list", () => {
  it("does not silently skip PECR, freemail, suppression, unverified, or demo", () => {
    for (const r of [
      "not_corporate_subscriber",
      "freemail_address",
      "lead_suppressed",
      "email_unverified",
      "demo_not_ready",
    ]) {
      expect(MANUAL_SKIP_REASONS).not.toContain(r);
    }
    expect(WARNING_REASONS).toContain("email_unverified");
    expect(filterManualHardReasons(["auto_send_disabled", "not_corporate_subscriber"])).toEqual([
      "not_corporate_subscriber",
    ]);
  });
});

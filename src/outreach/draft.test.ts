import { describe, expect, it } from "vitest";
import { CUSTOM_BODY_MAX_CHARS, validateCustomBody } from "./draft";

describe("validateCustomBody", () => {
  it("accepts a normal body", () => {
    expect(validateCustomBody("Hi,\n\nJust checking in.\n\nHumza")).toEqual({ ok: true });
  });

  it("rejects over-length bodies", () => {
    const r = validateCustomBody("x".repeat(CUSTOM_BODY_MAX_CHARS + 1));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("exceeds");
  });

  it("rejects unsubscribe links", () => {
    const r = validateCustomBody("See https://x.com/api/unsubscribe?token=abc");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/unsubscribe/i);
  });

  it("rejects footer separators", () => {
    const r = validateCustomBody("Hi\n\n--\nHumza Butt");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/footer separator/i);
  });

  it("rejects unrendered placeholders", () => {
    const r = validateCustomBody("Hello {{name}}");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/placeholder/i);
  });
});

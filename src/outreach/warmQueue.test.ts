import { describe, expect, it } from "vitest";
import { londonNineUtc, nextWeekdayNineLondon } from "./warmQueue";

describe("nextWeekdayNineLondon", () => {
  it("uses today when before 09:00 on a weekday", () => {
    // Wednesday 19 Aug 2026 07:30 BST
    const now = new Date("2026-08-19T06:30:00Z");
    const next = nextWeekdayNineLondon(now);
    expect(next.toISOString()).toBe(londonNineUtc(2026, 8, 19).toISOString());
  });

  it("skips to Monday from Saturday", () => {
    const now = new Date("2026-09-19T10:00:00Z"); // Saturday
    const next = nextWeekdayNineLondon(now);
    expect(next.toISOString()).toBe(londonNineUtc(2026, 9, 21).toISOString());
  });

  it("moves to next weekday after 09:00", () => {
    const now = new Date("2026-09-18T09:30:00+01:00"); // Friday after 9 London
    const next = nextWeekdayNineLondon(now);
    expect(next.toISOString()).toBe(londonNineUtc(2026, 9, 21).toISOString());
  });
});

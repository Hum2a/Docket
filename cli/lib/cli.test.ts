import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveApiKey, parseDevVarsApiKey } from "./key";
import { buildPatchFromSets, coerceSetValue } from "./coerce";
import { computeDiff, confirmApply, formatDiff } from "./diff";
import {
  LEAD_COMMANDS,
  LEAD_PATCH_FIELDS,
  FORBIDDEN_SEND_VERBS,
  assertNoSendInRegistry,
  leadEndpointFor,
} from "./registry";

describe("resolveApiKey", () => {
  it("reads API_KEY from .dev.vars", () => {
    const dir = mkdtempSync(join(tmpdir(), "docket-cli-"));
    try {
      writeFileSync(join(dir, ".dev.vars"), "API_KEY=secret-from-file\n", "utf8");
      const r = resolveApiKey({ cwd: dir, env: {} });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.key).toBe("secret-from-file");
        expect(r.source).toBe(".dev.vars");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("falls back to env when .dev.vars missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "docket-cli-"));
    try {
      const r = resolveApiKey({
        cwd: dir,
        env: { API_KEY: "secret-from-env" },
      });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.key).toBe("secret-from-env");
        expect(r.source).toBe("env");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails clearly without leaking any key", () => {
    const dir = mkdtempSync(join(tmpdir(), "docket-cli-"));
    try {
      const r = resolveApiKey({ cwd: dir, env: {} });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.message).toContain(".dev.vars");
        expect(r.message).toContain("API_KEY");
        expect(r.message.toLowerCase()).not.toContain("secret");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("parseDevVarsApiKey never returns other keys as API_KEY", () => {
    expect(parseDevVarsApiKey("DATABASE_URL=postgres://x\n")).toBeNull();
    expect(parseDevVarsApiKey('API_KEY="quoted-key"\n')).toBe("quoted-key");
  });
});

describe("coerceSetValue", () => {
  it("coerces boolean, number, null, string", () => {
    expect(coerceSetValue("true")).toBe(true);
    expect(coerceSetValue("false")).toBe(false);
    expect(coerceSetValue("null")).toBeNull();
    expect(coerceSetValue("42")).toBe(42);
    expect(coerceSetValue("7.5")).toBe(7.5);
    expect(coerceSetValue("info@example.co.uk")).toBe("info@example.co.uk");
  });

  it("rejects unknown field names with a valid list", () => {
    expect(() => buildPatchFromSets(["typoEmail=x"], LEAD_PATCH_FIELDS)).toThrow(
      /Unknown field "typoEmail"/
    );
    try {
      buildPatchFromSets(["typoEmail=x"], LEAD_PATCH_FIELDS);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      expect(msg).toContain("contactEmail");
    }
  });

  it("builds a coerced patch for known fields", () => {
    expect(
      buildPatchFromSets(
        ["corporateSubscriber=true", "priorityScore=7.5", "contactEmail=a@b.co"],
        LEAD_PATCH_FIELDS
      )
    ).toEqual({
      corporateSubscriber: true,
      priorityScore: 7.5,
      contactEmail: "a@b.co",
    });
  });
});

describe("diff + confirm", () => {
  it("shows only changed fields", () => {
    const diff = computeDiff(
      { contactEmail: "old@x.com", corporateSubscriber: true, status: "queued" },
      { contactEmail: "new@x.com", corporateSubscriber: true }
    );
    expect(diff).toEqual([
      { field: "contactEmail", oldValue: "old@x.com", newValue: "new@x.com" },
    ]);
    const formatted = formatDiff(diff);
    expect(formatted).toContain("contactEmail:");
    expect(formatted).toContain("old@x.com → new@x.com");
    expect(formatted).not.toContain("corporateSubscriber");
  });

  it("aborts cleanly on n", async () => {
    expect(await confirmApply(false, async () => "n")).toBe("abort");
    expect(await confirmApply(false, async () => "y")).toBe("apply");
    expect(await confirmApply(true, async () => "n")).toBe("apply");
  });

  it("formats long customBody as a unified-style diff", () => {
    const diff = computeDiff(
      { customBody: "line one\nline two" },
      { customBody: "line one\nline two changed" }
    );
    const formatted = formatDiff(diff);
    expect(formatted).toContain("customBody:");
    expect(formatted).toMatch(/^\s*- /m);
    expect(formatted).toMatch(/^\s*\+ /m);
  });
});

describe("no send capability", () => {
  it("command registry contains no send verb", () => {
    for (const verb of FORBIDDEN_SEND_VERBS) {
      expect(LEAD_COMMANDS).not.toContain(verb);
    }
    expect(() => assertNoSendInRegistry()).not.toThrow();
  });

  it("no command maps to a send endpoint", () => {
    for (const cmd of LEAD_COMMANDS) {
      const { path } = leadEndpointFor(cmd, 5);
      expect(path).not.toMatch(/\/send\b/);
      expect(path).not.toMatch(/\/approve\b/);
      expect(path).not.toMatch(/autosend/);
      expect(path).not.toMatch(/sequence/);
    }
  });
});

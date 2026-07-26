import { describe, expect, it } from "vitest";
import { outreachApp } from "../outreach-routes";
import {
  OUTREACH_PUBLIC_GETS,
  OUTREACH_READS_REQUIRING_KEY,
} from "./routeAuth";

const env = {
  API_KEY: "test-secret-key",
  DATABASE_URL: "postgres://invalid.example/db",
  UNSUBSCRIBE_SIGNING_KEY: "unsub-test",
} as Record<string, string>;

describe("outreach read auth", () => {
  it("returns 401 without X-Api-Key on every protected outreach read", async () => {
    for (const path of OUTREACH_READS_REQUIRING_KEY) {
      const res = await outreachApp.request(path, { method: "GET" }, env);
      expect(res.status, path).toBe(401);
      const body = (await res.json()) as { error?: string };
      expect(body.error, path).toMatch(/unauthorized/i);
      expect(JSON.stringify(body)).not.toMatch(/contactEmail|contactPhone|@/);
    }
  });

  it("does not 401 with a valid X-Api-Key (auth passes; handler may 5xx without DB)", async () => {
    for (const path of OUTREACH_READS_REQUIRING_KEY) {
      const res = await outreachApp.request(
        path,
        { method: "GET", headers: { "X-Api-Key": env.API_KEY } },
        env
      );
      expect(res.status, path).not.toBe(401);
    }
  });

  it("keeps preflight and unsubscribe free of API-key auth", async () => {
    for (const path of OUTREACH_PUBLIC_GETS) {
      const url =
        path === "/api/unsubscribe" ? `${path}?token=invalid` : path;
      const res = await outreachApp.request(url, { method: "GET" }, env);
      const text = await res.text();
      // Must not be the API-key gate (unsubscribe may 400 on bad token; preflight may 5xx without DB)
      expect(text, path).not.toMatch(/unauthorized: missing or invalid X-Api-Key/i);
      if (path === "/api/unsubscribe") {
        // Invalid token → client error, not "missing API key"
        expect(res.status, path).toBeGreaterThanOrEqual(400);
        expect(res.status, path).toBeLessThan(500);
      }
    }
  });

  it("rejects an invalid API key with 401", async () => {
    const res = await outreachApp.request(
      "/api/leads",
      { method: "GET", headers: { "X-Api-Key": "wrong" } },
      env
    );
    expect(res.status).toBe(401);
  });
});

#!/usr/bin/env node
/**
 * Generate missing local secrets and sync them to Cloudflare Workers.
 *
 * Usage:
 *   npm run secrets:sync              # ensure .dev.vars + push to Cloudflare
 *   npm run secrets:sync -- --local   # only update .dev.vars (no wrangler)
 *   npm run secrets:sync -- --force   # regenerate auto-keys even if set
 *   npm run secrets:sync -- --dry-run # print plan, write nothing
 *
 * Auto-generated (crypto):
 *   RESEND_INBOUND_SECRET, UNSUBSCRIBE_SIGNING_KEY
 *
 * Defaults when missing (edit in .dev.vars anytime):
 *   OUTREACH_FROM, OUTREACH_REPLY_TO, OUTREACH_POSTAL_ADDRESS
 *   DIGEST_FROM (if unset)
 *
 * Already-present values in .dev.vars are kept unless --force (generated keys only).
 */

import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const devVarsPath = join(root, ".dev.vars");

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const localOnly = args.has("--local");
const force = args.has("--force");

/** Keys we will push to Cloudflare when present in .dev.vars */
const SYNC_KEYS = [
  "DATABASE_URL",
  "API_KEY",
  "RESEND_API_KEY",
  "DIGEST_TO",
  "DIGEST_FROM",
  "OUTREACH_FROM",
  "OUTREACH_REPLY_TO",
  "OUTREACH_POSTAL_ADDRESS",
  "RESEND_INBOUND_SECRET",
  "UNSUBSCRIBE_SIGNING_KEY",
];

const GENERATORS = {
  RESEND_INBOUND_SECRET: () => randomBytes(32).toString("base64url"),
  UNSUBSCRIBE_SIGNING_KEY: () => randomBytes(32).toString("base64url"),
};

const DEFAULTS = {
  DIGEST_FROM: "Docket <Docket@Humza-Butt.space>",
  OUTREACH_FROM: "Outreach <outreach@Humza-Butt.space>",
  OUTREACH_REPLY_TO: "outreach@Humza-Butt.space",
  OUTREACH_POSTAL_ADDRESS: "Humza Butt, United Kingdom",
};

function parseDevVars(text) {
  /** @type {Map<string, string>} */
  const map = new Map();
  /** @type {string[]} */
  const order = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!map.has(key)) order.push(key);
    map.set(key, value);
  }
  return { map, order };
}

function serializeDevVars(map, order) {
  const keys = [...order];
  for (const key of SYNC_KEYS) {
    if (map.has(key) && !keys.includes(key)) keys.push(key);
  }
  for (const key of map.keys()) {
    if (!keys.includes(key)) keys.push(key);
  }
  return keys
    .filter((k) => map.has(k) && map.get(k) !== undefined)
    .map((k) => `${k}=${map.get(k)}`)
    .join("\n")
    .concat("\n");
}

function mask(value) {
  if (!value) return "(empty)";
  if (value.length <= 8) return "****";
  return `${value.slice(0, 4)}…${value.slice(-4)} (${value.length} chars)`;
}

function putSecret(name, value) {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["wrangler", "secret", "put", name], {
      cwd: root,
      shell: true,
      stdio: ["pipe", "inherit", "inherit"],
    });
    child.stdin.write(value);
    child.stdin.end();
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`wrangler secret put ${name} exited ${code}`));
    });
  });
}

async function main() {
  const existingText = existsSync(devVarsPath) ? readFileSync(devVarsPath, "utf8") : "";
  const { map, order } = parseDevVars(existingText);

  /** @type {string[]} */
  const changes = [];

  for (const [key, gen] of Object.entries(GENERATORS)) {
    if (!map.has(key) || !map.get(key) || force) {
      const value = gen();
      map.set(key, value);
      changes.push(`${force && existingText.includes(key) ? "regenerated" : "generated"} ${key}`);
    }
  }

  for (const [key, value] of Object.entries(DEFAULTS)) {
    if (!map.has(key) || !map.get(key)?.trim()) {
      map.set(key, value);
      changes.push(`defaulted ${key}`);
    }
  }

  if (changes.length === 0) {
    console.log("No new secrets to generate — .dev.vars already has outreach keys.");
  } else {
    console.log("Local updates:");
    for (const c of changes) console.log(`  • ${c}`);
  }

  if (dryRun) {
    console.log("\n[--dry-run] Would write .dev.vars and sync:");
    for (const key of SYNC_KEYS) {
      if (map.has(key) && map.get(key)) {
        console.log(`  • ${key} = ${mask(map.get(key))}`);
      } else {
        console.log(`  • ${key} = (missing — skipped)`);
      }
    }
    return;
  }

  writeFileSync(devVarsPath, serializeDevVars(map, order), "utf8");
  console.log(`\nWrote ${devVarsPath}`);

  if (localOnly) {
    console.log("(--local) Skipped Cloudflare sync.");
    return;
  }

  console.log("\nSyncing secrets to Cloudflare…");
  let synced = 0;
  let skipped = 0;
  for (const key of SYNC_KEYS) {
    const value = map.get(key);
    if (!value?.trim()) {
      console.log(`  skip ${key} (not set in .dev.vars)`);
      skipped++;
      continue;
    }
    process.stdout.write(`  put  ${key} … `);
    try {
      await putSecret(key, value);
      console.log(`ok (${mask(value)})`);
      synced++;
    } catch (err) {
      console.log("FAILED");
      throw err;
    }
  }

  console.log(`\nDone. Synced ${synced}, skipped ${skipped}.`);
  if (!map.get("DIGEST_TO")?.trim()) {
    console.log(
      "Note: DIGEST_TO is unset — set it in .dev.vars (your inbox) then re-run secrets:sync."
    );
  }
  console.log(
    "Tip: edit OUTREACH_POSTAL_ADDRESS / OUTREACH_FROM in .dev.vars if the defaults are wrong, then re-run."
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

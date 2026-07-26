#!/usr/bin/env node
/**
 * One-shot: auto-enable email_verified + corporate_subscriber for
 * business-domain (non-freemail) contacts, and strip those two review reasons.
 *
 *   node scripts/backfill-send-flags.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { neonConfig, Pool } from "@neondatabase/serverless";
import ws from "ws";

neonConfig.webSocketConstructor = ws;

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const path = join(root, ".dev.vars");
  if (!existsSync(path)) throw new Error("DATABASE_URL / .dev.vars missing");
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    if (t.slice(0, eq) === "DATABASE_URL") return t.slice(eq + 1);
  }
  throw new Error("DATABASE_URL not found");
}

const freemailList = [
  "gmail.com",
  "googlemail.com",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "yahoo.co.uk",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "protonmail.com",
  "proton.me",
  "btinternet.com",
  "sky.com",
  "mail.com",
  "gmx.com",
  "gmx.co.uk",
];

const pool = new Pool({ connectionString: loadDatabaseUrl() });
try {
  const before = await pool.query(
    `select count(*)::int as n from leads
     where contact_email is not null and btrim(contact_email) <> ''
       and (email_verified = false or corporate_subscriber = false)`
  );

  const res = await pool.query(
    `update leads
     set
       email_verified = case
         when contact_email is not null and btrim(contact_email) <> ''
           and lower(split_part(contact_email, '@', 2)) <> all($1::text[])
         then true else email_verified end,
       corporate_subscriber = case
         when contact_email is not null and btrim(contact_email) <> ''
           and lower(split_part(contact_email, '@', 2)) <> all($1::text[])
         then true else corporate_subscriber end,
       updated_at = now()
     where contact_email is not null and btrim(contact_email) <> ''
       and (email_verified = false or corporate_subscriber = false)
     returning id, business_name, email_verified, corporate_subscriber`,
    [freemailList]
  );

  const cleared = await pool.query(
    `update leads
     set review_reasons = coalesce((
       select array_agg(r) from unnest(review_reasons) as r
       where r not in ('email_unverified','not_corporate_subscriber')
     ), '{}'),
     updated_at = now()
     where review_reasons && array['email_unverified','not_corporate_subscriber']::text[]
     returning id`
  );

  console.log(
    JSON.stringify(
      {
        candidatesBefore: before.rows[0].n,
        updated: res.rowCount,
        sample: res.rows.slice(0, 8).map((r) => ({
          id: r.id,
          name: r.business_name,
          ev: r.email_verified,
          cs: r.corporate_subscriber,
        })),
        reviewCleared: cleared.rowCount,
      },
      null,
      2
    )
  );
} finally {
  await pool.end();
}

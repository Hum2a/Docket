#!/usr/bin/env node
/**
 * List leads flagged corporate without a CH number or a corporate entity type.
 * Dry run by default. --apply writes corporate_subscriber = false and adds
 * review reason corporate_unconfirmed.
 *
 *   node scripts/recheck-corporate.mjs
 *   node scripts/recheck-corporate.mjs --apply
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { neonConfig, Pool } from "@neondatabase/serverless";
import ws from "ws";

neonConfig.webSocketConstructor = ws;

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const apply = process.argv.includes("--apply");

const CORPORATE_ENTITIES = ["ltd", "llp", "scottish_partnership", "public_body"];

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const path = join(root, ".dev.vars");
  if (!existsSync(path)) throw new Error("DATABASE_URL / .dev.vars missing");
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    if (t.slice(0, eq) === "DATABASE_URL") return t.slice(eq + 1).replace(/^['"]|['"]$/g, "");
  }
  throw new Error("DATABASE_URL not found");
}

const SELECT = `
  SELECT
    l.id,
    l.business_name,
    l.contact_email,
    l.status,
    l.entity_type,
    l.companies_house_number,
    EXISTS (
      SELECT 1 FROM lead_messages m
      WHERE m.lead_id = l.id
        AND m.direction = 'out'
        AND m.status IN ('sent', 'delivered')
    ) AS already_sent
  FROM leads l
  WHERE l.corporate_subscriber = true
    AND (l.companies_house_number IS NULL OR btrim(l.companies_house_number) = '')
    AND lower(l.entity_type) <> ALL($1::text[])
  ORDER BY l.id
`;

const pool = new Pool({ connectionString: loadDatabaseUrl() });
try {
  const listed = await pool.query(SELECT, [CORPORATE_ENTITIES]);
  const rows = listed.rows;
  console.log(apply ? "APPLY" : "DRY RUN");
  console.log(`flagged: ${rows.length}`);
  const header = ["id", "business", "email", "status", "sent"];
  const cells = rows.map((r) => [
    String(r.id),
    String(r.business_name ?? "").slice(0, 36),
    String(r.contact_email ?? ""),
    String(r.status ?? ""),
    r.already_sent ? "Y" : "n",
  ]);
  const widths = header.map((h, i) =>
    Math.max(h.length, ...cells.map((c) => c[i].length))
  );
  const fmt = (cols) => cols.map((c, i) => c.padEnd(widths[i])).join("  ");
  console.log(fmt(header));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const c of cells) console.log(fmt(c));

  if (apply && rows.length) {
    const ids = rows.map((r) => r.id);
    const updated = await pool.query(
      `UPDATE leads
       SET corporate_subscriber = false,
           review_reasons = CASE
             WHEN 'corporate_unconfirmed' = ANY(review_reasons) THEN review_reasons
             ELSE array_append(review_reasons, 'corporate_unconfirmed')
           END,
           updated_at = now()
       WHERE id = ANY($1::int[])
       RETURNING id`,
      [ids]
    );
    console.log(`updated: ${updated.rowCount}`);
  }
} finally {
  await pool.end();
}

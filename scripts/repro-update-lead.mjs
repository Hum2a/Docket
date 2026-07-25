/**
 * Reproduce updateLead failure locally against Neon.
 * Prints only the error message — no secrets, no row dumps.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { neonConfig, neon } from "@neondatabase/serverless";
import ws from "ws";

neonConfig.webSocketConstructor = ws;

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const text = readFileSync(join(root, ".dev.vars"), "utf8");
let databaseUrl = "";
for (const line of text.split(/\r?\n/)) {
  if (line.startsWith("DATABASE_URL=")) {
    databaseUrl = line.slice("DATABASE_URL=".length).trim();
    break;
  }
}
if (!databaseUrl) {
  console.error("No DATABASE_URL in .dev.vars");
  process.exit(1);
}

const sql = neon(databaseUrl);

async function tryQuery(label, fn) {
  try {
    const rows = await fn();
    console.log(label, "OK rows=", Array.isArray(rows) ? rows.length : typeof rows);
  } catch (err) {
    console.log(label, "FAIL", err instanceof Error ? err.message : String(err));
  }
}

const id = 5;

await tryQuery("select star", () => sql`SELECT * FROM leads WHERE id = ${id}`);

await tryQuery("update touch only", () => sql`
  UPDATE leads SET updated_at = now() WHERE id = ${id} RETURNING id
`);

await tryQuery("update demo_status", () => sql`
  UPDATE leads SET demo_status = ${"failed"}, updated_at = now() WHERE id = ${id} RETURNING id
`);

await tryQuery("update audit jsonb stringify cast", async () => {
  const existing = await sql`SELECT audit FROM leads WHERE id = ${id}`;
  const audit = existing[0]?.audit ?? {};
  return sql`
    UPDATE leads SET audit = ${JSON.stringify(audit)}::jsonb, updated_at = now()
    WHERE id = ${id} RETURNING id
  `;
});

await tryQuery("update demo_expires_at null", () => sql`
  UPDATE leads SET demo_expires_at = ${null}, updated_at = now() WHERE id = ${id} RETURNING id
`);

await tryQuery("update full mirror of updateLead audit line", async () => {
  const rows = await sql`SELECT * FROM leads WHERE id = ${id}`;
  const row = rows[0];
  const audit = typeof row.audit === "object" && row.audit ? row.audit : {};
  return sql`
    UPDATE leads SET
      business_name = ${row.business_name},
      slug = ${row.slug},
      industry = ${row.industry},
      location = ${row.location},
      postcode = ${row.postcode},
      address = ${row.address},
      contact_name = ${row.contact_name},
      contact_email = ${row.contact_email},
      contact_phone = ${row.contact_phone},
      contact_form_url = ${row.contact_form_url},
      email_source = ${row.email_source},
      email_verified = ${row.email_verified},
      website_url = ${row.website_url},
      has_website = ${row.has_website},
      companies_house_number = ${row.companies_house_number},
      entity_type = ${row.entity_type},
      corporate_subscriber = ${row.corporate_subscriber},
      ch_status = ${row.ch_status},
      incorporated_on = ${row.incorporated_on},
      audit = ${JSON.stringify(audit)}::jsonb,
      need_score = ${row.need_score},
      likelihood_score = ${row.likelihood_score},
      priority_score = ${row.priority_score},
      score_reason = ${row.score_reason},
      demo_url = ${row.demo_url},
      demo_built_at = ${row.demo_built_at},
      demo_expires_at = ${row.demo_expires_at},
      demo_status = ${row.demo_status},
      status = ${row.status},
      offer_amount = ${row.offer_amount},
      source = ${row.source},
      source_ref = ${row.source_ref},
      updated_at = now()
    WHERE id = ${id}
    RETURNING id
  `;
});

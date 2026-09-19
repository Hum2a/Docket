/**
 * Local lead editor CLI.
 *
 * `send` is single-lead only, with a full email preview and typed confirmation.
 * Batch / autosend / sequence are not exposed here.
 */

import { createInterface } from "node:readline";
import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import {
  collectSets,
  hasFlag,
  pick,
  positional,
  resolveBase,
  DEFAULT_BASE,
} from "./lib/args";
import { buildPatchFromSets } from "./lib/coerce";
import { computeDiff, confirmApply, formatDiff } from "./lib/diff";
import { apiRequest, ApiError } from "./lib/http";
import { resolveApiKey } from "./lib/key";
import {
  confirmBusinessName,
  formatEmailPreview,
  formatGateResult,
  parseAckWarnings,
  parseSendIds,
  refuseDryRunWithoutOverride,
} from "./lib/manualSend";
import { isFreemail } from "../shared/freemail";
import { labelGateReason } from "../shared/manualGate";
import {
  LEAD_COMMANDS,
  LEAD_PATCH_FIELDS,
  type LeadCommand,
} from "./lib/registry";

type Lead = Record<string, unknown> & {
  id: number;
  businessName?: string;
  priorityScore?: number | null;
  status?: string;
  demoStatus?: string;
  contactEmail?: string | null;
  customBody?: string | null;
  customSubject?: string | null;
  consentEmail?: string | null;
  consentStatus?: string | null;
  consentNote?: string | null;
};

type Settings = {
  fromAddress?: string | null;
  dryRun?: boolean;
  sendingDomain?: string | null;
};

function usage(): never {
  console.error(`Usage:
  npm run lead -- list [--status=...] [--min-priority=N] [--json]
  npm run lead -- get <id>
  npm run lead -- patch <id> --file=./patch.json
  npm run lead -- patch <id> --set field=value [--set ...]
  npm run lead -- draft <id> --subject="..." --body-file=./draft.txt
  npm run lead -- preflight
  npm run lead -- consent <id> --email=<addr> --note="..." [--written]
  npm run lead -- send <id> [--warm] [--dry] [--queue] [--yes] [--override-dry-run] [--ack-warnings=codes|all]

Options:
  --base=URL   Default ${DEFAULT_BASE} (use http://localhost:8787 for wrangler)
  --yes        Skip confirmation prompts (patch/draft Apply?; send/consent typed name)
  --dry        Preview send only — never contacts Resend
  --warm       Consent lane: send to consent_email from personal From
  --queue      Warm only: schedule next weekday 09:00 Europe/London
  --ack-warnings=a,b  Acknowledge quality warnings (or all). Never skips suppressions / demo-not-ready.

API_KEY is read from .dev.vars or the environment — never pass it on the command line.
Send is one lead per invocation (no --all / batch).`);
  process.exit(2);
}

function askConfirm(): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question("Apply? [y/N] ", (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

function askLine(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

function printLead(lead: Lead): void {
  const { customBody, ...rest } = lead;
  console.log(JSON.stringify(rest, null, 2));
  if (customBody != null && customBody !== "") {
    console.log("\n--- customBody ---");
    console.log(String(customBody));
    console.log("--- end customBody ---");
  } else {
    console.log("\ncustomBody: (none)");
  }
}

function printListTable(leads: Lead[]): void {
  const rows = leads.map((l) => ({
    id: l.id,
    name: String(l.businessName ?? "").slice(0, 28),
    pri: l.priorityScore != null ? Number(l.priorityScore).toFixed(1) : "—",
    status: String(l.status ?? ""),
    demo: String(l.demoStatus ?? ""),
    email: l.contactEmail ? "Y" : "n",
  }));
  const header = ["id", "name", "pri", "status", "demo", "email"];
  const widths = header.map((h) =>
    Math.max(h.length, ...rows.map((r) => String((r as Record<string, unknown>)[h]).length))
  );
  const fmt = (cols: string[]) =>
    cols.map((c, i) => c.padEnd(widths[i]!)).join("  ");
  console.log(fmt(header));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const r of rows) {
    console.log(
      fmt([
        String(r.id),
        r.name,
        r.pri,
        r.status,
        r.demo,
        r.email,
      ])
    );
  }
}

async function applyPatch(opts: {
  base: string;
  apiKey: string;
  id: number;
  patch: Record<string, unknown>;
  yes: boolean;
}): Promise<void> {
  const current = await apiRequest<Lead>({
    base: opts.base,
    path: `/api/leads/${opts.id}`,
    apiKey: opts.apiKey,
  });
  const diff = computeDiff(current as Record<string, unknown>, opts.patch);
  console.log(formatDiff(diff));
  if (diff.length === 0) {
    console.log("Nothing to apply.");
    return;
  }
  const decision = await confirmApply(opts.yes, askConfirm);
  if (decision === "abort") {
    console.error("Aborted.");
    process.exit(1);
  }
  const updated = await apiRequest<Lead>({
    base: opts.base,
    path: `/api/leads/${opts.id}`,
    method: "PATCH",
    apiKey: opts.apiKey,
    body: opts.patch,
  });
  console.log(`Updated lead ${updated.id} (${updated.businessName}).`);
}

async function runSend(opts: {
  base: string;
  apiKey: string;
  argv: string[];
  pos: string[];
  yes: boolean;
}): Promise<void> {
  const parsed = parseSendIds(opts.pos);
  if (!parsed.ok) {
    console.error(parsed.error);
    process.exit(2);
  }
  const dryOnly = hasFlag(opts.argv, "dry");
  const overrideDryRun = hasFlag(opts.argv, "override-dry-run");

  const warm = hasFlag(opts.argv, "warm");
  const queue = hasFlag(opts.argv, "queue");
  const laneQs = warm ? "?lane=warm" : "";
  const lead = await apiRequest<Lead>({
    base: opts.base,
    path: `/api/leads/${parsed.id}`,
    apiKey: opts.apiKey,
  });
  const settings = await apiRequest<Settings>({
    base: opts.base,
    path: "/api/outreach/settings",
    apiKey: opts.apiKey,
  });
  const readiness = await apiRequest<{
    ok: boolean;
    reasons: string[];
    labels: string[];
    warnings?: string[];
    warningLabels?: string[];
    preflightReady: boolean;
    preflightBlocking: string[];
    dryRun: boolean;
  }>({
    base: opts.base,
    path: `/api/leads/${parsed.id}/send-readiness${laneQs}`,
    apiKey: opts.apiKey,
  });
  const preview = await apiRequest<{
    subject: string;
    text: string;
    source: string;
    from?: string;
    to?: string | null;
  }>({
    base: opts.base,
    path: `/api/leads/${parsed.id}/outreach-preview${laneQs}`,
    apiKey: opts.apiKey,
  });

  const from =
    (preview.from || settings.fromAddress || "").trim() || "(from-address not set)";
  const to = warm
    ? (lead.consentEmail || preview.to || "").trim() || "(no consent email)"
    : (lead.contactEmail || "").trim() || "(no contact email)";
  console.log(
    formatEmailPreview({
      from,
      to,
      subject: preview.subject,
      text: preview.text,
    })
  );
  console.log("");
  console.log(formatGateResult(readiness.reasons, readiness.warnings ?? []));

  if (!readiness.preflightReady) {
    console.error("Preflight not ready — blocking:");
    for (const k of readiness.preflightBlocking) {
      console.error(`  - ${labelGateReason(k)}`);
    }
    process.exit(1);
  }

  if (readiness.reasons.length > 0) {
    console.error("Hard gate failed — not sending.");
    process.exit(1);
  }

  const ack = parseAckWarnings(pick(opts.argv, "ack-warnings"));
  const warnings = readiness.warnings ?? [];
  if (warnings.length > 0) {
    const missing = warnings.filter((w) => !ack.includes("all") && !ack.includes(w));
    if (missing.length > 0) {
      console.error("Quality warnings need --ack-warnings (comma-separated codes or all):");
      for (const w of missing) console.error(`  - ${w}: ${labelGateReason(w)}`);
      process.exit(1);
    }
  }

  const dryRefuse = refuseDryRunWithoutOverride(
    Boolean(settings.dryRun),
    overrideDryRun,
    dryOnly
  );
  if (dryRefuse) {
    console.error(dryRefuse);
    process.exit(1);
  }

  if (dryOnly) {
    console.log("\n--dry: preview only, Resend not contacted.");
    return;
  }

  if (!opts.yes) {
    const typed = await askLine("Type the business name to send: ");
    if (!confirmBusinessName(typed, String(lead.businessName ?? ""))) {
      console.error("Aborted — business name did not match.");
      process.exit(1);
    }
  }

  const result = await apiRequest<{
    sent: boolean;
    dryRun: boolean;
    queued?: boolean;
    warmSendAt?: string;
    reasons: string[];
    messageId?: number;
  }>({
    base: opts.base,
    path: `/api/leads/${parsed.id}/send`,
    method: "POST",
    apiKey: opts.apiKey,
    body: { manual: true, overrideDryRun, warm, queue, acknowledgedWarnings: ack },
  });

  const fresh = await apiRequest<Lead>({
    base: opts.base,
    path: `/api/leads/${parsed.id}`,
    apiKey: opts.apiKey,
  });

  if (result.queued) {
    console.log(`Queued warm send at ${result.warmSendAt} · lead status=${fresh.status}`);
    return;
  }
  if (!result.sent && !result.dryRun) {
    console.error(`Send failed: ${(result.reasons || []).join(", ")}`);
    process.exit(1);
  }
  console.log(
    result.dryRun
      ? `Queued dry-run message id=${result.messageId ?? "?"} · lead status=${fresh.status}`
      : `Sent message id=${result.messageId ?? "?"} · lead status=${fresh.status}`
  );
}

async function runConsent(opts: {
  base: string;
  apiKey: string;
  argv: string[];
  pos: string[];
  yes: boolean;
}): Promise<void> {
  const id = Number(opts.pos[1]);
  if (!Number.isInteger(id)) usage();
  const email = pick(opts.argv, "email");
  const note = pick(opts.argv, "note");
  if (!email || !note) {
    console.error("consent requires --email= and --note=");
    process.exit(2);
  }
  const written = hasFlag(opts.argv, "written");
  const lead = await apiRequest<Lead>({
    base: opts.base,
    path: `/api/leads/${id}`,
    apiKey: opts.apiKey,
  });
  console.log(`Lead #${lead.id}  ${lead.businessName}`);
  console.log(`Consent email: ${email}`);
  console.log(`Note: ${note}`);
  console.log(`Kind: ${written ? "written_reply" : "verbal_call"}`);
  if (isFreemail(email)) {
    console.log("Warning: this is a freemail address. Consent makes it lawful — not blocked.");
  }
  if (!opts.yes) {
    const typed = await askLine("Type the business name to record consent: ");
    if (!confirmBusinessName(typed, String(lead.businessName ?? ""))) {
      console.error("Aborted — business name did not match.");
      process.exit(1);
    }
  }
  const updated = await apiRequest<Lead>({
    base: opts.base,
    path: `/api/leads/${id}/consent`,
    method: "POST",
    apiKey: opts.apiKey,
    body: { email, note, written },
  });
  console.log(
    `Recorded ${updated.consentStatus} for ${updated.consentEmail} (contactEmail unchanged).`
  );
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (hasFlag(argv, "help") || argv.includes("-h")) usage();

  const base = resolveBase(argv);
  console.log(`base: ${base}`);

  const keyResult = resolveApiKey({});
  if (!keyResult.ok) {
    console.error(keyResult.message);
    process.exit(1);
  }
  const apiKey = keyResult.key;
  console.log(`auth: ${keyResult.source}`);

  const pos = positional(argv);
  const command = pos[0] as LeadCommand | undefined;
  if (!command || !(LEAD_COMMANDS as readonly string[]).includes(command)) {
    usage();
  }

  const yes = hasFlag(argv, "yes");

  try {
    if (command === "list") {
      const status = pick(argv, "status");
      const minPri = pick(argv, "min-priority");
      const qs = new URLSearchParams();
      qs.set("limit", pick(argv, "limit") ?? "200");
      if (status) qs.set("status", status);
      if (minPri) qs.set("min_priority", minPri);
      const page = await apiRequest<{ leads: Lead[] }>({
        base,
        path: `/api/leads?${qs}`,
        apiKey,
      });
      if (hasFlag(argv, "json")) {
        console.log(JSON.stringify(page.leads, null, 2));
      } else {
        printListTable(page.leads);
        console.log(`\n${page.leads.length} lead(s)`);
      }
      return;
    }

    if (command === "get") {
      const id = Number(pos[1]);
      if (!Number.isInteger(id)) usage();
      const lead = await apiRequest<Lead>({
        base,
        path: `/api/leads/${id}`,
        apiKey,
      });
      printLead(lead);
      return;
    }

    if (command === "preflight") {
      const pf = await apiRequest<{
        ready: boolean;
        warmReady?: boolean;
        checks: Record<string, boolean>;
        blocking: string[];
        warmBlocking?: string[];
        warnings: string[];
      }>({
        base,
        path: "/api/outreach/preflight",
        apiKey,
      });
      console.log(`cold ready: ${pf.ready ? "yes" : "no"}`);
      console.log(`warm lane ready: ${pf.warmReady ? "yes" : "no"}`);
      for (const [k, ok] of Object.entries(pf.checks)) {
        console.log(`  ${ok ? "✓" : "✗"} ${k}`);
      }
      console.log(`blocking: ${pf.blocking.length ? pf.blocking.join(", ") : "(none)"}`);
      console.log(
        `warm blocking: ${pf.warmBlocking?.length ? pf.warmBlocking.join(", ") : "(none)"}`
      );
      console.log(`warnings: ${pf.warnings?.length ? pf.warnings.join(", ") : "(none)"}`);
      return;
    }

    if (command === "consent") {
      await runConsent({ base, apiKey, argv, pos, yes });
      return;
    }

    if (command === "send") {
      if (hasFlag(argv, "queue") && !hasFlag(argv, "warm")) {
        console.error("--queue requires --warm");
        process.exit(2);
      }
      await runSend({ base, apiKey, argv, pos, yes });
      return;
    }

    if (command === "patch") {
      const id = Number(pos[1]);
      if (!Number.isInteger(id)) usage();
      const file = pick(argv, "file");
      const sets = collectSets(argv);
      let patch: Record<string, unknown> = {};
      if (file) {
        const raw = readFileSync(resolvePath(file), "utf8");
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        for (const key of Object.keys(parsed)) {
          if (!(LEAD_PATCH_FIELDS as readonly string[]).includes(key)) {
            throw new Error(
              `Unknown field "${key}" in file. Valid fields: ${[...LEAD_PATCH_FIELDS].sort().join(", ")}`
            );
          }
        }
        patch = { ...parsed };
      }
      if (sets.length) {
        patch = { ...patch, ...buildPatchFromSets(sets, LEAD_PATCH_FIELDS) };
      }
      if (Object.keys(patch).length === 0) {
        console.error("Nothing to patch — pass --file and/or --set");
        process.exit(2);
      }
      await applyPatch({ base, apiKey, id, patch, yes });
      return;
    }

    if (command === "draft") {
      const id = Number(pos[1]);
      if (!Number.isInteger(id)) usage();
      const subject = pick(argv, "subject");
      const bodyFile = pick(argv, "body-file");
      if (!bodyFile) {
        console.error("draft requires --body-file=...");
        process.exit(2);
      }
      const body = readFileSync(resolvePath(bodyFile), "utf8");
      const patch: Record<string, unknown> = {
        customBody: body,
      };
      if (subject !== undefined) patch.customSubject = subject;
      await applyPatch({ base, apiKey, id, patch, yes });
      return;
    }

    usage();
  } catch (err) {
    if (err instanceof ApiError) {
      console.error(`Request failed (${err.status})`);
      console.error(err.body);
      process.exit(1);
    }
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

main();

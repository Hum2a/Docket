/**
 * Local outreach settings CLI.
 *
 * No send capability — does not call autosend, sequence, or lead send/approve.
 */

import { createInterface } from "node:readline";
import {
  collectSets,
  hasFlag,
  resolveBase,
} from "./lib/args";
import { buildPatchFromSets } from "./lib/coerce";
import { computeDiff, confirmApply, formatDiff } from "./lib/diff";
import { apiRequest, ApiError } from "./lib/http";
import { resolveApiKey } from "./lib/key";
import { SETTINGS_FIELDS } from "./lib/registry";

type Settings = Record<string, unknown>;

function usage(): never {
  console.error(`Usage:
  npm run settings -- --show
  npm run settings -- --set dryRun=false [--set sendingDomain=...]

Options:
  --base=URL   Default https://jobtracker.humza-butt.space
  --yes        Skip Apply? confirmation

API_KEY is read from .dev.vars or the environment — never pass it on the command line.`);
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

  const show = hasFlag(argv, "show") || collectSets(argv).length === 0;
  const yes = hasFlag(argv, "yes");

  try {
    const current = await apiRequest<Settings>({
      base,
      path: "/api/outreach/settings",
      apiKey,
    });

    const sets = collectSets(argv);
    if (sets.length === 0 || (show && sets.length === 0)) {
      console.log(JSON.stringify(current, null, 2));
      if (sets.length === 0 && !hasFlag(argv, "show")) {
        // bare `npm run settings` → show
      }
      return;
    }

    const patch = buildPatchFromSets(sets, SETTINGS_FIELDS);
    const diff = computeDiff(current, patch);
    console.log(formatDiff(diff));
    if (diff.length === 0) {
      console.log("Nothing to apply.");
      return;
    }
    const decision = await confirmApply(yes, askConfirm);
    if (decision === "abort") {
      console.error("Aborted.");
      process.exit(1);
    }
    const updated = await apiRequest<Settings>({
      base,
      path: "/api/outreach/settings",
      method: "PATCH",
      apiKey,
      body: patch,
    });
    console.log("Updated settings:");
    console.log(JSON.stringify(updated, null, 2));
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

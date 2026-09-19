/**
 * Manual send CLI helpers.
 *
 * Safeguards: print full email, typed business-name confirm, no batch mode.
 * --yes skips the typed confirm only — never PECR / freemail / suppression / demo gates.
 */

import { labelGateReason } from "../../shared/manualGate";

export function parseSendIds(positional: string[]): { ok: true; id: number } | { ok: false; error: string } {
  if (positional.includes("--all") || positional.some((p) => p === "all")) {
    return { ok: false, error: "Batch send is not supported. Send one lead id at a time." };
  }
  const ids = positional.slice(1).filter((p) => !p.startsWith("--"));
  if (ids.length === 0) {
    return { ok: false, error: "Usage: lead send <id>" };
  }
  if (ids.length > 1) {
    return {
      ok: false,
      error: "One lead per invocation — pass a single id (no batch / --all).",
    };
  }
  const id = Number(ids[0]);
  if (!Number.isInteger(id)) {
    return { ok: false, error: `Invalid lead id: ${ids[0]}` };
  }
  return { ok: true, id };
}

export function formatEmailPreview(opts: {
  from: string;
  to: string;
  subject: string;
  text: string;
}): string {
  return [
    `From: ${opts.from}`,
    `To:   ${opts.to}`,
    `Subject: ${opts.subject}`,
    "",
    opts.text,
  ].join("\n");
}

export function formatGateResult(blocking: string[], warnings: string[] = []): string {
  const lines: string[] = [];
  if (blocking.length > 0) {
    lines.push("Gate: FAIL");
    for (const r of blocking) lines.push(`  - ${labelGateReason(r)}`);
  } else if (warnings.length > 0) {
    lines.push("Gate: WARN");
    for (const r of warnings) lines.push(`  - ${labelGateReason(r)}`);
    lines.push("Pass --ack-warnings=<codes> or --ack-warnings=all after you've checked these.");
  } else {
    return "Gate: PASS";
  }
  return lines.join("\n");
}

export function parseAckWarnings(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  const trimmed = raw.trim();
  if (trimmed.toLowerCase() === "all") return ["all"];
  return trimmed
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function confirmBusinessName(
  typed: string,
  businessName: string
): boolean {
  return typed.trim() === businessName.trim();
}

export function refuseDryRunWithoutOverride(
  settingsDryRun: boolean,
  overrideDryRun: boolean,
  dryOnly: boolean
): string | null {
  if (dryOnly) return null;
  if (settingsDryRun && !overrideDryRun) {
    return "dryRun is on — pass --override-dry-run to send for real, or --dry to preview only.";
  }
  return null;
}

#!/usr/bin/env node
/**
 * Merge missing keys from .dev.vars.example into .dev.vars.
 * Never overwrites a key that already has a value.
 *
 *   npm run env:merge
 *   npm run env:merge -- --dry-run
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const examplePath = join(root, ".dev.vars.example");
const localPath = join(root, ".dev.vars");
const dryRun = process.argv.includes("--dry-run");

function parseLines(text) {
  return text.split(/\r?\n/);
}

function parsePair(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const eq = trimmed.indexOf("=");
  if (eq === -1) return null;
  return { key: trimmed.slice(0, eq).trim(), value: trimmed.slice(eq + 1) };
}

function localKeys(text) {
  /** @type {Map<string, string>} */
  const map = new Map();
  for (const line of parseLines(text)) {
    const pair = parsePair(line);
    if (pair) map.set(pair.key, pair.value);
  }
  return map;
}

function examplePairs(text) {
  /** @type {{ key: string, line: string }[]} */
  const pairs = [];
  const seen = new Set();
  for (const line of parseLines(text)) {
    const pair = parsePair(line);
    if (!pair || seen.has(pair.key)) continue;
    seen.add(pair.key);
    pairs.push({ key: pair.key, line: `${pair.key}=${pair.value}` });
  }
  return pairs;
}

if (!existsSync(examplePath)) {
  console.error(`.dev.vars.example not found at ${examplePath}`);
  process.exit(1);
}

const exampleText = readFileSync(examplePath, "utf8");
const localText = existsSync(localPath) ? readFileSync(localPath, "utf8") : "";
const existing = localKeys(localText);
const additions = examplePairs(exampleText).filter(({ key }) => {
  const current = existing.get(key);
  return current === undefined;
});

if (additions.length === 0) {
  console.log("env:merge — .dev.vars already has every key from .dev.vars.example");
  process.exit(0);
}

console.log(dryRun ? "env:merge — dry run, would add:" : "env:merge — adding:");
for (const { key } of additions) console.log(`  + ${key}`);

if (dryRun) process.exit(0);

const body = localText.replace(/\s*$/, "");
const next = `${body}${body ? "\n" : ""}${additions.map((a) => a.line).join("\n")}\n`;
writeFileSync(localPath, next, "utf8");
console.log(`Wrote ${additions.length} key(s) to .dev.vars (existing values kept)`);

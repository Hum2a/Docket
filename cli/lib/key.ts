import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export type KeyResult =
  | { ok: true; key: string; source: ".dev.vars" | "env" }
  | { ok: false; message: string };

/**
 * Resolve API_KEY from .dev.vars then process.env.
 * Never include the key value in `message`.
 */
export function resolveApiKey(opts: {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  readDevVars?: (path: string) => string | null;
}): KeyResult {
  const cwd = opts.cwd ?? process.cwd();
  const env = opts.env ?? process.env;
  const path = join(cwd, ".dev.vars");

  const read =
    opts.readDevVars ??
    ((p: string) => {
      if (!existsSync(p)) return null;
      try {
        return readFileSync(p, "utf8");
      } catch {
        return null;
      }
    });

  const fileContents = read(path);
  if (fileContents != null) {
    const fromFile = parseDevVarsApiKey(fileContents);
    if (fromFile) {
      return { ok: true, key: fromFile, source: ".dev.vars" };
    }
  }

  const fromEnv = env.API_KEY?.trim();
  if (fromEnv) {
    return { ok: true, key: fromEnv, source: "env" };
  }

  return {
    ok: false,
    message:
      "API_KEY not found. Set it in .dev.vars (API_KEY=...) or export API_KEY in the environment. " +
      "The CLI never accepts the key as a command-line argument.",
  };
}

/** Parse KEY=value lines; ignores comments and blank lines. */
export function parseDevVarsApiKey(contents: string): string | null {
  for (const raw of contents.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const name = line.slice(0, eq).trim();
    if (name !== "API_KEY") continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    return value || null;
  }
  return null;
}

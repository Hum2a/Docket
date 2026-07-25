/**
 * Arg parsing with npm_config_* fallbacks (Windows/PowerShell often eats --flags).
 */

export function readFlag(argv: string[], name: string): string | undefined {
  const eq = argv.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const idx = argv.indexOf(`--${name}`);
  if (idx >= 0 && argv[idx + 1] && !argv[idx + 1]!.startsWith("-")) {
    return argv[idx + 1];
  }
  return undefined;
}

function readNpmConfig(name: string): string | undefined {
  const underscored = name.replace(/-/g, "_");
  const candidates = [
    process.env[`npm_config_${underscored}`],
    process.env[`npm_config_${name}`],
  ];
  for (const v of candidates) {
    if (v != null && v !== "" && v !== "true") return v;
  }
  if (process.env[`npm_config_${underscored}`] === "true") return "true";
  return undefined;
}

export function pick(argv: string[], name: string): string | undefined {
  return readFlag(argv, name) ?? readNpmConfig(name);
}

export function hasFlag(argv: string[], name: string): boolean {
  if (argv.includes(`--${name}`)) return true;
  const underscored = name.replace(/-/g, "_");
  return process.env[`npm_config_${underscored}`] === "true";
}

/** Collect all `--set key=value` (and `--set=key=value`) pairs. */
export function collectSets(argv: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--set=")) {
      out.push(a.slice("--set=".length));
      continue;
    }
    if (a === "--set") {
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        out.push(next);
        i++;
      }
    }
  }
  // npm may flatten a single --set into npm_config_set
  const npmSet = process.env.npm_config_set;
  if (npmSet && npmSet !== "true" && !out.includes(npmSet)) {
    out.push(npmSet);
  }
  return out;
}

export function positional(argv: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--") continue;
    if (a.startsWith("--")) {
      if (!a.includes("=") && argv[i + 1] && !argv[i + 1]!.startsWith("-")) {
        i++; // skip flag value
      }
      continue;
    }
    out.push(a);
  }
  return out;
}

export const DEFAULT_BASE = "https://jobtracker.humza-butt.space";

export function resolveBase(argv: string[]): string {
  const raw = pick(argv, "base") ?? DEFAULT_BASE;
  return raw.replace(/\/$/, "");
}

/** Coerce CLI `--set key=value` string values. */

export function coerceSetValue(raw: string): string | number | boolean | null {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw === "null") return null;
  if (raw.trim() !== "" && /^-?\d+(\.\d+)?$/.test(raw.trim())) {
    return Number(raw.trim());
  }
  return raw;
}

export function parseSetPair(arg: string): { key: string; value: string } {
  const eq = arg.indexOf("=");
  if (eq <= 0) {
    throw new Error(`Invalid --set (expected key=value): ${arg}`);
  }
  return { key: arg.slice(0, eq).trim(), value: arg.slice(eq + 1) };
}

export function buildPatchFromSets(
  sets: string[],
  allowedFields: readonly string[]
): Record<string, unknown> {
  const allowed = new Set(allowedFields);
  const patch: Record<string, unknown> = {};
  for (const s of sets) {
    const { key, value } = parseSetPair(s);
    if (!allowed.has(key)) {
      throw new Error(
        `Unknown field "${key}". Valid fields: ${[...allowed].sort().join(", ")}`
      );
    }
    patch[key] = coerceSetValue(value);
  }
  return patch;
}

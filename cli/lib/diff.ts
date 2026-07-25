export type DiffEntry = {
  field: string;
  oldValue: unknown;
  newValue: unknown;
};

const LONG_STRING_FIELDS = new Set(["customBody", "scoreReason", "audit", "postalAddress"]);

function isLongString(field: string, value: unknown): boolean {
  if (typeof value !== "string") return false;
  if (LONG_STRING_FIELDS.has(field)) return true;
  return value.includes("\n") || value.length > 80;
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null && b == null) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/** Only fields present in `patch` that differ from `current`. */
export function computeDiff(
  current: Record<string, unknown>,
  patch: Record<string, unknown>
): DiffEntry[] {
  const entries: DiffEntry[] = [];
  for (const [field, newValue] of Object.entries(patch)) {
    const oldValue = current[field];
    if (valuesEqual(oldValue, newValue)) continue;
    entries.push({ field, oldValue, newValue });
  }
  return entries;
}

function unifiedLineDiff(oldText: string, newText: string): string {
  const a = oldText.split("\n");
  const b = newText.split("\n");
  const dp: number[][] = Array.from({ length: a.length + 1 }, () =>
    Array(b.length + 1).fill(0)
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i]![j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1]![j - 1]! + 1
          : Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
    }
  }
  const ops: Array<{ type: " " | "-" | "+"; line: string }> = [];
  let i = a.length;
  let j = b.length;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      ops.push({ type: " ", line: a[i - 1]! });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i]![j - 1]! >= dp[i - 1]![j]!)) {
      ops.push({ type: "+", line: b[j - 1]! });
      j--;
    } else {
      ops.push({ type: "-", line: a[i - 1]! });
      i--;
    }
  }
  ops.reverse();
  return ops.map((o) => `    ${o.type} ${o.line}`).join("\n");
}

export function formatDiff(entries: DiffEntry[]): string {
  if (entries.length === 0) return "(no changes)";
  const lines: string[] = [];
  for (const e of entries) {
    const oldS =
      e.oldValue === undefined
        ? "(absent)"
        : typeof e.oldValue === "string"
          ? e.oldValue
          : JSON.stringify(e.oldValue);
    const newS =
      e.newValue === undefined
        ? "(absent)"
        : typeof e.newValue === "string"
          ? e.newValue
          : JSON.stringify(e.newValue);

    if (
      isLongString(e.field, e.oldValue) ||
      isLongString(e.field, e.newValue) ||
      (typeof e.oldValue === "string" && typeof e.newValue === "string" && e.oldValue.includes("\n"))
    ) {
      lines.push(`${e.field}:`);
      lines.push(unifiedLineDiff(String(oldS), String(newS)));
    } else {
      lines.push(`${e.field}: ${oldS} → ${newS}`);
    }
  }
  return lines.join("\n");
}

export async function confirmApply(
  yesFlag: boolean,
  ask: () => Promise<string>
): Promise<"apply" | "abort"> {
  if (yesFlag) return "apply";
  const answer = (await ask()).trim().toLowerCase();
  return answer === "y" ? "apply" : "abort";
}

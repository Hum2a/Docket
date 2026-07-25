export type AppMode = "jobs" | "outreach";

const MODE_KEY = "docket_mode";

export function getStoredMode(): AppMode {
  const v = localStorage.getItem(MODE_KEY);
  return v === "outreach" ? "outreach" : "jobs";
}

export function setStoredMode(mode: AppMode) {
  localStorage.setItem(MODE_KEY, mode);
}

export function outreachStatusLabel(status: string): string {
  return status
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

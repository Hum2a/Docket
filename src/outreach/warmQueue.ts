/** Next weekday 09:00 Europe/London as an ISO timestamp. */

const WEEKDAY = new Set([1, 2, 3, 4, 5]); // Mon–Fri (Date.getUTCDay: 0 Sun)

function londonParts(now: Date): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

/** 09:00 Europe/London on the given civil date, as UTC Date. */
export function londonNineUtc(year: number, month: number, day: number): Date {
  const candidate = new Date(Date.UTC(year, month - 1, day, 9, 0, 0));
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      hour: "numeric",
      hourCycle: "h23",
    }).format(candidate)
  );
  if (hour === 10) return new Date(candidate.getTime() - 3600000);
  if (hour === 8) return new Date(candidate.getTime() + 3600000);
  return candidate;
}

function addCivilDays(year: number, month: number, day: number, n: number) {
  const d = new Date(Date.UTC(year, month - 1, day + n));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

export function nextWeekdayNineLondon(now: Date = new Date()): Date {
  const p = londonParts(now);
  let { year, month, day } = p;
  const pastNine = p.hour > 9 || (p.hour === 9 && (p.minute > 0 || p.second > 0));
  let dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  let advance = 0;
  if (!WEEKDAY.has(dow)) {
    advance = dow === 6 ? 2 : 1;
  } else if (pastNine) {
    advance = dow === 5 ? 3 : 1;
  }
  if (advance) {
    ({ year, month, day } = addCivilDays(year, month, day, advance));
    dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    while (!WEEKDAY.has(dow)) {
      ({ year, month, day } = addCivilDays(year, month, day, 1));
      dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    }
  }
  return londonNineUtc(year, month, day);
}

export function warmFollowupAt(from: Date = new Date()): string {
  return new Date(from.getTime() + 5 * 24 * 60 * 60 * 1000).toISOString();
}

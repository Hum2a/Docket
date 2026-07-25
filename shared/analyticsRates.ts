/**
 * Small-sample display rules for outreach rates.
 * Threshold lives in ONE constant — lower it deliberately, not by accident.
 */

/** Denominators below this never show a percentage. */
export const SMALL_SAMPLE_THRESHOLD = 20;

/** Time-to-reply median is hidden until at least this many samples. */
export const TIME_TO_REPLY_MIN_N = 5;

export type RateFraction = { num: number; den: number };

/**
 * Display a rate. Below SMALL_SAMPLE_THRESHOLD: fraction only, no `%`.
 * At/above: percentage with counts.
 */
export function formatRate(
  rate: RateFraction,
  threshold: number = SMALL_SAMPLE_THRESHOLD
): string {
  const { num, den } = rate;
  if (den < threshold) {
    return `${num} of ${den}`;
  }
  const pct = den === 0 ? 0 : Math.round((num / den) * 1000) / 10;
  return `${pct}% (${num} of ${den})`;
}

export function rateIsSmallSample(
  den: number,
  threshold: number = SMALL_SAMPLE_THRESHOLD
): boolean {
  return den < threshold;
}

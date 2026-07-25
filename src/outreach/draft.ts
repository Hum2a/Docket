/** Validation for hand-written outreach drafts stored on leads. */

export const CUSTOM_BODY_MAX_CHARS = 4000;

export type CustomBodyValidation =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Reject bodies that would duplicate the system footer, leak placeholders,
 * or exceed the size cap. Empty/whitespace is allowed (clears the draft).
 */
export function validateCustomBody(body: string): CustomBodyValidation {
  if (body.length > CUSTOM_BODY_MAX_CHARS) {
    return {
      ok: false,
      error: `custom_body exceeds ${CUSTOM_BODY_MAX_CHARS} characters`,
    };
  }
  if (body.includes("{{")) {
    return {
      ok: false,
      error: "custom_body contains an unrendered placeholder ({{)",
    };
  }
  // System footer uses a `--` separator line (see appendFooter).
  if (/(^|\n)--(\n|$)/.test(body)) {
    return {
      ok: false,
      error: "custom_body already contains a footer separator (--)",
    };
  }
  if (/unsubscribe/i.test(body) || /\/api\/unsubscribe/i.test(body)) {
    return {
      ok: false,
      error: "custom_body already contains an unsubscribe link",
    };
  }
  return { ok: true };
}

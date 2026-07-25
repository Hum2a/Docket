export type SendResult = { sent: boolean; reason?: string; id?: string };

/** Verified domain sender for Docket. */
export const DEFAULT_FROM = "Docket <Docket@Humza-Butt.space>";
export const DEFAULT_REPLY_TO = "Docket@Humza-Butt.space";

export function escapeHtml(str: string): string {
  return str
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Split comma / newline / semicolon separated emails; trim empties. */
export function parseEmailList(raw: string | null | undefined): string[] {
  if (!raw?.trim()) return [];
  return [
    ...new Set(
      raw
        .split(/[,;\n]+/)
        .map((e) => e.trim())
        .filter(Boolean)
    ),
  ];
}

export async function sendResendEmail(opts: {
  apiKey?: string;
  to?: string | string[];
  from?: string;
  replyTo?: string;
  subject: string;
  /** Optional — omit for text-only outreach (better inbox placement). */
  html?: string;
  text?: string;
  headers?: Record<string, string>;
  /**
   * Outreach only: ask Resend not to inject open/click tracking.
   * Job digests leave this unset (domain defaults apply).
   */
  disableTracking?: boolean;
}): Promise<SendResult> {
  if (!opts.apiKey) {
    return { sent: false, reason: "RESEND_API_KEY not configured" };
  }

  const recipients = Array.isArray(opts.to)
    ? opts.to.map((e) => e.trim()).filter(Boolean)
    : parseEmailList(opts.to);

  if (recipients.length === 0) {
    return { sent: false, reason: "No notify recipients configured (set in Settings)" };
  }

  const html = opts.html?.trim();
  const text = opts.text?.trim();
  if (!html && !text) {
    return { sent: false, reason: "Email body required (html or text)" };
  }

  const payload: Record<string, unknown> = {
    from: opts.from || DEFAULT_FROM,
    to: recipients,
    subject: opts.subject,
    reply_to: opts.replyTo || DEFAULT_REPLY_TO,
  };

  if (html) payload.html = html;
  if (text) payload.text = text;
  if (opts.headers && Object.keys(opts.headers).length > 0) {
    payload.headers = opts.headers;
  }
  // Per-email tracking flags (Resend: off by default on domain; set explicitly for outreach).
  if (opts.disableTracking) {
    payload.open_tracking = false;
    payload.click_tracking = false;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errText = await res.text();
    // Older Resend schemas may reject unknown tracking keys — retry once without them.
    if (
      opts.disableTracking &&
      /open_tracking|click_tracking|unknown|unexpected/i.test(errText)
    ) {
      delete payload.open_tracking;
      delete payload.click_tracking;
      const retry = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${opts.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      if (!retry.ok) {
        return { sent: false, reason: `Resend error: ${await retry.text()}` };
      }
      const retryData = (await retry.json().catch(() => null)) as { id?: string } | null;
      return { sent: true, id: retryData?.id };
    }
    return { sent: false, reason: `Resend error: ${errText}` };
  }

  const data = (await res.json().catch(() => null)) as { id?: string } | null;
  return { sent: true, id: data?.id };
}

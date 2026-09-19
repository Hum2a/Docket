import PostalMime from "postal-mime";

const BODY_CAP = 20 * 1024;
const INBOUND_URL = "https://jobtracker.humza-butt.space/api/webhooks/inbound";

export type MailRouterEnv = {
  FORWARD_TO: string;
  RESEND_INBOUND_SECRET: string;
};

export type Forwardable = {
  from: string;
  raw: ReadableStream<Uint8Array> | ArrayBuffer;
  forward: (to: string) => Promise<void>;
};

export type HandleDeps = {
  fetch: typeof fetch;
  parse?: (raw: ArrayBuffer) => Promise<{
    from?: { address?: string };
    subject?: string;
    text?: string;
    html?: string;
  }>;
};

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export async function handleInboundEmail(
  message: Forwardable,
  env: MailRouterEnv,
  deps: HandleDeps = { fetch: globalThis.fetch }
): Promise<void> {
  await message.forward(env.FORWARD_TO);

  try {
    const raw =
      message.raw instanceof ArrayBuffer
        ? message.raw
        : await new Response(message.raw).arrayBuffer();
    const parsed = deps.parse
      ? await deps.parse(raw)
      : await PostalMime.parse(raw);
    const text = (parsed.text || (parsed.html ? stripHtml(parsed.html) : "") || "").slice(
      0,
      BODY_CAP
    );
    const from = parsed.from?.address || message.from;
    const res = await deps.fetch(INBOUND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_INBOUND_SECRET}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        subject: parsed.subject || "",
        text,
      }),
    });
    if (!res.ok) {
      console.error(
        JSON.stringify({
          msg: "inbound_webhook_failed",
          status: res.status,
        })
      );
    }
  } catch (err) {
    console.error(
      JSON.stringify({
        msg: "inbound_webhook_error",
        error: err instanceof Error ? err.message : String(err),
      })
    );
  }
}

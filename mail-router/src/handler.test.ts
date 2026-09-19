import { describe, expect, it, vi } from "vitest";
import { handleInboundEmail } from "./handler";

describe("mail-router handleInboundEmail", () => {
  it("forwards even when the webhook returns 500", async () => {
    const forward = vi.fn(async () => undefined);
    const fetchFn = vi.fn(async () => new Response("nope", { status: 500 }));
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(
      handleInboundEmail(
        {
          from: "leslie@silverbiketraining.com",
          raw: new TextEncoder().encode("Subject: hi\n\nhello").buffer,
          forward,
        },
        { FORWARD_TO: "Humzab1711@hotmail.com", RESEND_INBOUND_SECRET: "secret" },
        {
          fetch: fetchFn as unknown as typeof fetch,
          parse: async () => ({
            from: { address: "leslie@silverbiketraining.com" },
            subject: "hi",
            text: "hello",
          }),
        }
      )
    ).resolves.toBeUndefined();

    expect(forward).toHaveBeenCalledWith("Humzab1711@hotmail.com");
    expect(fetchFn).toHaveBeenCalled();
    error.mockRestore();
  });
});

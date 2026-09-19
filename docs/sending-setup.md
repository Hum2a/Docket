# Sending setup (warm + cold)

Do not automate DNS from scripts. Confirm each record in the host (Cloudflare / Resend) yourself.

## Warm lane — humza-butt.space

Personal From: `Humza Butt <humza@humza-butt.space>`  
Reply-To: `humza@humza-butt.space`

1. In Resend, confirm **humza-butt.space** is verified.
2. Record the exact SPF include and DKIM CNAMEs Resend shows (copy them here when you set them).
3. DMARC (start permissive):

   `_dmarc.humza-butt.space` TXT  
   `v=DMARC1; p=none; rua=mailto:humza@humza-butt.space`

   After two clean weeks, move to `p=quarantine`.
4. Secrets (docket Worker):

   ```
   wrangler secret put OUTREACH_PERSONAL_FROM
   wrangler secret put OUTREACH_PERSONAL_REPLY_TO
   ```

5. Send yourself one warm email via `npx tsx cli/lead.ts send <id> --warm --dry`, then a real send to a test lead. Read both on a phone.

## Cold lane

`OUTREACH_FROM` must be a **separate domain**, not `humza-butt.space` and not a subdomain of it (`isPrimarySendingDomain` blocks those). Warm that domain for ~2 weeks at 5–10/day before turning auto-send on.

## Replies → Hotmail + Docket

1. Check existing MX first: `dig MX humza-butt.space` (or `Resolve-DnsName humza-butt.space -Type MX`).
2. If something already receives mail there, **stop** — do not overwrite MX.
3. If MX is free (or already Cloudflare Email Routing), add a verified destination for `Humzab1711@hotmail.com`.
4. Deploy `mail-router/` from the jobtracker directory and route `humza@humza-butt.space` → that Worker:

   ```
   npx wrangler deploy --config mail-router/wrangler.toml
   ```
5. Secrets (from `jobtracker/mail-router`):

   ```
   wrangler secret put FORWARD_TO
   wrangler secret put RESEND_INBOUND_SECRET
   ```

   `FORWARD_TO` must be the verified Hotmail address. `RESEND_INBOUND_SECRET` must match Docket.

Forwarding runs first. Docket logging is best-effort and must never block the forward.

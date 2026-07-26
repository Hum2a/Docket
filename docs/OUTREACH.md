# Outreach

B2B lead pipeline for rebuild demos and plain-text cold email. Job-search mode is separate; switch modes in the header (**Job Search | Outreach**).

## UI

| Page | Route | Role |
| --- | --- | --- |
| Board | `/outreach` | Drag-and-drop pipeline |
| List | `/outreach/list` | Filters (incl. **Demo live**), CSV export |
| Queue | `/outreach/queue` | Review, approve, send |
| Sent | `/outreach/sent` | Sent history |
| Detail | `/outreach/leads/:id` | Audit, scores, thread, drafts |
| Stats | `/outreach/stats` | Analytics |
| Settings | `/outreach/settings` | Pause, dry run, autosend, caps |

Status chip in the header: **Live / Dry run / Paused**.

## Data model

Additive schema from `migrations/003` onward: `leads`, `lead_notes`, `lead_reminders`, `lead_messages`, `suppressions`, `outreach_settings`.

Default settings seed:

- `auto_send_enabled = false`
- `dry_run = true`
- Autosend threshold `8.0`
- Daily cap `20`
- Follow-up offsets `{3, 7}` — **absolute days since the initial send** (day 3 follow-up, day 7 final)

After the final email the lead is marked `lost` and is not contacted again.

Bulk upsert (`POST /api/leads/bulk`) never overwrites send/reply/closed-status history fields.

## Demos

Autosend and manual send require `demoStatus === "ready"` and a non-empty `demoUrl`.

Demos are published by the sibling **demo-host** project to:

```text
https://demo.humza-butt.space/{slug}/
```

Filter **Demo live** on the List page for an auth’d index of open demos. Do not put a public gallery on the demo host.

## Send gates

Implemented in `src/outreach/canAutoSend.ts` (+ quality helpers). High level:

| Gate | Auto | Manual / Approve |
| --- | --- | --- |
| PECR corporate subscriber | Required | Required* |
| Verified non-freemail email | Required | Required* |
| Demo ready + URL | Required | Required |
| Postal address (footer) | Required | Required |
| Priority threshold | Required | Skipped (manual) |
| Dry run / pause / daily cap | Defers | Skipped (manual/force) |
| `business_name_implausible` | Blocks | **Overridable** (human reviewed preview) |
| Other quality hard blocks | Blocks | Blocks |

\*Approve attests corporate + email-verified before send. Freemail remains blocked.

Copy is plain text only (no HTML). Observation lines come from audit signals, not an LLM. The system appends postal address and unsubscribe link.

## Before the first real send

1. Sending domain live with SPF, DKIM, and DMARC; warm ~2 weeks
2. Keep daily cap at 10–20 until reply data exists
3. Turn **open tracking off** in Resend for the outreach domain
4. Set a real UK postal address (`OUTREACH_POSTAL_ADDRESS` or settings)
5. Send yourself the full initial → +3 → +7 sequence; read it on a phone
6. Confirm the demo renders on mobile
7. Disable dry run only when preflight is green

```bash
npm run lead -- preflight
npm run settings -- --show
```

## Crons

Configured in `wrangler.toml`:

| Cron | Job |
| --- | --- |
| `0 8 * * *` | Job reminder digest |
| `0 9 * * 1-5` | Outreach autosend |
| `0 10 * * 1-5` | Outreach follow-up sequence |

Manual triggers (API key): `POST /api/outreach/autosend`, `POST /api/outreach/sequence`.

## Compliance & ops

- Suppressions table + signed unsubscribe (`/api/unsubscribe`)
- Resend delivery webhook + inbound reply webhook
- Primary portfolio domain guard on From address (see migration `005`)
- Inbound secret and unsubscribe signing key via `npm run secrets:sync`

## Related docs

- [API](API.md) — endpoints and auth
- [CLI](CLI.md) — `lead` / `settings`
- [Setup](SETUP.md) — secrets and deploy

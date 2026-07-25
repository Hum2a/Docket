# Docket

Personal single-owner job application tracker **and** parallel Outreach (client leads) pipeline — Board, List, Detail, Stats, Settings — served as a React SPA from a Cloudflare Worker (Hono) with Neon Postgres, R2 document storage, and optional Resend emails (job digests + outreach sends).

## Stack

- **Frontend:** React + Vite + React Router + Recharts + `@dnd-kit`
- **API:** Cloudflare Worker (Hono)
- **DB:** Neon Postgres (`migrations/001_docket_schema.sql`, `002_app_settings.sql`, `003_outreach_schema.sql`)
- **Files:** R2 bucket `docket-documents` (binding `DOCS`)
- **Auth:** No login. Writes require `X-Api-Key`. Reads are open.
- **Tests:** Vitest (`npm test`) for outreach gate helpers

## First-time setup

1. **Install**
   ```bash
   npm install
   ```

2. **Local secrets** — create `.dev.vars` (gitignored):
   ```
   DATABASE_URL=...
   API_KEY=dev-local-key-change-me
   RESEND_API_KEY=
   DIGEST_TO=
   DIGEST_FROM=
   OUTREACH_FROM=
   OUTREACH_REPLY_TO=
   OUTREACH_POSTAL_ADDRESS=
   RESEND_INBOUND_SECRET=
   UNSUBSCRIBE_SIGNING_KEY=
   ```

3. **Migrate Neon** (reads `DATABASE_URL` from `.dev.vars`):
   ```bash
   npm run db:ping      # connectivity check
   npm run db:status    # pending vs applied
   npm run db:migrate   # apply migrations/*.sql
   ```
   This renames the legacy `applications` table, creates Docket tables, and maps existing rows. Already applied manually? Mark it so migrate skips it:
   ```sql
   CREATE TABLE IF NOT EXISTS schema_migrations (
     id TEXT PRIMARY KEY,
     applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
   );
   INSERT INTO schema_migrations (id) VALUES ('001_docket_schema.sql')
   ON CONFLICT DO NOTHING;
   ```

4. **Cloudflare login**
   ```bash
   npx wrangler login
   ```

5. **R2 bucket** — uses existing `docket-documents` (create with `npm run r2:create` if missing).

6. **Production secrets**
   ```bash
   npm run secrets:sync        # generate missing keys → .dev.vars + wrangler secret put
   npm run secrets:local       # same, but only write .dev.vars (no Cloudflare)
   ```
   `secrets:sync` auto-generates `RESEND_INBOUND_SECRET` + `UNSUBSCRIBE_SIGNING_KEY`, fills outreach/digest From defaults when missing, then pushes every known secret from `.dev.vars` to Cloudflare. Flags: `--force` (regen crypto keys), `--dry-run`.

   Individual `npm run secrets:*` prompts still work for one-off overrides.
   After Resend is set, use **Settings → Send test email** to verify job digests. Outreach uses `OUTREACH_FROM` (not the digest From).

7. **Build & deploy**
   ```bash
   npm run deploy
   ```
   Live at `https://jobtracker.humza-butt.space` (custom domain in `wrangler.toml`).

## Local development

```bash
npm run dev
```

Runs Vite on `http://localhost:5173` (proxies `/api` → Worker) and `wrangler dev` on `http://localhost:8787`.

Or build the SPA and serve everything from the Worker:

```bash
npm run build:web
npx wrangler dev
```

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Vite + Wrangler together |
| `npm run build:web` | Build React app → `dist/` |
| `npm run deploy` | Build + `wrangler deploy` |
| `npm run typecheck` | Worker + web TypeScript |
| `npm test` | Vitest (`canAutoSend` + bulk helpers) |
| `npm run db:migrate` | Apply pending `migrations/*.sql` |
| `npm run db:status` | Show applied vs pending migrations |
| `npm run db:ping` | Test DB connectivity |
| `npm run r2:create` | Create R2 buckets for docs |

## Modes (UI)

Header switch **Job Search | Outreach** (`localStorage` + `/outreach/*` routes). Job-search routes stay at `/`, `/list`, `/apps/:id`, `/stats`, `/settings`.

Outreach pages: Board, List (+ CSV export), Queue (approve/send), Detail (audit/scores/thread), Stats, Settings (pause / dry_run / auto_send). Status chip shows **Live / Dry run / Paused**.

## Outreach

Additive schema in `migrations/003_outreach_schema.sql` (`leads`, `lead_notes`, `lead_reminders`, `lead_messages`, `suppressions`, `outreach_settings`). Seed defaults: `auto_send_enabled=false`, `dry_run=true`, threshold `8.0`, daily cap `20`, follow-up offsets `{3,7}`.

Autosend is gated by `canAutoSend` (PECR corporate-subscriber rule, verified non-freemail, demo ready, daily cap, etc.). Dry run queues `lead_messages` without calling Resend. Outreach From is `OUTREACH_FROM` / settings — never the job digest sender.

Follow-up offsets `{3,7}` are **absolute days since the initial send** (day 3 = follow-up, day 7 = final). After the final email the lead is marked `lost` and never contacted again. Copy is plain text only (no HTML); observation lines come from `audit` signals, not an LLM. A real `postal_address` (settings or `OUTREACH_POSTAL_ADDRESS`) is required before any send.

### Before the first real send

- Sending domain live with SPF, DKIM and DMARC; warm ~2 weeks
- Cap at 10–20 sends/day until reply data exists (`daily_send_cap`)
- Turn **open tracking off** in the Resend dashboard for the outreach domain (pixels hurt deliverability; reply rate is the metric)
- Populate postal address, then send yourself the full initial → +3 → +7 sequence and read it on a phone
- Confirm the demo renders on mobile — the email tells them to open it there

### Crons (`wrangler.toml`)

| Cron | Job |
|---|---|
| `0 8 * * *` | Job reminder digest |
| `0 9 * * 1-5` | Outreach autosend |
| `0 10 * * 1-5` | Outreach follow-up sequence |

## API overview

| Method | Path | Auth |
|---|---|---|
| GET | `/api/health` | — |
| GET/POST | `/api/applications` | write: key |
| GET/PATCH/DELETE | `/api/applications/:id` | write: key |
| GET/POST | `/api/applications/:id/notes` | write: key |
| DELETE | `/api/notes/:id` | key |
| GET/POST | `/api/applications/:id/reminders` | write: key |
| PATCH/DELETE | `/api/reminders/:id` | key |
| GET/POST | `/api/documents` | write: key |
| GET | `/api/documents/:id/url` | key (signed download) |
| DELETE | `/api/documents/:id` | key |
| GET | `/api/stats` | — |
| POST | `/api/import` | key |
| GET/PATCH | `/api/settings` | write: key |
| POST | `/api/digest/run` | key |
| POST | `/api/email/test` | key |
| GET | `/api/leads` | —; paginated `{ leads, nextCursor, total }`; query: `limit` (1–200, default 50), `cursor`, `status`, `industry`, `min_priority` / `minPriority`, `corporate_only` / `corporate` |
| POST | `/api/leads` | key |
| POST | `/api/leads/bulk` | key |
| GET | `/api/leads/stats` | — |
| GET/PATCH/DELETE | `/api/leads/:id` | write: key |
| GET/POST | `/api/leads/:id/notes` | write: key |
| DELETE | `/api/lead-notes/:id` | key |
| GET/POST | `/api/leads/:id/reminders` | write: key |
| PATCH/DELETE | `/api/lead-reminders/:id` | key |
| GET | `/api/leads/:id/messages` | — |
| POST | `/api/leads/:id/send` | key |
| POST | `/api/leads/:id/approve` | key |
| GET/PATCH | `/api/outreach/settings` | write: key |
| GET | `/api/outreach/export.csv` | — |
| POST | `/api/outreach/autosend` | key |
| POST | `/api/outreach/sequence` | key |
| POST | `/api/suppressions` | key |
| GET/POST | `/api/unsubscribe` | signed |
| POST | `/api/webhooks/resend` | — |
| POST | `/api/webhooks/inbound` | inbound secret |

When `RESEND_API_KEY` is set and at least one recipient exists (Settings → Notify emails, or `DIGEST_TO` fallback), creating an application or changing its status sends a detailed email (bulk import does not). From address defaults to `Docket <Docket@Humza-Butt.space>`. Daily cron (`0 8 * * *`) still runs the reminder digest.

## Import JSON shape

```json
{
  "applications": [{
    "company": "",
    "roleTitle": "",
    "industry": "",
    "status": "wishlist",
    "location": "",
    "jobUrl": "",
    "appliedDate": "YYYY-MM-DD",
    "salaryRange": "",
    "source": "",
    "notes": ["..."],
    "reminders": [{ "dueDate": "YYYY-MM-DD", "message": "" }]
  }]
}
```

## Product notes

- Single owner, no multi-user / login / billing
- Notes are create/delete only (no edit)
- Reminder fields are not editable after create (toggle complete / delete)
- App deletes confirm; notes / reminders / docs do not
- Due soon = incomplete reminder due within 3 days
- Outreach bulk upsert never overwrites send/reply/status history fields

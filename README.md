# Docket

Personal job application tracker and B2B outreach CRM, served as a React SPA from a Cloudflare Worker with Neon Postgres and R2.

**Live:** [jobtracker.humza-butt.space](https://jobtracker.humza-butt.space)

| Mode | What it does |
| --- | --- |
| **Job Search** | Kanban board, applications, notes, reminders, document store, digest emails |
| **Outreach** | Lead pipeline, demo-gated sends, PECR-safe autosend, follow-ups, reply ingest |

---

## Stack

- **UI** — React 19, Vite, React Router, Recharts, `@dnd-kit`
- **API** — Cloudflare Worker (Hono) + SPA assets
- **DB** — Neon Postgres (`migrations/001`–`007`)
- **Files** — R2 bucket `docket-documents` (`DOCS`)
- **Email** — Resend (job digests + outreach)
- **Auth** — No login. Writes (and all outreach reads) require `X-Api-Key`. Job-search GETs are open.

---

## Quick start

```bash
npm install
cp .dev.vars.example .dev.vars   # fill DATABASE_URL + API_KEY
npm run db:migrate
npx wrangler login
npm run secrets:local            # optional: generate outreach/signing keys
npm run dev                      # Vite :5173 + Worker :8787
```

Production:

```bash
npm run secrets:sync             # push secrets to Cloudflare
npm run deploy                   # build SPA + wrangler deploy
```

Full setup, secrets, and migration notes: **[docs/SETUP.md](docs/SETUP.md)**

---

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Vite + Wrangler (local) |
| `npm run build` / `build:web` | Build SPA → `dist/` |
| `npm run deploy` | Build + deploy Worker |
| `npm run typecheck` | Typecheck Worker, web, and CLI |
| `npm test` | Vitest |
| `npm run db:migrate` / `db:status` / `db:ping` | Neon migrations |
| `npm run lead` / `settings` | Local outreach CLIs |
| `npm run secrets:sync` / `:local` / `:dry-run` | Generate & sync secrets |
| `npm run r2:create` | Create R2 bucket `docket-documents` |

---

## Documentation

| Doc | Contents |
| --- | --- |
| [Setup](docs/SETUP.md) | `.dev.vars`, migrations, R2, deploy, secrets |
| [Outreach](docs/OUTREACH.md) | Pipeline, send gates, crons, demos, compliance |
| [API](docs/API.md) | HTTP endpoints and auth |
| [CLI](docs/CLI.md) | `lead` and `settings` commands |

---

## Project layout

```
cli/          Lead + settings CLIs
docs/         Documentation
migrations/   SQL migrations (001–007)
scripts/      db, secrets helpers
shared/       Schemas and gates shared by Worker + web
src/          Cloudflare Worker (Hono)
web/          React SPA
```

Outreach demos are published by the sibling **demo-host** Worker (`demo.humza-butt.space/{slug}/`), not this repo.

---

## Product notes

- Single-owner; no multi-user auth or billing
- Notes are create/delete only; reminders are create / complete / delete
- Outreach bulk upsert never overwrites send, reply, or closed-status history
- Autosend stays off until you disable dry run and pass preflight

---

## License

Private / personal use. Not published as an open-source package.

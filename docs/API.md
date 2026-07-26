# API

Base URL (production): `https://jobtracker.humza-butt.space`

Auth header for protected routes:

```http
X-Api-Key: <API_KEY>
```

| Legend | Meaning |
| --- | --- |
| — | Public |
| key | Requires `X-Api-Key` |
| write: key | GET public; mutating methods require key |
| signed | Unsubscribe token / inbound secret |

---

## Health & job search

| Method | Path | Auth |
| --- | --- | --- |
| GET | `/api/health` | — |
| GET / POST | `/api/applications` | write: key |
| GET / PATCH / DELETE | `/api/applications/:id` | write: key |
| GET / POST | `/api/applications/:id/notes` | write: key |
| DELETE | `/api/notes/:id` | key |
| GET / POST | `/api/applications/:id/reminders` | write: key |
| PATCH / DELETE | `/api/reminders/:id` | key |
| GET / POST | `/api/documents` | write: key |
| GET | `/api/documents/:id/url` | key (signed download URL) |
| GET | `/api/documents/download` | — (tokenised) |
| DELETE | `/api/documents/:id` | key |
| GET | `/api/stats` | — |
| POST | `/api/import` | key |
| GET / PATCH | `/api/settings` | write: key |
| POST | `/api/digest/run` | key |
| POST | `/api/email/test` | key |

When `RESEND_API_KEY` is set and recipients exist (Settings → Notify emails, or `DIGEST_TO`), creating an application or changing its status sends a notification email. Bulk import does not. Daily cron still runs the reminder digest.

### Import JSON

```json
{
  "applications": [
    {
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
    }
  ]
}
```

---

## Outreach

Outreach **reads that expose lead PII require an API key** (unlike job-search GETs).

### Leads

| Method | Path | Auth |
| --- | --- | --- |
| GET | `/api/leads` | key — paginated `{ leads, nextCursor, total }`; query: `limit` (1–200, default 50), `cursor`, `status`, `industry`, `min_priority` / `minPriority`, `corporate_only` / `corporate` |
| POST | `/api/leads` | key |
| POST | `/api/leads/bulk` | key |
| GET | `/api/leads/stats` | key |
| GET / PATCH / DELETE | `/api/leads/:id` | key |
| GET | `/api/leads/:id/outreach-preview` | key |
| GET | `/api/leads/:id/send-readiness` | key |
| POST | `/api/leads/:id/send` | key — body: `{ manual?, overrideDryRun? }` |
| POST | `/api/leads/:id/approve` | key — attests PECR/email flags, then force+manual send |
| GET / POST | `/api/leads/:id/notes` | key |
| DELETE | `/api/lead-notes/:id` | key |
| GET / POST | `/api/leads/:id/reminders` | key |
| PATCH / DELETE | `/api/lead-reminders/:id` | key |
| GET | `/api/leads/:id/messages` | key |

### Settings, analytics, export

| Method | Path | Auth |
| --- | --- | --- |
| GET / PATCH | `/api/outreach/settings` | key |
| GET | `/api/outreach/preflight` | — |
| GET | `/api/outreach/analytics` | key |
| GET | `/api/outreach/export.csv` | key |
| GET | `/api/outreach/messages` | key |
| GET | `/api/outreach/messages.csv` | key |
| GET | `/api/outreach/messages/:id` | key |
| POST | `/api/outreach/autosend` | key |
| POST | `/api/outreach/sequence` | key |
| POST | `/api/suppressions` | key |

### Public / webhooks

| Method | Path | Auth |
| --- | --- | --- |
| GET / POST | `/api/unsubscribe` | signed token |
| POST | `/api/webhooks/resend` | — (Resend) |
| POST | `/api/webhooks/inbound` | inbound secret |

---

## Auth matrix (outreach)

Public on purpose:

- `GET /api/outreach/preflight`
- `GET|POST /api/unsubscribe`

Everything else under `/api/leads*` and `/api/outreach*` (except preflight) expects `X-Api-Key`. See `src/outreach/routeAuth.ts`.

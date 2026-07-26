# CLI

Local TypeScript CLIs for outreach ops. Both read `API_KEY` from `.dev.vars` or the environment — **never pass the key on the command line**.

Default base URL: `https://jobtracker.humza-butt.space`  
Local Worker: `--base=http://localhost:8787`

---

## `lead`

```bash
npm run lead -- <command> [options]
```

| Command | Description |
| --- | --- |
| `list [--status=…] [--min-priority=N] [--json]` | List leads |
| `get <id>` | Fetch one lead |
| `patch <id> --file=./patch.json` | Apply JSON patch |
| `patch <id> --set field=value` | Patch one or more fields |
| `draft <id> --subject="…" --body-file=./draft.txt` | Set custom initial copy |
| `preflight` | Check sending identity / postal / keys |
| `send <id> [--dry] [--yes] [--override-dry-run]` | Preview + typed confirm, then send |

Global options:

| Flag | Meaning |
| --- | --- |
| `--base=URL` | API origin |
| `--yes` | Skip confirmation prompts |
| `--dry` | Preview send only (never calls Resend) |
| `--override-dry-run` | Allow a live send while settings `dryRun` is true |
| `--help` | Usage |

**Send is single-lead only** — no `--all`, no batch. Autosend and sequence are API/cron only, not exposed here.

Examples:

```bash
npm run lead -- list --status=queued --json
npm run lead -- get 95
npm run lead -- patch 95 --set businessName="Blount Aerials"
npm run lead -- preflight --base=http://localhost:8787
npm run lead -- send 95 --dry
```

---

## `settings`

```bash
npm run settings -- [options]
```

| Invocation | Description |
| --- | --- |
| `npm run settings` / `--show` | Print current outreach settings |
| `--set key=value` | Patch settings (repeatable) |

Options: `--base=URL`, `--yes`, `--help`.

No send capability — does not call autosend, sequence, or lead send/approve.

Examples:

```bash
npm run settings -- --show
npm run settings -- --set dryRun=true --set dailySendCap=10
```

Patchable fields are listed in `cli/lib/registry.ts` (`SETTINGS_FIELDS`).

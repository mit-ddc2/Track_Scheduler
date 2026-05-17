# Calabogie Safety

Single-user staffing dashboard for the Calabogie Motorsport Park crash &
rescue crew. Manages a roster, builds event schedules, sends SMS/email
invitations, tracks RSVPs in real time, fills last-minute shortages from
ranked replacement candidates, and exports payroll-ready attendance CSVs.

The app is intentionally a **single-operator** tool — the safety manager is
the only authenticated user. Responders never see the dashboard; they
interact only through public RSVP links.

## Stack

- **Next.js 16** (App Router, Server Components, `proxy.ts` middleware)
- **Supabase** (Auth, Postgres, Realtime, RLS)
- **Tailwind CSS v4** (with the project's Pit Wall design tokens)
- **Twilio** for SMS, **Resend** for email
- **Vercel** for hosting and cron jobs
- **Playwright** + **Vitest** for tests

## Quick start

```bash
pnpm install
cp .env.example .env.local         # fill in Supabase + provider keys
pnpm dev
```

Then open <http://localhost:3000>. Sign in via the magic-link form at
`/login` using an email address that is set as `is_owner = true` in the
`profiles` table.

### Required environment variables

See [`.env.example`](./.env.example) for the full list. The bare minimum for
local development:

| Var                                    | Purpose                                  |
| -------------------------------------- | ---------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`             | Supabase project URL                     |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Client-side publishable key              |
| `SUPABASE_SECRET_KEY`                  | Server-side service-role key             |
| `APP_BASE_URL`                         | Public origin (for RSVP links)           |
| `APP_SECRET_PEPPER`                    | HMAC pepper for RSVP token hashes        |
| `CRON_SECRET`                          | Authenticates `/api/jobs/*` cron calls   |

Twilio + Resend env vars are optional in dev — the messaging code stubs
the providers when credentials are missing.

## Tests

```bash
pnpm typecheck          # tsc --noEmit
pnpm lint               # ESLint (Next.js + Tailwind)
pnpm test --run         # Vitest unit + integration tests
pnpm build              # Next.js production build
pnpm test:e2e           # Playwright happy-path (requires Supabase secrets)
```

The Playwright spec is skipped automatically when `SUPABASE_SECRET_KEY` is
missing, so the GitHub Actions check (which has no secrets) still passes.
To run the spec locally, populate `.env.local` first and start `pnpm dev`
in a separate terminal.

## Cron jobs (Hobby-plan note)

`vercel.json` defines a per-minute cron at `/api/jobs/drain-outbox`
(`* * * * *`). Per-minute schedules require a **Pro** plan or higher — on
the **Hobby** plan, Vercel rejects sub-hourly cron schedules. Until the
project is upgraded, drop the schedule frequency (e.g. `*/10 * * * *` for
every 10 minutes, or `0 * * * *` for hourly) or trigger the drain from an
external scheduler hitting the same endpoint with the configured auth
header.

## What's in v1.0

Phases 0 through 8 are merged: scaffold, auth, roster, events,
notifications, messaging, RSVP, replacements, attendance, payroll CSV,
hardening + ops runbook.

**Calendar sync ships in v1.1.** The Google Calendar / ICS feed import
flow is scaffolded but not wired into the dashboard for v1.0. Until then,
events are created manually through `/dashboard/events/new`.

## Operations

See [`OPERATIONS.md`](./OPERATIONS.md) for:

- Pre-flight checklist before the first live use
- The 9-step live E2E test the safety manager runs at launch
- Vercel deploy / rollback procedures
- What happens when Twilio or Supabase is down
- Where to check for failed messages, opt-outs, sync errors
- The CSV-based manual fallback flow

## Spec

The full engineering spec is at
[`racetrack-rescue-staffing-engineering-spec-v0.2.md`](./racetrack-rescue-staffing-engineering-spec-v0.2.md)
(checked in for offline reference; it pins the contracts every phase has
been built against).

## Deploy on Vercel

The dashboard is designed to deploy on Vercel and is hooked up via the
GitHub App. **Deployments are gated on the safety manager** — the user
controls deploy timing. Do not promote a preview to production without
running through the OPERATIONS.md pre-flight checklist first.

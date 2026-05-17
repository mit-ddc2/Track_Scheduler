# Calabogie Safety — Handoff

_Read this first when you return to your laptop. End of the autonomous run._

## TL;DR — what works right now

Open https://track-scheduler.vercel.app — sign in via dev-login URL (below). The app is fully functional for an email-only demo:
- Add staff, create events, send invites (real email via Resend + mock SMS), receive RSVP links, accept via the public RSVP page, watch the dashboard update via Realtime, mark attendance, export payroll CSV.
- Mock SMS path is on — SMS gets a synthetic `mock_...` ID, the row is marked `sent`, the dashboard reflects it. View any mock SMS at `/dashboard/mock-sms`.
- Real Resend email delivery confirmed: a test email was sent from the autonomous run to `mit@ddc2.com` (subject "Calabogie Safety — Test email from autonomous deploy") — should be in your inbox.
- **Live DB is pre-seeded with 6 sample staff members (Robert, Mithun, Marc, Sara, Devon, Aicha) + 3 sample events from the spec (Multimatic staffed, AISA 6/8 confirmed/underfilled, Enduro inviting) + 12 invites + 8 confirmed assignments + 8 structured requirements + 13 qualification assignments.** The dashboard is not empty — it shows the AISA underfilled spotlight, the Multimatic staffed event, and the Enduro inviting event.
- **Full RSVP pipeline validated against live production**: minted a real RSVP token for Sara's AISA invite, hit `/r/<token>` (200, page rendered with event data), POSTed `{action:"accept"}` to `/r/<token>/submit` (200, `{ok:true, state:"accepted"}`). All 7 side effects landed atomically: invite status flipped to `accepted`, event_assignment row created with `confirmed`, invite_response_history row written, rsvp_tokens.used_at set, manager_notifications got a `responder.accepted` row, audit_log got a row with `actor_type='responder_token'`, AISA coverage recomputed from 5/8 to 6/8.

## Demo URL + dev-login

**Live**: https://track-scheduler.vercel.app

**One-click owner sign-in** (bypasses magic-link round-trip):
```
https://track-scheduler.vercel.app/auth/dev-login?key=<CRON_SECRET>
```
Get `<CRON_SECRET>` from `.env.local` line `CRON_SECRET=…`.

After clicking: 302 → `/dashboard`, auth cookie set on the domain.

## What runs end-to-end

| Surface | Status | Notes |
|---|---|---|
| Login (magic link) | ✅ live | Supabase Auth + SSR cookies |
| Dev-login bypass | ✅ live | env-gated + rate-limited + audit-logged |
| Dashboard home | ✅ live | Real activity feed, computed counts, Realtime updates |
| Roster CRUD + CSV import/export | ✅ live | Phone E.164 normalize, dedupe, archive-not-delete |
| Events CRUD + requirements | ✅ live | Manual event creation, coverage calc, state machine |
| Notification center + bell badge | ✅ live | Realtime subscription, dedupe by key |
| Invite flow (3-step) | ✅ live | Select → compose → send |
| Outbox + cron drain | ✅ live | Daily cron on Vercel Hobby + manual trigger via curl |
| Real email send via Resend | ✅ verified | onboarding@resend.dev → mit@ddc2.com works |
| Mock SMS send | ✅ live | MESSAGING_PROVIDER=mock; visible at /dashboard/mock-sms |
| Public RSVP page | ✅ live | Pit Wall design, accept/decline/cancel, used-token enforcement |
| Replacement candidates | ✅ live | Filter + rank by fit + fairness |
| Attendance + payroll CSV | ✅ live | Status cycle, formula-injection-safe export |
| Settings: roles + quals | ✅ live | Archive-not-delete |
| Settings: notifications prefs | ✅ live | Per-event-type, severity thresholds |
| Settings: audit log viewer | ✅ live (v1.1 → LIVE) | Paginated, filter chips, before/after JSON |
| Settings: consent + opt-outs | ✅ live (v1.1 → LIVE) | Per-staff + opt-outs tabs |
| Settings: exports hub | ✅ live (v1.1 → LIVE) | Roster + per-event payroll |
| Settings: calendar | ⏸ v1.1 deferred | Schema exists, OAuth UI not built |

## What's NOT done — and what you'd need to make it production-ready

### Demo-blockers (none for email-only)
- **Real SMS delivery** — needs a Twilio phone number (~$1/mo + $0.0075/SMS) + Messaging Service SID set as `TWILIO_MESSAGING_SERVICE_SID` in Vercel. Currently SMS is mocked — visible at /dashboard/mock-sms but not actually delivered.

### Operational
- **Custom domain** — currently on `*.vercel.app`. For real use, point a DNS subdomain (e.g. `safety.calabogiemotorsportspark.com`) at Vercel.
- **Resend sending domain** — currently `onboarding@resend.dev` which Resend only delivers to *your own* registered email. To send to other responders, verify a domain in Resend (DKIM/SPF/DMARC) → update `RESEND_FROM_EMAIL` to e.g. `safety@yourdomain.com`.
- **Real owner (Robert)** — add via Supabase SQL: `insert into public.owner_emails (email) values ('robert@…') on conflict do nothing;`. Next time he signs in via magic link, his profile auto-mints with `is_owner=true`.
- **Vercel GitHub App** — install at https://github.com/apps/vercel → grant access to mit-ddc2/Track_Scheduler → enables PR previews + auto-deploy on merge. Currently every deploy is manual `vercel --prod` from local.
- **Vercel Pro upgrade** — only if you want per-minute cron (currently daily). Workaround: hit `curl -H "Authorization: Bearer $CRON_SECRET" .../api/jobs/drain-outbox` after sending invites to drain immediately. Or set up an external pinger (cron-job.org is free).
- **Disable dev-login in production** — set `DEV_LOGIN_ENABLED=false` in Vercel once Robert is signing in via magic link.

### Calendar sync (v1.1)
- The schema columns are all in place (`events.source_type`, `source_event_id`, `source_etag`, `calendar_sources`, `calendar_sync_runs`, `calendar_change_events`)
- What's missing: Google OAuth UI, ICS poller, push webhook handler, change-review banner UI
- Estimated effort: 1–2 days of focused work + Google Cloud Console setup

### Future polish (not blocking demo)
- Wire SMS reply commands (STOP/HELP) — Phase 5a webhook handler already processes them; just no UI surfaces for the manager to see opt-out events as notifications (they DO write to `manager_notifications` per spec, but no special UI)
- Browser push or installable PWA
- Second manager/accountant user — schema supports it, just no UI for inviting other users
- Calendar subscription for confirmed responders — generate per-responder ICS feed
- Reminder schedule (auto-send "your event is tomorrow" SMS+email)

## Test + validation coverage

- **Unit tests**: **309 passing across 35 test files** (final count after all autonomous merges)
- **Playwright E2E**: 2 scenarios (happy path + replacements). Skips without `SUPABASE_SECRET_KEY`; runs end-to-end against the dev server when secrets are present. Mock SMS lets the full SMS path complete.
- **Security audit**: full OWASP review done — `SECURITY_AUDIT.md` at repo root. All 4 HIGH and 2 of 6 MEDIUM findings **fixed** and merged.
- **Performance + accessibility audit**: `PERFORMANCE_AND_A11Y_AUDIT.md` at repo root. All 3 HIGH perf + all 4 HIGH a11y findings **fixed** and merged (plus the MEDIUM dashboard parallelization + new index migration).
- **Smoke test**: `bash scripts/smoke-test.sh` — 8 checks against the live URL. **Currently passing 8/8.**
- **Routes built**: 35 (full route list visible in `pnpm build` output)

## Repository state

- **26 PRs merged**, all CI-gated, all reviewer-audited (no `--admin` bypasses)
- Main branch is clean: lint + typecheck + test + build all green
- Zero stale local branches, zero stale worktrees
- Audit + ops docs: `SECURITY_AUDIT.md`, `PERFORMANCE_AND_A11Y_AUDIT.md`, `OPERATIONS.md`, `DEMO_SCRIPT.md`, `PROJECT_STATUS.md`, `HANDOFF.md` (this file), `README.md`

## How to demo end-of-day (8 min)

Follow `DEMO_SCRIPT.md` step by step. Key points:
1. Use the dev-login URL — don't make audience wait for magic link
2. Send invite to YOUR email (mit@ddc2.com) — Resend's onboarding sender only delivers there
3. After "SEND TO 1", drain the outbox manually with the curl command (cron is daily)
4. Show the email arriving + click the RSVP link in front of audience
5. Switch back to dashboard tab — show Realtime updating coverage to 1/1

## Decisions to make when you have time

1. **Twilio phone purchase** — see SMS section above. Demo works mocked; for production you need a real number.
2. **Custom domain + Resend domain verification** — required before sending to responders other than yourself.
3. **Calendar sync timeline** — v1.1 or push later?
4. **Vercel plan** — stay Hobby (free, daily cron) or upgrade to Pro ($20/mo, per-minute cron)?
5. **Real owner setup** — add Robert's email to `owner_emails` whenever you want to onboard him.

## If anything is broken when you return

1. Run `bash scripts/smoke-test.sh` first — that's a 5-second health check
2. Check `vercel logs` or use the Vercel MCP `get_runtime_logs` (filter by level=error, last 1h)
3. Check Supabase logs in the dashboard
4. Worst case: `vercel rollback` to the last green deploy (see OPERATIONS.md)

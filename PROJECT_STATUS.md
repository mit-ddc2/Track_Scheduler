# Calabogie Safety — Project Status

_Snapshot: 2026-05-17, mid-autonomous run_

## What's live & working

**Live URL**: https://track-scheduler.vercel.app

**Dev-login bypass** (review-mode, no email round-trip):
```
https://track-scheduler.vercel.app/auth/dev-login?key=<CRON_SECRET>
```
The CRON_SECRET is in `.env.local` locally. After clicking the URL, browser cookies are set and `/dashboard` loads as `mit@ddc2.com`.

**Code in main, deployed**:
- ✅ Phases 0–8 (full v1 scope) merged across 15 PRs, all CI-gated, all reviewer-audited
- ✅ 251 tests pass on `main` (25 test files)
- ✅ Lint + typecheck + build clean
- ✅ 28 routes built including all dashboard pages, public RSVP `/r/[token]`, all webhooks (Twilio + Resend), drain-outbox cron, both CSV exports (roster + payroll), dev-login bypass
- ✅ Supabase DB has 25 tables, RLS on every table, 5 functions (`is_owner`, `set_event_requirements_tx`, `update_staff_relations_tx`, plus auth triggers), seed data (5 roles + 6 qualifications + owner email)
- ✅ All env vars set in Vercel Production (10 of 11 needed — missing only `TWILIO_MESSAGING_SERVICE_SID` for SMS)

**Smoke-tested live**:
- `/` → 307 → `/login` ✓
- `/login` renders Calabogie Safety + Sign-in form ✓
- `/auth/dev-login?key=<CRON_SECRET>` → 302 → `/dashboard` with auth cookie ✓
- `/r/invalid-token` → 200, renders graceful "Link expired" UI ✓
- `/api/jobs/drain-outbox` → 401 without bearer, 200 with valid CRON_SECRET, returns `{attempted:0, sent:0, failed:0, suppressed:0}` ✓

## What's blocking full SMS+email E2E

| Blocker | Impact | Resolution path |
|---|---|---|
| **No Twilio Messaging Service SID** | SMS will be marked `PROVIDER_NOT_CONFIGURED` and never actually delivered | (a) Buy a Twilio phone number + create a Messaging Service in console.twilio.com (~$1/mo + $0.0075/SMS), or (b) authorize me to provision via Twilio API, or (c) accept email-only E2E |
| **Vercel GitHub App not installed** | No PR previews; every deploy needs `vercel --prod` from local | Install at https://github.com/apps/vercel → grant access to mit-ddc2/Track_Scheduler, then I can `vercel git connect` |
| **Cron runs daily on Hobby plan** | SMS/email may delay up to 24h | (a) Upgrade Vercel to Pro for per-minute cron, or (b) trigger drain manually via `curl -H "Authorization: Bearer $CRON_SECRET" .../api/jobs/drain-outbox`, or (c) external scheduler |

## What I can do without your input

- **Mock SMS path** — wire a stub provider so the SMS half of E2E "works" (logs payloads instead of sending) and the dashboard reflects sent status correctly
- **Expanded Playwright E2E** — cover all 17 scenarios from spec §19.3, including cancellation → replacement, attendance flow, CSV export
- **Comprehensive security audit** — independent agent audits the entire codebase for OWASP top 10, RLS bypass, input validation, secret leakage
- **Performance audit** — N+1 queries, missing indexes, large payloads, Realtime channel hygiene
- **Accessibility audit** — keyboard nav, ARIA, contrast, screen-reader on RSVP + login + dashboard
- **v1.1 features partial scaffolding** — calendar sync OAuth stub, message templates UI, audit log viewer, consent management UI, exports hub
- **Wire dashboard activity feed** to real data (currently mocked in the events tab)
- **Email-only E2E live run** — actually trigger an invite to my own email through Resend, verify delivery + RSVP loop

## What needs your input later (in order of urgency for the demo)

1. **Decide on Twilio path** (see table above). For an end-of-day demo, email-only is sufficient — but if you want SMS in the demo, this needs to happen.
2. **Vercel Pro decision** — only matters if you want SMS/email to land within minutes vs. on a daily cron.
3. **Custom domain** — currently on `*.vercel.app`. For Robert's actual use, you'd want e.g. `safety.calabogiemotorsportspark.com`.
4. **Resend sending domain** — currently using `onboarding@resend.dev` which only delivers to your own Resend-registered email. For sending to other responders, verify a domain in Resend → set `RESEND_FROM_EMAIL` to `safety@yourdomain.com`.
5. **Real owner email** — currently `mit@ddc2.com` is the only entry in `owner_emails`. For Robert: `INSERT INTO public.owner_emails (email) VALUES ('robert@…');` via Supabase SQL editor.
6. **Calendar source** — Google Calendar OAuth client credentials + the track's calendar ID, OR an ICS URL. Calendar sync is deferred to v1.1 (schema exists, UI deferred).

## Worktree / branch state

- One clean main worktree at `/Users/mitjothiravi/Desktop/repos/Track_Scheduler`
- Zero stale local branches
- Zero stale worktrees
- 15 merged PRs on GitHub (Phase 0–8 + 7 small hotfix/feature PRs)

## What runs next (this autonomous session)

In parallel via subagents:
1. **Security audit** — full codebase, OWASP-mapped findings
2. **Twilio mock provider** — make SMS path testable end-to-end
3. **Expanded Playwright E2E** — 17-scenario coverage from spec §19.3
4. **Performance + accessibility audit**
5. **v1.1 scaffolding** — calendar source OAuth UI stub, audit log viewer, message templates page, consent viewer, exports hub
6. **Dashboard polish** — activity feed real data, replacement-from-cancellation hint

Then merge sequentially, validate, push, redeploy, and produce the final demo brief.

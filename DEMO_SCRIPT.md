# Calabogie Safety — Demo Script

_For end-of-day demo. Email-only (Twilio SMS blocked on phone-number purchase). Run time: ~8 minutes._

## Pre-demo (30 seconds, before audience joins)

1. Open https://track-scheduler.vercel.app — should show the dark Pit Wall landing → "Sign in" form
2. In a second tab open https://track-scheduler.vercel.app/auth/dev-login?key=`<CRON_SECRET>` to bypass the magic-link email round-trip. The URL is in `.env.local` and was set in Vercel as `CRON_SECRET`.
3. Open the Supabase dashboard in a third tab → table editor → can show the DB live during demo if asked

## Demo flow (8 minutes)

### 1. Open (30s) — "What problem are we solving"
- Robert (track safety manager) currently coordinates 12+ emergency rescue staff via phone/Facebook for each race weekend. Messages land in junk, no single source of truth, no easy way to track who said yes.
- This app replaces that with a mobile-first dashboard. Single-user (just Robert), responders RSVP via tokenized links — no accounts needed.
- Built in one autonomous session: Next.js 16 + Supabase + Tailwind v4 + Twilio + Resend. ~250 unit tests, full E2E spec, security-audited.

### 2. The dashboard (1 min)
- Show https://track-scheduler.vercel.app/dashboard (already signed in via dev-login)
- Point out: Pit Wall aesthetic (motorsport pit-lane timing-board vibe), mobile-first, bottom nav (Events / Roster / Activity / More), top bar with notification bell
- Note: the "MAY · Week 21" sub-header is computed from the current date

### 3. Roster (1 min)
- Tap Roster → "Add staff"
- Fill: Your Name, your phone (`+16138831157`), your email (`mit@ddc2.com`), preferred contact = Email (for demo), Role = Rescue Crew, Qual = First Aid, consent email = granted
- Submit → appears in the roster list
- Tap into the new staff member → show detail page (contact methods, consent record, event history empty)

### 4. Create an event (45s)
- Bottom nav → Events → New
- Fill: title = "Demo: Crash Rescue Drill", tomorrow 09:00–17:00, location = "Calabogie Long Course", required headcount = 1
- Submit

### 5. Send an invitation (1.5 min)
- Open the event → tap "SEND INVITES"
- Step 1: select yourself → CONTINUE
- Step 2: toggle **only Email** (SMS will be marked "Twilio not configured" since we haven't bought a phone number) → preview the rendered email subject + body → CONTINUE
- Step 3: confirm → "SEND TO 1"
- Sent screen: "1 invite out · 1 email enqueued"
- **Open a terminal and run**:
  ```
  curl -H "Authorization: Bearer $CRON_SECRET" \
    https://track-scheduler.vercel.app/api/jobs/drain-outbox
  ```
  Returns `{"attempted":1,"sent":1,"failed":0,"suppressed":0}` — the email was actually sent via Resend.

### 6. The RSVP link (1.5 min)
- Switch to your email — the invite arrived. Subject: "Rescue Team Request: Demo: Crash Rescue Drill — …"
- Tap the RSVP link → opens https://track-scheduler.vercel.app/r/<token>
- Show the responder UI: top stripes, big date number, event title, specs grid (CALL / START / END / LOCATION / ROLE / PAY / WEATHER), crew status bar, accept/decline buttons
- Tap ACCEPT → "● CONFIRMED" state

### 7. Back to the dashboard (1 min)
- Return to the dashboard tab — within seconds Realtime should update: event detail shows "1/1 CONFIRMED"
- Bottom nav → Activity → see your acceptance in the live feed
- Notification bell → see the new "responder.accepted" notification

### 8. Attendance + payroll (45s)
- After the event happens: dashboard → event → ATTENDANCE button
- Cycle the status pill from "scheduled" → "WORKED"
- Edit hours/pay (8h × $24)
- Tap "EXPORT PAYROLL CSV" → downloads `payroll-2026-05-18-demo-crash-rescue-drill.csv` — open in Sheets → columns match spec §8.12, no formula-injection vulnerability

### 9. Settings + ops (45s)
- More → Settings → show the LIVE entries:
  - Notification preferences (per-event-type toggles)
  - Crew roles + Qualifications (admin pages)
  - Consent & opt-outs (LIVE) — shows your granted-email status
  - Audit log (LIVE) — shows every action you just took
  - Exports — roster CSV + payroll CSV hub
- Calendar source — `v1.1` deferral, intentionally not built

## What's still a stub or v1.1

- **Google Calendar / ICS sync** — schema is there, OAuth UI deferred. Defer = a few hours of work + Google Cloud Console setup.
- **Real SMS** — needs a Twilio phone number + Messaging Service. ~3 minutes in Twilio console, $1/mo + $0.0075/SMS.
- **Sub-daily cron** — Vercel Hobby caps at daily. Upgrade to Pro for per-minute, OR set up an external pinger (cron-job.org), OR continue using the manual `curl /api/jobs/drain-outbox` trigger demonstrated above.
- **Vercel GitHub App** — not installed; means deploys are manual via `vercel --prod`. Install at https://github.com/apps/vercel for PR-preview workflow.

## Anticipated demo questions

**"How do we add Robert as the actual owner?"**
SQL one-liner via Supabase dashboard:
```sql
insert into public.owner_emails (email) values ('robert@…') on conflict do nothing;
```
Next time he signs in (magic link), his profile auto-mints with `is_owner=true`.

**"What about Robert's existing 12 responders — how do we get them in?"**
Roster → Import CSV → upload the spec-compliant CSV (`first_name, last_name, display_name, email, phone, preferred_contact, primary_role, roles, qualifications, notes, active`). Phone numbers normalize to E.164, duplicates flagged by normalized phone OR email, missing-contact rows become `manual_only`.

**"What if a responder cancels last-minute?"**
Their RSVP link → "CANCEL MY SPOT" → dashboard immediately shows underfilled → spotlight nudge → "FIND REPLACEMENTS" → ranked candidate list with role-match + fairness scoring → bulk-invite replacement candidates.

**"Where does the data live? Is it secure?"**
Supabase Postgres (us-east-2). Every table has Row-Level Security; only the seeded owner email can read. RSVP tokens are 32 random bytes hashed with a per-deploy pepper (constant-time compare on verify). Audit log on every mutation. CSV exports escape formula-injection chars.

**"How long did it take to build?"**
A single autonomous session — bootstrapping, full DB schema, 28 routes, 250+ tests, 8 phases, security + perf + a11y audits, all merged via 15+ PRs with CI gates. Live + verified.

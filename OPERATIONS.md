# Calabogie Safety — Operations Runbook

This document is for the safety manager (the sole operator) and anyone
helping debug production. It covers pre-launch checks, the live test the
manager runs at go-time, rollback, provider outages, daily ops, the manual
fallback, and the cron expectations.

---

## 1. Pre-flight (do this once, before the first live use)

### 1.1 Supabase

- **Auth → URL Configuration**
  - **Site URL** = the production origin (e.g. `https://calabogie-safety.vercel.app`).
  - **Redirect URLs** must include `<APP_BASE_URL>/auth/callback` AND every
    preview-deployment origin the manager will sign in from.
- **Auth → Email Templates**
  - Magic-link template's CTA URL set to `{{ .SiteURL }}/auth/callback?code={{ .Token }}&next=/`.
- **Database**
  - `profiles` table contains the manager's `id` (from `auth.users`) with
    `is_owner = true`, `is_active = true`. Any other row should have
    `is_owner = false`.
- **RLS**
  - Every domain table (`staff_members`, `events`, `event_invites`,
    `event_assignments`, `attendance_records`, etc.) has RLS enabled. RLS
    is part of the migrations checked into `supabase/migrations/`.

### 1.2 Vercel

- The **Vercel GitHub App** is installed and linked to this repo.
- The Vercel project is connected to the `main` branch with automatic
  Production deploys.
- The `vercel.json` cron schedule has been adjusted to the plan tier (see
  §6 below).

### 1.3 Environment variables (set in Vercel **Production** + **Preview**)

| Var                                    | Required | Notes                                                     |
| -------------------------------------- | :------: | --------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`             | yes      | Public Supabase project URL                               |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | yes      | Public key                                                |
| `SUPABASE_SECRET_KEY`                  | yes      | Server-only service-role key                              |
| `APP_BASE_URL`                         | yes      | `https://<your-vercel-host>` — used to build RSVP links    |
| `APP_SECRET_PEPPER`                    | yes      | `openssl rand -base64 48`. Rotation invalidates RSVP links |
| `CRON_SECRET`                          | yes      | Random string; sent as `Authorization` by Vercel cron       |
| `TWILIO_ACCOUNT_SID`                   | for SMS  | Twilio account                                            |
| `TWILIO_AUTH_TOKEN`                    | for SMS  | Twilio auth                                               |
| `TWILIO_MESSAGING_SERVICE_SID`         | for SMS  | Twilio messaging service                                  |
| `TWILIO_WEBHOOK_SECRET`                | for SMS  | Validates inbound webhooks                                |
| `RESEND_API_KEY`                       | for email | Resend                                                    |
| `RESEND_FROM_EMAIL`                    | for email | Verified domain sender                                    |
| `RESEND_WEBHOOK_SECRET`                | for email | Validates inbound webhooks                                |
| `OWNER_CONTACT_PHONE`                  | optional | Phone shown on RSVP page; falls back to generic copy      |

### 1.4 Verify before go-live

Run through this checklist on the **Production** deployment:

- [ ] Sign in at `/login` with the owner email; land on `/dashboard`.
- [ ] `/dashboard/roster` lists at least one staff member.
- [ ] `/dashboard/events/new` saves a draft event without 500ing.
- [ ] `/api/jobs/drain-outbox` returns `401` without the secret, `200`
      with `Authorization: Bearer <CRON_SECRET>`.
- [ ] Twilio webhook URL configured at `<APP_BASE_URL>/api/webhooks/twilio`
      and Resend at `<APP_BASE_URL>/api/webhooks/resend`.

---

## 2. The live E2E test (9 steps, done by the safety manager)

This is the smoke test that proves the production deploy works. Run it
once after the first deploy and after any provider config change.

1. **Add yourself** (or a willing buddy) as a roster staff member at
   `/dashboard/roster/new`. Include phone + email, toggle BOTH SMS and
   email consent.
2. **Create an event** at `/dashboard/events/new`, tomorrow's date,
   `required_headcount = 1`.
3. **Open the event** and click `SEND INVITES`.
4. **Select yourself** as the recipient, both channels (SMS + email), and
   confirm. The "campaign sent" page shows `1 SMS queued` and
   `1 email queued`.
5. **Within ~1 minute** (or one cron tick — whichever is longer on your
   Vercel plan), receive **both** the SMS and the email.
6. **Open the SMS link** on your phone. The RSVP page loads, shows your
   name and the event details.
7. Tap `ACCEPT · I'M IN`. The page swaps to "● CONFIRMED · You're on the
   crew."
8. **Back on the dashboard**, refresh `/dashboard/events/<id>`. The
   coverage bar shows `1/1 CONFIRMED` (no refresh required if Realtime
   is connected).
9. Check `/dashboard/notifications` — a green entry should be there
   saying the responder accepted.

If any step fails, see §4 (provider failure handling) and §5 (daily ops).

---

## 3. Rollback procedure

### 3.1 Via Vercel dashboard (preferred)

1. Open the project → **Deployments** tab.
2. Find the last known-good Production deployment.
3. Click the `⋯` menu → **Promote to Production**.

This takes ~10 seconds and serves the previous build immediately. The
database is untouched; any RLS / schema changes in the rolled-back commit
remain (Supabase migrations are forward-only — coordinate carefully).

### 3.2 Via the CLI

```bash
vercel rollback
```

The CLI prompts for the deployment to roll back to. Use this when the
dashboard is unreachable or the deploy was triggered from CI.

### 3.3 If a Supabase migration is the problem

Supabase migrations are forward-only. Roll forward with a corrective
migration; do NOT attempt to revert a migration in production without a
full backup verified.

---

## 4. Provider failure handling

### 4.1 Twilio is down or rate-limited

- **Symptom**: Outbox rows stay `pending`. The cron job (`drain-outbox`)
  retries each row up to 4 times with exponential backoff (1m, 5m, 15m,
  60m). After 4 failures, the row is marked `failed` and surfaces in the
  notification center as a "failed delivery" warning.
- **What you can do**:
  - Open `/dashboard/notifications` — failed messages show the recipient
    and event.
  - Call/text the affected responder manually from your phone.
  - Once Twilio recovers, re-trigger the campaign from the event detail
    page; the orchestrator de-duplicates via the per-staff-per-channel
    idempotency key, so re-sending is safe.

### 4.2 Resend is down

Same model as Twilio: rows stay `pending`, retried 4×, then flagged. Use
the responder's phone (or call) as the manual fallback.

### 4.3 Supabase is down

- **Symptom**: The dashboard renders empty lists or 500s on actions.
- **Dashboard becomes read-only-ish**: server actions throw because RLS
  queries fail. RSVP pages also fail since they read the invite row.
- **What you can do**: Wait. Supabase outages are typically short. Notify
  responders by phone for anything time-critical. Once the database is
  back, re-run any failed actions from the dashboard.

### 4.4 Vercel cron paused (Hobby plan limits)

If the platform pauses the per-minute cron (Hobby plan), the outbox stops
draining. Symptoms:

- Outbox rows have `created_at` in the past, no `sent_at`, no error.
- The 9-step live test sits at "queued" forever.

Switch `vercel.json` to a less-frequent schedule (see README) and/or move
to a paid plan.

---

## 5. Daily ops

### 5.1 Where to look every morning

| Where                          | What to check                                        |
| ------------------------------ | ---------------------------------------------------- |
| `/dashboard`                   | Today / next 7 days — any `UNDERFILLED` events       |
| `/dashboard/notifications`     | Failed sends, opt-outs, RSVP cancellations           |
| Supabase → `message_outbox`    | Rows with `status = 'failed'` in the last 24h        |
| Supabase → `audit_log`         | Anything unexpected (mass deletes, frozen-event hits) |

### 5.2 Common signals

- **Failed messages**: see §4. Cross-check with Twilio/Resend dashboards.
- **Opt-outs**: a responder texted `STOP`. Their row's `consent_sms` is
  flipped to false and `staff_contact_methods.opt_out_at` is stamped.
  Future SMS campaigns automatically skip them.
- **Sync errors** (calendar): not applicable in v1.0; ships in v1.1.

---

## 6. Cron expectations

| Job                              | Schedule (vercel.json)         | Notes                                                                   |
| -------------------------------- | ------------------------------ | ----------------------------------------------------------------------- |
| `POST /api/jobs/drain-outbox`    | `* * * * *` (per-minute)       | Pro plan only. On Hobby drop to `*/10 * * * *` or hourly.                |
| Calendar-sync polling            | Deferred                       | Ships in v1.1.                                                          |

Cron requests are authenticated by Vercel sending `Authorization: Bearer
<CRON_SECRET>`; the route returns 401 without it. Manual triggers can use
`curl -H "Authorization: Bearer $CRON_SECRET" $APP_BASE_URL/api/jobs/drain-outbox`.

---

## 7. Manual fallback (when the dashboard is unavailable)

The roster, event, and call-sheet CSV exports are designed so the safety
manager can run the day with a printed sheet if the app is hard down
(spec §9.5).

- **Roster CSV**: `/dashboard/roster` → `EXPORT CSV` (top-right).
- **Per-event call sheet**: `/dashboard/events/<id>` → `EXPORT CALL SHEET`
  on the event detail page.
- **Payroll CSV**: `/dashboard/events/<id>/attendance` → `EXPORT PAYROLL`.

Print the day's call sheet at the start of every event. If the dashboard
fails mid-event, mark attendance on paper and re-enter it the next day —
the attendance actions are idempotent on `(event_id, staff_member_id)`.

---

## 8. Phase 5b note: RSVP token rotation

`APP_SECRET_PEPPER` is included in the hash of every RSVP token. Rotating
it invalidates **all outstanding RSVP links**. Only rotate if:

- The secret has leaked, OR
- All active campaigns have finished and no further responses are needed.

After rotation, any responder clicking an old link will see the "● LINK
NOT FOUND" page — they should be contacted manually for any RSVPs that
were still pending.

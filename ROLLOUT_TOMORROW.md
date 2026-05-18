# Rollout checklist — tomorrow morning

_Goal: Mit + Robert can sign in; both can add staff + events; invitations actually deliver to responders' inboxes._

## Status of the two prep items

| Item | Status |
|---|---|
| Robert added as owner (placeholder `robert@calabogie-safety.local`) | ✅ done via Supabase MCP — when you have Robert's real email, run `UPDATE public.owner_emails SET email='REAL@EMAIL' WHERE email='robert@calabogie-safety.local';` in Supabase SQL editor |
| Daily cron + manual drain | ✅ already configured — see "Drain after sending invites" below |
| Resend sending domain | ⏳ **YOU DO TONIGHT** (see below) |

---

## TONIGHT (~20 minutes total)

### 1. Buy a domain (~5 min, ~$10/yr)

**Recommended**: register at **Cloudflare Registrar** — they sell at cost, no markup, free WHOIS privacy. https://www.cloudflare.com/products/registrar/

Suggested names (check availability in this order):
- `calabogiesafety.com` — short, brandable, ~$10/yr
- `calabogiesafety.ca` — Canadian TLD, fits the location, ~$11/yr (requires "Canadian Presence Requirement" — check the box; as a Canadian individual you qualify)
- `crashrescue.ca` — even shorter, ~$11/yr
- `calabogie-safety.com` — fallback if `.com` is taken
- `calabogie-safety.ca`

If you don't already have a Cloudflare account: sign up (free), buy the domain, that's it. The domain will be on Cloudflare's nameservers automatically — that makes step 2 painless.

(Namecheap or Porkbun work too; just slightly less convenient because you'd need to set DNS records manually.)

### 2. Verify the domain in Resend (~10 min, mostly waiting)

a. Log into Resend → **Domains** → **Add Domain** → paste your new domain.
b. Resend gives you 3 DNS records (TXT for SPF, TXT/CNAME for DKIM, TXT for DMARC).
c. **If domain is on Cloudflare**: Cloudflare → your domain → DNS → click Resend's "Open in Cloudflare" link OR copy each record manually into Cloudflare DNS. Each record is type + name + value — exactly as Resend shows.
d. Back in Resend, click **Verify**. Status will go: Pending → Verified within ~5 min for Cloudflare DNS (up to 24h for slower providers, but with Cloudflare it's usually fast).

### 3. Pick your from-address

e.g. `Calabogie Safety <safety@calabogiesafety.com>` or `<robert@calabogiesafety.com>`. Anything `@yourdomain.com` works once the domain is verified.

### 4. Tell me the from-address

Reply in chat with: `RESEND_FROM_EMAIL=Calabogie Safety <safety@calabogiesafety.com>` (or whatever you chose). I'll update the Vercel env var + redeploy in <2 minutes.

---

## TOMORROW MORNING (~5 minutes)

### 1. Confirm Robert's real email

When you know Robert's real email (e.g. `robert.lavoie@gmail.com` or his Calabogie email), reply in chat OR run this in Supabase SQL editor yourself:

```sql
UPDATE public.owner_emails 
SET email = 'REAL_EMAIL_HERE' 
WHERE email = 'robert@calabogie-safety.local';
```

### 2. Robert's first sign-in

a. Send Robert https://track-scheduler.vercel.app
b. He enters his email → "SEND MAGIC LINK"
c. He clicks the link in his inbox → lands on `/dashboard`
d. **First-time sign-in**: a `profiles` row is auto-created with `is_owner=true` (because his email is in `owner_emails`).

### 3. Smoke test together

a. Both you and Robert at https://track-scheduler.vercel.app/dashboard — you should each see the same 3 seeded events + 6 staff.
b. One of you: **Roster → Add staff** → real responder with real email → save.
c. One of you: **Events → New** → real upcoming event → save.
d. Open the event → **SEND INVITES** → pick the new responder → choose Email only → CONTINUE → SEND.
e. **Drain immediately** (cron is daily; this triggers the send right now):
   ```
   curl -H "Authorization: Bearer <CRON_SECRET>" \
     https://track-scheduler.vercel.app/api/jobs/drain-outbox
   ```
   CRON_SECRET is in `.env.local` here on this laptop. If you don't have terminal access, I can build you a "Drain now" button in the dashboard in ~10 minutes.
f. The responder should receive the email within ~10s. They click the RSVP link → ACCEPT → your dashboard updates within ~5s via Realtime.

---

## DECISION POINTS YOU MAY HIT

### "Robert's real email is in Gmail / a personal address"
That's fine. Owners use whatever email they prefer; it just needs to be reachable for magic-link sign-in. He doesn't need to be on your domain.

### "Some responders don't have email, only phone"
SMS is currently mocked (visible at `/dashboard/mock-sms`). For real SMS you'd need to:
1. Buy a Twilio phone number (console.twilio.com → Phone Numbers → Buy, ~$1/mo)
2. Create a Messaging Service in Twilio (Messaging → Services → Create, add the number to it)
3. Paste me the MGxxx Messaging Service SID — I'll set it in Vercel + redeploy
4. Set `MESSAGING_PROVIDER=` empty in Vercel (currently `mock`) — I can do that

For tomorrow's rollout this is optional; if a responder is phone-only, mark them `manual_only` in the roster and Robert calls them.

### "We want a real URL not vercel.app"
Once you own a domain (step 1 above), you can also point a subdomain at this app:
- Cloudflare → DNS → add CNAME `app` → `cname.vercel-dns.com`
- Vercel project → Settings → Domains → Add `app.calabogiesafety.com`
- Update Vercel env vars: `APP_BASE_URL=https://app.calabogiesafety.com`
- Update Supabase Auth → URL Configuration → set Site URL to the new origin
- Redeploy
~10 min total. Optional for tomorrow.

### "Robert doesn't want to type a CRON_SECRET into a terminal"
Pick one:
- (a) **Build him a "Drain now" button** — I can ship this in ~10 min, sits at `/dashboard/settings`.
- (b) **Upgrade Vercel to Pro** ($20/mo) → cron runs every minute → no manual trigger needed.
- (c) **External pinger** — cron-job.org (free) hits the drain URL on a schedule you choose.

---

## What's still NOT in scope for tomorrow

- **Calendar sync** (Google Calendar / ICS) — v1.1 deferral; deferred until Robert decides which calendar to sync with.
- **CSV bulk-import of Robert's existing 12-ish responders** — UI exists at `/dashboard/roster/import`; he can use it tomorrow if he has a CSV. Otherwise he can add them one-by-one via the form.

---

## If anything breaks

- `bash scripts/smoke-test.sh` — 8 health checks against the live URL
- `vercel rollback` — instant rollback to the previous green deploy (Vercel dashboard or CLI)
- Vercel runtime logs visible at https://vercel.com/mit-8436s-projects/track-scheduler/logs
- Supabase logs at https://supabase.com/dashboard/project/vpyjwbsryeldbhjfogwd/logs

You can ping me with any errors and I'll debug.

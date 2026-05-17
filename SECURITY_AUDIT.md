# Calabogie Safety — Security Audit

**Branch reviewed:** `main` (worktree at `agent-ab33ddb1c367f0fe6`)
**Reviewer:** automated security audit
**Stack:** Next.js 16 (App Router) · React 19 · Supabase (auth + Postgres + RLS) · Twilio · Resend · Vercel (Hobby) cron.

---

## Executive Summary

The codebase exhibits a generally strong security posture for a single-owner MVP. Authentication enforces `requireOwner()` on every dashboard server action and export route; Twilio/Resend webhooks verify signatures with constant-time comparison and fail closed; RSVP tokens use 32 random bytes + peppered SHA-256 with `timingSafeEqual`; the cron route requires `Authorization: Bearer ${CRON_SECRET}`; Postgres RLS is enabled on every public table; and CSV exports defang formula-injection. Zod schemas gate every server action input.

The main concerns are: **(1) the `/auth/dev-login` route is still wired up in production and gates only on `CRON_SECRET`**, meaning anyone who learns or brute-forces that single secret gains permanent owner-level auth (and the secret is also accepted by the cron endpoint, doubling its blast radius); **(2) the public `/r/[token]` flow and webhook endpoints have no application-level rate limiting**, so an attacker can brute-force token space or hammer the outbox/webhook handlers; and **(3) the `/auth/callback?next=` parameter is forwarded to `redirect()` without validating it's a same-origin path**, allowing a phishing-style open redirect chained off a magic link.

**Tally — total findings:** 0 CRITICAL · 4 HIGH · 6 MEDIUM · 5 LOW · 6 INFO/confirmations.

---

## HIGH

### H1. `/auth/dev-login` exposes a full owner session behind a single shared secret reused with the cron job
- **OWASP:** A07 Identification & Authentication Failures (also A05 Misconfiguration)
- **File:** `app/auth/dev-login/route.ts:30-88`
- **Description:** The route reads `CRON_SECRET`, compares the query-string `?key=` against it (constant-time, good), then calls `admin.auth.admin.generateLink` + `supabase.auth.verifyOtp` to mint a full owner session **on every request** for `DEV_LOGIN_EMAIL` (default `mit@ddc2.com`). There is no environment gate (`NODE_ENV !== 'production'`), no deployment-flag gate, no IP allow-list, no rate limiting, and no audit log. The same `CRON_SECRET` is also the only credential required to call `/api/jobs/drain-outbox` (`lib/security/signatures.ts:126`), so anyone who steals or guesses it gets both background-job control AND the ability to impersonate the owner.
- **Reproduction:** `curl -i 'https://<host>/auth/dev-login?key=$CRON_SECRET'` returns `302 → /dashboard` and sets the Supabase auth cookies on the attacker's session. The follow-up `curl -b cookies.txt https://<host>/dashboard` has full owner access.
- **Suggested fix:** Either (a) hard-delete the route before public launch, (b) gate it with `if (process.env.NODE_ENV === 'production') return 404` and also require a deploy-time env flag like `ENABLE_DEV_LOGIN=1`, AND (c) use a dedicated `DEV_LOGIN_SECRET` distinct from `CRON_SECRET`. Also add `writeAudit({ action: 'auth.dev_login', ... })` so any use is visible.
- **Effort:** S

### H2. `/auth/callback?next=` accepts an unvalidated redirect target (open redirect)
- **OWASP:** A01 Broken Access Control (open redirect class)
- **File:** `app/auth/callback/route.ts:13,29`
- **Description:** After exchanging the magic-link code for a session, the handler does `return NextResponse.redirect(`${origin}${next}`)` where `next` comes straight from `searchParams.get("next") ?? "/"`. A value of `//evil.example` or `/\\evil.example` becomes `https://<host>//evil.example` which most browsers parse as `https://evil.example`. An attacker who can convince a victim to request a magic link with the crafted callback URL (e.g. by embedding it in a phishing landing page that calls `signInWithOtp({ emailRedirectTo: ... })`) can bounce a freshly-authenticated session to an attacker-controlled host, where the URL fragment / referer can leak the recently-set Supabase session info.
- **Reproduction:** Trigger a magic link with `emailRedirectTo=https://victim/auth/callback?next=//attacker.tld`. After the user clicks, the server issues `302 Location: https://victim//attacker.tld`.
- **Suggested fix:** Validate `next` is a single, relative same-origin path: reject anything containing `:`, `//`, `\\`, or that doesn't begin with `/`. Example: `const safeNext = next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";`
- **Effort:** S

### H3. Public `/r/[token]` (and `/r/[token]/submit`) has no rate limiting — RSVP token brute-force is feasible
- **OWASP:** A07 Identification & Authentication Failures (also A04 Insecure Design)
- **Files:** `app/r/[token]/page.tsx:49-95`, `app/r/[token]/submit/route.ts`, `app/r/[token]/rsvp-handler.ts:58-119`
- **Description:** The token is 32 random bytes (256 bits) — *cryptographically* infeasible to guess — but the loader makes a Supabase round-trip on every request and the route handler/page sit on `force-dynamic` with no upstream rate limit, IP throttling, or lockout. An attacker can repeatedly hit `/r/<garbage>` (or POST to `/r/<garbage>/submit`) to (a) exhaust the Supabase function-invocation budget / Vercel function quota (DoS), or (b) probe response timing / shape to differentiate `invalid` vs `expired` vs `used` (the `loadInviteByTokenImpl` returns distinct reason codes that the page renders into `RsvpExpired`). Without rate limiting there is also no defence against a flood of POSTs to `/submit` once any real token is leaked from the recipient's SMS history.
- **Reproduction:** `for i in $(seq 1 100000); do curl -s -o /dev/null https://<host>/r/$(openssl rand -hex 32) & done` — sustains arbitrary load on the Supabase free tier (egress + reads) and the Vercel function pool.
- **Suggested fix:** Add a per-IP rate limit (e.g. 10 req / 60 s) on `/r/*` in `proxy.ts` (or use `@upstash/ratelimit`). Also collapse `loadInviteByTokenImpl`'s `invalid`/`expired`/`used` outcomes into a single "not valid" response surface for unauthenticated callers — the granular reasons are useful to a legitimate user but also useful to a token-fuzzer.
- **Effort:** M

### H4. `/api/jobs/drain-outbox` returns 200 on internal failures, masking errors AND allowing easy probe-DoS once `CRON_SECRET` is known
- **OWASP:** A09 Security Logging & Monitoring Failures (also A04 Insecure Design)
- **File:** `app/api/jobs/drain-outbox/route.ts:25-37`
- **Description:** Two issues: (1) authenticated callers (anyone with `CRON_SECRET`) can call this endpoint at arbitrary frequency. Each call runs `drainOutbox({ limit: 50 })` which issues many admin-client queries and potentially fires SMS/email through Twilio/Resend (real money). There is no `if last_invocation < 30s ago` guard, no concurrency lock; two concurrent cron runs are only protected by the per-row `pending → sending` claim (`lib/messaging/outbox.ts:232-243`), but the surrounding DB load is unbounded. (2) Any internal exception is swallowed and returned as `200 { error: 'drain_failed' }` (line 34), so a broken job is invisible to Vercel's cron health dashboards (which key off 5xx). Combined with H1 reusing `CRON_SECRET`, a single secret compromise = both auth bypass AND ability to burn SMS budget.
- **Reproduction:** `while true; do curl -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/jobs/drain-outbox; done` — every call enters the loop, hits the DB, and potentially dispatches outbound provider calls. Errors never surface in monitoring.
- **Suggested fix:** (a) Add a coarse re-entrancy guard — e.g. a `drain_runs` row with `started_at`, abort if a run started < 20s ago; (b) on real internal errors return 500 so Vercel surfaces them (still avoid 5xx for *expected* provider failures — those are correctly captured per-row in the outbox); (c) use a distinct `CRON_SECRET` from any user-facing auth path (see H1).
- **Effort:** M

---

## MEDIUM

### M1. `verifyCronSecret` does not normalise length before `constantTimeEqual`, leaking secret length via timing
- **OWASP:** A02 Cryptographic Failures
- **File:** `lib/security/signatures.ts:11-26, 126-137`
- **Description:** `constantTimeEqual` returns `false` immediately when buffer lengths differ (it does a same-length compare against zero bytes to consume time, which is good), but `verifyCronSecret` always passes the user-supplied string directly. An attacker can binary-search the secret length by measuring response time deltas because the zero-fill compare cost differs from the real compare cost on long strings vs short. The risk is small (the secret is high-entropy random) but it's avoidable: hash both sides with SHA-256 first and compare the fixed-length digests.
- **Reproduction:** Statistical timing analysis over thousands of requests with varying header lengths.
- **Suggested fix:** In `verifyCronSecret`, do `createHash("sha256").update(presented).digest()` and compare against the pre-computed digest of the expected value. Same recommendation for the `?key=` check in `app/auth/dev-login/route.ts:23-28` (which has its own local `constantTimeEqual` that returns `false` on length mismatch without consuming time — strictly worse than the shared helper).
- **Effort:** S

### M2. Twilio signature verification cannot reject duplicate / replayed callbacks
- **OWASP:** A08 Software and Data Integrity Failures
- **File:** `lib/security/signatures.ts:40-57`, `app/api/webhooks/twilio/route.ts:23-89`
- **Description:** The verifier checks HMAC-SHA1 of the URL + sorted body params — correct per Twilio docs — but unlike `verifyResendSignature` (which enforces a 5-minute timestamp tolerance, `signatures.ts:91-96`) it has no timestamp window or nonce. A captured webhook payload (e.g. via TLS proxy on a compromised CDN, or a logged request) can be replayed indefinitely. The downstream `processTwilioStatusCallback` is idempotent at the `message_events` upsert (unique key `provider,provider_message_id,event_type`), which limits damage for status callbacks — but `processTwilioInbound` inserts a new `message_events` row each time (no upsert, `provider-webhooks.ts:162-170`) and re-applies opt-out/opt-in state changes (`provider-webhooks.ts:194-239`). Replaying a "STOP" message can re-mark a contact as opted-out after the owner manually restored it.
- **Reproduction:** Capture one signed inbound POST. POST it again later — it succeeds and re-applies the STOP side effects.
- **Suggested fix:** Reject replays older than ~10 minutes by checking the Twilio-supplied `X-Twilio-Signature` request's freshness via a `MessageSid` lookup (refuse to process if `message_events` already has an `inbound.*` row for the same `(MessageSid, From)`). Easier: enforce a unique index on `(provider, provider_message_id)` for inbound events and let the second insert hit a 23505.
- **Effort:** M

### M3. RSVP token error responses leak `invalid` vs `expired` vs `used` to anyone hitting the URL
- **OWASP:** A04 Insecure Design (related to H3)
- **Files:** `app/r/[token]/rsvp-handler.ts:62-119`, `components/rsvp/RsvpExpired.tsx`
- **Description:** Three distinct reason strings are surfaced to unauthenticated callers. While useful UX, it gives a token-fuzzer a side-channel: a real token previously used by another user yields "used", a real but stale token yields "expired", and a never-issued token yields "invalid". Combined with H3 (no rate limiting), an attacker who learns one token can map all sibling tokens' lifecycle. Note also: `loadInviteByTokenImpl` never returns `used` — it only checks `expires_at` (line 103) — but the page/RsvpExpired still supports `used`, so today the leak is "invalid vs expired". Whether or not `used` is wired, the reason multiplicity remains a side-channel.
- **Suggested fix:** Either collapse all three reasons into one for the public surface (recommended), or accept the reason leak as an explicit product trade-off and document it. Also: fold `loadInviteByTokenImpl`'s used-token check back in so `rsvp_tokens.used_at` is actually enforced (today's code allows the same token to be replayed by the legitimate user, see M5).
- **Effort:** S

### M4. `manager_notes` and `event.title` are concatenated and re-rendered without HTML/SQL/template escaping in downstream surfaces
- **OWASP:** A03 Injection (template injection in email/SMS)
- **Files:** `app/dashboard/events/actions.ts:249-250` (cancel reason → manager_notes); `lib/messaging/render-templates.ts:79-89` (SMS); `app/r/[token]/page.tsx:185` (RSVP page); `lib/messaging/render-templates.ts:138-154` (email HTML)
- **Description:** Email HTML rendering uses `htmlEscape` correctly (`render-templates.ts:140-148`) — good. However: (a) the SMS template substitutes `event.title` raw into the SMS body; if an event title contains a URL it'll be auto-linked by recipients' SMS clients and could be used for SMS phishing within a legitimate-looking Calabogie message. (b) `manager_notes` is appended to via `cancel` action with the user's reason text — but `manager_notes` is read by the same owner only, so risk is self-inflicted. (c) The RSVP page renders `event.title` via React (`<div>{event.title}</div>`) — React escapes by default, so HTML/JS injection is **not** possible there. The remaining risk is SMS title-spoofing.
- **Reproduction:** Owner sets event title to `"FREE COFFEE -> https://bit.ly/x"`; SMS arrives as `Calabogie Safety: Rescue crew request for FREE COFFEE -> https://bit.ly/x, ...` and recipients can be tricked into tapping the attacker URL.
- **Suggested fix:** Strip URL-like tokens (`https?://`, `www.`, bare TLD patterns) from event titles before embedding in SMS, OR display the title in quotes with an explicit "from your manager" disclaimer. Since this is a single-owner app where the owner is the only injector, severity is bounded.
- **Effort:** S

### M5. `used_at` on `rsvp_tokens` is set but never enforced — tokens are infinitely replayable until expiry
- **OWASP:** A04 Insecure Design
- **File:** `app/r/[token]/rsvp-handler.ts:103-104, 291-296`
- **Description:** `submitRsvpResponseImpl` writes `used_at = now()` after a non-`update_note` action (line 291-296), but `loadInviteByTokenImpl` only rejects on `expires_at < now` (line 103). There is no `if (token.used_at) return { ok: false, reason: 'used' }`. As a result, the spec/UI contract that "each link can only be used once" (per `RsvpExpired.tsx:23` copy) is silently broken — a recipient (or anyone who later sees the token in their SMS history) can re-accept/decline/cancel as many times as they want until expiry. This combines with the lack of rate limiting (H3) to allow an attacker who got the link once to flip the RSVP state at will.
- **Reproduction:** Accept via `/r/<token>`, then POST `action=cancel` to `/r/<token>/submit` — succeeds even though `used_at` is set.
- **Suggested fix:** In `loadInviteByTokenImpl`, add `if (token.used_at) return { ok: false, reason: "used" };`. Or relax the once-only contract and update the UI copy to match — the spec needs to decide which is intended. Either way, code and copy must agree.
- **Effort:** S

### M6. Server errors leak raw Supabase/Postgres error messages into action responses (information disclosure)
- **OWASP:** A09 Logging & Monitoring (info disclosure via responses)
- **Files:** `app/dashboard/events/actions.ts:98, 195, 213, 263, 332`; `app/dashboard/roster/actions.ts:114, 165, 184, 201, 301, 349, 382`; `app/r/[token]/rsvp-handler.ts:213, 225`
- **Description:** Failure paths return `{ error: error.message }` straight from the Supabase client. Postgres/PostgREST errors can reveal schema details (column names, constraint names like `event_invites_event_id_staff_member_id_key`, RLS-policy IDs). For authenticated owner actions, this is low impact (owner sees their own schema). But `submitRsvpResponseImpl` is **public** (returned via `/r/[token]/submit/route.ts:65`), so an attacker can probe for schema details by sending malformed inputs and reading the resulting error strings.
- **Suggested fix:** For public surfaces (RSVP submit), wrap `error.message` in a generic "Could not save your response — please try again." string and log the raw message server-side only. For owner-facing surfaces, the current behaviour is acceptable.
- **Effort:** S

---

## LOW

### L1. `lib/db/audit.ts` swallows admin-client failures silently (best-effort audit log)
- **OWASP:** A09 Logging & Monitoring Failures
- **File:** `lib/db/audit.ts:31-60`
- **Description:** `writeAudit` catches all errors and logs to `console.warn`. If `SUPABASE_SECRET_KEY` is unset, audit entries are silently dropped (line 52-58). For a security-relevant audit log this is fragile — a misconfigured prod deploy will look fine but produce no audit history. Recommend: throw on missing service-role key at boot (or surface a startup health warning).
- **Suggested fix:** Add a one-time boot check in instrumentation that validates the admin client can write a no-op row; alert if not.
- **Effort:** S

### L2. `app/dashboard/roster/actions.ts:475-479` lower-cases role/qualification names without validating uniqueness — minor data-integrity risk
- **OWASP:** A04 Insecure Design (data integrity)
- **Description:** CSV import resolves role/qualification names case-insensitively via `roleByName.get(name.trim().toLowerCase())`. If two crew_roles differ only in case ("EMT" vs "emt") the loser silently disappears. Not a confidentiality/integrity exploit; flagged for completeness.
- **Suggested fix:** Add a CHECK constraint or trigger in Postgres to forbid case-insensitive name duplicates.
- **Effort:** S

### L3. `OWNER_EMAIL` default is a real, hard-coded email (`mit@ddc2.com`)
- **OWASP:** A05 Misconfiguration
- **File:** `app/auth/dev-login/route.ts:21`
- **Description:** The default falls back to a specific user's email when `DEV_LOGIN_EMAIL` is unset. In combination with H1, this means anyone with `CRON_SECRET` gains a session as the actual project owner. Defaults should fail closed (e.g. `null` and refuse to proceed if `DEV_LOGIN_EMAIL` isn't set explicitly).
- **Suggested fix:** Remove the default; require `DEV_LOGIN_EMAIL` to be set or 500 with a clear error.
- **Effort:** S

### L4. `app/api/exports/payroll/[eventId]` and `/api/exports/roster` have no row-volume cap or rate limit
- **OWASP:** A04 Insecure Design / DoS
- **Description:** Owner-only routes (`requireOwner()` is enforced) so exfiltration risk is bounded to the owner. Still, the roster export does `listStaff()` which selects every row + joins (no `.limit()`), and the payroll route returns every attendance row. A future multi-tenant world would need pagination + auditing of large pulls. Today only LOW because owner is trusted and dataset is small.
- **Suggested fix:** Add a sanity `.limit(10_000)` plus log row count in the existing audit entry (already done — see line 81 of roster route).
- **Effort:** S

### L5. `lib/messaging/send-email.ts:16` uses `safety@example.invalid` as a fallback `From` address
- **OWASP:** A05 Misconfiguration
- **Description:** If `RESEND_FROM_EMAIL` is unset, the code logs a warning and tries to send anyway. Resend will reject `example.invalid` so the outbox row will fail correctly — but a more defensive approach is to refuse to attempt the send (return `accepted: false` early). Avoids burning a Resend API call and surfaces the misconfiguration faster.
- **Suggested fix:** Treat missing `RESEND_FROM_EMAIL` like missing `RESEND_API_KEY`: return `accepted: false, errorCode: "PROVIDER_NOT_CONFIGURED"`.
- **Effort:** S

---

## INFO / Confirmations (things checked and OK)

### C1. `SUPABASE_SECRET_KEY` is never exposed to the client bundle
- **File:** `lib/db/supabase-admin.ts:1-37`
- The module begins with `if (typeof window !== "undefined") throw` and is only imported from server-only files (`audit.ts`, `outbox.ts`, `provider-webhooks.ts`, `create-campaign.ts`, `rsvp-handler.ts`, `notifications/create-manager-notification.ts`, `/auth/dev-login/route.ts`). The publishable key (`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`) is correctly the only Supabase key in `supabase-browser.ts`.

### C2. Postgres RLS is enabled on every public table; policies require `is_owner()` for business tables
- **File:** `supabase/migrations/0002_rls.sql:18-26, 37-64`
- Every table in the `public` schema has `ENABLE ROW LEVEL SECURITY` and an owner-only policy. Server-only tables (`message_outbox`, `message_events`, `rsvp_tokens`, `audit_log`) have *read* policies for the owner and rely on the service-role key bypassing RLS for writes.

### C3. Webhook signature verification fails closed when secrets are missing
- **Files:** `app/api/webhooks/twilio/route.ts:43-52`, `app/api/webhooks/resend/route.ts:17-21`, `lib/security/signatures.ts:127-131`
- Missing `TWILIO_AUTH_TOKEN`, `RESEND_WEBHOOK_SECRET`, or `CRON_SECRET` all return 403/401. No accidental "skip signature in dev" branches.

### C4. RSVP token storage uses HMAC-via-SHA256-pepper, never persists the raw token, and uses `timingSafeEqual` for compare
- **File:** `lib/security/token.ts:39-72`
- 32 random bytes encoded URL-safe base64 (43 chars), hashed with `APP_SECRET_PEPPER` server-side, constant-time compare on lookup. Pepper missing → throws at boot.

### C5. RSVP page renders all user-controlled strings via React (escaped) — no `dangerouslySetInnerHTML`, no `innerHTML`
- Search across `app/`, `components/`, `lib/`: zero hits for `dangerouslySetInnerHTML` / `innerHTML`. Event title, location, manager_notes, staff display_name, RSVP note all flow through JSX text nodes or React component props.

### C6. No raw SQL template literals; only two `.rpc()` calls and both pass parameters via the named-arg shape Supabase serialises safely
- **Files:** `app/dashboard/events/actions.ts:327` (`set_event_requirements_tx`), `app/dashboard/roster/actions.ts:339` (`update_staff_relations_tx`)
- No SQL injection surface in app code. Validated Zod inputs are passed as named args.

### C7. No outbound `fetch()` against user-controlled URLs — SSRF surface is zero
- Search for `fetch(...)` with a `request`/`url`/`input` variable returned no hits in `app/` or `lib/`. All outbound calls go through Twilio/Resend SDKs with hard-coded endpoints.

### C8. `proxy.ts` matcher correctly excludes public surfaces while still refreshing auth cookies for everything else
- **File:** `proxy.ts:46-58`
- `/login`, `/auth/*`, `/api/webhooks/*`, `/api/jobs/*`, `/r/*` are excluded so webhook signature checks don't get a free pre-empt from middleware. `requireOwner()` is the perimeter for the dashboard.

### C9. CSV exports defang formula injection (`=`, `+`, `-`, `@`, `\t`, `\r`, `\n`)
- **Files:** `app/api/exports/roster/route.ts:19,29-31`; `lib/payroll/export-csv.ts:62-80`
- Both routes prefix `'` to neutralise spreadsheet formulas and wrap in quotes per RFC 4180.

### C10. Owner-only mutations always call `requireOwner()` *before* touching the DB
- Spot-checked every server action in `app/dashboard/**/actions.ts`. The pattern is consistent and reliable. RLS provides a second layer of defence via `is_owner()` (`migrations/0002_rls.sql:7-15`).

---

## Recommendations Prioritisation

If only three things can ship before public launch:
1. **H1** — disable or harden `/auth/dev-login` before any non-allowlisted user can reach the deployment.
2. **H2** — validate `?next=` in the auth callback (4 lines of code).
3. **H3 + H4** — add rate limiting on `/r/*` and `/api/jobs/*` (a single `@upstash/ratelimit` setup covers both).

The remaining HIGH (H4 / sub-issue: cron error masking) and all MEDIUM items can be batched into a single hardening PR.

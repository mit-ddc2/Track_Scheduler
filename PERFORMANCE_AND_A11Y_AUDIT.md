# Audit Summary

Read-only audit of the Calabogie Safety dashboard (Next.js 16 + Supabase) covering the routes listed in the brief plus shared lib code and the public RSVP/login flows. Overall the codebase is in good shape for a single-user MVP — server queries are short, indexes are well-matched to the dominant access paths, the shared realtime channel pattern is correctly used by both `NotificationsLive` and `NotificationBadge`, and bundle imports are tree-shakable. The audit produced **3 HIGH / 6 MEDIUM / 5 LOW performance findings** and **4 HIGH / 7 MEDIUM / 4 LOW accessibility findings** — the largest concerns are the lack of any visible `:focus-visible` style anywhere in the design system, several body-text uses of `--text-3` (#6b6b6b) that fall short of the WCAG AA 4.5:1 target, and a handful of N+1 / per-row Supabase fetches in the RSVP submit, event detail page, and the outbox drain suppression check.

## Performance Findings

### HIGH

- **`lib/messaging/outbox.ts:208-340` — per-row suppression query in `drainOutbox` (N+1, multiplied).** The drain pulls up to 50 due rows per minute, and for each row `checkSuppression` issues 1–3 sequential admin queries (`staff_contact_methods` lookup, optional `invitation_campaigns` lookup, optional `events` lookup). At a 50-row batch a single drain can fire 50–150 round-trips before any send call. The author's note at line 348 acknowledges this. Fix: select rows with the joined campaign/event/contact info up front (single `select(...)` with `!inner` joins or a SQL view), or batch IDs and do one `in()` query per table per drain.

- **`app/r/[token]/page.tsx:59-80` and `app/r/[token]/rsvp-handler.ts:73-296` — RSVP request fires ~6 sequential admin queries on GET and 10+ on POST.** The GET path runs token-lookup → invite-lookup serially, then 4 admin queries in `Promise.all` (event, staff, invites, assignments). The POST path adds: staff lookup, event lookup, invite update, response-history insert, conditional assignment select+update/insert, rsvp_tokens update, recompute (2 more queries), event status update, manager_notification create (which itself enqueues), and audit insert — all sequential. For a public, mobile-network responder this is the worst latency surface in the app. Fix: hydrate event+staff+invite in `loadInviteByTokenImpl` with a single `select(..., event:events(*), staff:staff_members(*))` join; on POST, replace the assignment select+update/insert with a single `upsert` on the `(event_id, staff_member_id)` unique key.

- **`app/api/exports/roster/route.ts:69` + `lib/roster/queries.ts:54-69` — unbounded `listStaff()` for CSV export.** No `.limit()`; pulls every `staff_members` row with nested contact methods, roles, qualifications. For the MVP (low hundreds) this is fine, but as soon as roster grows beyond a few thousand the embedded-relation payload balloons into the megabytes and Vercel's response time budget on the serverless function shrinks. Fix: stream via Postgres cursor or paginate the embed; alternatively flatten with a SQL view that returns one row per staff for the CSV columns.

### MEDIUM

- **`app/dashboard/page.tsx:30-41` — dashboard issues two sequential awaits (`listUpcomingEvents()` then the urgent-notifications query).** They're independent; `Promise.all` would save one DB round-trip on every dashboard load.

- **`app/dashboard/events/[eventId]/replacements/page.tsx:25-26` and `lib/roster/replacement-candidates-fetch.ts:43-141` — replacement-candidates path runs 5 sequential awaits.** `getEvent` → `listEventRequirements` (sequential in the page) → then inside the fetcher: requirements, staff, assignments, invites, attendance — only the last block could parallelize. Wrap the four read-only queries in `Promise.all`. Also: `attRows.limit(staffIds.length * 4)` (line 141) is a heuristic that can silently truncate the "last worked" facts when most staff have many attendance records each — switch to a SQL `distinct on (staff_member_id) order by actual_end desc` view to guarantee one row per staff.

- **`app/dashboard/events/[eventId]/page.tsx:50-71` — event detail tab fetches always run, even when the tab is hidden.** The current code uses ternaries to skip the roster/messages queries when not on that tab, which is correct. However `getEventCoverageRows` and `listEventRequirements` always run even though "requirements" is rendered behind a tab. Tabs use full-page navigation (anchor `Link` with `?tab=`), so each tab change re-fetches the full event header. Acceptable, but adding `<Suspense>` boundaries per tab panel would avoid the wait on the unused panes. Low impact at MVP scale.

- **`app/dashboard/events/[eventId]/invite/page.tsx:31-37` — `listStaff()` pulls every staff member with all relations.** OK for the MVP, but the invite page only needs `display_name`, `preferred_contact`, primary role/qual chips, and per-channel reachability — most of the `contact_methods` payload (consent_source, consented_at, normalized_value, last_verified_at, etc) is unused on the page. Trim the selected columns to reduce wire payload on every invite-page load.

- **`lib/events/queries.ts:90-95` — `listAllEvents` `.or()` filter on `(starts_at >= lower OR ends_at >= lower)`.** PostgREST translates `.or()` to a Postgres `OR`, which the planner cannot satisfy from `idx_events_starts_at` alone (the `ends_at` half is a sequential scan). Add `create index idx_events_ends_at on events(ends_at)`. At low row counts the planner happily seq-scans, so this is medium not high.

- **`components/notifications/NotificationBadge.tsx:46-66` — reseed-on-reconnect issues a `select id` with `count: 'exact'`.** `count: 'exact'` triggers a full scan of `manager_notifications` filtered by `(profile_id, status='unread')`. The composite index `idx_manager_notifications_unread (profile_id, status, created_at desc)` covers this query and the count is bounded by the small per-owner unread set, so this is fine today. Worth a follow-up to switch to `head: true` with no `select(id)` payload, since the IDs are also being captured into `unreadIdsRef` — the realtime stream alone can keep that set live after the initial seed.

- **`lib/attendance/queries.ts:82-122` — two sequential queries for listEventAttendance (assignments embed then attendance_records).** They're issued sequentially. The second only depends on `event_id` (already known), so `Promise.all` would save a round-trip. Minor at MVP scale.

### LOW

- **`app/dashboard/events/[eventId]/page.tsx:62-70` — messages tab fetches `message_outbox` with `.limit(50)` but no `.eq("event_id", ...)`.** Phase 5b note: the outbox is queried globally, which means clicking the Messages tab on Event A shows messages for *all* events. Functional/UX bug more than perf, but the missing predicate also forces a full table scan instead of using `(campaign_id, ...)`. Add `eq("campaign_id", in(...))` or join via `invitation_campaigns.event_id`.

- **`app/api/exports/payroll/[eventId]/route.ts` → `getPayrollExportData` (lib/attendance/queries.ts:149-192)** — calls `listEventAttendance` which itself does 2 sequential queries (above), then re-shapes. Same parallelization win available.

- **`lib/messaging/outbox.ts:118-178` — `enqueueOutboxMessage` SELECTs then INSERTs.** This is intentional to keep the dedupe check explicit, but a single `insert(..., { onConflict: 'idempotency_key', ignoreDuplicates: true }).select('id')` round-trip is one query instead of two. The unique-violation race fallback (line 162) shows this is already understood.

- **`components/notifications/NotificationsLive.tsx:89-99` — `todayCount` re-derives a `new Date()` and per-notification date comparisons on every render** (driven by realtime updates). Reasonable now, but if the inbox grows the comparison cost compounds. Memoize `now` once per render and store the day boundary as an ISO string for cheap `>=` compare.

- **`lib/notifications/realtime.ts:36` — shared channel cache lives at module scope.** This is the right pattern; just noting that Next.js dev-mode hot reloads can leak old `SharedChannelEntry` instances. Production OK.

- **`app/dashboard/page.tsx` + `app/dashboard/layout.tsx` — both await `requireOwner()` then the layout re-runs `requireOwner()` and a count query on every navigation.** That's two `auth.getUser()` round-trips for every dashboard navigation. `requireOwner()` could memoize via React.cache for the lifetime of one request; check `lib/auth/require-owner.ts` for whether it already does so.

## Accessibility Findings

### HIGH (blocks task completion)

- **`app/globals.css` — no `:focus-visible` or `:focus` styles anywhere.** Verified with `grep -c "focus\|outline" app/globals.css → 0`. The `.cs-btn`, `.cs-chip`, `FilterPill`, all attendance/roster buttons, the RSVP accept/decline buttons, and the inline `<input>`s in `LoginForm` and `AttendanceEditRow` rely on browser defaults — and several inputs explicitly set `outline: "none"` (e.g. `RosterListView.tsx:119`, `LoginForm.tsx:120`, `AttendanceEditRow.tsx:51`) without supplying a replacement. Keyboard users currently cannot see where focus is. Fix: add a global `:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }` rule and a matching `.cs-btn:focus-visible`, then remove the bare `outline: none` from the inputs.

- **`components/notifications/NotificationCard.tsx:83-88` and `components/ui/Card.tsx` (`.cs-card--hover`) — hover-only border highlight as the sole "interactive" affordance.** Spec §16.1 / §17 explicitly forbid hover-only primary actions. The card has no `:focus` state, so a keyboard or touch user gets no visual confirmation that the card is focused. Add a `:focus-visible` border treatment matching the hover state.

- **`components/rsvp/RsvpForm.tsx:160-200` — RSVP Accept/Decline buttons have no `:focus` style and the green Accept button (`background: var(--ok) #22c55e`, text `#062a13`) sits inside an `aria-live`-less screen.** The button itself has decent contrast (~7.5:1), but successful action ("CONFIRMED · You're on the crew") is rendered as static text — there is no `role="status"` or `aria-live="polite"` wrapper around the localStatus state, so a screen-reader user who taps Accept hears no confirmation. The pending "WORKING…" label change is also silent. Add `aria-live="polite"` to a wrapper, and make sure the status change announces.

- **Color contrast: `--text-3` (#6b6b6b) on `--bg` (#0a0a0a) ≈ 3.6:1.** Below the 4.5:1 WCAG AA threshold for normal text. This token is used pervasively for body-size labels: `.cs-eyebrow` at 10px (`globals.css:144`), `.cs-label` at 10px (`globals.css:147`), and is hard-coded in countless places — dashboard counts (`app/dashboard/page.tsx:79`), event-card metadata, table cell headers (`app/dashboard/events/page.tsx:153`, 204, 228, 268), RSVP timestamps, notification "OPEN EVENT" hint lines, qualification expiry labels, etc. Most of this text is 10–12px (small), so the AA target is still 4.5:1. Fix: lift `--text-3` to ~#8a8a8a (~5.6:1) in the `pit-wall` theme to match `--text-3` in the `day` theme, OR introduce a `--text-muted` token reserved for non-text decorative use and force body labels to use `--text-2`.

### MEDIUM (impedes)

- **`app/dashboard/events/[eventId]/page.tsx:223-272` — tab list has `role="tablist"` / `role="tab"` / `aria-selected` correctly, but each tab is a `<Link>` (full-page navigation) rather than focusable buttons.** The pattern works for screen-readers but the ARIA `tablist` keyboard model (Arrow Left/Right to move between tabs, Home/End) is not implemented. Either drop the ARIA tab roles and let it be plain navigation links, or implement the keyboard model.

- **`components/notifications/NotificationsLive.tsx:168-201` — filter pills use `role="tab"` but are not inside `<div role="tablist">`'s corresponding `tabpanel` IDs (the result list has no `id`/`role="tabpanel"`).** Same fix as above: either complete the tablist pattern (panel ID + `aria-controls` on each tab) or drop the tab semantics and use ordinary toggle buttons with `aria-pressed`.

- **`components/dashboard/DashboardNav.tsx:74-120` (`BottomNav`) — touch targets are too small.** The grid cells have `padding: "8px 0 6px"` and a 20px icon + tiny 9px label → total height around 36-40px. Spec §16.1 requires 44px minimum. Increase vertical padding or set `min-height: 44px` on the `<Link>`.

- **`components/invite/InviteSelectStep.tsx:118-164` — filter chips are wrapped in unstyled `<button>` elements with no visible hit area beyond the `Chip` interior, and the `Chip` has its own `padding: 4px 8px` (~24px tall).** Below the 44px target on phones. Pad the outer button.

- **`app/r/[token]/page.tsx:248-258` — crew-status bar (`cells.map`) renders `<span>` blocks for each crew cell with no `aria-label` or visually-hidden text describing "5 of 8 confirmed".** The text version sits above as eyebrow text, but the SR may still hear "5 spans, empty". Mark the container `aria-hidden` or give it `role="img" aria-label="5 of 8 spots confirmed"`.

- **`components/auth/LoginForm.tsx:100-129` — email input uses inline `outline: "none"` + JS `onFocus`/`onBlur` to swap `borderColor`.** This is fragile and doesn't help keyboard users with high-contrast settings. Replace with `:focus-visible` CSS.

- **`components/replacements/ReplacementList.tsx:199-207` — the disabled "SELECT REPLACEMENTS TO SEND" button is rendered with `aria-disabled` but no `disabled={true}` styling that meets contrast.** Verify the disabled state's text contrast — `.cs-btn--primary` disabled drops the visual but the text color stays `--accent-ink #fff` on `--accent #E63946` (passes), so this is mostly a polish item; just confirming `aria-disabled` is announced.

- **`components/notifications/NotificationsLive.tsx:159` `LiveIndicator` — status colors (var(--ok) / var(--bad) / var(--warn)) are the only signal for "LIVE" / "OFFLINE" / "ERROR" state.** Label text is included next to the dot ("LIVE", "OFFLINE", etc.), so this passes — listed here only as confirmation, not a defect.

### LOW (polish)

- **`app/r/[token]/page.tsx:144-292` — the RSVP page renders the entire screen as a series of `<div>`s.** No `<main>` landmark, no `<h1>` until line 184, and the page uses hard-coded `background: "#0a0a0a"` instead of `var(--bg)` (which means the public page doesn't pick up theme tokens). Cosmetic, but landmark roles help SR navigation.

- **Heading hierarchy on `/dashboard` (`app/dashboard/page.tsx`):** `h1 "Calabogie Safety"` then jumps to `h2 "Activity feed"` (only on desktop) and `h3` via `cs-h3` (which is a CSS class, not a `<h3>` element — the spotlight headings in `EventSpotlight` would need an audit). Several pages use `<span className="cs-h2">` rather than `<h2>` — visually correct but flatten the SR outline. Convert visual headings to semantic `<h2>`/`<h3>` where they are headings.

- **`components/dashboard/TopBar.tsx:31` — "Calabogie Safety" is rendered with `className="cs-h2"` but is wrapped in a plain `<div>` rather than the page `<h1>`.** Combined with the layout-level rendering of `<h1>` per page, this is acceptable, but the dashboard owner identity could use `<p aria-label="Signed in as ...">` instead of the bare cs-eyebrow.

- **`components/attendance/AttendanceList.tsx:106-139` — the row toggle uses `aria-expanded`/`aria-controls` correctly.** Listed as confirmation.

## Confirmations

- **Realtime channel hygiene — single shared channel pattern is honoured.** `lib/notifications/realtime.ts:36` maintains a module-level `Map<topic, SharedChannelEntry>`. The two callers (`NotificationsLive.tsx:50` and `NotificationBadge.tsx:70`) both go through `subscribeToNotifications`, so the same profile gets one websocket subscription. `EventInvitesLive.tsx:24` is a separate, per-event channel (`event_invites:${eventId}`) and is the only mounted instance per event detail page — no duplication there either.
- **Bundle imports are tree-shakable.** `lucide-react` icons are imported as named symbols (e.g. `import { Bell } from "lucide-react"`), `date-fns-tz` uses `formatInTimeZone` only, no `lodash`/`moment` imports anywhere in `components/` or `app/`. ✓
- **Indexes match the dominant access paths.** `idx_event_invites_event_status (event_id, status)` covers the event-detail and invite-page lookups; `idx_event_assignments_event_status` covers replacements + RSVP recompute; `idx_manager_notifications_unread (profile_id, status, created_at desc)` covers the dashboard notifications query and the badge reseed; `idx_outbox_status_next_attempt (status, next_attempt_at)` covers the drain selector. The 0001 schema is well-thought-out.
- **Tab ARIA on event detail (`app/dashboard/events/[eventId]/page.tsx:223-272`) — `role="tablist"`/`role="tab"`/`role="tabpanel"`/`aria-controls`/`aria-labelledby`/`aria-selected`/`tabIndex` are all present.** Phase 3 fixer fix held. (Only gap: keyboard arrow-key model, see Medium finding above.)
- **`requireOwner()` is correctly invoked at every dashboard/page entry** (`app/dashboard/page.tsx:29`, `[eventId]/page.tsx:41`, `[eventId]/invite/page.tsx:23`, `[eventId]/replacements/page.tsx:19`, `[eventId]/attendance/page.tsx:23`, `notifications/page.tsx:12`, `api/exports/roster/route.ts:68`, `api/exports/payroll/[eventId]/route.ts:27`). ✓
- **Login form has a real `<label for="email">` paired to `<input id="email">` (`components/auth/LoginForm.tsx:93-100`)** and uses `autoComplete="email"`, `required`, `type="email"` — passes WCAG label criterion.
- **RSVP error display uses `role="alert"`** (`RsvpForm.tsx:235`), as does the login error block (`(auth)/login/page.tsx:75`) and the inline form errors in attendance/invite. ✓
- **No `lodash` or `moment` in dependencies** (verified in `package.json`).
- **`writeAudit` is no-op-safe** when the admin client isn't configured (`lib/db/audit.ts:51-58`) — won't break parent server actions. ✓

## Recommendations

Top 5 fixes ordered by impact-per-effort:

1. **Add a global `:focus-visible` style in `app/globals.css`** and remove all inline `outline: "none"` declarations on inputs. This is one CSS rule that fixes the largest a11y gap in the app — keyboard users currently have no idea what's focused.
2. **Lift `--text-3` in the `pit-wall` theme from `#6b6b6b` to ~`#8a8a8a`** to clear the WCAG AA 4.5:1 threshold for the dozens of small-text uses (eyebrow labels, dashboard counts, table headers, RSVP timestamps). One-line change with a wide blast radius.
3. **Collapse the RSVP submit path** (`app/r/[token]/rsvp-handler.ts:73-296`) by hydrating event+staff+invite in the token lookup join and replacing the assignment select+update/insert with a single `upsert` keyed on `(event_id, staff_member_id)`. Public mobile latency is the single biggest UX risk here.
4. **Batch the outbox suppression check** in `lib/messaging/outbox.ts:208-340` — pre-fetch all distinct contact methods, campaigns, and events for the batch with three `.in()` queries instead of 50–150 per-row round-trips. This will keep the cron under 1s at scale.
5. **Implement an `aria-live="polite"` status region in `RsvpForm.tsx`** so the success state ("You're on the crew") is announced to screen readers. Also add `aria-live="polite"` to the `LiveIndicator` in `NotificationsLive.tsx` so realtime connection changes are perceivable.

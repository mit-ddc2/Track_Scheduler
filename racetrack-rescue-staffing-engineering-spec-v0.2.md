# Racetrack Crash Rescue Staffing Web App — Engineering Spec

**Version:** 0.2 draft  
**Updated:** May 17, 2026  
**Prepared for:** Robert Harrison, Track Emergency Safety Manager / Crash Rescue Team staffing workflow  
**Prepared by:** Mithun Jothiravi  
**Target deployment:** Vercel-hosted responsive web app with Supabase backend and third-party messaging/calendar integrations  
**Status:** Draft for review and iteration

---

## 1. Executive Summary

The goal is to build a simple, reliable staffing and roster dashboard for Robert, the track emergency safety manager. The application should replace ad hoc phone/email/Facebook coordination with a central dashboard that Robert can use from either his phone or laptop.

The MVP is optimized around **Robert as the only authenticated dashboard user**. Responders should not need accounts; they should interact through SMS/email messages and secure RSVP links.

The app should allow Robert to:

1. Maintain a central roster of crash rescue team members, including names, roles, qualifications, phone numbers, email addresses, contact preferences, notes, active/inactive status, and consent/opt-out state.
2. Import race/event schedule information from the central track authority calendar when available.
3. Add race/events manually when they are not yet available in the calendar.
4. Detect calendar updates/cancellations quickly and surface them in Robert’s dashboard.
5. Notify Robert when the track schedule changes, when a team member accepts/declines/cancels/updates availability, or when an event becomes underfilled.
6. Select team members for an event and send SMS, email, or both.
7. Collect one-tap accept/decline/cancel responses from responders through secure RSVP links without requiring responder accounts.
8. See staffing status at a glance: required headcount, accepted responders, pending responders, declined responders, cancellations, and replacement candidates.
9. Mark who actually worked and export a payroll/attendance report after the event.

This system is for **advance staffing and schedule coordination**, not live incident dispatch. The track should keep a manual/offline contact list and event roster as a safety fallback.

---

## 2. v0.2 Clarification Summary

This version incorporates the latest clarifications:

- Robert is the **only dashboard user** for the MVP.
- The dashboard must be a **central source of truth for team members**, not just an invite-sending tool.
- Robert must be able to add/edit team members, roles, qualifications, phone numbers, emails, notes, and contact preferences.
- Events can be imported from the central track authority calendar or created manually.
- Calendar updates and cancellations should appear quickly on Robert’s dashboard.
- Robert should be notified when:
  - the calendar source adds, changes, or cancels an event;
  - a responder accepts, declines, cancels, or changes availability;
  - a cancellation causes an event to become underfilled;
  - message delivery fails or a responder opts out.
- The dashboard must be usable on a phone and on a laptop. The design should be mobile-first, with responsive layouts for larger screens.

---

## 3. Problem Context

Robert currently has staff contact information on his phone and is responsible for staffing the crash rescue team before race days and track events. The current process is time-consuming because:

- Contacts are not centralized in a structured roster.
- Staff roles, qualifications, and contact preferences are not managed in one place.
- Calendar events, staffing requirements, messages, confirmations, cancellations, and pay records are separate workflows.
- The central track schedule can change or be cancelled, and those changes need to reach Robert quickly.
- Facebook groups are unsuitable because some members do not want to use Facebook and member removal/management is awkward.
- Email-only coordination is unreliable because messages can land in junk/spam folders.
- There is no quick dashboard showing who accepted, who cancelled, who is pending, and who can replace missing headcount.
- Robert works from both a phone and a laptop, so a desktop-only interface is not acceptable.

The app should be designed for Robert as a practical operator: minimal administrative friction, clear event status, strong mobile usability, and no unnecessary complexity.

---

## 4. Product Scope

### 4.1 MVP Goals

The first usable release should support:

- Single-user Robert login.
- Central team roster.
- Team member create/edit/archive/restore.
- Team member contact methods: SMS phone, email, preferred contact channel, manual-only option, consent, delivery health, and opt-out status.
- Team member role/qualification management.
- CSV contact import with preview and deduplication.
- Manual event creation.
- Google Calendar import/sync where the central track calendar is accessible through Google Calendar.
- ICS feed polling fallback if the central track calendar is available only as an ICS subscription feed.
- Calendar update detection through Google Calendar push notifications when supported, plus periodic reconciliation sync.
- Event cancellation/change handling without deleting staffing history.
- Robert notification center for schedule changes and responder availability changes.
- Optional Robert SMS/email notifications for urgent changes.
- Event staffing requirements by total headcount and optional role/qualification.
- Invitation campaigns by SMS, email, or both.
- Secure RSVP links for responders without responder accounts.
- Dashboard coverage status and replacement candidate suggestions.
- Attendance marking and payroll CSV export.
- Audit log for roster, event, invite, response, notification, and payroll changes.
- Mobile-first responsive dashboard with laptop-friendly table views.
- Manual fallback exports: full roster, event roster, and event call sheet.

### 4.2 Non-Goals for MVP

The MVP should **not** attempt to be:

- A live emergency dispatch system.
- A medical record or incident command record system.
- A payroll processor that issues payments.
- A Facebook-style social platform.
- A public registration portal.
- A native iOS/Android app requiring App Store or Play Store deployment.
- A multi-user admin system.
- A full shift-bidding marketplace.
- A complete responder self-service portal with account login.
- A system that edits the central track authority calendar unless explicitly authorized.
- A sub-second real-time mirror of an ICS calendar. If the calendar is ICS-only, changes are detected by polling, not true push updates.

### 4.3 Future Enhancements

Potential later phases:

- Second manager/accounting read-only user.
- Browser push notifications or installable PWA behavior.
- SMS reply commands such as `YES`, `NO`, `CANCEL`, and `HELP` without needing links.
- Responder self-service portal with upcoming events and availability calendar.
- Automatic reminder schedule.
- Calendar subscription/feed for confirmed responders.
- More advanced crew composition rules.
- Incident-day check-in/out by QR code.
- Integration with payroll/accounting software.
- Printable event sheets and laminated contact sheets.

---

## 5. Key Assumptions and Product Decisions

These assumptions should be validated with Robert before implementation:

1. Robert is the only authenticated dashboard user for MVP.
2. Responders should not need accounts for MVP.
3. Responders may receive SMS, email, or both.
4. Some responders may be manual-only.
5. Robert has, or can obtain, the team contact information needed for an initial CSV import.
6. The central track authority calendar is the operational source of truth for official event dates/times when linked.
7. Robert can create manual local events when the official calendar is delayed or incomplete.
8. The preferred calendar integration is Google Calendar API with push notifications and incremental sync.
9. If Google Calendar API access is not available, an ICS feed can be supported by polling, with less-real-time behavior.
10. Calendar staffing information should stay in the app database, not in Google Calendar descriptions.
11. Event history, attendance history, and payment-support history should be preserved even if a responder is archived or an event is cancelled.
12. The track must maintain manual fallback procedures and exportable contact lists.
13. The team size is modest: likely tens of responders, not thousands.
14. The app is for operational staffing, not marketing.
15. Payroll export initially needs CSV only, not payment processing.

---

## 6. User Personas

### 6.1 Robert / Safety Manager / Sole Dashboard User

Robert needs to:

- Add/edit/archive team members.
- Maintain roles, qualifications, notes, phone numbers, emails, and contact preferences.
- See upcoming track events from the central calendar and manually created events.
- Review calendar updates/cancellations.
- Receive notifications when schedule/staffing changes happen.
- Select responders for an event.
- Send invitations.
- Monitor confirmations and cancellations.
- Fill shortages quickly.
- Mark actual attendance.
- Export pay/attendance reports.
- Use the app from a phone and laptop.

### 6.2 Responder / Staff Member

Does not need an app account in MVP. Needs to:

- Receive clear event details.
- Accept, decline, cancel, or update availability with one tap.
- See the event date/time/location.
- Contact Robert if needed.
- Stop receiving automated messages if desired.

### 6.3 Future Secondary User

Deferred. A future second manager or accounting user may receive read-only or limited permissions. This is not an MVP requirement.

---

## 7. Core User Stories

### 7.1 Roster and Role Management

- As Robert, I can add a team member with name, role, phone, email, notes, qualifications, and preferred contact method.
- As Robert, I can edit a team member’s role, qualifications, contact details, active/inactive status, and notes from one dashboard.
- As Robert, I can import a CSV contact list and deduplicate by normalized phone/email.
- As Robert, I can mark a responder inactive without deleting historical attendance/payment records.
- As Robert, I can search/filter the roster by name, role, qualification, contactability, and active status.
- As Robert, I can see whether a responder has opted into SMS/email and whether a channel has bounced or opted out.

### 7.2 Event Management

- As Robert, I can import events from the central track calendar.
- As Robert, I can manually create a local event if it is not yet on the central calendar.
- As Robert, I can see whether an event came from the calendar or was created manually.
- As Robert, I can see when an imported event was last synced.
- As Robert, I can see what changed if the central calendar changes an event.
- As Robert, I can set needed headcount and optional role/qualification requirements.
- As Robert, I can see whether an event is underfilled, filled, overfilled, cancelled, locked, or needs review.

### 7.3 Calendar Update Notifications

- As Robert, I get an in-app notification when the central calendar creates, updates, or cancels an event.
- As Robert, I get a higher-priority notification when a staffed or invited event changes.
- As Robert, I can review the changed fields before notifying responders.
- As Robert, I can choose whether to notify accepted responders, all invited responders, or nobody yet.

### 7.4 Invitations and RSVP

- As Robert, I can select responders for an event and choose SMS, email, or both.
- As Robert, I can preview the SMS and email before sending.
- As a responder, I can open a secure RSVP link and accept, decline, cancel, or update availability.
- As Robert, I can see responses in near real time while the dashboard is open.
- As Robert, I can resend to no-response members without duplicating messages to those who already answered.

### 7.5 Replacement Workflow

- As Robert, I can see if an event is short after someone declines or cancels.
- As Robert, I can open “Find replacements” and see active responders who are not already assigned and who match role/qualification needs.
- As Robert, I can send replacement invitations to selected responders.

### 7.6 Attendance and Pay

- As Robert, I can mark confirmed responders as worked, no-show, cancelled, or excused.
- As Robert, I can enter actual hours and optional pay-rate details.
- As Robert, I can export a payroll/attendance CSV.
- As Robert, I can review historical events and who worked them.

### 7.7 Mobile and Laptop Usage

- As Robert, I can check event staffing, read notifications, and send replacement invitations from a phone.
- As Robert, I can use a laptop for imports, bulk edits, reviewing longer lists, and exporting payroll.
- As Robert, I can complete critical actions without relying on hover-only UI controls.

---

## 8. Functional Requirements

### 8.1 Authentication and Authorization

MVP requirement: Robert is the only authenticated dashboard user. Responders use secure RSVP links.

Authentication:

- Use Supabase Auth for Robert’s login.
- Seed one owner profile for Robert.
- Require MFA for Robert’s owner account if supported by chosen auth configuration.
- Protect all dashboard routes with server-side auth checks.
- Every Server Action and Route Handler must independently verify authorization.
- Do not rely on hidden UI controls as an authorization boundary.

Responder access:

- RSVP links use random tokens stored as hashes.
- Tokens authorize only one invite.
- Tokens do not expose staff IDs or event IDs directly.
- Tokens expire after the event end date plus a configurable grace period, default 48 hours.
- Responders can update accept/decline/cancel/availability until the event is locked or completed.

Future extensibility:

- The schema may include role fields for future owner/manager/viewer accounts.
- The MVP UI should not expose multi-user administration unless explicitly requested later.

### 8.2 Central Roster

Roster fields:

- Display/preferred name.
- First name and last name, optional.
- Primary role.
- Additional roles.
- Qualifications/certifications/tags.
- Phone number, normalized to E.164.
- Email address, lowercase normalized.
- Preferred contact method: `sms`, `email`, `both`, `manual_only`.
- Active/inactive status.
- Notes visible only to Robert.
- Consent status per channel.
- Last contacted timestamp.
- Delivery health per channel: valid, invalid, bounced, suppressed, opted out.
- Event history.
- Last worked date.

Roster actions:

- Create.
- Edit.
- Archive.
- Restore.
- Search.
- Filter.
- Import CSV.
- Export CSV.
- Add/edit roles.
- Add/edit qualifications.
- View event history.

Important rule: never delete staff members with historical assignments, attendance, messages, or payroll records. Archive instead.

### 8.3 Roles and Qualifications

Roles are operational staffing categories. Examples:

- Incident Lead.
- Rescue Crew.
- Truck Driver.
- Medical/First Aid.
- Tow/Recovery.

Qualifications are capabilities/certifications/tags. Examples:

- Fire Suppression.
- Extrication.
- First Aid.
- Medical.
- Tow/Recovery.
- Driver.

Requirements:

- Robert can manage role names from a settings page.
- Robert can assign one primary role and optional additional roles to each team member.
- Robert can assign qualifications/tags to each team member.
- Qualifications can optionally have expiry dates.
- Event requirements can be expressed by role, qualification, or simple total headcount.

MVP simplification:

- Support simple headcount by default.
- Support roles/qualifications as filters and optional event requirements.
- Do not force Robert into complex crew-composition rules unless he configures them.

### 8.4 Contact Import

MVP import should use CSV because phone contacts can usually be exported from Google Contacts, Outlook, Android, or iOS workflows.

Supported CSV columns:

```text
first_name,last_name,display_name,email,phone,preferred_contact,primary_role,roles,qualifications,notes,active
```

Import behavior:

1. Show preview of parsed rows.
2. Normalize phone/email.
3. Identify likely duplicates by normalized phone/email.
4. Let Robert choose update/skip/create for duplicates.
5. Do not send messages during import.
6. Import rows with missing phone/email as `manual_only` until fixed.
7. Set consent status to `unknown` unless the CSV includes explicit consent evidence.

Future: support vCard import or Google Contacts integration only if needed.

### 8.5 Events

Event fields:

- Title.
- Description.
- Event type: race, school, lapping, private test, festival support, etc.
- Start date/time.
- End date/time.
- Timezone, default `America/Toronto`.
- Location.
- Status: `draft`, `scheduled`, `inviting`, `underfilled`, `staffed`, `needs_review`, `locked`, `completed`, `cancelled`.
- Source type: `manual`, `google_calendar`, `ics_feed`.
- Calendar source reference.
- External calendar event ID.
- External etag/updated timestamp where available.
- Last source sync timestamp.
- Required headcount.
- Optional requirement rows by role/qualification.
- Robert notes.

Event actions:

- Create manual event.
- Edit manual/local fields.
- Cancel event.
- Import/update from calendar source.
- Link a manual event to a calendar-source event.
- Set headcount and role requirements.
- Select invitees.
- Send invitations.
- Review calendar changes.
- Lock roster.
- Mark complete.
- Export attendance/pay CSV.

Calendar-linked event rule:

- Official source fields such as title, date/time, location, and source status should be updated from the calendar unless Robert intentionally keeps a local override.
- Staffing data remains local to the app.

### 8.6 Calendar Integration

The app must support two event entry paths:

1. Import/sync from central track authority calendar.
2. Manual local event creation.

Supported source modes:

| Source mode | When to use | Update behavior | Limitation |
|---|---|---|---|
| Google Calendar API | Preferred if Robert can access the central calendar in Google Calendar | Push notifications + incremental sync + fallback polling | Requires OAuth/calendar access |
| ICS feed | Use if the track only exposes an ICS subscription feed | Scheduled polling and normalized-event diffing | Not true push/real-time |
| Manual event | Use for private placeholders or events not yet in the official calendar | Robert edits directly | No source updates |

Minimum calendar features:

- Configure calendar source in Settings.
- Import upcoming events.
- Create manual events.
- Link/unlink manual events and imported source events.
- Update local event when source event changes.
- Store sync metadata.
- Preserve staffing history when a source event is cancelled.
- Show last successful sync time.
- Show sync error state.

Near-real-time behavior:

- For Google Calendar API sources, production should use Calendar push notifications to an HTTPS webhook as the primary change signal.
- The push webhook should treat notifications as change signals only and then perform incremental sync to fetch details.
- Watch channels must be renewed before expiration.
- Scheduled fallback polling should run even when push notifications are enabled.
- For ICS feeds, only polling is available.

Calendar change handling:

- New source event: import as `scheduled`; optionally notify Robert.
- Source event update before invitations: update automatically and record a change event.
- Source event update after invitations/assignments: update local event, mark `needs_review`, create Robert notification, and show review banner.
- Source cancellation: mark local event `cancelled`, create Robert notification, do not delete history.
- Source event missing from feed/API unexpectedly: mark as `source_missing` or `needs_review` before treating as cancelled unless the source explicitly reports cancellation.

### 8.7 Event Staffing Requirements

Events can have simple or structured requirements.

Simple mode:

- One total headcount number, such as “Need 8 responders.”

Structured mode:

- Requirement rows with role/qualification tags, such as:
  - 1 Incident Lead.
  - 2 Truck Drivers.
  - 4 Rescue Crew.
  - 1 Medical/First Aid.

MVP behavior:

- Default to simple headcount.
- Allow optional structured requirements.
- Let Robert override assignments manually.

Coverage calculations:

- `confirmed_count`: accepted/assigned responders not cancelled.
- `needed_count`: configured headcount.
- `short_count`: max(needed - confirmed, 0).
- `surplus_count`: max(confirmed - needed, 0).
- `pending_count`: invited but no response.
- `declined_count`: declined.
- `cancelled_count`: accepted earlier but later cancelled.
- `partial_count`: responders who submitted partial availability.

### 8.8 Invitation Campaigns

An invitation campaign is a batch of messages for one event.

Campaign fields:

- Event ID.
- Created by Robert.
- Audience filters/snapshot.
- Channels selected: SMS, email, both.
- Campaign type: initial, reminder, replacement, calendar change notice.
- Message template and rendered preview.
- Status: `draft`, `sending`, `sent`, `partially_failed`, `cancelled`.
- Counts by sent/failed/suppressed/no-contact.

Send behavior:

1. Robert selects event.
2. Robert selects responders or filters roster.
3. Robert chooses channels.
4. App shows message preview.
5. Robert clicks send.
6. App creates `event_invites` and `message_outbox` rows in a transaction.
7. App sends messages from the outbox with idempotency keys.
8. Delivery callbacks update message records.

Do not send to:

- inactive responders;
- opted-out channels;
- contacts with invalid phone/email for selected channel;
- members already accepted/assigned unless Robert explicitly chooses resend;
- contacts with `manual_only` preference unless Robert overrides for manual tracking.

Message content rules:

- Identify sender/team clearly.
- Include event title, date, start/end time, location, and role if relevant.
- Include one clear RSVP link.
- Keep SMS short enough to avoid unnecessary multi-segment messages.
- Include STOP/HELP language for SMS.
- Include plain-text email fallback.
- Do not expose other responders’ personal details.

Example SMS:

```text
Calabogie Safety: Rescue crew request for AISA Driving School, Sat May 23, 7:30am-5pm. RSVP: https://app.example.com/r/abc123 Reply STOP to opt out.
```

Example email subject:

```text
Rescue Team Request: AISA Driving School — Sat May 23
```

### 8.9 RSVP and Availability Flow

Responder opens a unique link and sees:

- Event title.
- Date/time/location.
- “You were invited as [name].”
- Buttons:
  - Accept.
  - Decline.
  - Cancel my accepted spot, if previously accepted.
  - Update availability / note.
  - Contact Robert.
- Optional note field.
- Optional partial availability fields.

State transitions:

```text
created -> invited
invited -> accepted
invited -> declined
invited -> availability_updated
accepted -> cancelled_by_member
accepted -> availability_updated
availability_updated -> accepted
availability_updated -> declined
accepted -> cancelled_by_manager
declined -> accepted, if event not locked and Robert allows changes
cancelled_by_member -> accepted, if event not locked and Robert allows changes
```

When a responder accepts:

- Set invite status to `accepted`.
- Create/update `event_assignments` row.
- Recalculate coverage.
- Create Robert notification.

When a responder declines:

- Set invite status to `declined`.
- Recalculate coverage.
- Create Robert notification.

When a responder cancels:

- Set invite status to `cancelled_by_member`.
- Set assignment status to `cancelled`.
- Recalculate coverage.
- If event becomes underfilled, create urgent Robert notification.
- Surface replacement candidates.

When a responder updates availability:

- Store availability window and note.
- Set status to `availability_updated` unless already accepted and only note changed.
- Create Robert notification.
- Do not count partial availability toward confirmed headcount unless Robert confirms it.

### 8.10 Robert Notification Center

Robert should not need to keep refreshing the dashboard to learn about important changes.

Required notification channels:

- In-app notification center, required.
- Optional email to Robert, configurable.
- Optional SMS to Robert for urgent changes, configurable.

Notification triggers:

- Calendar event created.
- Calendar event updated.
- Calendar event cancelled.
- Calendar sync failed.
- Calendar watch channel expiring or renewal failed.
- Responder accepted.
- Responder declined.
- Responder cancelled.
- Responder updated availability/note.
- Event became underfilled.
- Message send failed.
- SMS/email delivery failure.
- Responder opted out.

Severity levels:

- `info`: routine accept/decline, new imported event.
- `warning`: event underfilled, sync delayed, delivery failures.
- `urgent`: responder cancellation causes shortage, staffed event cancelled, event time changes after invitations sent.

Notification behavior:

- Every notification links to affected event/staff/campaign.
- Notifications can be marked read/unread.
- Duplicate notifications should be deduplicated or grouped by `dedupe_key`.
- Routine notifications should not spam Robert by SMS.
- Urgent notifications may be sent by SMS/email depending on Robert preferences.
- Do not automatically notify responders about calendar changes until Robert confirms the message and audience.

### 8.11 Replacement Candidate Dashboard

Replacement candidates are computed from the roster.

Eligible if:

- Active.
- Not already assigned/accepted for event.
- Not declined for same event unless Robert includes declined contacts.
- Has required role/qualification if filling structured requirement.
- Has at least one usable contact channel.
- Has not opted out of selected channel.

Sort suggestions by:

1. Required role/qualification match.
2. Contactability: SMS+email > SMS only > email only > manual-only.
3. Fairness: prefer people who have worked/contacted less recently when all else equal.
4. Last contacted older first.
5. Name.

Dashboard should show:

- Event short count.
- Required roles short.
- Suggested replacements.
- Quick-send replacement invitation button.
- Manual phone-call checkbox for manual-only members.

### 8.12 Attendance and Payroll Export

Attendance states:

- `scheduled`.
- `worked`.
- `no_show`.
- `cancelled_by_member`.
- `cancelled_by_manager`.
- `excused`.

Attendance fields:

- Event ID.
- Staff member ID.
- Scheduled start/end.
- Actual start/end.
- Hours worked.
- Pay rate.
- Pay code.
- Notes.
- Approved timestamp.

Payroll export CSV columns:

```text
event_date,event_title,staff_name,email,phone,attendance_status,scheduled_hours,actual_hours,pay_rate,total_pay,notes
```

MVP does not issue payment. It creates an export Robert can send to whoever handles pay.

### 8.13 Audit Log

Every important manager/system/responder action should create an audit log row:

- Created/edited/archived staff member.
- Imported contacts.
- Created/edited/cancelled event.
- Calendar source created/updated.
- Calendar sync detected event change.
- Robert reviewed calendar change.
- Sent campaign.
- Resent message.
- Responder accepted/declined/cancelled/updated availability.
- Manually changed response/assignment.
- Marked attendance.
- Exported payroll.
- Changed notification preferences.

Audit fields:

- Actor type: owner, responder_token, system, provider.
- Actor user ID where applicable.
- Action type.
- Entity type/id.
- Before/after summary.
- Timestamp.
- Request metadata where appropriate.

---

## 9. Non-Functional Requirements

### 9.1 Reliability

- Invitation actions must be idempotent so accidental double-clicks do not duplicate messages.
- Message sending must use an outbox table so failed sends can be retried.
- Webhook handlers must be idempotent because providers may retry events.
- Calendar sync must be idempotent because push notifications and polling can overlap.
- Cron/job routes must use locking or bounded idempotent work.
- The app must tolerate email/SMS/calendar provider failures and show failures clearly.
- The app must never delete staffing/payment history when staff members are archived.

### 9.2 Performance

- Dashboard pages should load in under 2 seconds for normal team sizes.
- Roster and event pages should support at least 500 responders without becoming unusable.
- Message sending should return quickly after outbox creation rather than blocking on every provider send.
- Mobile pages should avoid huge unpaginated tables.

### 9.3 Privacy and Security

- Store only the minimum personal information needed for staffing.
- Use HTTPS everywhere.
- Do not expose staff contact lists publicly.
- Do not expose roster or payroll exports to responders.
- Hash RSVP tokens at rest.
- Protect provider webhooks with signature verification or shared secrets.
- Store secrets in environment variables; never commit secrets.
- Maintain backups and manual export fallback.

### 9.4 Accessibility and Usability

- Mobile-first dashboard.
- Laptop-friendly table views.
- Large tap targets on phone.
- No hover-only primary actions.
- Clear date/time formatting with timezone.
- High contrast.
- Keyboard navigation.
- Plain-text email fallback.
- Click-to-call and click-to-email links where appropriate.

### 9.5 Operational Fallback

Because this supports safety staffing, include manual fallback mechanisms:

- Printable event roster.
- Exportable full contact list.
- Exportable event-specific call sheet.
- Clear display of last calendar sync and message status.
- Manual override ability for Robert to mark someone as accepted after a phone call.
- Reminder that the app is not live incident dispatch.

---

## 10. Recommended Architecture

### 10.1 Stack Summary

| Layer | Recommended Choice | Reason |
|---|---|---|
| Frontend | Next.js App Router, TypeScript, Tailwind, shadcn/ui | Fast to build, agent-friendly, deploys cleanly to Vercel |
| Hosting | Vercel | Preview/production deployments, route handlers, cron support |
| Auth + Database | Supabase Auth + Supabase Postgres | Managed Postgres, Auth, RLS, migrations |
| In-app updates | Supabase Realtime or lightweight polling fallback | Keeps dashboard notifications/status fresh while Robert has it open |
| Email | Resend, with Postmark as fallback option | Transactional email, domain verification, webhooks |
| SMS | Twilio Programmable Messaging | SMS delivery, STOP/HELP handling, webhook support |
| Calendar | Google Calendar API preferred; ICS fallback | Matches central calendar use case while allowing fallback |
| Validation | Zod | Runtime validation for forms/API/webhooks |
| Testing | Vitest + React Testing Library + Playwright | Unit, integration, and E2E coverage |
| Observability | Vercel logs + Supabase logs + optional Sentry | Error visibility |

### 10.2 High-Level Architecture

```text
                         +-----------------------------+
                         |       Robert Browser        |
                         | Phone or laptop dashboard   |
                         +--------------+--------------+
                                        |
                                        | HTTPS
                                        v
+-------------------+        +-----------------------------+        +--------------------+
| Central Calendar  |<------>| Next.js Route Handlers      |<------>| Supabase Postgres  |
| Google API / ICS  |        | Server Actions / API routes |        | Auth + RLS + SQL   |
+-------------------+        +--------------+--------------+        +--------------------+
                                        |
                 +----------------------+----------------------+
                 |                                             |
                 v                                             v
+------------------------+                         +-----------------------+
| Twilio SMS             |                         | Resend Email          |
| outbound + webhooks    |                         | outbound + webhooks   |
+-----------+------------+                         +-----------+-----------+
            |                                                  |
            v                                                  v
+------------------------+                         +-----------------------+
| Responder phone        |                         | Responder email inbox |
| SMS + RSVP link        |                         | Email + RSVP link     |
+------------------------+                         +-----------------------+
```

### 10.3 Frontend Route Structure

```text
app/
  (auth)/
    login/page.tsx
    callback/route.ts
  (dashboard)/
    layout.tsx
    page.tsx                         # overview dashboard
    notifications/page.tsx
    roster/page.tsx
    roster/import/page.tsx
    roster/[staffId]/page.tsx
    settings/roles/page.tsx
    settings/qualifications/page.tsx
    settings/calendar/page.tsx
    settings/notifications/page.tsx
    settings/integrations/page.tsx
    events/page.tsx
    events/new/page.tsx
    events/[eventId]/page.tsx
    events/[eventId]/invite/page.tsx
    events/[eventId]/replacements/page.tsx
    events/[eventId]/attendance/page.tsx
    payroll/page.tsx
  r/[token]/page.tsx                  # responder RSVP page
  api/
    webhooks/twilio/route.ts
    webhooks/resend/route.ts
    webhooks/google-calendar/route.ts
    jobs/drain-outbox/route.ts
    jobs/calendar-sync/route.ts
    jobs/renew-calendar-watch/route.ts
    jobs/poll-ics-feeds/route.ts
    exports/payroll/[eventId]/route.ts
```

### 10.4 Server-Side Modules

```text
lib/
  auth/
    get-session.ts
    require-owner.ts
  db/
    supabase-admin.ts
    supabase-server.ts
    types.ts
  calendar/
    google-client.ts
    ics-client.ts
    sync-events.ts
    watch.ts
    diff-events.ts
  notifications/
    create-manager-notification.ts
    preferences.ts
    realtime.ts
  messaging/
    render-templates.ts
    send-email.ts
    send-sms.ts
    outbox.ts
    provider-webhooks.ts
  roster/
    import-csv.ts
    normalize-contact.ts
    replacement-candidates.ts
  events/
    coverage.ts
    state-machine.ts
  payroll/
    export-csv.ts
  security/
    token.ts
    signatures.ts
  validation/
    schemas.ts
```

---

## 11. Data Model

### 11.1 Entity Overview

Core entities:

- `profiles`: Robert’s app user/profile.
- `crew_roles`: operational role labels.
- `qualifications`: configurable tags/skills/certifications.
- `staff_members`: responders/team members.
- `staff_contact_methods`: phone/email records and delivery health.
- `staff_roles`: many-to-many staff role assignments.
- `staff_qualifications`: many-to-many staff qualifications.
- `calendar_sources`: Google Calendar or ICS source definitions.
- `calendar_sync_runs`: sync execution records.
- `calendar_change_events`: detected additions/updates/cancellations.
- `events`: track events needing coverage.
- `event_requirements`: headcount/role/qualification requirements.
- `invitation_campaigns`: batch invitation sends.
- `event_invites`: one invite per staff member per event/campaign.
- `invite_response_history`: history of responder changes.
- `rsvp_tokens`: hashed responder link tokens.
- `event_assignments`: accepted/confirmed/waitlisted roster rows.
- `message_outbox`: pending/sent/failed SMS/email messages.
- `message_events`: provider delivery status callbacks.
- `manager_notifications`: Robert notification records.
- `notification_preferences`: Robert notification settings.
- `attendance_records`: actual worked records.
- `consent_records`: channel consent and opt-out history.
- `audit_log`: manager/system/responder audit events.

### 11.2 Suggested SQL Types

```sql
create type contact_channel as enum ('sms', 'email');
create type preferred_contact_method as enum ('sms', 'email', 'both', 'manual_only');
create type contact_status as enum ('unknown', 'valid', 'invalid', 'bounced', 'suppressed', 'opted_out');
create type consent_status as enum ('unknown', 'granted', 'denied', 'withdrawn');
create type event_status as enum ('draft', 'scheduled', 'inviting', 'underfilled', 'staffed', 'needs_review', 'locked', 'completed', 'cancelled');
create type event_source_type as enum ('manual', 'google_calendar', 'ics_feed');
create type calendar_sync_status as enum ('never_synced', 'syncing', 'healthy', 'failed', 'needs_reauth', 'disabled');
create type calendar_change_type as enum ('created', 'updated', 'cancelled', 'deleted', 'restored', 'source_missing');
create type campaign_status as enum ('draft', 'sending', 'sent', 'partially_failed', 'cancelled');
create type invite_status as enum ('created', 'invited', 'accepted', 'declined', 'cancelled_by_member', 'cancelled_by_manager', 'availability_updated', 'expired', 'waitlisted');
create type assignment_status as enum ('confirmed', 'waitlisted', 'cancelled', 'completed');
create type outbox_status as enum ('pending', 'sending', 'sent', 'failed', 'cancelled');
create type notification_severity as enum ('info', 'warning', 'urgent');
create type notification_status as enum ('unread', 'read', 'archived');
create type attendance_status as enum ('scheduled', 'worked', 'no_show', 'cancelled_by_member', 'cancelled_by_manager', 'excused');
```

### 11.3 Tables

#### `profiles`

```sql
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  email text not null unique,
  is_owner boolean not null default true,
  is_active boolean not null default true,
  phone_for_alerts text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

#### `crew_roles`

```sql
create table crew_roles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

#### `qualifications`

```sql
create table qualifications (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

#### `staff_members`

```sql
create table staff_members (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  first_name text,
  last_name text,
  preferred_contact preferred_contact_method not null default 'both',
  active boolean not null default true,
  notes text,
  imported_source text,
  created_by uuid references profiles(id),
  updated_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
```

#### `staff_contact_methods`

```sql
create table staff_contact_methods (
  id uuid primary key default gen_random_uuid(),
  staff_member_id uuid not null references staff_members(id) on delete cascade,
  channel contact_channel not null,
  value text not null,
  normalized_value text not null,
  is_primary boolean not null default true,
  status contact_status not null default 'unknown',
  consent consent_status not null default 'unknown',
  consent_source text,
  consented_at timestamptz,
  opted_out_at timestamptz,
  last_verified_at timestamptz,
  last_delivery_status text,
  last_delivery_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(channel, normalized_value)
);
```

#### `staff_roles`

```sql
create table staff_roles (
  staff_member_id uuid not null references staff_members(id) on delete cascade,
  role_id uuid not null references crew_roles(id) on delete cascade,
  is_primary boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  primary key (staff_member_id, role_id)
);
```

#### `staff_qualifications`

```sql
create table staff_qualifications (
  staff_member_id uuid not null references staff_members(id) on delete cascade,
  qualification_id uuid not null references qualifications(id) on delete cascade,
  notes text,
  expires_at date,
  created_at timestamptz not null default now(),
  primary key (staff_member_id, qualification_id)
);
```

#### `calendar_sources`

```sql
create table calendar_sources (
  id uuid primary key default gen_random_uuid(),
  source_type event_source_type not null check (source_type in ('google_calendar', 'ics_feed')),
  name text not null,
  google_calendar_id text,
  google_account_email text,
  ics_url_encrypted text,
  access_token_encrypted text,
  refresh_token_encrypted text,
  token_expires_at timestamptz,
  sync_token text,
  watch_channel_id text,
  watch_resource_id text,
  watch_expires_at timestamptz,
  status calendar_sync_status not null default 'never_synced',
  last_synced_at timestamptz,
  last_sync_error text,
  active boolean not null default true,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

#### `calendar_sync_runs`

```sql
create table calendar_sync_runs (
  id uuid primary key default gen_random_uuid(),
  calendar_source_id uuid not null references calendar_sources(id) on delete cascade,
  trigger_type text not null, -- manual | webhook | cron | startup
  status text not null, -- running | success | failed
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_count integer not null default 0,
  updated_count integer not null default 0,
  cancelled_count integer not null default 0,
  error_message text
);
```

#### `events`

```sql
create table events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  event_type text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  timezone text not null default 'America/Toronto',
  location text,
  status event_status not null default 'draft',
  source_type event_source_type not null default 'manual',
  calendar_source_id uuid references calendar_sources(id) on delete set null,
  source_event_id text,
  source_etag text,
  source_updated_at timestamptz,
  last_source_seen_at timestamptz,
  source_hash text,
  review_required boolean not null default false,
  required_headcount integer not null default 0 check (required_headcount >= 0),
  overbooking_policy text not null default 'allow_all', -- allow_all | waitlist_after_requirement
  manager_notes text,
  created_by uuid references profiles(id),
  updated_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  cancelled_at timestamptz,
  completed_at timestamptz,
  constraint valid_event_time check (ends_at > starts_at)
);
```

#### `calendar_change_events`

```sql
create table calendar_change_events (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references events(id) on delete cascade,
  calendar_source_id uuid references calendar_sources(id) on delete set null,
  source_event_id text,
  change_type calendar_change_type not null,
  changed_fields jsonb not null default '{}',
  before_snapshot jsonb,
  after_snapshot jsonb,
  requires_review boolean not null default false,
  reviewed_by uuid references profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
```

#### `event_requirements`

```sql
create table event_requirements (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  label text not null,
  required_count integer not null check (required_count >= 0),
  role_id uuid references crew_roles(id),
  qualification_id uuid references qualifications(id),
  notes text,
  created_at timestamptz not null default now()
);
```

#### `invitation_campaigns`

```sql
create table invitation_campaigns (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  created_by uuid references profiles(id),
  status campaign_status not null default 'draft',
  channels contact_channel[] not null,
  campaign_type text not null default 'initial', -- initial | reminder | replacement | calendar_change_notice
  audience_snapshot jsonb not null default '{}',
  sms_template text,
  email_subject text,
  email_template text,
  sent_count integer not null default 0,
  failed_count integer not null default 0,
  suppressed_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz
);
```

#### `event_invites`

```sql
create table event_invites (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  campaign_id uuid references invitation_campaigns(id) on delete set null,
  staff_member_id uuid not null references staff_members(id),
  status invite_status not null default 'created',
  selected_channels contact_channel[] not null,
  available_start_at timestamptz,
  available_end_at timestamptz,
  response_note text,
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(event_id, staff_member_id)
);
```

#### `invite_response_history`

```sql
create table invite_response_history (
  id uuid primary key default gen_random_uuid(),
  invite_id uuid not null references event_invites(id) on delete cascade,
  event_id uuid not null references events(id) on delete cascade,
  staff_member_id uuid not null references staff_members(id),
  old_status invite_status,
  new_status invite_status not null,
  available_start_at timestamptz,
  available_end_at timestamptz,
  response_note text,
  actor_type text not null, -- responder_token | owner | system
  created_at timestamptz not null default now()
);
```

#### `rsvp_tokens`

```sql
create table rsvp_tokens (
  id uuid primary key default gen_random_uuid(),
  invite_id uuid not null references event_invites(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
```

#### `event_assignments`

```sql
create table event_assignments (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  staff_member_id uuid not null references staff_members(id),
  invite_id uuid references event_invites(id),
  status assignment_status not null default 'confirmed',
  role_id uuid references crew_roles(id),
  role_label text,
  requirement_id uuid references event_requirements(id),
  counts_toward_headcount boolean not null default true,
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  cancellation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(event_id, staff_member_id)
);
```

#### `manager_notifications`

```sql
create table manager_notifications (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  severity notification_severity not null default 'info',
  status notification_status not null default 'unread',
  event_type text not null,
  title text not null,
  body text,
  event_id uuid references events(id) on delete cascade,
  staff_member_id uuid references staff_members(id) on delete set null,
  related_entity_type text,
  related_entity_id uuid,
  dedupe_key text,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  unique(profile_id, dedupe_key)
);
```

#### `notification_preferences`

```sql
create table notification_preferences (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  event_type text not null,
  in_app_enabled boolean not null default true,
  email_enabled boolean not null default false,
  sms_enabled boolean not null default false,
  minimum_sms_severity notification_severity not null default 'urgent',
  minimum_email_severity notification_severity not null default 'warning',
  quiet_hours_start time,
  quiet_hours_end time,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(profile_id, event_type)
);
```

#### `message_outbox`

```sql
create table message_outbox (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references invitation_campaigns(id) on delete set null,
  invite_id uuid references event_invites(id) on delete set null,
  manager_notification_id uuid references manager_notifications(id) on delete set null,
  staff_member_id uuid references staff_members(id),
  channel contact_channel not null,
  to_value text not null,
  subject text,
  body_text text not null,
  body_html text,
  provider text not null, -- twilio | resend | postmark
  provider_message_id text,
  idempotency_key text not null unique,
  status outbox_status not null default 'pending',
  attempt_count integer not null default 0,
  last_attempt_at timestamptz,
  next_attempt_at timestamptz,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
```

#### `message_events`

```sql
create table message_events (
  id uuid primary key default gen_random_uuid(),
  message_outbox_id uuid references message_outbox(id) on delete set null,
  provider text not null,
  provider_message_id text,
  event_type text not null,
  payload jsonb not null default '{}',
  received_at timestamptz not null default now(),
  unique(provider, provider_message_id, event_type, received_at)
);
```

#### `attendance_records`

```sql
create table attendance_records (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  staff_member_id uuid not null references staff_members(id),
  assignment_id uuid references event_assignments(id) on delete set null,
  status attendance_status not null default 'scheduled',
  scheduled_start timestamptz,
  scheduled_end timestamptz,
  actual_start timestamptz,
  actual_end timestamptz,
  actual_hours numeric(6,2),
  pay_rate numeric(10,2),
  pay_code text,
  notes text,
  approved_by uuid references profiles(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(event_id, staff_member_id)
);
```

#### `consent_records`

```sql
create table consent_records (
  id uuid primary key default gen_random_uuid(),
  staff_member_id uuid not null references staff_members(id) on delete cascade,
  contact_method_id uuid references staff_contact_methods(id) on delete set null,
  channel contact_channel not null,
  status consent_status not null,
  source text not null, -- import | verbal | web_form | sms_reply | admin_update
  captured_by uuid references profiles(id),
  captured_at timestamptz not null default now(),
  notes text,
  evidence jsonb not null default '{}'
);
```

#### `audit_log`

```sql
create table audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references profiles(id),
  actor_type text not null default 'owner', -- owner | responder_token | system | provider
  action text not null,
  entity_type text not null,
  entity_id uuid,
  summary text,
  before jsonb,
  after jsonb,
  request_id text,
  created_at timestamptz not null default now()
);
```

### 11.4 Indexes

```sql
create index idx_staff_members_active on staff_members(active);
create index idx_staff_contact_staff on staff_contact_methods(staff_member_id);
create index idx_staff_contact_channel_status on staff_contact_methods(channel, status, consent);
create index idx_staff_roles_role on staff_roles(role_id);
create index idx_staff_qualifications_qualification on staff_qualifications(qualification_id);
create index idx_calendar_sources_active on calendar_sources(active);
create index idx_calendar_sync_runs_source_started on calendar_sync_runs(calendar_source_id, started_at desc);
create index idx_events_starts_at on events(starts_at);
create index idx_events_status on events(status);
create index idx_events_source_event on events(calendar_source_id, source_event_id);
create index idx_calendar_change_events_event on calendar_change_events(event_id, created_at desc);
create index idx_event_invites_event_status on event_invites(event_id, status);
create index idx_invite_response_history_event on invite_response_history(event_id, created_at desc);
create index idx_event_assignments_event_status on event_assignments(event_id, status);
create index idx_manager_notifications_unread on manager_notifications(profile_id, status, created_at desc);
create index idx_outbox_status_next_attempt on message_outbox(status, next_attempt_at);
create index idx_attendance_event on attendance_records(event_id);
create index idx_audit_log_entity on audit_log(entity_type, entity_id);
```

---

## 12. Security Model

### 12.1 Dashboard Access

- All dashboard pages require authentication.
- All mutations run server-side.
- Server Actions must use `requireOwner()`.
- Do not rely on hiding buttons in UI.
- Do not expose Supabase service role key in the browser.
- Export routes require owner access.

### 12.2 Supabase RLS

Suggested policy model:

- `profiles`: Robert can read/update own profile.
- Staff/events/invites/assignments/attendance/notifications: authenticated owner can read/write.
- `message_outbox`, `message_events`, `calendar_sources`: server-only for writes; limited dashboard reads as needed.
- `audit_log`: owner can read; inserts from server-side functions only.
- RSVP token routes use server-side privileged access after validating token.

### 12.3 RSVP Token Security

Token generation:

- Generate 32 bytes of cryptographically random data.
- Encode URL-safe.
- Store only `sha256(token + server_pepper)` in `rsvp_tokens.token_hash`.
- Send raw token only in link.
- Compare tokens using constant-time comparison where practical.

RSVP endpoint rules:

- Token authorizes only one invite.
- Token cannot view other staff members.
- Token page shows limited event details and no full roster.
- Rate-limit repeated attempts.
- Expired/invalid tokens show a helpful “contact Robert” message.

### 12.4 Webhook Security

Twilio:

- Validate Twilio request signatures.
- Accept only expected paths and methods.
- Use idempotency keyed by Twilio message SID and event type.

Resend/Postmark:

- Verify webhook signature/secret.
- Store provider event ID where available.
- Handle delivered, bounced, complained, failed, and suppressed events.

Google Calendar:

- Validate channel ID/resource ID/token against active `calendar_sources`.
- Treat webhook as a change signal only.
- Run sync from trusted server-side Google client.
- Renew watch channels before expiration.

### 12.5 Secrets

Store these in Vercel environment variables:

```text
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SECRET_KEY=
SUPABASE_DB_URL=
APP_BASE_URL=
APP_SECRET_PEPPER=
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_MESSAGING_SERVICE_SID=
TWILIO_WEBHOOK_SECRET=
RESEND_API_KEY=
RESEND_WEBHOOK_SECRET=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_OAUTH_REDIRECT_URI=
GOOGLE_WEBHOOK_TOKEN=
CRON_SECRET=
```

Rules:

- Never prefix secrets with `NEXT_PUBLIC_` unless safe for browser exposure.
- Use separate preview and production credentials where possible.
- Rotate secrets after accidental exposure.
- Do not paste tokens into issue threads or agent prompts.

---

## 13. Compliance and Privacy Guardrails

This section is not legal advice; it is an engineering risk-control baseline.

### 13.1 Canadian Messaging Consent

Because the track is in Canada/Ontario and messages may be sent by email/text, the app should behave conservatively:

- Record consent for SMS and email separately.
- Identify sender in messages.
- Provide opt-out or preference management.
- Keep proof of consent/withdrawal in `consent_records`.
- Respect STOP/HELP behavior for SMS.
- Avoid non-urgent overnight SMS messages.
- Do not send marketing/promotional messages through this staffing tool.

### 13.2 Personal Information Handling

Engineering principles:

- Collect only data needed for scheduling and pay reporting.
- Do not collect SINs, banking information, or medical details in MVP.
- Limit access to Robert.
- Keep exports secure and time-limited where possible.
- Make privacy practices visible during opt-in/preference flow.
- Let staff request correction of phone/email/contact preferences.
- Keep archived staff records only as long as operational/pay history requires.

### 13.3 Opt-Out and Preference Rules

SMS:

- If provider reports STOP/opt-out, set contact method to `opted_out` and consent to `withdrawn`.
- Do not send future SMS unless provider reports START/UNSTOP or Robert records valid renewed consent.
- Maintain local opt-out state in addition to provider-level suppression.

Email:

- If email bounces permanently, set contact to `bounced` or `invalid`.
- If complaint/spam event occurs, set contact to `suppressed` and stop non-essential email.
- Include preference link where appropriate.

Manual-only:

- Members who do not consent to automated messages can remain in roster as `manual_only`.

---

## 14. Messaging Design

### 14.1 Providers

SMS provider:

- Twilio Messaging Service.
- Configure Canada-compliant sending number/type.
- Enable STOP/HELP handling.
- Configure inbound webhook at `/api/webhooks/twilio`.

Email provider:

- Resend with verified sending domain; Postmark fallback is acceptable.
- Configure DKIM/SPF/DMARC as required.
- Use clear sender identity, e.g. `Calabogie Safety <safety@notify.example.com>`.
- Configure delivery webhooks at `/api/webhooks/resend`.

### 14.2 Deliverability Notes

Because Robert reported messages landing in junk, do not use personal email accounts for batch operational messages. Use a verified domain and transactional email provider.

Email best practices:

- Send from a controlled domain.
- Configure SPF/DKIM/DMARC.
- Include plain-text content.
- Avoid URL shorteners.
- Avoid all-caps/overly promotional wording.
- Keep subject lines consistent and clear.
- Track bounces/complaints and suppress bad addresses.

SMS best practices:

- Identify sender.
- Keep messages short.
- Include link and STOP language.
- Respect opt-outs.
- Avoid late-night messages unless urgent.

### 14.3 Outbox Retry Policy

`message_outbox` retry schedule:

- Attempt 1: immediate.
- Attempt 2: after 2 minutes.
- Attempt 3: after 10 minutes.
- Attempt 4: after 1 hour.
- Stop after 4 attempts and mark failed.

Do not retry if:

- Contact opted out.
- Permanent bounce/suppression.
- Invalid phone/email.
- Event has been cancelled and message is not a cancellation notice.

### 14.4 Idempotency

Use idempotency keys like:

```text
event:{eventId}:staff:{staffId}:campaign:{campaignId}:channel:{sms|email}:template:{hash}
```

Before sending, check if a sent/pending outbox row already exists with that key.

---

## 15. Calendar Sync Design

### 15.1 Google Calendar OAuth Setup

Robert connects a calendar source:

1. Open Settings → Calendar.
2. Click **Connect Google Calendar**.
3. Complete OAuth.
4. Select the central track calendar from available calendars.
5. App performs initial full sync.
6. App registers a watch channel if permitted and production URL is available.
7. App stores sync token and watch metadata.

Required OAuth scopes:

- Prefer read-only calendar scope if the app only imports events.
- Use write scope only if the app must create/update Google Calendar events.

MVP recommendation: **read-only calendar sync** for central track authority events. Staffing data should remain in the app database, not in the calendar description.

### 15.2 ICS Feed Setup

If the calendar source is an ICS feed:

1. Robert enters a private/public ICS URL in Settings → Calendar.
2. App validates the feed can be fetched server-side.
3. App runs initial import.
4. App polls on a configured schedule.
5. App compares normalized event hashes to detect changes.

ICS warning text in UI:

```text
ICS feeds are not real-time. Updates appear after the next scheduled sync.
```

### 15.3 Import Logic

Import range:

- Default: 30 days ago to 180 days ahead.
- Manual sync can override range.

Mapping:

| Calendar field | App field |
|---|---|
| summary/title | `events.title` |
| description | `events.description` |
| location | `events.location` |
| start | `events.starts_at` |
| end | `events.ends_at` |
| etag/sequence/hash | `events.source_etag` / `events.source_hash` |
| updated/last-modified | `events.source_updated_at` |
| id/uid | `events.source_event_id` |

Change detection compares:

- Title.
- Description.
- Start time.
- End time.
- Location.
- Cancelled/status field.
- Source updated timestamp.
- Source etag/hash.

Conflict handling:

- If event has no invitations/assignments, update automatically.
- If invitations or assignments exist and title/location/time/status changed, set `review_required=true`, set status to `needs_review` unless cancelled, create `calendar_change_events` row, and notify Robert.
- If event is cancelled at source, mark local event `cancelled` but preserve history.

Example change diff:

```json
{
  "starts_at": {
    "before": "2026-06-13T11:30:00Z",
    "after": "2026-06-13T12:00:00Z"
  },
  "location": {
    "before": "Main Paddock",
    "after": "North Paddock"
  }
}
```

### 15.4 Push Notifications

Production path for Google Calendar:

- Register watch channel for events collection.
- Google sends POST to `/api/webhooks/google-calendar`.
- Handler validates headers and optional token.
- Handler records receipt and runs/enqueues incremental sync.
- Scheduled job renews watch before expiration.
- Scheduled fallback polling runs to catch missed webhooks.

Important behavior:

- A push notification is a signal, not the full changed event payload.
- The app must call Calendar API to retrieve changed event details.
- Ignore or safely handle initial `sync` notification.
- Watch channels expire and must be renewed.
- Webhook processing must be idempotent.

### 15.5 Incremental Sync

Use sync tokens where possible:

1. Initial import stores `nextSyncToken` in `calendar_sources.sync_token`.
2. Incremental sync sends the stored sync token.
3. Changed, created, and deleted/cancelled entries are processed into local event updates.
4. New `nextSyncToken` replaces previous token after final page.
5. If sync token is invalidated, run a full sync and reconcile carefully.

### 15.6 Robert Notifications After Calendar Changes

Notify Robert immediately for:

- Event cancellation.
- Date/time change after invitations have been sent.
- Date/time change for event with accepted responders.
- New event inside configured lookahead window.
- Sync failure lasting more than one scheduled interval.

Do not automatically notify responders until Robert confirms audience and message.

### 15.7 Staff Notifications After Calendar Changes

If a staffed event changes:

1. Show changed fields to Robert.
2. Offer actions:
   - Notify accepted only.
   - Notify all invited.
   - Notify no one yet.
   - Mark reviewed.
3. Create a calendar-change invitation campaign only after Robert confirms.
4. Use campaign type `calendar_change_notice`.
5. Log notification in campaign history.

---

## 16. UI Specification

### 16.1 Responsive Design Principles

The app is a responsive web app, not a native mobile app.

Phone-first requirements:

- Dashboard cards instead of dense tables.
- Sticky bottom action bar for critical event actions.
- Large tap targets, target minimum 44px.
- Searchable roster cards.
- Click-to-call and click-to-email links.
- No horizontal scrolling for core tasks.
- Alerts visible above the fold where possible.

Laptop requirements:

- Data-dense tables.
- Bulk selection.
- CSV import preview.
- Payroll export review.
- Richer filtering/sorting.

Test viewport widths:

- 360px.
- 390px.
- 430px.
- 1280px.
- 1440px.

### 16.2 Dashboard Home

Phone layout:

- Today/upcoming event cards.
- Underfilled events.
- Calendar changes needing review.
- Recent responder responses.
- Notification badge.
- Quick buttons: Add Staff, New Event, Sync Calendar.

Laptop layout:

- Upcoming events table.
- Underfilled events panel.
- Notifications panel.
- Message failures panel.
- Calendar sync status.

Widgets:

- Upcoming events next 30 days.
- Events underfilled.
- Calendar changes needing review.
- Recent cancellations.
- Pending no-response counts.
- Messages failed/bounced.
- Last calendar sync time.

### 16.3 Notification Center

Features:

- Unread notification list.
- Filter by event, severity, type, unread.
- Mark read/unread.
- Open related event/staff member.
- Review calendar change.
- Send follow-up notification campaign where relevant.

Notification card fields:

- Severity badge.
- Title.
- Short body.
- Timestamp.
- Related event/staff/campaign link.
- Primary action.

### 16.4 Roster Page

Phone layout:

- Search bar.
- Filter button.
- Staff cards with name, role, contact icons, active status.
- Quick action to call/text/email.

Laptop layout:

- Table with sortable columns.
- Bulk import/export actions.
- Filters sidebar.

Columns:

- Name.
- Primary role.
- Qualifications.
- Phone.
- Email.
- Preferred contact.
- Last worked.
- Consent/delivery health.
- Active status.

Actions:

- Add staff.
- Import CSV.
- Export roster.
- Archive/restore.
- Open detail page.

### 16.5 Staff Detail Page

Sections:

- Basic information.
- Roles.
- Qualifications.
- Contact methods.
- Consent records.
- General availability notes.
- Event history.
- Robert notes.
- Audit timeline.

### 16.6 Roles and Qualifications Pages

Requirements:

- List active/inactive roles.
- Add/edit/archive role.
- List active/inactive qualifications.
- Add/edit/archive qualification.
- Warn if role/qualification is used by existing staff or event requirements.
- Archive instead of deleting when used historically.

### 16.7 Calendar Page

Settings → Calendar:

- Connect Google Calendar.
- Add ICS feed.
- Show source status.
- Show last sync time.
- Manual sync button.
- Show last sync error.
- Show watch channel expiration if Google Calendar push is enabled.

### 16.8 Events Page

Phone layout:

- Upcoming event cards.
- Status badges.
- Short count highlighted.
- Review-required badge.

Laptop layout:

- Event table.
- Filters by source/status/date.
- Calendar sync controls.

Columns:

- Date.
- Event title.
- Source.
- Status.
- Required headcount.
- Accepted.
- Partial.
- Pending.
- Short.
- Calendar review required.

Actions:

- Sync calendar.
- New event.
- Open event.

### 16.9 Event Detail Page

Header:

- Title.
- Date/time/location.
- Source calendar/manual badge.
- Last source update.
- Status.
- Required vs accepted count.
- Underfilled/filled badge.

Banners:

- Calendar changed — review required.
- Event cancelled in source calendar.
- Event underfilled.
- Message failures.

Tabs:

- Overview.
- Invites.
- Accepted roster.
- Partial availability.
- Replacement candidates.
- Attendance/pay.
- Calendar changes.
- Message log.
- Audit.

### 16.10 Invite Page

Steps:

1. Select contacts.
2. Choose channels.
3. Preview message.
4. Send.
5. Show sent/failure summary.

Filters:

- Active only.
- Role.
- Qualification.
- Has SMS.
- Has email.
- Not already invited.
- Not declined.
- Last worked.
- Last contacted.

### 16.11 RSVP Page

Design:

- No login.
- Very simple layout.
- Phone-first.
- Large buttons.
- Confirmation screen after action.
- Robert contact link.

States:

- Valid token.
- Already accepted.
- Already declined.
- Partial availability submitted.
- Event changed after invite was sent.
- Event locked.
- Event cancelled.
- Token expired.

### 16.12 Attendance Page

Rows for accepted/assigned responders:

- Name.
- Scheduled status.
- Attendance status.
- Actual hours.
- Pay rate.
- Notes.
- Approved.

Actions:

- Mark all confirmed as worked.
- Edit individual hours.
- Export CSV.

---

## 17. API and Server Actions

### 17.1 Authenticated Server Actions

```text
createStaffMember(input)
updateStaffMember(staffId, input)
archiveStaffMember(staffId)
restoreStaffMember(staffId)
importRosterCsv(file)
exportRosterCsv()
createRole(input)
updateRole(roleId, input)
createQualification(input)
updateQualification(qualificationId, input)
createManualEvent(input)
updateEvent(eventId, input)
cancelEvent(eventId, reason)
connectGoogleCalendar()
createCalendarSource(input)
syncCalendarSource(calendarSourceId)
reviewCalendarChange(changeId, action)
createInvitationCampaign(eventId, input)
sendInvitationCampaign(campaignId)
manualSetInviteStatus(inviteId, status, note)
markAttendance(eventId, records)
updateNotificationPreferences(input)
markNotificationRead(notificationId)
```

Every action must:

1. Validate Robert’s session.
2. Check owner authorization.
3. Validate input with Zod.
4. Use a transaction where multiple rows are changed.
5. Write audit log where appropriate.
6. Return typed success/error response.

### 17.2 Public RSVP Routes

```text
GET  /r/[token]
POST /r/[token]
```

POST payload:

```json
{
  "action": "accept" | "decline" | "cancel" | "partial" | "update_note",
  "available_start_at": "optional ISO timestamp",
  "available_end_at": "optional ISO timestamp",
  "note": "optional responder note"
}
```

Rules:

- Validate token hash.
- Check expiry.
- Check event status.
- Update invite/assignment atomically.
- Add response history row.
- Recalculate coverage.
- Create Robert notification.
- Write audit row with actor type `responder_token`.
- Do not expose roster data.

### 17.3 Webhook Routes

```text
POST /api/webhooks/twilio
POST /api/webhooks/resend
POST /api/webhooks/google-calendar
```

Webhook requirements:

- Verify signature/secret.
- Parse payload with Zod.
- Persist event idempotently.
- Return 2xx quickly once persisted.
- Process expensive logic after persistence or in bounded jobs.

### 17.4 Job Routes

```text
GET /api/jobs/drain-outbox
GET /api/jobs/calendar-sync
GET /api/jobs/renew-calendar-watch
GET /api/jobs/poll-ics-feeds
```

Job requirements:

- Require `CRON_SECRET`.
- Process bounded batches.
- Be idempotent.
- Log counts.
- Avoid logging secrets.
- Create Robert notification on repeated failure.

---

## 18. Implementation Plan

### Phase 0 — Project Setup

Deliverables:

- GitHub repository.
- Next.js app with TypeScript.
- Tailwind/shadcn/ui.
- Supabase project.
- Vercel project connected to repo.
- Environment variables configured.
- Basic CI: lint, typecheck, unit tests.

Acceptance criteria:

- App deploys to Vercel.
- Login page loads.
- Protected dashboard redirects unauthenticated users.
- Local development can connect to Supabase.

### Phase 1 — Auth, Single-User Access, Database Schema

Deliverables:

- SQL migrations for core tables.
- Supabase Auth integration.
- Seed Robert owner profile.
- `requireOwner()` server helper.
- RLS enabled where appropriate.
- Audit log helper.

Acceptance criteria:

- Robert can log in.
- Unauthenticated users cannot access dashboard.
- RSVP route remains public but token-limited.
- Unauthorized Server Actions fail.

### Phase 2 — Roster, Roles, Qualifications

Deliverables:

- Roster list/detail/edit pages.
- Add/edit/archive team members.
- Role management.
- Qualification management.
- Contact normalization.
- CSV import preview and dedupe.
- Consent fields.
- Roster export.
- Mobile card view and laptop table view.

Acceptance criteria:

- Robert can add a responder manually.
- Robert can assign role/qualification.
- Robert can import sample contact CSV.
- Duplicate phone/email is detected.
- Archived staff does not appear in active invite filter.
- Export file contains active roster.
- Roster works on phone without horizontal scrolling.

### Phase 3 — Events, Calendar Sources, and Calendar Sync

Deliverables:

- Events CRUD.
- Manual event creation.
- Event requirements.
- Calendar source settings.
- Google OAuth connection.
- Manual calendar sync.
- Push webhook path for Google Calendar.
- Incremental sync with sync token.
- ICS polling fallback.
- Calendar conflict/change handling.

Acceptance criteria:

- Robert can create event manually.
- Robert can import central calendar events.
- Updating a calendar event updates local event if no staffing conflict.
- Updating a staffed/invited event creates review banner and Robert notification.
- Calendar cancellation does not delete history.
- Events dashboard shows last successful sync time.

### Phase 4 — Robert Notification Center

Deliverables:

- Notification table and creation helper.
- Notification center page.
- Dashboard notification badge.
- Notification preferences.
- In-app notifications for calendar changes, RSVP changes, underfilled events, and message failures.
- Optional SMS/email to Robert for urgent notifications.

Acceptance criteria:

- Robert receives notification when calendar event changes.
- Robert receives notification when responder accepts/declines/cancels.
- Robert receives urgent notification when cancellation causes shortage.
- Robert can mark notifications read.
- Notifications link to relevant event/staff context.

### Phase 5 — Invitations and RSVP

Deliverables:

- Campaign creation UI.
- Message templates.
- Twilio SMS integration.
- Email integration.
- Outbox table and sending logic.
- RSVP token generation.
- Public RSVP page.
- Delivery webhook handling.

Acceptance criteria:

- Robert can send test invite to test staff member.
- SMS and email include valid RSVP link.
- Responder can accept/decline/cancel/update availability without login.
- Dashboard updates invite status.
- Robert receives response notification.
- Duplicate send attempts do not send duplicates.
- STOP/bounce events suppress future sends.

### Phase 6 — Replacement Dashboard

Deliverables:

- Coverage calculation module.
- Underfilled event banner.
- Replacement candidate list.
- Replacement invitation flow.

Acceptance criteria:

- If accepted responder cancels, event becomes underfilled.
- Candidate list excludes already assigned/cancelled/opted-out members.
- Candidate list respects role/qualification requirements.
- Robert can send replacement invite.

### Phase 7 — Attendance and Payroll

Deliverables:

- Attendance page.
- Mark worked/no-show/cancelled/excused.
- Actual hours and pay rate fields.
- Payroll CSV export.

Acceptance criteria:

- Robert can mark all confirmed as worked.
- Robert can edit actual hours.
- CSV export matches required columns.
- Export action is audit logged.

### Phase 8 — Hardening and Launch

Deliverables:

- Playwright E2E tests.
- Error handling and loading states.
- Monitoring/logging.
- Backup/export procedure.
- Privacy/consent text.
- Production provider setup.
- Runbook.

Acceptance criteria:

- Critical E2E tests pass.
- Provider webhooks tested in preview and production.
- Calendar sync tested with event update and cancellation.
- Robert can perform full workflow from event import to pay export.
- Manual fallback contact export is available.

---

## 19. Validation and Test Plan

### 19.1 Unit Tests

Test modules:

- Phone/email normalization.
- CSV import parsing.
- Role/qualification assignment.
- Calendar event normalization.
- Calendar source diff/change classification.
- Coverage calculation.
- Candidate replacement filtering.
- RSVP state transitions.
- Message template rendering.
- Notification severity/deduplication.
- Token generation/hashing.
- Payroll export calculations.

Example tests:

- `coverage` returns short count 2 when required 8 and accepted 6.
- Cancelled assignment does not count as accepted.
- Opted-out SMS contact is excluded from SMS invite list.
- Duplicate email in CSV maps to existing staff member.
- Calendar time change after invites creates `needs_review` event.
- Responder cancellation after accepted creates urgent notification if event becomes underfilled.

### 19.2 Integration Tests

- Create staff member with role/contact/qualification.
- Import CSV and merge duplicate contact.
- Create event + campaign + invites in transaction.
- RSVP accept creates assignment.
- RSVP cancel updates assignment and event status.
- Calendar sync updates unstaffed event automatically.
- Calendar sync creates review notification for staffed event change.
- Webhook event updates outbox status idempotently.
- Manual Robert override creates audit log.

### 19.3 End-to-End Tests

Use Playwright:

1. Robert logs in.
2. Imports roster CSV.
3. Adds a responder manually with role and contact info.
4. Creates manual event “Enduro Event.”
5. Connects/imports from test calendar.
6. Simulates calendar time change.
7. Verifies notification and review banner.
8. Sets required headcount to 6.
9. Selects 8 responders.
10. Sends email-only mock campaign.
11. Opens RSVP link as responder and accepts.
12. Opens another RSVP link and declines.
13. Dashboard shows accepted/declined/pending counts.
14. Accepted responder cancels.
15. Dashboard shows underfilled and replacement candidates.
16. Robert sends replacement invite.
17. Robert marks attendance and exports payroll CSV.

### 19.4 Provider Tests

Twilio:

- Validate outbound payload.
- Validate signature verification.
- Simulate STOP/START/HELP inbound messages.
- Simulate delivery failed status.

Email:

- Verify send API payload.
- Verify webhook signature.
- Simulate delivered/bounced/complained events.

Google Calendar:

- Use test calendar.
- Import single event.
- Update event time.
- Cancel event.
- Test push webhook.
- Test watch renewal job.
- Test fallback polling path.

ICS:

- Import sample feed.
- Update sample event hash.
- Remove event from feed and verify conservative source-missing behavior.

### 19.5 Security Tests

- Unauthenticated dashboard access redirects to login.
- RSVP token cannot access roster.
- Expired token cannot update invite.
- Invalid webhook signature is rejected.
- Service role key is not exposed to browser bundle.
- RLS prevents anonymous reads from staff tables.
- CSV import/export escapes spreadsheet formulas.

### 19.6 Responsive UI Tests

- Roster page works at 360px, 390px, 430px, 1280px, and 1440px widths.
- Event detail page exposes same critical actions on phone and laptop.
- Notification center works by touch and keyboard.
- No primary workflow depends on hover-only controls.
- Tables collapse into cards or scroll-safe layouts on phone.

### 19.7 Launch Acceptance Scenario

Use real-world sample events from the current track season:

- Multimatic event around May 20, 2026.
- AISA driving school on May 23–24, 2026.
- Enduro/race event on June 13–14, 2026.

Launch candidate is ready when Robert can:

1. Import or create a small roster.
2. Add/edit a team member and role.
3. Sync/import sample events.
4. Receive notification from simulated calendar update.
5. Send controlled test invitation to Mithun and Robert.
6. See RSVP status update.
7. Fill a shortage with replacement workflow.
8. Mark attendance.
9. Export pay CSV.
10. Export fallback roster/call sheet.

---

## 20. Operational Runbook

### 20.1 Before an Event

1. Check dashboard notifications.
2. Check calendar sync status.
3. Sync/review calendar if needed.
4. Open event.
5. Confirm date/time/location/headcount.
6. Select responders.
7. Preview message.
8. Send invitations.
9. Monitor accepted count and notifications.
10. Send reminders or replacements if short.
11. Print/export roster before event day.

### 20.2 Day of Event

1. Use printed roster as fallback.
2. Mark attendance during/after event.
3. Note cancellations/no-shows.
4. Avoid relying on app for live incident dispatch.

### 20.3 After Event

1. Confirm actual attendance.
2. Enter actual hours/rates.
3. Export payroll CSV.
4. Mark event complete.
5. Archive notes needed for staffing history.

### 20.4 Failure Modes

| Failure | Expected Handling |
|---|---|
| Email lands in junk | Use SMS fallback; maintain verified domain; show delivery status |
| SMS provider outage | Use email/manual phone fallback; export call sheet |
| Calendar event changes after invites sent | Mark event needs review, notify Robert, require review before responder notification |
| Calendar sync fails | Existing local events remain; show last sync time/error; notify Robert after repeated failure |
| ICS feed is stale | Show last sync time; treat as delayed source, not real-time source |
| App unavailable | Use exported roster/call sheet |
| Member opts out | Stop automated sends; keep manual-only contact option |
| Duplicate invite click | Idempotent state transition; no duplicate assignment |
| Event cancelled | Notify Robert; let Robert choose staff notification audience; keep history |

---

## 21. Agent Development Instructions

An implementation agent should follow these rules:

1. Read this spec before making code changes.
2. Treat Robert-only dashboard access as an MVP requirement.
3. Keep all schema changes in migrations.
4. Do not send real SMS/email in tests or preview unless explicitly configured.
5. Use test providers/mocks by default.
6. Never expose service keys to client components.
7. Every mutation must validate auth, role/owner access, and input.
8. Every important mutation must write an audit log row.
9. Every message send must use outbox/idempotency.
10. Calendar sync must be idempotent.
11. Calendar updates must create Robert notifications when operationally meaningful.
12. RSVP changes must create Robert notifications.
13. Keep responder RSVP pages minimal and public-data-safe.
14. Preserve history; archive instead of deleting staff/events whenever possible.
15. Add or update tests for every workflow change.
16. Prefer simple, readable implementation over clever automation.
17. After each phase, produce a concise implementation note: changed files, migrations, tests, and manual validation steps.

---

## 22. Initial Seed Data for Development

Create sample roles:

```text
Incident Lead
Rescue Crew
Truck Driver
Medical/First Aid
Tow/Recovery
```

Create sample qualifications:

```text
Fire Suppression
Extrication
First Aid
Medical
Tow/Recovery
Driver
```

Create sample events:

```text
Multimatic Track Event — May 20, 2026
AISA Driving School — May 23–24, 2026
Enduro Race Event — June 13–14, 2026
```

Create sample responders with fake contact info only in development.

---

## 23. Open Questions for Review

1. What is the track’s preferred sender name and domain?
2. Should staff be called responders, crew, safety team, or something else?
3. What operational roles actually matter for staffing decisions?
4. Which qualifications/certifications need expiry tracking?
5. Is simple headcount enough, or does every event need minimum role counts?
6. Is the central track calendar a Google Calendar Robert can access, or only an ICS/public feed?
7. Who owns the central calendar, and can the app be granted access without Robert’s personal Google account?
8. How quickly must calendar changes appear in practice: near-real-time, within 15 minutes, hourly, or daily?
9. Which Robert notifications should be SMS/email versus in-app only?
10. Should accepted responders be automatically confirmed, or should Robert manually confirm them?
11. Should extra accepted responders be allowed or waitlisted?
12. What pay rules are needed: flat day rate, hourly, role-based, mileage, per-diem?
13. Does Robert need one-click reminders before events?
14. How should consent be gathered for existing team members?
15. How long should staffing/payment history be retained?
16. Is Robert-only expected long term, or should a second manager/accounting user be planned soon?
17. What is the manual fallback procedure if the app is down on race day?

---

## 24. Reference Links to Re-Verify Before Build

These sources should be re-checked during implementation because platform details and compliance rules can change.

- Next.js App Router: https://nextjs.org/docs/app
- Next.js Route Handlers: https://nextjs.org/docs/app/getting-started/route-handlers
- Next.js Server Functions / mutating data: https://nextjs.org/docs/app/getting-started/mutating-data
- Vercel deployments: https://vercel.com/docs/deployments
- Vercel environment variables: https://vercel.com/docs/environment-variables
- Vercel Cron Jobs: https://vercel.com/docs/cron-jobs
- Vercel Cron Jobs usage and pricing: https://vercel.com/docs/cron-jobs/usage-and-pricing
- Supabase Auth with Next.js: https://supabase.com/docs/guides/auth/quickstarts/nextjs
- Supabase Row Level Security: https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase Realtime Postgres changes: https://supabase.com/docs/guides/realtime/postgres-changes
- Google Calendar synchronization / sync tokens: https://developers.google.com/workspace/calendar/api/guides/sync
- Google Calendar push notifications: https://developers.google.com/workspace/calendar/api/guides/push
- Google Calendar OAuth quickstart: https://developers.google.com/workspace/calendar/api/quickstart/js
- Twilio Canada SMS guidelines: https://www.twilio.com/en-us/guidelines/ca/sms
- Twilio Advanced Opt-Out: https://www.twilio.com/docs/messaging/tutorials/advanced-opt-out
- Resend Send Email API: https://resend.com/docs/api-reference/emails/send-email
- Resend Webhooks: https://resend.com/docs/webhooks/introduction
- Resend Domain Verification: https://resend.com/docs/dashboard/domains/introduction
- CRTC CASL requirements: https://crtc.gc.ca/eng/internet/anti/reg.htm
- Office of the Privacy Commissioner of Canada — PIPEDA requirements: https://www.priv.gc.ca/en/privacy-topics/privacy-laws-in-canada/the-personal-information-protection-and-electronic-documents-act-pipeda/pipeda_brief/
- OPC workplace privacy guidance: https://www.priv.gc.ca/en/privacy-topics/employers-and-employees/02_05_d_17/

---

## 25. MVP Definition of Done

The MVP is considered complete when:

- Robert can log in securely as the sole dashboard user.
- Robert can add/import/edit/archive team members.
- Robert can manage roles and qualifications.
- Robert can store phone, email, contact preference, consent, and notes.
- Robert can sync/import central calendar events or create manual events.
- Robert can see last-sync status and calendar change/cancellation notifications.
- Robert can set required headcount and optional role/qualification requirements.
- Robert can invite selected responders by SMS/email.
- Responders can accept/decline/cancel/update availability via link without accounts.
- Robert receives notifications for RSVP updates and shortages.
- Robert can see staffing status and replacement candidates.
- Robert can mark attendance and export pay CSV.
- Opt-outs/bounces are respected.
- Critical actions are audit logged.
- Dashboard is usable on phone and laptop.
- Offline roster/event exports are available.
- Basic tests and E2E happy path pass.

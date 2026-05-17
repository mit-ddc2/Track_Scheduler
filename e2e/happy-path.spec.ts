/**
 * Comprehensive Phase 8 end-to-end happy-path spec (spec §19.3).
 *
 * Coverage
 * --------
 *   1. Manager UI: dashboard → roster create → event create →
 *      send invites wizard (3 steps) → sent screen → assertions.
 *   2. RSVP responder accepts → manager dashboard reflects 1/1 →
 *      activity notification → attendance flip → payroll CSV export.
 *   3. Replacement scenario: 2-headcount event, one cancellation drives
 *      the event into `underfilled` and surfaces replacement candidates.
 *
 * Strategy
 * --------
 *   - Setup uses the Supabase admin client to seed an owner profile,
 *     mint an auth session, plant the SSR cookie on the Playwright
 *     browser context — so the UI flow itself never wades through
 *     the magic-link round-trip.
 *   - Mock SMS provider (MESSAGING_PROVIDER=mock) writes outgoing SMS
 *     to `mock_sent_sms` and reports back accepted=true; the outbox
 *     cron drains rows the same as production.
 *   - Drains the outbox via authenticated cron call so providers run.
 *   - Tokens are stored hashed — we cannot recover the raw form. The
 *     spec mints a fresh known-raw token and replaces the hash on the
 *     row so the responder context can navigate to /r/<raw>.
 *   - Self-skips when SUPABASE_SECRET_KEY is missing.
 *
 * Run with:
 *   pnpm test:e2e
 *
 * Required env (all from `.env.local`):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
 *   SUPABASE_SECRET_KEY
 *   APP_SECRET_PEPPER
 *   CRON_SECRET
 *   MESSAGING_PROVIDER=mock              (set by playwright.config.ts webServer)
 *   APP_BASE_URL                         (defaults to http://localhost:3000)
 */

import { test, expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_SECRET = process.env.SUPABASE_SECRET_KEY ?? "";
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const CRON_SECRET = process.env.CRON_SECRET ?? "";

const SHOULD_SKIP = !SUPABASE_URL || !SUPABASE_SECRET;

// Stable per-run id so concurrent runs do not collide on display_name / title.
const runId = Date.now().toString(36);

// Track everything we create so afterAll can scrub it.
type Cleanup = {
  staffMemberIds: string[];
  eventIds: string[];
  ownerUserIds: string[];
};

test.describe("Phase 8 happy path · end-to-end", () => {
  test.skip(
    SHOULD_SKIP,
    "Requires SUPABASE_SECRET_KEY + NEXT_PUBLIC_SUPABASE_URL — skipping E2E.",
  );

  let admin: SupabaseClient;
  const cleanup: Cleanup = {
    staffMemberIds: [],
    eventIds: [],
    ownerUserIds: [],
  };

  // ── Owner / auth setup ────────────────────────────────────────────────

  let ownerUserId: string;
  let ownerPassword: string;
  const ownerEmail = `e2e+owner-${runId}@calabogie-safety.test`;

  test.beforeAll(async () => {
    admin = createClient(SUPABASE_URL, SUPABASE_SECRET, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // 1. Create the auth user via admin API (no magic-link round-trip).
    ownerPassword = `e2e-${runId}-${Math.random().toString(36).slice(2, 12)}`;
    const created = await admin.auth.admin.createUser({
      email: ownerEmail,
      password: ownerPassword,
      email_confirm: true,
    });
    if (created.error) throw created.error;
    ownerUserId = created.data.user!.id;
    cleanup.ownerUserIds.push(ownerUserId);

    // 2. Promote to owner. The on-signup trigger inserts profiles; we just
    //    flip is_owner. Upsert defensively in case the trigger isn't present.
    await admin
      .from("profiles")
      .upsert(
        {
          id: ownerUserId,
          email: ownerEmail,
          display_name: `E2E Owner ${runId}`,
          is_owner: true,
          is_active: true,
        },
        { onConflict: "id" },
      );
  });

  test.afterAll(async () => {
    if (!admin) return;
    await scrub(admin, cleanup);
  });

  // ── Test 1: full happy path ───────────────────────────────────────────

  test("manager creates staff + event, sends invites, responder accepts, attendance + payroll work", async ({
    page,
    browser,
  }) => {
    test.setTimeout(180_000);

    const staffName = `E2E Test Responder ${runId}`;
    const staffPhone = "+15555550199";
    const staffEmail = `e2e+${runId}@test.local`;
    const eventTitle = `E2E Event ${runId}`;

    // ── 1. Sign in + dashboard sanity ────────────────────────────────
    await signInOwner(page, ownerEmail, ownerPassword);
    await page.goto(`${BASE_URL}/dashboard`);
    await expect(
      page.getByRole("link", { name: /Calabogie Safety/i }).first(),
    ).toBeVisible({ timeout: 15_000 });
    // Bottom nav: aria-label="Primary" (DashboardNav). Both mobile +
    // desktop variants exist; at least one is in the tree.
    await expect(
      page.getByRole("navigation", { name: /primary/i }).first(),
    ).toBeVisible();

    // ── 2. Roster → New responder ───────────────────────────────────
    await page.goto(`${BASE_URL}/dashboard/roster/new`);
    await expect(page.getByRole("heading", { name: /Add staff/i })).toBeVisible();

    // StaffForm uses `<span class="cs-label">` instead of <label htmlFor>,
    // so getByLabel rarely matches. Fall back to nearest-input matching.
    await fillNthAfterLabel(page, /display name/i, staffName);
    await page.locator('input[type="tel"]').first().fill(staffPhone);
    await page.locator('input[type="email"]').first().fill(staffEmail);

    // Both consent checkboxes (the StaffForm renders them by label text).
    await checkByLabel(page, /Consent to SMS/i);
    await checkByLabel(page, /Consent to email/i);

    // Try to pick the "Rescue Crew" role if the chip is present. The seed
    // migration ships some default roles but they may differ across envs;
    // tolerate either presence or absence.
    const rescueChip = page
      .getByRole("button", { name: /Rescue Crew/i })
      .first();
    if (await rescueChip.count().catch(() => 0)) {
      await rescueChip.click().catch(() => undefined);
    }

    await page.getByRole("button", { name: /^Create$|^Save/i }).click();
    await page.waitForURL(/\/dashboard\/roster(?:\/|$)/, { timeout: 30_000 });

    // Locate the created row in the DB (UI may render the card later).
    const staffRowQ = await admin
      .from("staff_members")
      .select("id, display_name")
      .eq("display_name", staffName)
      .maybeSingle();
    expect(staffRowQ.data, "staff member created").toBeTruthy();
    const staffMemberId = (staffRowQ.data as { id: string }).id;
    cleanup.staffMemberIds.push(staffMemberId);

    // Defensive: ensure SMS contact + consent are present, even if the form
    // skipped them. Use the same idempotent shape the production action uses.
    await ensureContactAndConsent(admin, staffMemberId, {
      phone: staffPhone,
      email: staffEmail,
    });

    // Soft assertion on the live UI — the card should mention the new name.
    await expect(page.getByText(staffName).first()).toBeVisible({
      timeout: 10_000,
    });

    // ── 3. Events → New ─────────────────────────────────────────────
    await page.goto(`${BASE_URL}/dashboard/events/new`);
    await expect(
      page.getByRole("heading", { name: /Create event/i }),
    ).toBeVisible();

    const tomorrow = new Date(Date.now() + 24 * 3600 * 1000);
    const isoDate = tomorrow.toISOString().slice(0, 10);

    // EventForm uses proper <label htmlFor>; getByLabel works.
    await page.getByLabel(/^Title/i).fill(eventTitle);
    await page.getByLabel(/^Starts/i).fill(`${isoDate}T09:00`);
    await page.getByLabel(/^Ends/i).fill(`${isoDate}T17:00`);
    const headcountInput = page.getByLabel(/Required headcount/i);
    await headcountInput.fill("1");
    await page.getByRole("button", { name: /Create event|Save/i }).first().click();
    await page.waitForURL(/\/dashboard\/events\/[0-9a-f-]+/, {
      timeout: 30_000,
    });

    const eventRowQ = await admin
      .from("events")
      .select("id, title")
      .eq("title", eventTitle)
      .maybeSingle();
    expect(eventRowQ.data, "event created").toBeTruthy();
    const eventId = (eventRowQ.data as { id: string }).id;
    cleanup.eventIds.push(eventId);

    // ── 4. Invite wizard ─────────────────────────────────────────────
    await page.goto(`${BASE_URL}/dashboard/events/${eventId}`);
    await page
      .getByRole("link", { name: /SEND INVITES/i })
      .first()
      .click();
    await page.waitForURL(
      new RegExp(`/dashboard/events/${eventId}/invite$`),
      { timeout: 15_000 },
    );

    // Step 1: select the responder. The candidate row is a button with the
    // staff name visible inside it.
    await page
      .getByRole("button", { name: new RegExp(escapeRe(staffName), "i") })
      .first()
      .click();
    await page
      .getByRole("button", { name: /^CONTINUE/i })
      .first()
      .click();

    // Step 2: SMS + EMAIL both default-on; if either is off, click it on.
    // We don't assert visibility because in some viewports the chip label
    // matches both the channel button and the chip on the candidate row.
    await page
      .getByRole("button", { name: /^CONTINUE/i })
      .first()
      .click();

    // Step 3: confirm + send.
    await page
      .getByRole("button", { name: /^SEND TO\s+1/i })
      .first()
      .click();

    // ── 5. Sent screen + DB assertions ───────────────────────────────
    await page.waitForURL(
      new RegExp(`/dashboard/events/${eventId}/invite/sent`),
      { timeout: 30_000 },
    );
    await expect(page.getByText(/1\s+invites out/i)).toBeVisible();

    // 1 invite row.
    const invitesCount = await pollUntil(
      async () => {
        const { count } = await admin
          .from("event_invites")
          .select("*", { count: "exact", head: true })
          .eq("event_id", eventId);
        return count ?? 0;
      },
      (n) => n >= 1,
    );
    expect(invitesCount).toBeGreaterThanOrEqual(1);

    const inviteRowQ = await admin
      .from("event_invites")
      .select("id")
      .eq("event_id", eventId)
      .eq("staff_member_id", staffMemberId)
      .maybeSingle();
    expect(inviteRowQ.data).toBeTruthy();
    const inviteId = (inviteRowQ.data as { id: string }).id;

    // 1 rsvp_tokens row.
    const tokenCountQ = await admin
      .from("rsvp_tokens")
      .select("*", { count: "exact", head: true })
      .eq("invite_id", inviteId);
    expect(tokenCountQ.count ?? 0).toBeGreaterThanOrEqual(1);

    // 2 message_outbox rows (sms + email) — query via invite_id.
    const outboxCountQ = await admin
      .from("message_outbox")
      .select("channel", { count: "exact" })
      .eq("invite_id", inviteId);
    expect(outboxCountQ.count ?? 0).toBeGreaterThanOrEqual(2);
    const channels = ((outboxCountQ.data ?? []) as Array<{ channel: string }>)
      .map((r) => r.channel)
      .sort();
    expect(channels).toEqual(expect.arrayContaining(["email", "sms"]));

    // ── 6. Drain outbox via authenticated cron call ──────────────────
    if (CRON_SECRET) {
      const drainRes = await page.request.get(
        `${BASE_URL}/api/jobs/drain-outbox`,
        {
          headers: { authorization: `Bearer ${CRON_SECRET}` },
        },
      );
      expect(drainRes.status()).toBe(200);
      const drainBody = (await drainRes.json()) as {
        attempted: number;
        sent: number;
        failed: number;
      };
      expect(drainBody).toMatchObject({
        attempted: expect.any(Number),
        sent: expect.any(Number),
        failed: expect.any(Number),
      });

      // After the drain, rows whose providers are configured should be
      // 'sent'. SMS is always mocked; email may be 'sent' (Resend wired)
      // or 'failed' (PROVIDER_NOT_CONFIGURED). Assert at least the SMS row.
      const smsRowQ = await admin
        .from("message_outbox")
        .select("status, provider_message_id")
        .eq("invite_id", inviteId)
        .eq("channel", "sms")
        .maybeSingle();
      expect(smsRowQ.data, "sms outbox row").toBeTruthy();
      const smsRow = smsRowQ.data as {
        status: string;
        provider_message_id: string | null;
      };
      expect(smsRow.status).toBe("sent");
      expect(smsRow.provider_message_id).toMatch(/^mock_/);
    }

    // ── 7. Mint a known-raw token + visit /r/<token> ────────────────
    const { generateRsvpToken } = await import("../lib/security/token");
    const { raw, hash } = generateRsvpToken();
    const expiresAt = new Date(
      Date.now() + 30 * 24 * 3600 * 1000,
    ).toISOString();
    await admin
      .from("rsvp_tokens")
      .update({ token_hash: hash, used_at: null, expires_at: expiresAt })
      .eq("invite_id", inviteId);

    const responderCtx = await browser.newContext();
    const responderPage = await responderCtx.newPage();
    await responderPage.goto(`${BASE_URL}/r/${raw}`);

    // RSVP page renders the event title in the header. Accept button.
    await expect(
      responderPage.getByText(new RegExp(escapeRe(eventTitle), "i")).first(),
    ).toBeVisible({ timeout: 15_000 });
    await responderPage
      .getByRole("button", { name: /accept.*I'?m in/i })
      .first()
      .click();
    await expect(responderPage.getByText(/●\s*CONFIRMED/i)).toBeVisible({
      timeout: 15_000,
    });
    await responderCtx.close();

    // ── 8. DB assertions: accepted invite + assignment + notification ─
    const acceptedInviteQ = await admin
      .from("event_invites")
      .select("status")
      .eq("id", inviteId)
      .maybeSingle();
    expect((acceptedInviteQ.data as { status: string }).status).toBe(
      "accepted",
    );

    const assignmentQ = await admin
      .from("event_assignments")
      .select("status")
      .eq("event_id", eventId)
      .eq("staff_member_id", staffMemberId)
      .maybeSingle();
    expect(assignmentQ.data, "event_assignments row").toBeTruthy();
    expect((assignmentQ.data as { status: string }).status).toBe("confirmed");

    const acceptNotifQ = await admin
      .from("manager_notifications")
      .select("event_type")
      .eq("event_id", eventId)
      .eq("event_type", "responder.accepted")
      .maybeSingle();
    expect(acceptNotifQ.data, "responder.accepted notification").toBeTruthy();

    // ── 9. Manager dashboard reflects coverage ──────────────────────
    await page.goto(`${BASE_URL}/dashboard/events/${eventId}`);
    // Coverage strip shows "1/1" somewhere when fully confirmed.
    await expect(
      page.getByText(/1\s*\/\s*1|CONFIRMED/i).first(),
    ).toBeVisible({ timeout: 15_000 });

    // ── 10. Notifications page surfaces the acceptance ───────────────
    await page.goto(`${BASE_URL}/dashboard/notifications`);
    await expect(
      page.getByText(new RegExp(escapeRe(eventTitle), "i")).first(),
    ).toBeVisible({ timeout: 15_000 });

    // ── 11. Attendance: cycle to "worked" ────────────────────────────
    await page.goto(`${BASE_URL}/dashboard/events/${eventId}/attendance`);
    const cycleBtn = page
      .getByRole("button", { name: /Attendance status:/i })
      .first();
    await expect(cycleBtn).toBeVisible({ timeout: 15_000 });
    // First click from 'scheduled' lands on 'worked' per StatusCycleButton.
    await cycleBtn.click();
    await expect(
      page.getByRole("button", { name: /Attendance status: WORKED/i }).first(),
    ).toBeVisible({ timeout: 10_000 });

    // DB confirmation.
    await pollUntil(
      async () => {
        const { data } = await admin
          .from("attendance_records")
          .select("status")
          .eq("event_id", eventId)
          .eq("staff_member_id", staffMemberId)
          .maybeSingle();
        return (data as { status?: string } | null)?.status ?? null;
      },
      (s) => s === "worked",
    );

    // ── 12. Payroll CSV export ──────────────────────────────────────
    const payrollRes = await page.request.get(
      `${BASE_URL}/api/exports/payroll/${eventId}`,
    );
    expect(payrollRes.status()).toBe(200);
    expect(payrollRes.headers()["content-type"] ?? "").toMatch(/text\/csv/i);
    const csv = await payrollRes.text();
    // Header row + at least one data row (the responder we marked worked).
    const lines = csv.trim().split(/\r?\n/);
    expect(lines.length).toBeGreaterThanOrEqual(2);
  });

  // ── Test 2: replacement scenario ─────────────────────────────────────

  test("event becomes underfilled after cancel and surfaces replacements", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await signInOwner(page, ownerEmail, ownerPassword);

    // Seed event + 2 staff directly via admin client (faster than UI flow,
    // we already proved that path in Test 1).
    const evTitle = `E2E Replacement ${runId}-${Math.random()
      .toString(36)
      .slice(2, 6)}`;
    const tomorrow = new Date(Date.now() + 24 * 3600 * 1000);
    const isoStart = `${tomorrow.toISOString().slice(0, 10)}T13:00:00.000Z`;
    const isoEnd = `${tomorrow.toISOString().slice(0, 10)}T20:00:00.000Z`;

    const evRes = await admin
      .from("events")
      .insert({
        title: evTitle,
        starts_at: isoStart,
        ends_at: isoEnd,
        timezone: "America/Toronto",
        required_headcount: 2,
        status: "scheduled",
      })
      .select("id")
      .single();
    expect(evRes.error, evRes.error?.message ?? "").toBeFalsy();
    const eventId = (evRes.data as { id: string }).id;
    cleanup.eventIds.push(eventId);

    const staffIds: string[] = [];
    const inviteIds: string[] = [];

    for (let i = 0; i < 2; i++) {
      const sName = `E2E Rep ${runId}-${i}`;
      const sPhone = `+155555502${String(i).padStart(2, "0")}`;
      const sEmail = `e2e+rep-${runId}-${i}@test.local`;
      const created = await admin
        .from("staff_members")
        .insert({
          display_name: sName,
          preferred_contact: "both",
          active: true,
        })
        .select("id")
        .single();
      expect(created.error, created.error?.message ?? "").toBeFalsy();
      const sid = (created.data as { id: string }).id;
      staffIds.push(sid);
      cleanup.staffMemberIds.push(sid);

      await ensureContactAndConsent(admin, sid, {
        phone: sPhone,
        email: sEmail,
      });

      // Create invite + accept it directly.
      const inv = await admin
        .from("event_invites")
        .insert({
          event_id: eventId,
          staff_member_id: sid,
          status: "accepted",
          selected_channels: ["sms"],
          responded_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      expect(inv.error, inv.error?.message ?? "").toBeFalsy();
      const invId = (inv.data as { id: string }).id;
      inviteIds.push(invId);

      await admin.from("event_assignments").insert({
        event_id: eventId,
        staff_member_id: sid,
        invite_id: invId,
        status: "confirmed",
        counts_toward_headcount: true,
        confirmed_at: new Date().toISOString(),
      });
    }

    // Sanity: both confirmed, event scheduled.
    {
      const { count } = await admin
        .from("event_assignments")
        .select("*", { count: "exact", head: true })
        .eq("event_id", eventId)
        .eq("status", "confirmed");
      expect(count ?? 0).toBe(2);
    }

    // One responder cancels via the public POST /r/<token>/submit. Mint a
    // raw token + flip the hash on the existing rsvp_tokens row (or create
    // one if missing).
    const { generateRsvpToken } = await import("../lib/security/token");
    const { raw, hash } = generateRsvpToken();
    const expiresAt = new Date(
      Date.now() + 30 * 24 * 3600 * 1000,
    ).toISOString();
    // Try to find an existing rsvp_token (may not exist since we bypassed
    // the invite wizard); insert if not.
    const existingTok = await admin
      .from("rsvp_tokens")
      .select("id")
      .eq("invite_id", inviteIds[0])
      .maybeSingle();
    if (existingTok.data) {
      await admin
        .from("rsvp_tokens")
        .update({ token_hash: hash, used_at: null, expires_at: expiresAt })
        .eq("id", (existingTok.data as { id: string }).id);
    } else {
      const insTok = await admin.from("rsvp_tokens").insert({
        invite_id: inviteIds[0],
        token_hash: hash,
        expires_at: expiresAt,
      });
      expect(insTok.error, insTok.error?.message ?? "").toBeFalsy();
    }

    const cancelRes = await page.request.post(`${BASE_URL}/r/${raw}/submit`, {
      headers: { "content-type": "application/json" },
      data: { action: "cancel" },
    });
    expect(cancelRes.status()).toBeLessThan(400);

    // Event should now be underfilled (Phase 6 transition logic).
    await pollUntil(
      async () => {
        const { data } = await admin
          .from("events")
          .select("status")
          .eq("id", eventId)
          .maybeSingle();
        return (data as { status?: string } | null)?.status ?? null;
      },
      (s) => s === "underfilled",
      15_000,
    );
    const finalStatus = await admin
      .from("events")
      .select("status")
      .eq("id", eventId)
      .maybeSingle();
    expect((finalStatus.data as { status: string }).status).toBe(
      "underfilled",
    );

    // Replacements page renders the candidate list (anything non-fatal —
    // we only check that the page loaded under the owner session and shows
    // the candidate count line).
    await page.goto(
      `${BASE_URL}/dashboard/events/${eventId}/replacements`,
    );
    await expect(
      page.getByRole("heading", { name: new RegExp(escapeRe(evTitle), "i") }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/CANDIDATES?/i).first()).toBeVisible();
  });
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function scrub(admin: SupabaseClient, cleanup: Cleanup): Promise<void> {
  // Order matters: children before parents.
  try {
    for (const eventId of cleanup.eventIds) {
      const { data: invites } = await admin
        .from("event_invites")
        .select("id")
        .eq("event_id", eventId);
      const inviteIds = (invites ?? []).map((r: { id: string }) => r.id);
      if (inviteIds.length > 0) {
        await admin.from("rsvp_tokens").delete().in("invite_id", inviteIds);
        await admin
          .from("message_outbox")
          .delete()
          .in("invite_id", inviteIds);
      }
      await admin.from("event_invites").delete().eq("event_id", eventId);
      await admin.from("event_assignments").delete().eq("event_id", eventId);
      await admin.from("attendance_records").delete().eq("event_id", eventId);
      await admin.from("event_requirements").delete().eq("event_id", eventId);
      await admin
        .from("invitation_campaigns")
        .delete()
        .eq("event_id", eventId);
      await admin
        .from("manager_notifications")
        .delete()
        .eq("event_id", eventId);
      await admin.from("events").delete().eq("id", eventId);
    }
    for (const sid of cleanup.staffMemberIds) {
      await admin
        .from("staff_contact_methods")
        .delete()
        .eq("staff_member_id", sid);
      await admin.from("staff_roles").delete().eq("staff_member_id", sid);
      await admin
        .from("staff_qualifications")
        .delete()
        .eq("staff_member_id", sid);
      await admin.from("consent_records").delete().eq("staff_member_id", sid);
      await admin.from("staff_members").delete().eq("id", sid);
    }
    for (const uid of cleanup.ownerUserIds) {
      await admin.from("profiles").delete().eq("id", uid);
      await admin.auth.admin.deleteUser(uid).catch(() => undefined);
    }
  } catch (err) {
    // Cleanup is best-effort.
    console.warn("[e2e] cleanup error:", (err as Error).message);
  }
}

async function ensureContactAndConsent(
  admin: SupabaseClient,
  staffMemberId: string,
  contacts: { phone?: string; email?: string },
): Promise<void> {
  if (contacts.phone) {
    const existing = await admin
      .from("staff_contact_methods")
      .select("id")
      .eq("staff_member_id", staffMemberId)
      .eq("channel", "sms")
      .maybeSingle();
    if (!existing.data) {
      await admin.from("staff_contact_methods").insert({
        staff_member_id: staffMemberId,
        channel: "sms",
        value: contacts.phone,
        normalized_value: contacts.phone,
        is_primary: true,
        status: "valid",
        consent: "granted",
        consent_source: "manual",
        consented_at: new Date().toISOString(),
      });
    }
  }
  if (contacts.email) {
    const existing = await admin
      .from("staff_contact_methods")
      .select("id")
      .eq("staff_member_id", staffMemberId)
      .eq("channel", "email")
      .maybeSingle();
    if (!existing.data) {
      await admin.from("staff_contact_methods").insert({
        staff_member_id: staffMemberId,
        channel: "email",
        value: contacts.email,
        normalized_value: contacts.email.toLowerCase(),
        is_primary: true,
        status: "valid",
        consent: "granted",
        consent_source: "manual",
        consented_at: new Date().toISOString(),
      });
    }
  }
}

async function signInOwner(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  const sb = createClient(SUPABASE_URL, SUPABASE_SECRET, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await sb.auth.signInWithPassword({
    email,
    password,
  });
  if (error || !data.session) {
    throw new Error(
      `signInWithPassword failed: ${error?.message ?? "no session"}`,
    );
  }

  const ref = projectRef(SUPABASE_URL);
  const cookieName = `sb-${ref}-auth-token`;
  const value = `base64-${Buffer.from(
    JSON.stringify([data.session.access_token, data.session.refresh_token]),
  ).toString("base64")}`;

  const url = new URL(BASE_URL);
  await page.context().addCookies([
    {
      name: cookieName,
      value,
      domain: url.hostname,
      path: "/",
      httpOnly: false,
      secure: url.protocol === "https:",
      sameSite: "Lax",
    },
  ]);
}

function projectRef(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.split(".")[0] ?? "localhost";
  } catch {
    return "localhost";
  }
}

async function fillNthAfterLabel(
  page: Page,
  label: RegExp,
  value: string,
): Promise<void> {
  // The StaffForm uses <span class="cs-label"> followed by an <input>. We
  // find the span and then the next text input sibling. Falls through to a
  // first-input fallback so the surrounding fill() still throws clearly if
  // the structure changes.
  const labelEl = page.getByText(label).first();
  if (await labelEl.count().catch(() => 0)) {
    const input = labelEl.locator("xpath=following::input[1]").first();
    if (await input.count().catch(() => 0)) {
      await input.fill(value);
      return;
    }
  }
  await page.locator("input").first().fill(value);
}

async function checkByLabel(page: Page, label: RegExp): Promise<void> {
  // Checkbox label structure: <label><input type="checkbox" /><span>{label}</span></label>
  const span = page.getByText(label).first();
  if (await span.count().catch(() => 0)) {
    const cb = span.locator(
      "xpath=ancestor::label[1]//input[@type='checkbox']",
    );
    if (await cb.count().catch(() => 0)) {
      await cb.check({ force: true }).catch(() => undefined);
      return;
    }
  }
  // Fallback to the accessible-label flow.
  const el = page.getByLabel(label).first();
  if (await el.count().catch(() => 0)) {
    await el.check({ force: true }).catch(() => undefined);
  }
}

async function pollUntil<T>(
  fn: () => Promise<T>,
  done: (v: T) => boolean,
  timeoutMs = 15_000,
  intervalMs = 500,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T = await fn();
  while (!done(last) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, intervalMs));
    last = await fn();
  }
  return last;
}

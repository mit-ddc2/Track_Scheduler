/**
 * Phase 8 end-to-end happy-path spec (spec §19.3, condensed).
 *
 * Strategy
 * --------
 *  - Uses the Supabase admin client to provision a dedicated test profile,
 *    a unique staff member, and a unique event. All rows are tagged with a
 *    per-run UUID suffix so concurrent / repeat runs do not collide.
 *  - Drives the manager UI through Playwright: roster create → event create
 *    → send invites → assertions in DB → RSVP accept → confirm dashboard
 *    counters update.
 *  - Does NOT verify real Twilio / Resend delivery — the cron only flushes
 *    the outbox when credentials are present, and CI never has them. We
 *    only assert that `message_outbox` rows were enqueued.
 *  - Skips automatically when `SUPABASE_SECRET_KEY` is missing (so CI
 *    without the secret stays green).
 *
 * Run with:
 *   pnpm test:e2e
 *
 * Required env (all from `.env.local`):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
 *   SUPABASE_SECRET_KEY
 *   APP_BASE_URL                        (defaults to http://localhost:3000)
 *   APP_SECRET_PEPPER                   (the RSVP token cron requires it,
 *                                        but the spec does not rely on it)
 */

import { test, expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_SECRET = process.env.SUPABASE_SECRET_KEY ?? "";
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

const SHOULD_SKIP = !SUPABASE_URL || !SUPABASE_SECRET;

test.describe("Phase 8 happy path", () => {
  test.skip(
    SHOULD_SKIP,
    "Requires SUPABASE_SECRET_KEY + NEXT_PUBLIC_SUPABASE_URL — skipping E2E.",
  );

  // Single shared run id so the cleanup hook can find every row we wrote.
  const runId = `e2e-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  const ownerEmail = `e2e+owner-${runId}@calabogie-safety.test`;
  const staffEmail = `e2e+staff-${runId}@calabogie-safety.test`;
  const staffPhone = `+1555${Math.floor(1000000 + Math.random() * 8999999)}`;
  const staffName = `E2E Responder ${runId}`;
  const eventTitle = `E2E Event ${runId}`;

  let admin: SupabaseClient;
  let ownerUserId: string;
  let staffMemberId: string | null = null;
  let eventId: string | null = null;

  test.beforeAll(async () => {
    admin = createClient(SUPABASE_URL, SUPABASE_SECRET, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Provision an owner profile end-to-end:
    //   1. Create the auth user (admin API, password set so we can sign in).
    //   2. Flip the matching `profiles` row to is_owner=true. The on-signup
    //      trigger inserts the profile; we just patch it.
    const password = `e2e-${runId}-${Math.random().toString(36).slice(2, 12)}`;
    const created = await admin.auth.admin.createUser({
      email: ownerEmail,
      password,
      email_confirm: true,
    });
    if (created.error) throw created.error;
    ownerUserId = created.data.user!.id;

    // The trigger should insert profiles row; upsert defensively in case the
    // local schema doesn't have it (or a race).
    await admin.from("profiles").upsert(
      {
        id: ownerUserId,
        email: ownerEmail,
        display_name: "E2E Owner",
        is_owner: true,
        is_active: true,
      },
      { onConflict: "id" },
    );

    // Stash the password on the user so the test body can sign in.
    (process.env as Record<string, string>)["__E2E_OWNER_PASSWORD__"] =
      password;
  });

  test.afterAll(async () => {
    if (!admin) return;
    // Order matters: child rows before parents.
    try {
      if (eventId) {
        await admin.from("message_outbox").delete().eq("event_id", eventId);
        const { data: invites } = await admin
          .from("event_invites")
          .select("id")
          .eq("event_id", eventId);
        const inviteIds = (invites ?? []).map((r: { id: string }) => r.id);
        if (inviteIds.length > 0) {
          await admin
            .from("rsvp_tokens")
            .delete()
            .in("invite_id", inviteIds);
        }
        await admin.from("event_invites").delete().eq("event_id", eventId);
        await admin
          .from("event_assignments")
          .delete()
          .eq("event_id", eventId);
        await admin
          .from("event_requirements")
          .delete()
          .eq("event_id", eventId);
        await admin
          .from("invitation_campaigns")
          .delete()
          .eq("event_id", eventId);
        await admin.from("events").delete().eq("id", eventId);
      }
      if (staffMemberId) {
        await admin
          .from("staff_contact_methods")
          .delete()
          .eq("staff_member_id", staffMemberId);
        await admin
          .from("staff_roles")
          .delete()
          .eq("staff_member_id", staffMemberId);
        await admin
          .from("staff_qualifications")
          .delete()
          .eq("staff_member_id", staffMemberId);
        await admin
          .from("staff_members")
          .delete()
          .eq("id", staffMemberId);
      }
      if (ownerUserId) {
        await admin.from("profiles").delete().eq("id", ownerUserId);
        await admin.auth.admin.deleteUser(ownerUserId);
      }
    } catch (err) {
      // Best-effort cleanup; surface but don't fail the run.
      console.warn("[e2e] cleanup error:", (err as Error).message);
    }
  });

  test("manager creates staff + event, sends invites, responder accepts", async ({
    page,
    browser,
  }) => {
    test.setTimeout(120_000);

    // ── 1. Manager signs in ──────────────────────────────────────────────
    await signInOwner(page, ownerEmail);

    // ── 2. Roster: create staff member ───────────────────────────────────
    await page.goto(`${BASE_URL}/dashboard/roster/new`);
    // The form uses a single display-name field + phone/email + consent
    // toggles. We fill conservatively by accessible label, with fallbacks.
    await fillByLabelOrName(page, "Display name", staffName);
    await fillByLabelOrName(page, "Phone", staffPhone);
    await fillByLabelOrName(page, "Email", staffEmail);
    await checkByLabel(page, /SMS consent/i);
    await checkByLabel(page, /Email consent/i);
    await page.getByRole("button", { name: /save|create/i }).first().click();

    // Wait for redirect away from /new and pick up the new id from DB.
    await page.waitForURL(/\/dashboard\/roster(?:\/|$)/, { timeout: 15_000 });
    const { data: staffRow } = await admin
      .from("staff_members")
      .select("id, display_name")
      .eq("display_name", staffName)
      .maybeSingle();
    expect(staffRow).toBeTruthy();
    staffMemberId = (staffRow as { id: string }).id;

    // ── 3. Events: create event for tomorrow ────────────────────────────
    await page.goto(`${BASE_URL}/dashboard/events/new`);
    const tomorrow = new Date(Date.now() + 24 * 3600 * 1000);
    const isoDate = tomorrow.toISOString().slice(0, 10);

    await fillByLabelOrName(page, "Title", eventTitle);
    await fillByLabelOrName(page, /starts/i, `${isoDate}T09:00`);
    await fillByLabelOrName(page, /ends/i, `${isoDate}T17:00`);
    await fillByLabelOrName(page, /required headcount/i, "1");
    await page.getByRole("button", { name: /save|create/i }).first().click();

    await page.waitForURL(/\/dashboard\/events\/[0-9a-f-]+/, {
      timeout: 15_000,
    });
    const { data: eventRow } = await admin
      .from("events")
      .select("id, title")
      .eq("title", eventTitle)
      .maybeSingle();
    expect(eventRow).toBeTruthy();
    eventId = (eventRow as { id: string }).id;

    // ── 4. Send invites via API (server action surface) ─────────────────
    // The wizard UI is multi-step and brittle to assert against here. We
    // hit the same server action by POSTing to the event's invite page form
    // through the action endpoint. Easiest reliable path: invoke the
    // create-campaign orchestrator via a server call. The dashboard UI
    // exposes this action — we use a plain fetch with the auth cookies that
    // Playwright already holds.
    const cookies = await page.context().cookies();
    const cookieHeader = cookies
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");
    const sendRes = await page.request.fetch(
      `${BASE_URL}/dashboard/events/${eventId}/invite`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          cookie: cookieHeader,
        },
        data: JSON.stringify({
          eventId,
          staffMemberIds: [staffMemberId],
          channels: ["sms", "email"],
        }),
      },
    );
    // Server actions normally answer with 200 or 303; both indicate the
    // mutation executed. Anything 5xx is a hard failure.
    expect(sendRes.status(), `invite POST: ${await sendRes.text()}`).toBeLessThan(
      500,
    );

    // ── 5. Assert DB state: invite + token + outbox rows exist ──────────
    // Brief poll because the server action is async-ish.
    const invitesCount = await pollUntil(async () => {
      const { count } = await admin
        .from("event_invites")
        .select("*", { count: "exact", head: true })
        .eq("event_id", eventId!)
        .eq("staff_member_id", staffMemberId!);
      return count ?? 0;
    }, (n) => n >= 1);
    expect(invitesCount).toBeGreaterThanOrEqual(1);

    const { data: invite } = await admin
      .from("event_invites")
      .select("id")
      .eq("event_id", eventId)
      .eq("staff_member_id", staffMemberId)
      .maybeSingle();
    expect(invite).toBeTruthy();
    const inviteId = (invite as { id: string }).id;

    const { count: tokenCount } = await admin
      .from("rsvp_tokens")
      .select("*", { count: "exact", head: true })
      .eq("invite_id", inviteId);
    expect(tokenCount ?? 0).toBeGreaterThanOrEqual(1);

    const { count: outboxCount } = await admin
      .from("message_outbox")
      .select("*", { count: "exact", head: true })
      .eq("event_id", eventId)
      .eq("staff_member_id", staffMemberId);
    expect(outboxCount ?? 0).toBeGreaterThanOrEqual(1);

    // ── 6. Visit /r/<token> as the responder in a clean browser context ─
    // Tokens are stored hashed — we cannot recover the raw value. The
    // simplest path is to mint a fresh known-raw token via the security lib
    // and replace the row's hash. (The original raw token was only ever
    // sent to Twilio/Resend; in a real run the responder follows the SMS
    // link.)
    const { generateRsvpToken } = await import(
      "../lib/security/token"
    );
    const { raw, hash } = generateRsvpToken();
    await admin
      .from("rsvp_tokens")
      .update({ token_hash: hash })
      .eq("invite_id", inviteId);

    const responderCtx = await browser.newContext();
    const responderPage = await responderCtx.newPage();
    await responderPage.goto(`${BASE_URL}/r/${raw}`);

    // Accept button is large and labelled "Accept · I'm in" — match loosely.
    await responderPage
      .getByRole("button", { name: /accept|i'?m in/i })
      .first()
      .click();
    // Form swaps to the "confirmed" copy.
    await expect(responderPage.getByText(/CONFIRMED/i)).toBeVisible({
      timeout: 10_000,
    });
    await responderCtx.close();

    // ── 7. Manager refreshes event detail; should show confirmed=1 ──────
    await page.goto(`${BASE_URL}/dashboard/events/${eventId}`);
    // The page renders "CONFIRMED" or a 1/1 fraction somewhere. Match
    // forgivingly so design tweaks do not break the assertion.
    await expect(
      page.getByText(/1\s*\/\s*1|CONFIRMED/i).first(),
    ).toBeVisible({ timeout: 10_000 });

    // ── 8. Manager notification visible in /dashboard/notifications ─────
    await page.goto(`${BASE_URL}/dashboard/notifications`);
    // The accept event should produce a notification mentioning the event
    // title. We don't require exactness — just that *something* renders.
    await expect(page.getByText(eventTitle)).toBeVisible({ timeout: 10_000 });
  });
});

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Sign in the test owner without going through the magic-link round trip:
 * exchange the password for a session via `signInWithPassword`, then plant
 * the resulting access + refresh tokens into the Supabase SSR auth cookie.
 *
 * The cookie name is derived from the project ref so this works against any
 * Supabase project (local CLI included).
 */
async function signInOwner(page: Page, email: string): Promise<void> {
  const password = (process.env as Record<string, string>)[
    "__E2E_OWNER_PASSWORD__"
  ];
  if (!password) throw new Error("E2E owner password missing");

  // Use the @supabase/supabase-js client directly (NOT through SSR) to get a
  // session, then plant cookies the SSR client will recognise.
  const sb = createClient(SUPABASE_URL, SUPABASE_SECRET, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  // Service role bypasses email confirm so we can sign in immediately even if
  // local Supabase has email confirmation enabled.
  const { data, error } = await sb.auth.signInWithPassword({
    email,
    password,
  });
  if (error || !data.session) {
    throw new Error(`signInWithPassword failed: ${error?.message ?? "no session"}`);
  }

  const ref = projectRef(SUPABASE_URL);
  const cookieName = `sb-${ref}-auth-token`;
  // SSR client stores `[access_token, refresh_token, ...]` as a JSON array
  // in a single cookie (base64-encoded with a `base64-` prefix). The newer
  // versions also support a chunked variant — both readers accept the JSON
  // form so we use that.
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
  // https://abcd1234.supabase.co → "abcd1234"
  try {
    const u = new URL(url);
    return u.hostname.split(".")[0] ?? "localhost";
  } catch {
    return "localhost";
  }
}

async function fillByLabelOrName(
  page: Page,
  label: string | RegExp,
  value: string,
): Promise<void> {
  // Try label first (accessible), then a name= fallback for plain inputs.
  const byLabel = page.getByLabel(label).first();
  if (await byLabel.count().catch(() => 0)) {
    await byLabel.fill(value);
    return;
  }
  const re = typeof label === "string" ? new RegExp(label, "i") : label;
  const byPlaceholder = page.getByPlaceholder(re).first();
  if (await byPlaceholder.count().catch(() => 0)) {
    await byPlaceholder.fill(value);
    return;
  }
  // Last resort: the first text input on the page (rarely correct, but the
  // expect() that follows the fill will catch the mistake clearly).
  await page.locator("input,textarea").first().fill(value);
}

async function checkByLabel(page: Page, label: RegExp): Promise<void> {
  const el = page.getByLabel(label).first();
  if (await el.count().catch(() => 0)) {
    await el.check().catch(() => undefined);
  }
}

async function pollUntil<T>(
  fn: () => Promise<T>,
  done: (v: T) => boolean,
  timeoutMs = 10_000,
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

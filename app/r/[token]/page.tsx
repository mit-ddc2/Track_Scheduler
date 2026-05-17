import { formatInTimeZone } from "date-fns-tz";

import { RsvpForm } from "@/components/rsvp/RsvpForm";
import { RsvpExpired } from "@/components/rsvp/RsvpExpired";
import { createAdminClient } from "@/lib/db/supabase-admin";
import { computeCoverage } from "@/lib/events/coverage";
import { getOwnerContact } from "@/lib/utils/contact";

import { submitRsvpResponse } from "./actions";
import { loadInviteByTokenImpl as loadInviteByToken } from "./rsvp-handler";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ token: string }>;
};

type EventRow = {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  timezone: string;
  location: string | null;
  event_type: string | null;
  required_headcount: number;
};

type StaffRow = {
  id: string;
  display_name: string;
};

function shortCode(id: string): string {
  return id.replace(/-/g, "").slice(0, 6).toUpperCase();
}

/**
 * Wrapped outside the render function so the React-purity lint rule doesn't
 * complain about calling `Date.now()` directly during render — this is a
 * server-only `force-dynamic` page, so the value is computed once per
 * request.
 */
function computeDaysOut(start: Date): number {
  const now = Date.now();
  return Math.max(0, Math.ceil((start.getTime() - now) / (24 * 3600 * 1000)));
}

export default async function RsvpPage({ params }: PageProps) {
  const { token } = await params;
  const loaded = await loadInviteByToken(token);

  if (!loaded.ok) {
    return <RsvpExpired reason={loaded.reason} />;
  }

  const admin = createAdminClient();

  const [evRes, staffRes, invitesRes, assignmentsRes] = await Promise.all([
    admin
      .from("events")
      .select(
        "id, title, starts_at, ends_at, timezone, location, event_type, required_headcount",
      )
      .eq("id", loaded.invite.event_id)
      .maybeSingle(),
    admin
      .from("staff_members")
      .select("id, display_name")
      .eq("id", loaded.invite.staff_member_id)
      .maybeSingle(),
    admin
      .from("event_invites")
      .select("status")
      .eq("event_id", loaded.invite.event_id),
    admin
      .from("event_assignments")
      .select("status")
      .eq("event_id", loaded.invite.event_id),
  ]);

  if (evRes.error || !evRes.data) {
    return <RsvpExpired reason="invalid" />;
  }
  const event = evRes.data as EventRow;
  const staff = (staffRes.data as StaffRow | null) ?? {
    id: loaded.invite.staff_member_id,
    display_name: "Responder",
  };

  // Coverage for the "5/8 confirmed" bar.
  const coverage = computeCoverage(
    (invitesRes.data ?? []) as { status: "invited" | "accepted" | "declined" | "cancelled_by_member" | "cancelled_by_manager" | "availability_updated" | "expired" | "waitlisted" | "created" }[],
    (assignmentsRes.data ?? []) as { status: "confirmed" | "waitlisted" | "cancelled" | "completed" }[],
    event.required_headcount,
  );

  const tz = event.timezone || "America/Toronto";
  const start = new Date(event.starts_at);
  const dayNum = formatInTimeZone(start, tz, "d");
  const dayOfWeek = formatInTimeZone(start, tz, "EEE MMM").toUpperCase();
  const yearWeek = formatInTimeZone(start, tz, "yyyy · 'W'II");
  const tMinusDays = computeDaysOut(start);

  const specs: Array<[string, string]> = [
    ["CALL", formatInTimeZone(start, tz, "HH:mm")],
    ["START", formatInTimeZone(start, tz, "HH:mm")],
    ["END", formatInTimeZone(new Date(event.ends_at), tz, "HH:mm")],
    ["LOCATION", event.location ?? "Calabogie Motorsports Park"],
    ["ROLE", "Rescue Crew"],
  ];

  // Cap the filled crew bar at the required headcount so the design holds
  // even if confirmed > needed (overbook).
  const needed = Math.max(event.required_headcount, 1);
  const cells = Array.from({ length: needed }).map((_, i) => i < coverage.confirmed);

  // The form's idea of "status" maps the internal invite_status enum into the
  // 4 buckets the form cares about.
  const formStatus = ((): "invited" | "accepted" | "declined" | "cancelled_by_member" => {
    switch (loaded.invite.status) {
      case "accepted":
        return "accepted";
      case "declined":
        return "declined";
      case "cancelled_by_member":
        return "cancelled_by_member";
      default:
        return "invited";
    }
  })();

  return (
    <div
      style={{
        position: "relative",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        background: "#0a0a0a",
        color: "#ececec",
      }}
    >
      <div style={{ flex: 1, overflowY: "auto" }}>
        <div className="cs-stripes" style={{ height: 6 }} />
        <div style={{ padding: "20px 20px 0", maxWidth: 560, margin: "0 auto" }}>
          <div className="cs-eyebrow" style={{ marginBottom: 10 }}>
            ● CALABOGIE SAFETY · CREW CALL
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 10,
              marginBottom: 6,
            }}
          >
            <span className="cs-data-xl" style={{ fontSize: 56 }}>
              {dayNum}
            </span>
            <div>
              <div
                className="mono"
                style={{
                  fontSize: 14,
                  fontWeight: 700,
                  letterSpacing: "0.04em",
                }}
              >
                {dayOfWeek}
              </div>
              <div
                className="mono"
                style={{
                  fontSize: 11,
                  color: "#888",
                  letterSpacing: "0.04em",
                }}
              >
                {yearWeek.toUpperCase()}
              </div>
            </div>
          </div>
          <div className="cs-h1" style={{ fontSize: 26, marginTop: 16 }}>
            {event.title}
          </div>
          <div
            className="mono"
            style={{
              fontSize: 11,
              color: "#888",
              marginTop: 6,
              letterSpacing: "0.04em",
            }}
          >
            {shortCode(event.id)} · {(event.event_type ?? "EVENT").toUpperCase()} ·
            T-{tMinusDays}D
          </div>
        </div>

        {/* Specs grid */}
        <div
          style={{
            padding: 20,
            marginTop: 16,
            maxWidth: 560,
            margin: "16px auto 0",
          }}
        >
          <div
            style={{
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 4,
            }}
          >
            {specs.map(([k, v], i) => (
              <div
                key={k}
                style={{
                  display: "flex",
                  padding: "12px 14px",
                  borderTop: i ? "1px solid rgba(255,255,255,0.06)" : 0,
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <span className="cs-label">{k}</span>
                <span className="mono tnum" style={{ fontSize: 12 }}>
                  {v}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Crew status */}
        <div
          style={{
            padding: "0 20px 20px",
            maxWidth: 560,
            margin: "0 auto",
          }}
        >
          <div className="cs-eyebrow" style={{ marginBottom: 8 }}>
            CREW · {String(coverage.confirmed).padStart(2, "0")}/
            {String(needed).padStart(2, "0")} CONFIRMED
          </div>
          <div style={{ display: "flex", gap: 4, height: 10 }}>
            {cells.map((filled, i) => (
              <span
                key={i}
                style={{
                  flex: 1,
                  background: filled ? "var(--ok)" : "rgba(255,255,255,0.06)",
                }}
              />
            ))}
          </div>
          <div
            className="mono"
            style={{
              fontSize: 10,
              color: "#888",
              marginTop: 8,
              letterSpacing: "0.04em",
            }}
          >
            Tap below to confirm your spot. You can change later.
          </div>
        </div>
      </div>

      {/* Action zone */}
      <div
        style={{
          padding: "16px 20px 24px",
          borderTop: "1px solid rgba(255,255,255,0.08)",
          background: "#111",
        }}
      >
        <div style={{ maxWidth: 560, margin: "0 auto" }}>
          <RsvpForm
            token={token}
            status={formStatus}
            responderName={staff.display_name}
            expiresAt={loaded.invite.expires_at}
            submitAction={submitRsvpResponse}
            contact={getOwnerContact()}
          />
        </div>
      </div>
    </div>
  );
}

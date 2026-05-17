import Link from "next/link";
import { notFound } from "next/navigation";

import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { requireOwner } from "@/lib/auth/require-owner";
import { getEvent } from "@/lib/events/queries";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function asInt(v: string | string[] | undefined): number {
  if (Array.isArray(v)) v = v[0];
  const n = Number.parseInt(v ?? "0", 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export default async function InviteSentPage({ params, searchParams }: PageProps) {
  await requireOwner();
  const { eventId } = await params;
  const event = await getEvent(eventId);
  if (!event) notFound();

  const sp = await searchParams;
  const invited = asInt(sp.invited);
  const sms = asInt(sp.sms);
  const email = asInt(sp.email);
  const optOut = asInt(sp.opt);
  const manual = asInt(sp.manual);
  const noContact = asInt(sp.none);

  const totalMessages = sms + email;
  const failed =
    !process.env.TWILIO_ACCOUNT_SID && sms > 0
      ? sms
      : 0; /* surfaced in UI as "provider not configured" */

  return (
    <div style={{ position: "relative", paddingBottom: 96 }}>
      <div className="cs-stripes" style={{ height: 6 }} />
      <div
        style={{
          padding: "40px 24px",
          textAlign: "center",
          maxWidth: 540,
          margin: "0 auto",
        }}
      >
        <div
          aria-hidden
          style={{
            width: 80,
            height: 80,
            borderRadius: 4,
            background: "color-mix(in srgb, var(--ok) 14%, transparent)",
            color: "var(--ok)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 24,
            fontWeight: 700,
            fontSize: 36,
          }}
        >
          ✓
        </div>
        <div className="cs-eyebrow" style={{ marginBottom: 8 }}>
          CAMPAIGN SENT
        </div>
        <div className="cs-h1" style={{ marginBottom: 8 }}>
          {invited} invites out
        </div>
        <div
          className="mono"
          style={{
            fontSize: 12,
            color: "var(--text-2)",
            letterSpacing: "0.04em",
            marginBottom: 32,
          }}
        >
          {event.title.toUpperCase()}
        </div>

        <Card
          style={{ padding: 16, textAlign: "left", marginBottom: 24 }}
          aria-label="Delivery summary"
        >
          <div className="cs-label" style={{ marginBottom: 8 }}>
            DELIVERY · QUEUED
          </div>
          <Row label={`${sms} SMS queued`} tone={sms > 0 ? "ok" : "default"} />
          <Row label={`${email} email queued`} tone={email > 0 ? "ok" : "default"} />
          {optOut > 0 && (
            <Row label={`${optOut} skipped (opt-out / bounced)`} tone="bad" />
          )}
          {manual > 0 && (
            <Row label={`${manual} skipped (manual-only)`} tone="warn" />
          )}
          {noContact > 0 && (
            <Row label={`${noContact} skipped (no contact for channel)`} tone="default" />
          )}
          {failed > 0 && (
            <Row
              label={`${failed} will fail (Twilio not configured — see .env.local)`}
              tone="warn"
            />
          )}
          {totalMessages === 0 && (
            <div
              style={{
                fontSize: 12,
                color: "var(--text-3)",
                marginTop: 4,
              }}
            >
              No messages queued — check the recipient list.
            </div>
          )}
        </Card>

        <div
          style={{
            display: "flex",
            gap: 8,
            justifyContent: "center",
            flexWrap: "wrap",
          }}
        >
          <Link
            href={`/dashboard/events/${eventId}`}
            className="cs-btn cs-btn--primary cs-btn--lg"
            style={{ textDecoration: "none" }}
          >
            BACK TO EVENT
          </Link>
          <Link
            href="/dashboard/notifications"
            className="cs-btn cs-btn--lg"
            style={{ textDecoration: "none" }}
          >
            VIEW NOTIFICATIONS
          </Link>
        </div>
      </div>
    </div>
  );
}

function Row({
  label,
  tone,
}: {
  label: string;
  tone: "ok" | "warn" | "bad" | "default";
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        marginBottom: 6,
        fontSize: 13,
      }}
    >
      <span style={{ flex: 1, color: "var(--text)" }}>{label}</span>
      <Chip
        tone={
          tone === "default" ? "default" : (tone as "ok" | "warn" | "bad")
        }
      >
        {tone === "ok" ? "OK" : tone === "bad" ? "FAIL" : tone === "warn" ? "WARN" : "—"}
      </Chip>
    </div>
  );
}

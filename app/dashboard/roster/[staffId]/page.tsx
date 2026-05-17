import { Mail, MessageSquare, Pencil } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Avatar } from "@/components/roster/Avatar";
import { ConsentSummary } from "@/components/roster/ConsentSummary";
import { ArchiveButton } from "@/components/roster/ArchiveButton";
import { Btn } from "@/components/ui/Btn";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { StatusDot } from "@/components/ui/StatusDot";
import { getStaffById } from "@/lib/roster/queries";

export const dynamic = "force-dynamic";

type Params = Promise<{ staffId: string }>;

export default async function StaffDetailPage({ params }: { params: Params }) {
  const { staffId } = await params;
  const staff = await getStaffById(staffId);
  if (!staff) notFound();

  const sms = staff.contact_methods.find((c) => c.channel === "sms");
  const email = staff.contact_methods.find((c) => c.channel === "email");
  const primaryRole = staff.staff_roles.find((r) => r.is_primary);
  const otherRoles = staff.staff_roles.filter((r) => !r.is_primary);

  // Placeholder counts until Phase 5 wires real data.
  const acceptedCount = 0;
  const missedCount = 0;
  const invitesCount = 0;
  const lastWorked = "—";

  return (
    <div
      style={{
        maxWidth: 720,
        margin: "0 auto",
        padding: "16px 16px 80px",
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
          <Avatar name={staff.display_name} size={56} />
          <div>
            <span className="cs-eyebrow">
              {primaryRole?.crew_roles?.name?.toUpperCase() ?? "RESPONDER"}
            </span>
            <h1 className="cs-h1" style={{ marginTop: 4 }}>
              {staff.display_name}
            </h1>
            <div className="cs-label" style={{ marginTop: 4 }}>
              Last worked · {lastWorked}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Link href={`/dashboard/roster/${staff.id}/edit`}>
            <Btn>
              <Pencil size={14} strokeWidth={1.6} /> Edit
            </Btn>
          </Link>
          <ArchiveButton
            staffId={staff.id}
            archived={!staff.active}
          />
        </div>
      </header>

      <Card style={{ padding: 16 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 0,
          }}
        >
          <MiniStat n={acceptedCount} l="ACCEPTED" tone="ok" />
          <MiniStat n={missedCount} l="MISSED" tone="warn" />
          <MiniStat n={invitesCount} l="INVITES YR" tone="idle" />
        </div>
      </Card>

      <SectionHead title="Contact" />
      <Card>
        <ContactRow
          icon="sms"
          label="SMS"
          value={sms?.value ?? "No SMS"}
          present={Boolean(sms)}
          consentStatus={sms?.consent ?? "unknown"}
          consentSource={sms?.consent_source ?? null}
          consentedAt={sms?.consented_at ?? null}
        />
        <div className="cs-divider" />
        <ContactRow
          icon="email"
          label="Email"
          value={email?.value ?? "No email"}
          present={Boolean(email)}
          consentStatus={email?.consent ?? "unknown"}
          consentSource={email?.consent_source ?? null}
          consentedAt={email?.consented_at ?? null}
        />
      </Card>

      <SectionHead title="Roles & qualifications" />
      <Card style={{ padding: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div>
            <span className="cs-label">Primary role</span>
            <div style={{ marginTop: 4 }}>
              {primaryRole?.crew_roles?.name ? (
                <Chip tone="accent">
                  {primaryRole.crew_roles.name.toUpperCase()}
                </Chip>
              ) : (
                <span style={{ color: "var(--text-3)" }}>—</span>
              )}
            </div>
          </div>
          {otherRoles.length > 0 && (
            <div>
              <span className="cs-label">Other roles</span>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
                {otherRoles.map((r) => (
                  <Chip key={r.role_id}>{r.crew_roles?.name ?? "?"}</Chip>
                ))}
              </div>
            </div>
          )}
          <div>
            <span className="cs-label">Qualifications</span>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
              {staff.staff_qualifications.length === 0 ? (
                <span style={{ color: "var(--text-3)" }}>—</span>
              ) : (
                staff.staff_qualifications.map((q) => (
                  <Chip key={q.qualification_id}>
                    {q.qualifications?.name ?? "?"}
                    {q.expires_at && (
                      <span
                        style={{
                          marginLeft: 6,
                          color: "var(--text-3)",
                        }}
                      >
                        · exp {q.expires_at}
                      </span>
                    )}
                  </Chip>
                ))
              )}
            </div>
          </div>
        </div>
      </Card>

      {staff.notes && (
        <>
          <SectionHead title="Notes" />
          <Card style={{ padding: 16, color: "var(--text-2)", whiteSpace: "pre-wrap" }}>
            {staff.notes}
          </Card>
        </>
      )}

      <SectionHead title="Event history" hint="last 6 months" />
      <Card style={{ padding: 16, color: "var(--text-3)" }}>
        No events yet — wiring lands in Phase 5.
      </Card>
    </div>
  );
}

function SectionHead({ title, hint }: { title: string; hint?: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        marginTop: 8,
      }}
    >
      <h2 className="cs-h3">{title}</h2>
      {hint && (
        <span
          className="mono"
          style={{
            fontSize: 10,
            color: "var(--text-3)",
            letterSpacing: "0.04em",
            textTransform: "uppercase",
          }}
        >
          {hint}
        </span>
      )}
    </div>
  );
}

function MiniStat({
  n,
  l,
  tone,
}: {
  n: number;
  l: string;
  tone: "ok" | "warn" | "idle";
}) {
  const color =
    tone === "ok" ? "var(--ok)" : tone === "warn" ? "var(--warn)" : "var(--text)";
  return (
    <div style={{ textAlign: "center" }}>
      <div className="cs-data-lg" style={{ color }}>
        {n}
      </div>
      <div className="cs-label" style={{ marginTop: 4 }}>
        {l}
      </div>
    </div>
  );
}

function ContactRow({
  icon,
  label,
  value,
  present,
  consentStatus,
  consentSource,
  consentedAt,
}: {
  icon: "sms" | "email";
  label: string;
  value: string;
  present: boolean;
  consentStatus: "unknown" | "granted" | "denied" | "withdrawn";
  consentSource: string | null;
  consentedAt: string | null;
}) {
  const Icon = icon === "sms" ? MessageSquare : Mail;
  return (
    <div
      style={{
        padding: "14px 16px",
        display: "flex",
        gap: 12,
        alignItems: "center",
      }}
    >
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: 4,
          background: "var(--surface-2)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--text-2)",
          flexShrink: 0,
        }}
      >
        <Icon size={16} strokeWidth={1.6} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <span className="cs-label">{label}</span>
        <div
          className="mono"
          style={{
            fontSize: 13,
            marginTop: 2,
            color: present ? "var(--text)" : "var(--text-3)",
          }}
        >
          {value}
        </div>
        <div style={{ marginTop: 4 }}>
          {present ? (
            <ConsentSummary
              status={consentStatus}
              source={consentSource}
              capturedAt={consentedAt}
            />
          ) : (
            <span
              className="mono"
              style={{ fontSize: 11, color: "var(--text-3)" }}
            >
              No value on file
            </span>
          )}
        </div>
      </div>
      <StatusDot tone={present ? (consentStatus === "granted" ? "ok" : "idle") : "idle"} />
    </div>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";

import { AttendanceList } from "@/components/attendance/AttendanceList";
import { AttendanceMatrix } from "@/components/attendance/AttendanceMatrix";
import { MarkAllWorkedButton } from "@/components/attendance/MarkAllWorkedButton";
import { PdfExportButton } from "@/components/attendance/PdfExportButton";
import { Card } from "@/components/ui/Card";
import { requireOwner } from "@/lib/auth/require-owner";
import {
  listEventAttendance,
  listEventAttendanceMatrix,
} from "@/lib/attendance/queries";
import { enumerateEventDays } from "@/lib/events/coverage";
import {
  formatEventDate,
  formatTimeRange,
  isMultiDayEvent,
  shortCode,
} from "@/lib/events/format";
import { getEvent } from "@/lib/events/queries";

import { markAllWorked, setAttendanceStatus, updateAttendanceDetails } from "./actions";

type PageProps = {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AttendancePage({ params, searchParams }: PageProps) {
  await requireOwner();
  const { eventId } = await params;
  const sp = await searchParams;
  const advanced = sp?.advanced === "1";

  const event = await getEvent(eventId);
  if (!event) notFound();

  const tz = event.timezone || "America/Toronto";
  const multiDay = isMultiDayEvent(event.starts_at, event.ends_at, tz);
  // Defaults for the PDF date-range modal: the event's own start/end day.
  const pdfFrom = event.starts_at.slice(0, 10);
  const pdfTo = event.ends_at.slice(0, 10);

  // Branch the data fetch by single-day vs multi-day so we only pull what
  // the rendered UI actually needs.
  const days = multiDay
    ? enumerateEventDays(event.starts_at, event.ends_at)
    : [event.starts_at.slice(0, 10)];

  const [rows, matrixRows] = await Promise.all([
    multiDay ? Promise.resolve([]) : listEventAttendance(eventId),
    multiDay
      ? listEventAttendanceMatrix(eventId, days)
      : Promise.resolve([]),
  ]);

  const listRows = rows.map((r) => ({
    staff_member_id: r.staff_member_id,
    display_name: r.staff_display_name,
    status: r.attendance?.status ?? ("scheduled" as const),
    actual_hours: r.attendance?.actual_hours ?? null,
    pay_rate: r.attendance?.pay_rate ?? null,
    role_label:
      r.role_label ?? r.role_name ?? r.primary_qualification_name ?? null,
    actual_start: r.attendance?.actual_start ?? null,
    actual_end: r.attendance?.actual_end ?? null,
    pay_code: r.attendance?.pay_code ?? null,
    notes: r.attendance?.notes ?? null,
  }));

  return (
    <div style={{ position: "relative", paddingBottom: 120 }}>
      <div style={{ padding: "20px 16px 0", maxWidth: 720, margin: "0 auto" }}>
        <header style={{ marginBottom: 16 }}>
          <span className="cs-eyebrow">{shortCode(event.id)} · POST-EVENT</span>
          <h1 className="cs-h1" style={{ marginTop: 6 }}>
            Attendance
          </h1>
          <div
            className="mono"
            style={{
              fontSize: 11,
              color: "var(--text-2)",
              letterSpacing: "0.04em",
              marginTop: 6,
            }}
          >
            {event.title} ·{" "}
            {formatEventDate(event.starts_at, event.ends_at, tz)} ·{" "}
            {formatTimeRange(event.starts_at, event.ends_at, tz)}
          </div>
        </header>

        <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
          <MarkAllWorkedButton eventId={event.id} action={markAllWorked} />
          {advanced ? (
            <Link
              href={`/api/exports/payroll/${event.id}`}
              className="cs-btn cs-btn--ghost cs-btn--sm"
              style={{
                textDecoration: "none",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
              aria-label="Download payroll CSV"
            >
              <span aria-hidden style={{ fontSize: 14 }}>↓</span>
              CSV
            </Link>
          ) : null}
        </div>

        <Card>
          {multiDay ? (
            <AttendanceMatrix
              eventId={event.id}
              days={days}
              rows={matrixRows.map((r) => ({
                staff_member_id: r.staff_member_id,
                staff_display_name: r.staff_display_name,
                role_label: r.role_label,
                cells: r.cells.map((c) => ({
                  day_date: c.day_date,
                  status: c.status,
                  attendance: c.attendance
                    ? { status: c.attendance.status }
                    : null,
                })),
              }))}
              timezone={tz}
              setStatus={setAttendanceStatus}
            />
          ) : (
            <AttendanceList
              eventId={event.id}
              rows={listRows}
              setStatus={setAttendanceStatus}
              updateDetails={updateAttendanceDetails}
            />
          )}
        </Card>
      </div>

      {/* Sticky bottom: Export */}
      <div className="cs-attendance-actionbar-wrap">
        <div className="cs-attendance-actionbar">
          <PdfExportButton defaultFrom={pdfFrom} defaultTo={pdfTo} />
          {advanced ? (
            <Link
              href={`/api/exports/payroll/${event.id}`}
              className="cs-btn cs-btn--ghost cs-btn--sm"
              style={{
                textDecoration: "none",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
              }}
              aria-label="Download payroll CSV"
            >
              <span aria-hidden style={{ fontSize: 14 }}>↓</span>
              CSV
            </Link>
          ) : null}
        </div>
      </div>
      <style>{`
        .cs-attendance-actionbar-wrap {
          position: fixed;
          left: 0;
          right: 0;
          bottom: 64px;
          display: flex;
          justify-content: center;
          pointer-events: none;
          padding: 0 16px;
          background: linear-gradient(to top, var(--bg) 60%, transparent);
        }
        .cs-attendance-actionbar {
          pointer-events: auto;
          width: 100%;
          max-width: 720px;
          display: flex;
          gap: 8px;
          padding: 12px 0;
        }
        @media (min-width: 768px) {
          .cs-attendance-actionbar-wrap { bottom: 0; }
        }
      `}</style>
    </div>
  );
}

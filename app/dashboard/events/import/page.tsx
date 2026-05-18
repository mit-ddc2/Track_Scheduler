import Link from "next/link";

import { Btn } from "@/components/ui/Btn";
import { EventImportWizard } from "@/components/events/EventImportWizard";
import { requireOwner } from "@/lib/auth/require-owner";

export const dynamic = "force-dynamic";

export default async function ImportEventsPage() {
  await requireOwner();

  return (
    <div
      style={{
        maxWidth: 1080,
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
          alignItems: "flex-end",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <div>
          <span className="cs-eyebrow">Events</span>
          <h1 className="cs-h1" style={{ marginTop: 4 }}>
            Import from spreadsheet
          </h1>
          <p
            className="mono"
            style={{
              fontSize: 11,
              color: "var(--text-2)",
              letterSpacing: "0.04em",
              marginTop: 6,
            }}
          >
            Bulk-create events from Robert&apos;s booking xlsx.
          </p>
        </div>
        <Link href="/dashboard/events">
          <Btn variant="ghost">Back to events</Btn>
        </Link>
      </header>

      <EventImportWizard />
    </div>
  );
}

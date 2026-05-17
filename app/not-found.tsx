import Link from "next/link";

import { Btn } from "@/components/ui/Btn";
import { Card } from "@/components/ui/Card";

/**
 * Global 404 — rendered for any unmatched route in the App Router. Uses the
 * Pit Wall aesthetic so an unknown URL still looks like part of the product
 * rather than a Vercel error frame.
 */
export default function NotFound() {
  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "32px 20px",
        background: "var(--bg)",
      }}
    >
      <Card
        style={{
          maxWidth: 520,
          width: "100%",
          padding: 0,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div className="cs-stripes" style={{ height: 6 }} aria-hidden="true" />
        <div
          style={{
            padding: 24,
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          <span className="cs-eyebrow" style={{ color: "var(--accent)" }}>
            ● 404 · LOST
          </span>
          <h1 className="cs-h1" style={{ marginTop: 4 }}>
            Page not found
          </h1>
          <p
            style={{
              margin: 0,
              color: "var(--text-2)",
              fontSize: 14,
              lineHeight: 1.5,
            }}
          >
            The page you were looking for either moved, expired, or never
            existed.
          </p>
          <div
            style={{
              display: "flex",
              gap: 10,
              flexWrap: "wrap",
              marginTop: 4,
            }}
          >
            <Link href="/dashboard" style={{ textDecoration: "none" }}>
              <Btn variant="primary">← Back to dashboard</Btn>
            </Link>
            <Link href="/login" style={{ textDecoration: "none" }}>
              <Btn variant="ghost">Go to login</Btn>
            </Link>
          </div>
        </div>
      </Card>
    </main>
  );
}

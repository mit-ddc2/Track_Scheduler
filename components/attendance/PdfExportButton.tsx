"use client";

import { useState } from "react";

import { Btn } from "@/components/ui/Btn";

export type PdfExportButtonProps = {
  /** ISO date (`YYYY-MM-DD`) used as the modal's default 'from' value. */
  defaultFrom: string;
  /** ISO date (`YYYY-MM-DD`) used as the modal's default 'to' value. */
  defaultTo: string;
  /** When true, render the small ghost variant suitable for an overflow row. */
  ghost?: boolean;
  /** Custom button label. Defaults to "EXPORT PDF". */
  label?: string;
};

/**
 * Owner-facing "Export PDF" button. Opens a minimal modal with `from` and
 * `to` date pickers (HTML5 native — no extra deps), then routes the user to
 * `/api/exports/payroll-pdf?from=…&to=…` in a new tab so the download starts
 * without disturbing the dashboard tab.
 */
export function PdfExportButton({
  defaultFrom,
  defaultTo,
  ghost = false,
  label = "EXPORT PDF",
}: PdfExportButtonProps) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);

  const invalid = !from || !to || from > to;

  const onExport = () => {
    if (invalid) return;
    const params = new URLSearchParams({ from, to });
    const href = `/api/exports/payroll-pdf?${params.toString()}`;
    if (typeof window !== "undefined") {
      window.open(href, "_blank", "noopener,noreferrer");
    }
    setOpen(false);
  };

  return (
    <>
      <Btn
        variant={ghost ? "ghost" : "primary"}
        size={ghost ? "sm" : "lg"}
        onClick={() => setOpen(true)}
        style={ghost ? undefined : { flex: 1 }}
      >
        <span aria-hidden style={{ marginRight: 6 }}>
          ↓
        </span>
        {label}
      </Btn>

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="cs-pdf-export-title"
          onClick={(e) => {
            // Backdrop click closes; clicks on the inner dialog don't bubble.
            if (e.target === e.currentTarget) setOpen(false);
          }}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 100,
            padding: 16,
          }}
        >
          <div
            style={{
              background: "var(--surface, #1a1a1a)",
              color: "var(--text, #ffffff)",
              borderRadius: 8,
              padding: 20,
              width: "100%",
              maxWidth: 360,
              border: "1px solid var(--hairline, #333)",
              boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
            }}
          >
            <div
              id="cs-pdf-export-title"
              className="cs-eyebrow"
              style={{ marginBottom: 4 }}
            >
              EXPORT PAYROLL PDF
            </div>
            <p
              className="mono"
              style={{
                fontSize: 11,
                color: "var(--text-2, #aaa)",
                marginTop: 0,
                marginBottom: 14,
              }}
            >
              Pick the date range. The PDF lists events chronologically with
              a per-day attendance table.
            </p>

            <label
              style={{
                display: "block",
                fontSize: 11,
                marginBottom: 4,
                letterSpacing: "0.04em",
              }}
              htmlFor="cs-pdf-export-from"
            >
              FROM
            </label>
            <input
              id="cs-pdf-export-from"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              style={{
                width: "100%",
                padding: "8px 10px",
                fontFamily: "inherit",
                fontSize: 13,
                background: "var(--bg, #0a0a0a)",
                color: "var(--text, #fff)",
                border: "1px solid var(--hairline, #333)",
                borderRadius: 4,
                marginBottom: 12,
              }}
            />

            <label
              style={{
                display: "block",
                fontSize: 11,
                marginBottom: 4,
                letterSpacing: "0.04em",
              }}
              htmlFor="cs-pdf-export-to"
            >
              TO
            </label>
            <input
              id="cs-pdf-export-to"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              style={{
                width: "100%",
                padding: "8px 10px",
                fontFamily: "inherit",
                fontSize: 13,
                background: "var(--bg, #0a0a0a)",
                color: "var(--text, #fff)",
                border: "1px solid var(--hairline, #333)",
                borderRadius: 4,
                marginBottom: 16,
              }}
            />

            {invalid ? (
              <div
                role="alert"
                className="mono"
                style={{
                  fontSize: 11,
                  color: "var(--bad, #cf2031)",
                  marginBottom: 12,
                }}
              >
                FROM must be on or before TO.
              </div>
            ) : null}

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <Btn variant="ghost" size="sm" onClick={() => setOpen(false)}>
                CANCEL
              </Btn>
              <Btn
                variant="primary"
                size="sm"
                disabled={invalid}
                onClick={onExport}
              >
                EXPORT
              </Btn>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

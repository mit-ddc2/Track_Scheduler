"use client";

import { useState } from "react";

import { Btn } from "@/components/ui/Btn";

type Props = {
  /** CRON_SECRET — passed in from the server, never inlined in the bundle */
  cronSecret: string;
};

/**
 * "Reset demo data" trigger + confirmation modal. Owner must type "RESET" to
 * arm the destructive action. POSTs to `/api/admin/reset-demo?key=...` which
 * itself re-checks `requireOwner()` and the constant-time key match.
 */
export function ResetDemoButton({ cronSecret }: Props) {
  const [open, setOpen] = useState(false);
  const [confirmInput, setConfirmInput] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "ok" | "error">(
    "idle",
  );
  const [message, setMessage] = useState<string | null>(null);

  const armed = confirmInput.trim().toUpperCase() === "RESET";

  function reset() {
    setOpen(false);
    setConfirmInput("");
    setStatus("idle");
    setMessage(null);
  }

  async function submit() {
    if (!armed) return;
    setStatus("submitting");
    setMessage(null);
    try {
      const res = await fetch(
        `/api/admin/reset-demo?key=${encodeURIComponent(cronSecret)}`,
        {
          method: "POST",
          // Same-origin cookies carry the owner session for requireOwner().
          credentials: "same-origin",
        },
      );
      const data = (await res
        .json()
        .catch(() => ({}))) as {
        ok?: boolean;
        counts?: Record<string, number>;
        error?: string;
        message?: string;
      };
      if (!res.ok || data.ok !== true) {
        setStatus("error");
        setMessage(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setStatus("ok");
      const summary = data.counts
        ? Object.entries(data.counts)
            .map(([k, v]) => `${v} ${k}`)
            .join(", ")
        : "done";
      setMessage(`Seeded: ${summary}`);
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <>
      <Btn variant="danger" onClick={() => setOpen(true)}>
        Reset demo data
      </Btn>
      {status === "ok" && message && (
        <div
          role="status"
          className="mono"
          style={{
            marginTop: 8,
            fontSize: 11,
            color: "var(--ok)",
          }}
        >
          ● {message}
        </div>
      )}
      {status === "error" && message && (
        <div
          role="alert"
          className="mono"
          style={{
            marginTop: 8,
            fontSize: 11,
            color: "var(--bad)",
          }}
        >
          ● Reset failed: {message}
        </div>
      )}
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="reset-demo-title"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.7)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
            zIndex: 1000,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget && status !== "submitting") {
              reset();
            }
          }}
        >
          <div
            className="cs-card"
            style={{
              maxWidth: 440,
              width: "100%",
              padding: 0,
              overflow: "hidden",
              background: "var(--surface)",
            }}
          >
            <div
              className="cs-stripes"
              style={{ height: 6 }}
              aria-hidden="true"
            />
            <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
              <span
                className="cs-eyebrow"
                style={{ color: "var(--accent)" }}
              >
                ● DESTRUCTIVE
              </span>
              <h2 id="reset-demo-title" className="cs-h2">
                Reset demo data
              </h2>
              <p
                style={{
                  margin: 0,
                  fontSize: 13,
                  lineHeight: 1.5,
                  color: "var(--text-2)",
                }}
              >
                This wipes <strong>ALL</strong> data — staff, events, invites,
                assignments, notifications, audit log — and re-seeds the
                canonical 6-staff / 3-event demo fixtures.
              </p>
              <label
                className="cs-label"
                htmlFor="reset-demo-confirm"
                style={{ marginTop: 4 }}
              >
                Type <span className="mono" style={{ color: "var(--accent)" }}>RESET</span> to confirm
              </label>
              <input
                id="reset-demo-confirm"
                type="text"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                value={confirmInput}
                disabled={status === "submitting"}
                onChange={(e) => setConfirmInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && armed && status !== "submitting") {
                    submit();
                  } else if (e.key === "Escape" && status !== "submitting") {
                    reset();
                  }
                }}
                style={{
                  background: "var(--bg-2)",
                  border: "1px solid var(--line)",
                  borderRadius: 4,
                  padding: "10px 12px",
                  color: "var(--text)",
                  fontFamily: "var(--font-jetbrains-mono), monospace",
                  fontSize: 14,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                }}
              />
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <Btn
                  variant="ghost"
                  onClick={reset}
                  disabled={status === "submitting"}
                >
                  Cancel
                </Btn>
                <Btn
                  variant="danger"
                  onClick={submit}
                  disabled={!armed || status === "submitting"}
                >
                  {status === "submitting" ? "Resetting…" : "Wipe + reseed"}
                </Btn>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

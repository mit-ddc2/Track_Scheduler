"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Btn } from "@/components/ui/Btn";
import { Card } from "@/components/ui/Card";

export type CancelEventPreview = {
  recipients: number;
  sms: number;
  email: number;
  manual_only: number;
  no_contact: number;
};

export type CancelEventResultLike = {
  id?: string;
  error?: string;
  notifications?: {
    recipients: number;
    sms_enqueued: number;
    email_enqueued: number;
    skipped_no_contact: number;
    skipped_opt_out: number;
    skipped_manual_only: number;
  };
};

export type CancelEventFormProps = {
  action: (reason: string) => Promise<CancelEventResultLike>;
  backHref: string;
  /** Pre-fetched preview of who would be notified — null when unavailable. */
  preview?: CancelEventPreview | null;
};

export function CancelEventForm({
  action,
  backHref,
  preview,
}: CancelEventFormProps) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState<CancelEventResultLike["notifications"] | null>(
    null,
  );

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await action(reason.trim());
      if (result.error) {
        setError(result.error);
        return;
      }
      // Show a brief confirmation before navigating away, so Robert sees the
      // notification count + has time to read it.
      setDone(result.notifications ?? null);
      // Small delay so the toast has time to register.
      setTimeout(() => {
        router.push(backHref);
        router.refresh();
      }, 1200);
    });
  };

  if (done) {
    return (
      <Card style={{ padding: 16, borderColor: "var(--ok)" }}>
        <p
          className="mono"
          style={{
            margin: 0,
            color: "var(--ok)",
            fontSize: 12,
            letterSpacing: "0.04em",
          }}
        >
          ● EVENT CANCELLED
        </p>
        <p style={{ margin: "8px 0 0", fontSize: 13, color: "var(--text-2)" }}>
          {done && done.recipients > 0
            ? `${done.recipients} notification${done.recipients === 1 ? "" : "s"} enqueued (${done.sms_enqueued} SMS + ${done.email_enqueued} email).`
            : "No notifications enqueued — nobody had accepted yet."}
        </p>
      </Card>
    );
  }

  return (
    <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {error && (
        <Card style={{ padding: 12, borderColor: "var(--bad)" }}>
          <p
            className="mono"
            style={{
              margin: 0,
              color: "var(--bad)",
              fontSize: 12,
              letterSpacing: "0.04em",
            }}
          >
            {error}
          </p>
        </Card>
      )}
      <Card style={{ padding: 16 }}>
        <label className="cs-label" htmlFor="reason" style={{ display: "block", marginBottom: 6 }}>
          Reason*
        </label>
        <textarea
          id="reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          required
          minLength={1}
          maxLength={1000}
          rows={4}
          placeholder="e.g. Weather — track closed for the day."
          style={{
            width: "100%",
            padding: "10px 12px",
            borderRadius: 4,
            border: "1px solid var(--line)",
            background: "var(--surface)",
            color: "var(--text)",
            fontFamily: "inherit",
            fontSize: 13,
            resize: "vertical",
          }}
        />
        <p
          className="mono"
          style={{
            margin: "8px 0 0",
            color: "var(--text-3)",
            fontSize: 11,
            letterSpacing: "0.04em",
          }}
        >
          The reason is appended to the event&apos;s manager notes, sent in the
          cancellation email body, and recorded in the audit log.
        </p>
      </Card>

      {preview && (
        <Card style={{ padding: 16 }}>
          <p
            className="mono"
            style={{
              margin: 0,
              fontSize: 11,
              letterSpacing: "0.04em",
              color: "var(--text-3)",
            }}
          >
            NOTIFICATIONS ON SUBMIT
          </p>
          <p
            style={{
              margin: "6px 0 0",
              fontSize: 14,
              fontWeight: 600,
              color: "var(--text)",
            }}
          >
            {preview.recipients === 0
              ? "No responders to notify."
              : `Will notify ${preview.recipients} responder${preview.recipients === 1 ? "" : "s"} (${preview.sms} SMS + ${preview.email} email).`}
          </p>
          {(preview.manual_only > 0 || preview.no_contact > 0) && (
            <p
              style={{
                margin: "6px 0 0",
                fontSize: 12,
                color: "var(--text-3)",
              }}
            >
              {preview.manual_only > 0 &&
                `${preview.manual_only} marked manual-only`}
              {preview.manual_only > 0 && preview.no_contact > 0 && " · "}
              {preview.no_contact > 0 &&
                `${preview.no_contact} with no reachable contact`}
              {" — call them directly."}
            </p>
          )}
        </Card>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <Btn
          type="submit"
          variant="danger"
          disabled={pending || reason.trim().length === 0}
          style={{ flex: 1 }}
        >
          {pending ? "CANCELLING…" : "CONFIRM CANCEL"}
        </Btn>
        <Link href={backHref} className="cs-btn" style={{ textDecoration: "none" }}>
          BACK
        </Link>
      </div>
    </form>
  );
}

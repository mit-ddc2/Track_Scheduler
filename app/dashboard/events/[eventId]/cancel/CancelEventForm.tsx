"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Btn } from "@/components/ui/Btn";
import { Card } from "@/components/ui/Card";

export type CancelEventFormProps = {
  action: (reason: string) => Promise<{ id?: string; error?: string }>;
  backHref: string;
};

export function CancelEventForm({ action, backHref }: CancelEventFormProps) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await action(reason.trim());
      if (result.error) {
        setError(result.error);
        return;
      }
      router.push(backHref);
      router.refresh();
    });
  };

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
            outline: "none",
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
          The reason is appended to the event&apos;s manager notes and recorded
          in the audit log.
        </p>
      </Card>
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

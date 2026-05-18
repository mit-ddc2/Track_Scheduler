"use client";

import { useState, useTransition } from "react";

import { Btn } from "@/components/ui/Btn";

import type { DrainNowResult } from "./drain-actions";

export type DrainNowButtonProps = {
  action: () => Promise<DrainNowResult>;
};

type Status =
  | { kind: "idle" }
  | { kind: "ok"; attempted: number; sent: number; failed: number; suppressed: number }
  | { kind: "error"; message: string };

export function DrainNowButton({ action }: DrainNowButtonProps) {
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const onClick = () => {
    setStatus({ kind: "idle" });
    startTransition(async () => {
      const res = await action();
      if (res.ok) {
        setStatus({
          kind: "ok",
          attempted: res.attempted,
          sent: res.sent,
          failed: res.failed,
          suppressed: res.suppressed,
        });
      } else {
        setStatus({ kind: "error", message: res.error });
      }
    });
  };

  return (
    <div>
      <Btn variant="ghost" onClick={onClick} disabled={pending}>
        {pending ? "Draining…" : "Send queued messages now"}
      </Btn>
      {status.kind === "ok" && (
        <div
          role="status"
          className="mono"
          style={{
            marginTop: 8,
            fontSize: 11,
            color: "var(--ok)",
            letterSpacing: "0.04em",
          }}
        >
          ● Attempted {status.attempted} · Sent {status.sent} · Failed{" "}
          {status.failed} · Suppressed {status.suppressed}
        </div>
      )}
      {status.kind === "error" && (
        <div
          role="alert"
          className="mono"
          style={{
            marginTop: 8,
            fontSize: 11,
            color: "var(--bad)",
            letterSpacing: "0.04em",
          }}
        >
          ● {status.message}
        </div>
      )}
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";

import { Btn } from "@/components/ui/Btn";

export type MarkAllWorkedButtonProps = {
  eventId: string;
  action: (input: { eventId: string }) => Promise<{
    ok?: true;
    error?: string;
    count?: number;
  }>;
};

/**
 * Confirms before flipping every confirmed/completed assignment to `worked`.
 * The confirm is deliberately a `window.confirm` — Phase 7 keeps the surface
 * area tiny; we can move to a Pit Wall modal once the design system has one.
 */
export function MarkAllWorkedButton({ eventId, action }: MarkAllWorkedButtonProps) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const onClick = () => {
    if (typeof window !== "undefined") {
      const ok = window.confirm(
        "Mark every confirmed assignee as WORKED?\nYou can still edit individual rows after.",
      );
      if (!ok) return;
    }
    setError(null);
    startTransition(async () => {
      const result = await action({ eventId });
      if (result.error) setError(result.error);
    });
  };

  return (
    <>
      <Btn size="sm" onClick={onClick} disabled={pending}>
        {pending ? "MARKING…" : "MARK ALL WORKED"}
      </Btn>
      {error && (
        <span
          role="alert"
          className="mono"
          style={{ marginLeft: 8, fontSize: 11, color: "var(--bad)" }}
        >
          {error}
        </span>
      )}
    </>
  );
}

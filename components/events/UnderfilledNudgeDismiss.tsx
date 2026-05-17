"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

import { dismissUnderfilledNudge } from "./underfilled-nudge-actions";

export type UnderfilledNudgeDismissProps = {
  eventId: string;
};

/**
 * "Dismiss" button for the underfilled nudge. Calls a server action that
 * writes a session cookie keyed to this event, then refreshes so the parent
 * server component sees the cookie and hides the banner.
 */
export function UnderfilledNudgeDismiss({
  eventId,
}: UnderfilledNudgeDismissProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const handleClick = () => {
    startTransition(async () => {
      await dismissUnderfilledNudge(eventId);
      router.refresh();
    });
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      className="cs-btn"
      style={{ flex: "0 0 auto", opacity: pending ? 0.6 : 1 }}
    >
      DISMISS
    </button>
  );
}

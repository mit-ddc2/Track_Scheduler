"use client";

import { useTransition } from "react";

import { Btn } from "@/components/ui/Btn";
import {
  archiveStaffMember,
  restoreStaffMember,
} from "@/app/dashboard/roster/actions";

type ArchiveButtonProps = {
  staffId: string;
  archived: boolean;
};

/** Toggles archive/restore for a staff member with a confirm step. */
export function ArchiveButton({ staffId, archived }: ArchiveButtonProps) {
  const [isPending, startTransition] = useTransition();

  function onClick() {
    if (archived) {
      startTransition(async () => {
        await restoreStaffMember(staffId);
      });
      return;
    }
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        "Archive this responder? They will be hidden from active rosters but their history is preserved.",
      )
    ) {
      return;
    }
    startTransition(async () => {
      await archiveStaffMember(staffId);
    });
  }

  return (
    <Btn
      variant={archived ? "default" : "danger"}
      onClick={onClick}
      disabled={isPending}
    >
      {isPending
        ? "Saving…"
        : archived
          ? "Restore"
          : "Archive"}
    </Btn>
  );
}

import { Chip, type ChipTone } from "@/components/ui/Chip";
import type { EventStatus } from "@/lib/db/types";

const MAP: Record<EventStatus, { tone: ChipTone; label: string }> = {
  draft: { tone: "default", label: "DRAFT" },
  scheduled: { tone: "info", label: "SCHEDULED" },
  inviting: { tone: "warn", label: "INVITING" },
  underfilled: { tone: "bad", label: "SHORT" },
  staffed: { tone: "ok", label: "STAFFED" },
  needs_review: { tone: "warn", label: "REVIEW" },
  locked: { tone: "accent", label: "LOCKED" },
  completed: { tone: "ok", label: "COMPLETED" },
  cancelled: { tone: "default", label: "CANCELLED" },
};

export function EventStatusChip({ status }: { status: EventStatus }) {
  const v = MAP[status] ?? MAP.scheduled;
  return <Chip tone={v.tone}>{v.label}</Chip>;
}

import { StatusDot, type StatusDotTone } from "@/components/ui/StatusDot";
import type { NotificationSeverity } from "@/lib/db/types";

const SEVERITY_TO_TONE: Record<NotificationSeverity, StatusDotTone> = {
  info: "ok",
  warning: "warn",
  urgent: "bad",
};

export function severityToTone(severity: NotificationSeverity): StatusDotTone {
  return SEVERITY_TO_TONE[severity] ?? "idle";
}

export function SeverityDot({
  severity,
}: {
  severity: NotificationSeverity;
}) {
  return <StatusDot tone={severityToTone(severity)} />;
}

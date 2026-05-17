import { Mail, MessageSquare } from "lucide-react";

import type { ContactChannel, ContactStatus } from "@/lib/db/types";

type ChannelBadgeProps = {
  channel: ContactChannel;
  /** When `present` is false, badge renders muted to signal no value on file. */
  present: boolean;
  status?: ContactStatus;
  size?: number;
};

/**
 * Small monochrome SMS/email badge used on the roster list. Tone is driven
 * by `present` first (no value → idle), then `status` for delivery health.
 */
export function ChannelBadge({
  channel,
  present,
  status = "unknown",
  size = 18,
}: ChannelBadgeProps) {
  const Icon = channel === "sms" ? MessageSquare : Mail;
  const tone = present ? statusTone(status, channel) : "idle";
  const palette = tonePalette(tone);
  return (
    <span
      aria-label={`${channel.toUpperCase()} ${present ? status : "missing"}`}
      title={`${channel.toUpperCase()} · ${present ? status : "missing"}`}
      style={{
        width: size,
        height: size,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 3,
        background: palette.bg,
        color: palette.fg,
        flexShrink: 0,
      }}
    >
      <Icon size={Math.round(size * 0.6)} strokeWidth={1.6} />
    </span>
  );
}

type BadgeTone = "ok" | "warn" | "bad" | "info" | "idle";

function statusTone(status: ContactStatus, channel: ContactChannel): BadgeTone {
  switch (status) {
    case "valid":
      return channel === "sms" ? "ok" : "info";
    case "unknown":
      return channel === "sms" ? "ok" : "info";
    case "invalid":
    case "bounced":
    case "suppressed":
    case "opted_out":
      return "bad";
    default:
      return "idle";
  }
}

function tonePalette(tone: BadgeTone): { bg: string; fg: string } {
  switch (tone) {
    case "ok":
      return {
        bg: "color-mix(in srgb, var(--ok) 14%, transparent)",
        fg: "var(--ok)",
      };
    case "warn":
      return {
        bg: "color-mix(in srgb, var(--warn) 14%, transparent)",
        fg: "var(--warn)",
      };
    case "bad":
      return {
        bg: "color-mix(in srgb, var(--bad) 14%, transparent)",
        fg: "var(--bad)",
      };
    case "info":
      return {
        bg: "color-mix(in srgb, var(--info) 14%, transparent)",
        fg: "var(--info)",
      };
    case "idle":
    default:
      return { bg: "var(--chip-bg)", fg: "var(--text-3)" };
  }
}

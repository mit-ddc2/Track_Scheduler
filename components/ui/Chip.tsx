import * as React from "react";

import { cn } from "@/lib/utils";

export type ChipTone =
  | "ok"
  | "warn"
  | "bad"
  | "info"
  | "accent"
  | "default";

export type ChipProps = React.HTMLAttributes<HTMLSpanElement> & {
  tone?: ChipTone;
  mono?: boolean;
};

/** Small uppercase status pill. Mirrors `cs-chip` family. */
export function Chip({
  className,
  tone = "default",
  mono = true,
  children,
  ...props
}: ChipProps) {
  return (
    <span
      className={cn(
        "cs-chip",
        tone !== "default" && `cs-chip--${tone}`,
        mono && "mono",
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}

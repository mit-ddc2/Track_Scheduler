import * as React from "react";

import { cn } from "@/lib/utils";

export type StatusDotTone = "ok" | "warn" | "bad" | "idle";

export type StatusDotProps = React.HTMLAttributes<HTMLSpanElement> & {
  tone?: StatusDotTone;
};

/** 6px halo dot for status indicators. Mirrors `cs-dot`. */
export function StatusDot({
  tone = "idle",
  className,
  ...props
}: StatusDotProps) {
  return (
    <span
      aria-hidden
      className={cn("cs-dot", `cs-dot--${tone}`, className)}
      {...props}
    />
  );
}

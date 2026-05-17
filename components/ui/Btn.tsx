import * as React from "react";

import { cn } from "@/lib/utils";

type BtnVariant = "primary" | "ghost" | "danger" | "default";
type BtnSize = "sm" | "lg" | "default";

export type BtnProps = Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "size"
> & {
  variant?: BtnVariant;
  size?: BtnSize;
};

/**
 * Pit Wall primary action. Maps to the `cs-btn` family from globals.css.
 * `default` variant uses the bare `cs-btn` look (surface bg, hairline border).
 */
export const Btn = React.forwardRef<HTMLButtonElement, BtnProps>(
  function Btn(
    {
      className,
      variant = "default",
      size = "default",
      type = "button",
      children,
      ...props
    },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type}
        className={cn(
          "cs-btn",
          variant !== "default" && `cs-btn--${variant}`,
          size !== "default" && `cs-btn--${size}`,
          className,
        )}
        {...props}
      >
        {children}
      </button>
    );
  },
);

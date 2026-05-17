import * as React from "react";

import { cn } from "@/lib/utils";

export type CardProps = React.HTMLAttributes<HTMLDivElement> & {
  hover?: boolean;
};

/** Surface container with hairline border. Mirrors `cs-card`. */
export const Card = React.forwardRef<HTMLDivElement, CardProps>(function Card(
  { className, hover, children, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn("cs-card", hover && "cs-card--hover", className)}
      {...props}
    >
      {children}
    </div>
  );
});

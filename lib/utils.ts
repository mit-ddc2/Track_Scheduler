import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Standard shadcn-style class composer: merges Tailwind utility classes while
 * de-duplicating conflicting ones. Use everywhere instead of raw template
 * strings so component variants stay predictable.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

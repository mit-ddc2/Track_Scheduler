import type { ReactElement, ReactNode } from "react";
import { describe, expect, it } from "vitest";

import NotFound from "./not-found";

/**
 * Walks a React element tree and concatenates all leaf strings, className
 * attributes, and href props into a single haystack so we can assert content
 * without pulling in a full render library. The tree contains circular refs
 * via Link/forwardRef components, so JSON.stringify can't be used directly.
 */
function collect(node: ReactNode, sink: string[]): void {
  if (node == null || typeof node === "boolean") return;
  if (typeof node === "string" || typeof node === "number") {
    sink.push(String(node));
    return;
  }
  if (Array.isArray(node)) {
    for (const child of node) collect(child, sink);
    return;
  }
  if (typeof node === "object" && "props" in node) {
    const el = node as ReactElement<Record<string, unknown>>;
    const props = el.props ?? {};
    if (typeof props.className === "string") sink.push(props.className);
    if (typeof props.href === "string") sink.push(props.href);
    if (typeof props["aria-label"] === "string") sink.push(props["aria-label"]);
    if ("children" in props) collect(props.children as ReactNode, sink);
  }
}

function haystack(node: ReactNode): string {
  const parts: string[] = [];
  collect(node, parts);
  return parts.join(" \n ");
}

describe("NotFound page", () => {
  it("renders the eyebrow, headline, body copy and both action links", () => {
    const text = haystack(NotFound());

    // Eyebrow + headline + body — verbatim from the spec.
    expect(text).toContain("● 404 · LOST");
    expect(text).toContain("Page not found");
    expect(text).toContain(
      "The page you were looking for either moved, expired, or never existed.",
    );

    // Both navigation hrefs must be present.
    expect(text).toContain("/dashboard");
    expect(text).toContain("/login");

    // Button labels.
    expect(text).toContain("Back to dashboard");
    expect(text).toContain("Go to login");
  });

  it("uses the Pit Wall design-system stripes accent", () => {
    const text = haystack(NotFound());
    expect(text).toContain("cs-stripes");
  });
});

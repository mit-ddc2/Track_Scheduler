import { NextResponse } from "next/server";

import {
  rsvpSubmitSchema,
  type RsvpSubmitInput,
} from "@/lib/validation/schemas";

import { submitRsvpResponseImpl as submitRsvpResponse } from "../rsvp-handler";

export const dynamic = "force-dynamic";

/**
 * POST /r/[token]/submit — fallback transport for the RSVP form.
 *
 * The React form uses a server action directly, but having a plain Route
 * Handler means the same flow works from curl, a basic HTML <form>, or any
 * non-JS client. The token from the URL `[token]` segment is authoritative;
 * the body's `token` field (if any) is ignored.
 *
 * Accepts JSON or `application/x-www-form-urlencoded`.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  let payload: unknown;
  const contentType = request.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("application/json")) {
      payload = await request.json();
    } else {
      const form = await request.formData();
      payload = Object.fromEntries(form.entries());
    }
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid request body" },
      { status: 400 },
    );
  }

  const obj = (payload ?? {}) as Record<string, unknown>;
  const candidate: RsvpSubmitInput = {
    token,
    action: (obj.action as RsvpSubmitInput["action"]) ?? "accept",
    note:
      typeof obj.note === "string" && obj.note.length > 0
        ? (obj.note as string)
        : null,
  };

  const parsed = rsvpSubmitSchema.safeParse(candidate);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: parsed.error.issues[0]?.message ?? "Invalid submission",
      },
      { status: 400 },
    );
  }

  const result = await submitRsvpResponse(parsed.data);
  if (!result.ok) {
    return NextResponse.json(result, { status: 400 });
  }
  return NextResponse.json(result);
}

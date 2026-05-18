"use client";

import * as React from "react";

import { Btn } from "@/components/ui/Btn";
import { createClient } from "@/lib/db/supabase-browser";

type FormState =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent"; email: string }
  | { kind: "error"; message: string }
  | { kind: "not_allowed" };

const NOT_AUTHORIZED_COPY =
  "This email isn't authorized to use Calabogie Safety. Contact the site admin.";

export function LoginForm() {
  const [email, setEmail] = React.useState("");
  const [state, setState] = React.useState<FormState>({ kind: "idle" });

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) {
      setState({ kind: "error", message: "Enter your email to continue." });
      return;
    }
    setState({ kind: "sending" });
    try {
      // v2: pre-check the email against the server-side allowlist before
      // touching Supabase Auth. Stops us from emailing a magic link to
      // random addresses and gives the user immediate feedback when their
      // email isn't on the list.
      let allowed = false;
      try {
        const res = await fetch("/api/auth/is-allowed", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: trimmed }),
        });
        if (res.status === 429) {
          setState({
            kind: "error",
            message:
              "Too many sign-in attempts. Wait a minute and try again.",
          });
          return;
        }
        const body = (await res.json().catch(() => ({}))) as {
          allowed?: boolean;
        };
        allowed = Boolean(body.allowed);
      } catch {
        // Network failure — fail closed; we'd rather refuse a legitimate
        // user (who can retry) than blast a magic link on a guess.
        setState({
          kind: "error",
          message: "Couldn't verify access right now. Try again in a moment.",
        });
        return;
      }
      if (!allowed) {
        setState({ kind: "not_allowed" });
        return;
      }

      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOtp({
        email: trimmed,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      if (error) {
        setState({ kind: "error", message: error.message });
        return;
      }
      setState({ kind: "sent", email: trimmed });
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : "Unexpected error.",
      });
    }
  }

  if (state.kind === "not_allowed") {
    return (
      <div
        role="alert"
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 12,
          padding: 16,
          borderRadius: 4,
          border: "1px solid color-mix(in srgb, var(--bad) 30%, transparent)",
          background: "color-mix(in srgb, var(--bad) 8%, transparent)",
        }}
      >
        <span className="cs-chip cs-chip--bad">Access denied</span>
        <p
          style={{
            margin: 0,
            fontSize: 14,
            color: "var(--text)",
            lineHeight: 1.45,
          }}
        >
          {NOT_AUTHORIZED_COPY}
        </p>
        <button
          type="button"
          className="cs-btn cs-btn--ghost cs-btn--sm"
          onClick={() => setState({ kind: "idle" })}
          style={{ alignSelf: "flex-start" }}
        >
          Try a different email
        </button>
      </div>
    );
  }

  if (state.kind === "sent") {
    return (
      <div
        role="status"
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 12,
          padding: 16,
          borderRadius: 4,
          border: "1px solid var(--line)",
          background: "var(--surface-2)",
        }}
      >
        <span
          className="cs-eyebrow"
          style={{ color: "var(--ok)", letterSpacing: "0.14em" }}
        >
          ● Magic link sent
        </span>
        <p style={{ margin: 0, fontSize: 14, color: "var(--text)" }}>
          Check{" "}
          <span className="mono" style={{ color: "var(--text)" }}>
            {state.email}
          </span>
          . Click the link in the email to sign in.
        </p>
        <button
          type="button"
          className="cs-btn cs-btn--ghost cs-btn--sm"
          onClick={() => setState({ kind: "idle" })}
          style={{ alignSelf: "flex-start" }}
        >
          Use a different email
        </button>
      </div>
    );
  }

  const sending = state.kind === "sending";

  return (
    <form
      onSubmit={onSubmit}
      style={{ display: "flex", flexDirection: "column", gap: 14 }}
    >
      <label
        htmlFor="email"
        className="cs-label"
        style={{ color: "var(--text-2)" }}
      >
        Email
      </label>
      <input
        id="email"
        type="email"
        autoComplete="email"
        required
        spellCheck={false}
        autoCapitalize="off"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@calabogie.example"
        disabled={sending}
        className="mono"
        style={{
          width: "100%",
          padding: "12px 14px",
          background: "var(--bg-2)",
          border: "1px solid var(--line)",
          borderRadius: 4,
          color: "var(--text)",
          fontSize: 14,
          transition: "border-color 100ms ease",
        }}
      />
      {state.kind === "error" && (
        <div
          role="alert"
          className="mono"
          style={{
            fontSize: 11,
            color: "var(--bad)",
            letterSpacing: "0.04em",
          }}
        >
          {state.message}
        </div>
      )}
      <Btn
        type="submit"
        variant="primary"
        size="lg"
        disabled={sending}
        style={{ marginTop: 6, opacity: sending ? 0.6 : 1 }}
      >
        {sending ? "Sending…" : "Send magic link"}
      </Btn>
    </form>
  );
}

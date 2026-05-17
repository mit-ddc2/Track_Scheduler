"use client";

import * as React from "react";

import { Btn } from "@/components/ui/Btn";
import { createClient } from "@/lib/db/supabase-browser";

type FormState =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent"; email: string }
  | { kind: "error"; message: string };

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
          outline: "none",
          transition: "border-color 100ms ease",
        }}
        onFocus={(e) => {
          e.currentTarget.style.borderColor = "var(--line-2)";
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor = "var(--line)";
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

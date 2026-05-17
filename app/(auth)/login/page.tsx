import type { Metadata } from "next";

import { LoginForm } from "@/components/auth/LoginForm";

export const metadata: Metadata = {
  title: "Sign in · Calabogie Safety",
};

type LoginPageProps = {
  searchParams: Promise<{ error?: string }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { error } = await searchParams;

  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "32px 20px",
        background: "var(--bg)",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 420,
          display: "flex",
          flexDirection: "column",
          gap: 18,
        }}
      >
        <div
          aria-hidden
          className="cs-stripes"
          style={{ width: 96, height: 8, borderRadius: 2 }}
        />
        <div
          className="cs-card"
          style={{ overflow: "hidden" }}
        >
          <div
            aria-hidden
            className="cs-stripes"
            style={{ height: 4, width: "100%" }}
          />
          <div
            style={{
              padding: "24px 24px 28px",
              display: "flex",
              flexDirection: "column",
              gap: 18,
            }}
          >
            <span className="cs-eyebrow">
              Calabogie Safety · Owner Access
            </span>
            <h1 className="cs-h1">Sign in</h1>
            <p
              className="cs-label"
              style={{
                color: "var(--text-2)",
                letterSpacing: "0.04em",
                textTransform: "none",
                lineHeight: 1.4,
              }}
            >
              Single-user dashboard. Magic link via email.
            </p>
            {error && (
              <div
                role="alert"
                className="mono"
                style={{
                  fontSize: 11,
                  color: "var(--bad)",
                  letterSpacing: "0.04em",
                  padding: "8px 10px",
                  border: "1px solid color-mix(in srgb, var(--bad) 30%, transparent)",
                  borderRadius: 3,
                  background: "color-mix(in srgb, var(--bad) 8%, transparent)",
                }}
              >
                {error === "callback"
                  ? "Sign-in link was invalid or expired. Request a new one below."
                  : "Sign-in failed. Try again."}
              </div>
            )}
            <LoginForm />
          </div>
        </div>
        <p
          className="mono"
          style={{
            fontSize: 10,
            color: "var(--text-3)",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            textAlign: "center",
            margin: 0,
          }}
        >
          Need access? Contact site admin.
        </p>
      </div>
    </main>
  );
}

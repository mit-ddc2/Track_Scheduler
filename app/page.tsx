import { redirect } from "next/navigation";

import { getSession } from "@/lib/auth/get-session";

export default async function Home() {
  const session = await getSession();

  if (!session) {
    redirect("/login");
  }

  if (session.profile?.is_owner === true) {
    redirect("/dashboard");
  }

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
        className="cs-card"
        style={{
          maxWidth: 460,
          width: "100%",
          padding: 24,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <span className="cs-eyebrow" style={{ color: "var(--warn)" }}>
          ● Access pending
        </span>
        <h1 className="cs-h2">Almost there</h1>
        <p
          style={{
            margin: 0,
            color: "var(--text-2)",
            fontSize: 14,
            lineHeight: 1.5,
          }}
        >
          You&rsquo;re signed in as{" "}
          <span className="mono" style={{ color: "var(--text)" }}>
            {session.user.email}
          </span>
          , but this account isn&rsquo;t an authorized owner yet. Contact the
          site admin to be granted access.
        </p>
        <form action="/auth/sign-out" method="post">
          <button
            type="submit"
            className="cs-btn cs-btn--ghost cs-btn--sm"
            style={{ marginTop: 4 }}
          >
            Sign out
          </button>
        </form>
      </div>
    </main>
  );
}

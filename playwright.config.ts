import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

/**
 * When the run has no Supabase secret, the only spec we ship (the happy-path
 * E2E) self-skips inside `test.describe`. Spinning up `pnpm dev` purely to
 * have it crash on missing env vars is wasted work and produces confusing
 * webServer timeouts in CI. Skip the webServer in that case so the run
 * exits with "0 tests / 0 failed" instead.
 */
const hasSecrets = !!(
  process.env.SUPABASE_SECRET_KEY && process.env.NEXT_PUBLIC_SUPABASE_URL
);

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: hasSecrets
    ? {
        command: "pnpm dev",
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      }
    : undefined,
});

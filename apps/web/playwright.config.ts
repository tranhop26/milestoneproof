import { defineConfig } from "@playwright/test"
import { env } from "node:process"

const PORT = 4178

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 15 * 60 * 1_000,
  expect: { timeout: 30_000 },
  reporter: "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    channel: "chrome",
    timezoneId: "UTC",
    trace: "off",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `pnpm exec vite --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: false,
    env: {
      ...env,
      VITE_ENABLE_E2E_WALLET: "true",
      VITE_MILESTONEPROOF_ADDRESS: env.E2E_CONTRACT_ADDRESS ?? "",
    },
  },
})

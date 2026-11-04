import { defineConfig } from "@playwright/test";
const baseURL = process.env.MULTI_CHAT_TEST_URL || "http://127.0.0.1:9137";
if (new URL(baseURL).port === "9121" || new URL(baseURL).port === "9119")
  throw new Error(
    "Browser tests refuse common production ports. Use a disposable dashboard on port 9137.",
  );
export default defineConfig({
  testDir: "./tests/browser",
  timeout: 90000,
  expect: { timeout: 30000 },
  workers: 1,
  fullyParallel: false,
  reporter: [
    ["list"],
    ["json", { outputFile: "test-results/browser-results.json" }],
  ],
  use: {
    baseURL,
    headless: true,
    viewport: { width: 1600, height: 1100 },
    trace: "off",
    screenshot: "off",
    video: "off",
  },
});

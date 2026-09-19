import { defineConfig, devices } from "@playwright/test";

import type { PearioTestOptions } from "./e2e/helpers";

export default defineConfig<PearioTestOptions>({
  testDir: "./e2e",
  timeout: 90000,
  expect: {
    timeout: 20000,
  },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "https://127.0.0.1:5137",
    ignoreHTTPSErrors: true,
    trace: "on-first-retry",
    acceptDownloads: true,
  },
  projects: [
    {
      name: "chrome-to-chrome",
      use: {
        ...devices["Desktop Chrome"],
        senderBrowserName: "chromium",
        receiverBrowserName: "chromium",
      },
    },
    {
      name: "chrome-to-firefox",
      use: {
        ...devices["Desktop Chrome"],
        senderBrowserName: "chromium",
        receiverBrowserName: "firefox",
      },
    },
    {
      name: "firefox-to-firefox",
      use: {
        ...devices["Desktop Firefox"],
        senderBrowserName: "firefox",
        receiverBrowserName: "firefox",
      },
    },
    {
      name: "firefox-to-chrome",
      use: {
        ...devices["Desktop Firefox"],
        senderBrowserName: "firefox",
        receiverBrowserName: "chromium",
      },
    },
  ],
});

import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  use: {
    baseURL: "http://127.0.0.1:4300",
    launchOptions: {
      executablePath:
        process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || "/usr/bin/chromium",
    },
  },
  webServer: {
    command: "PORT=4300 node build/index.js",
    url: "http://127.0.0.1:4300/api/health",
    reuseExistingServer: false,
    env: { SESSION_ENCRYPTION_KEY: "", RATE_LIMIT_KEY: "", NODE_ENV: "test" },
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 960 } } },
    { name: "tablet", use: { viewport: { width: 768, height: 1024 } } },
    { name: "mobile", use: { viewport: { width: 390, height: 844 } } },
  ],
});

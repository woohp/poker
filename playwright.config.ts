import { defineConfig } from "@playwright/test";

export default defineConfig({
    testDir: "./e2e",
    testMatch: "**/*.e2e.ts",
    timeout: 30_000,
    retries: process.env.CI ? 2 : 0,
    use: {
        baseURL: "http://127.0.0.1:4173",
        headless: true,
    },
    webServer: [
        {
            command: "npm run e2e:relay",
            port: 8000,
            reuseExistingServer: !process.env.CI,
        },
        {
            command: "npm run e2e:app",
            port: 4173,
            reuseExistingServer: !process.env.CI,
        },
    ],
});

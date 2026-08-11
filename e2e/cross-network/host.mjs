import { writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const [appUrl, run, roomFile, settleMsText] = process.argv.slice(2);
const settleMs = Number(settleMsText);
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
await context.addInitScript(() => {
    localStorage.setItem("poker-webrtc-debug", "1");
    window.__connectionDiagnostics = [];
    const originalDebug = console.debug;
    console.debug = (...args) => {
        window.__connectionDiagnostics.push({
            wallTime: Date.now(),
            monotonicTime: performance.now(),
            args,
        });
        originalDebug(...args);
    };
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
});

try {
    await page.goto(appUrl);
    await page.getByLabel("Your name").fill(`CrossNetworkHost${run}`);
    await page.getByText("Create Game", { exact: true }).click();
    await page.getByText("Create Room", { exact: true }).click();
    await page.waitForURL(/#\/room\//);
    const room = page.url().split("/").at(-1);
    writeFileSync(roomFile, room);

    await page.getByText("Players (2/10)").waitFor({ state: "visible", timeout: 60_000 });
    const playersTwoWallTime = Date.now();
    await page.waitForTimeout(settleMs);
    const diagnostics = await page.evaluate(() => window.__connectionDiagnostics ?? []);
    console.log(JSON.stringify({ run, room, playersTwoWallTime, diagnostics, errors }));
} finally {
    await browser.close();
}

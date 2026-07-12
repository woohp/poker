import { chromium, expect, firefox, test, type Browser } from "@playwright/test";

async function joinGame(browser: Browser, digital = false) {
    const hostContext = await browser.newContext();
    const guestContext = await browser.newContext();
    const host = await hostContext.newPage();
    const guest = await guestContext.newPage();

    await host.goto("./");
    await host.getByLabel("Your name").fill("Host");
    await host.getByText("Create Game", { exact: true }).click();
    if (digital) await host.getByText("Digital cards", { exact: true }).click();
    await host.getByText("Create Room", { exact: true }).click();

    const roomCode = host.url().split("/").at(-1);
    expect(roomCode).toBeTruthy();

    await guest.goto(`./#/join/${roomCode}`);
    await guest.getByLabel("Your name").fill("Guest");
    await guest.getByText("Join", { exact: true }).click();
    await expect(host.getByText("Players (2/10)")).toBeVisible({ timeout: 15_000 });

    return { hostContext, guestContext, host, guest };
}

test("a player can join and leave a game", async ({ browser }) => {
    const { hostContext, guestContext, host, guest } = await joinGame(browser);

    await expect(host.getByText("Guest", { exact: true })).toBeVisible();
    await guest.getByText("Leave Game", { exact: true }).click();
    await expect(host.getByText("Players (1/10)")).toBeVisible({ timeout: 5_000 });
    await expect(host.getByText("Guest", { exact: true })).not.toBeVisible();

    await guestContext.close();
    await hostContext.close();
});

test("digital hole cards arrive without refreshing", async ({ browser }) => {
    const { hostContext, guestContext, host, guest } = await joinGame(browser, true);

    await host.getByText("Start Game", { exact: true }).click();

    await expect(host.getByText("Your hand", { exact: true })).toBeVisible({ timeout: 5_000 });
    await expect(guest.getByText("Your hand", { exact: true })).toBeVisible({ timeout: 5_000 });

    await guestContext.close();
    await hostContext.close();
});

test("digital hole cards arrive from a Chromium host to a Firefox guest", async () => {
    const hostBrowser = await chromium.launch();
    const guestBrowser = await firefox.launch();
    const hostContext = await hostBrowser.newContext();
    const guestContext = await guestBrowser.newContext();
    const host = await hostContext.newPage();
    const guest = await guestContext.newPage();

    await host.goto("./");
    await host.getByLabel("Your name").fill("Host");
    await host.getByText("Create Game", { exact: true }).click();
    await host.getByText("Digital cards", { exact: true }).click();
    await host.getByText("Create Room", { exact: true }).click();

    const roomCode = host.url().split("/").at(-1);
    await guest.goto(`./#/join/${roomCode}`);
    await guest.getByLabel("Your name").fill("Guest");
    await guest.getByText("Join", { exact: true }).click();
    await expect(host.getByText("Players (2/10)")).toBeVisible({ timeout: 15_000 });

    await host.getByText("Start Game", { exact: true }).click();
    await expect(guest.getByText("Your hand", { exact: true })).toBeVisible({ timeout: 5_000 });

    await guestBrowser.close();
    await hostBrowser.close();
});

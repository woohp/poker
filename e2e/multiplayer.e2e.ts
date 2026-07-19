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

test("four players can act in turn", async ({ browser }) => {
    const contexts = await Promise.all(Array.from({ length: 4 }, () => browser.newContext()));
    const pages = await Promise.all(contexts.map((context) => context.newPage()));
    const [host, second, third, fourth] = pages;

    try {
        await host!.goto("./");
        await host!.getByLabel("Your name").fill("First");
        await host!.getByText("Create Game", { exact: true }).click();
        await host!.getByText("Create Room", { exact: true }).click();
        const roomCode = host!.url().split("/").at(-1);
        expect(roomCode).toBeTruthy();

        for (const [index, page] of [second!, third!, fourth!].entries()) {
            await page.goto(`./#/join/${roomCode}`);
            await page.getByLabel("Your name").fill(["Second", "Third", "Fourth"][index]!);
            await page.getByText("Join", { exact: true }).click();
            await expect(host!.getByText(`Players (${index + 2}/10)`)).toBeVisible({
                timeout: 15_000,
            });
        }

        await host!.getByText("Start Game", { exact: true }).click();
        await expect(fourth!.getByText("Check", { exact: true })).toBeVisible();
        await fourth!.getByText("Check", { exact: true }).click();

        await expect(host!.getByText("Call 10", { exact: true })).toBeVisible();
        await host!.getByText("Call 10", { exact: true }).click();
        await expect(second!.getByText("Call 10", { exact: true })).toBeVisible();
        await second!.getByText("Call 10", { exact: true }).click();
        await expect(third!.getByText("Call 5", { exact: true })).toBeVisible();
        await third!.getByText("Call 5", { exact: true }).click();

        await expect(host!.getByText("flop", { exact: true })).toBeVisible({ timeout: 5_000 });

        await expect(host!.getByText("Check", { exact: true })).toBeVisible();
        await host!.getByText("Check", { exact: true }).click();
        await expect(third!.getByText("Check", { exact: true })).toBeVisible();
        await third!.getByText("Check", { exact: true }).click();
        await expect(fourth!.getByText("Check", { exact: true })).toBeVisible();
        await fourth!.getByText("Check", { exact: true }).click();
        await expect(second!.getByText("Check", { exact: true })).toBeVisible();
        await second!.getByText("Check", { exact: true }).click();

        await expect(host!.getByText("turn", { exact: true })).toBeVisible({ timeout: 5_000 });
    } finally {
        await Promise.all(contexts.map((context) => context.close()));
    }
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

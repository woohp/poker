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

test("a player can refresh during their turn and continue", async ({ browser }) => {
    const { hostContext, guestContext, host, guest } = await joinGame(browser);

    try {
        await host.getByText("Start Game", { exact: true }).click();
        let currentPage = host;
        await expect
            .poll(async () => {
                if (await host.locator('button[data-action="fold"]').isVisible()) {
                    currentPage = host;
                    return "ready";
                }
                if (await guest.locator('button[data-action="fold"]').isVisible()) {
                    currentPage = guest;
                    return "ready";
                }
                return "waiting";
            })
            .toBe("ready");

        await currentPage.reload();
        await expect(currentPage.locator('button[data-action="fold"]')).toBeVisible({
            timeout: 15_000,
        });
        await currentPage.locator('button[data-action="fold"]').click();

        let outcome = "waiting";
        await expect
            .poll(async () => {
                if (await host.getByText("New Hand", { exact: true }).isVisible()) {
                    outcome = "complete";
                } else if (
                    await currentPage
                        .getByText("The turn changed before this action arrived.", { exact: true })
                        .isVisible()
                ) {
                    outcome = "recovered";
                }
                return outcome;
            })
            .not.toBe("waiting");

        if (outcome === "recovered") {
            await expect(currentPage.locator('button[data-action="fold"]')).toBeEnabled();
            await currentPage.locator('button[data-action="fold"]').click();
        }

        await expect(host.getByText("New Hand", { exact: true })).toBeVisible({ timeout: 10_000 });
    } finally {
        await Promise.all([hostContext.close(), guestContext.close()]);
    }
});

test("the host can refresh mid-hand without replaying old actions", async ({ browser }) => {
    const { hostContext, guestContext, host, guest } = await joinGame(browser);

    try {
        await host.getByText("Start Game", { exact: true }).click();
        const guestAction = guest.locator(
            'button[data-action="check"], button[data-action="call"]',
        );
        await expect(guestAction).toBeVisible();
        await guestAction.click();

        await expect(host.locator('button[data-action="fold"]')).toBeVisible();
        const revisionBeforeRefresh = await host.evaluate(() => {
            const raw = localStorage.getItem("poker_game_state");
            return raw ? (JSON.parse(raw) as { revision: number }).revision : -1;
        });

        await host.reload();
        await expect(host.locator('button[data-action="fold"]')).toBeVisible({ timeout: 15_000 });
        const revisionAfterRefresh = await host.evaluate(() => {
            const raw = localStorage.getItem("poker_game_state");
            return raw ? (JSON.parse(raw) as { revision: number }).revision : -1;
        });
        expect(revisionAfterRefresh).toBeGreaterThanOrEqual(revisionBeforeRefresh);

        const hostAction = host.locator('button[data-action="check"], button[data-action="call"]');
        await expect(hostAction).toBeVisible();
        await hostAction.click();

        await expect(host.getByText("flop", { exact: true })).toBeVisible({ timeout: 10_000 });
        await expect(guest.getByText("flop", { exact: true })).toBeVisible({ timeout: 10_000 });
    } finally {
        await Promise.all([hostContext.close(), guestContext.close()]);
    }
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

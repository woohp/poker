import { chromium, expect, firefox, test, type Browser, type Page } from "@playwright/test";
import { createRoom, joinRoom } from "./helpers";

async function joinGame(
    browser: Browser,
    {
        digital = false,
        failableStorage = false,
    }: { digital?: boolean; failableStorage?: boolean } = {},
) {
    const hostContext = await browser.newContext();
    const guestContext = await browser.newContext();
    if (failableStorage) {
        await hostContext.addInitScript(() => {
            const originalSetItem = Object.getOwnPropertyDescriptor(Storage.prototype, "setItem")!
                .value as (this: Storage, key: string, value: string) => void;
            Object.defineProperty(Storage.prototype, "setItem", {
                configurable: true,
                value(this: Storage, key: string, value: string) {
                    if (
                        key === "poker_game_state" &&
                        (window as Window & { __failPokerPersistence?: boolean })
                            .__failPokerPersistence
                    ) {
                        throw new Error("simulated storage failure");
                    }
                    Reflect.apply(originalSetItem, this, [key, value]);
                },
            });
        });
    }
    const host = await hostContext.newPage();
    const guest = await guestContext.newPage();

    const roomCode = await createRoom(host, "Host", { digital });
    await joinRoom(host, guest, roomCode, "Guest", 2);

    const close = () => Promise.all([hostContext.close(), guestContext.close()]);
    return { host, guest, close };
}

async function savedRevision(page: Page): Promise<number> {
    return page.evaluate(() => {
        const raw = localStorage.getItem("poker_game_state");
        return raw ? (JSON.parse(raw) as { history: unknown[] }).history.length : -1;
    });
}

test("a player can join and leave a game", async ({ browser }) => {
    const { host, guest, close } = await joinGame(browser);

    try {
        await expect(host.getByText("Guest", { exact: true })).toBeVisible();
        await guest.getByText("Leave Game", { exact: true }).click();
        await expect(host.getByText("Players (1/10)")).toBeVisible({ timeout: 5_000 });
        await expect(host.getByText("Guest", { exact: true })).not.toBeVisible();
    } finally {
        await close();
    }
});

test("a player can refresh during their turn and continue", async ({ browser }) => {
    const { host, guest, close } = await joinGame(browser);

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
        await close();
    }
});

test("the host can refresh mid-hand without replaying old actions", async ({ browser }) => {
    const { host, guest, close } = await joinGame(browser);

    try {
        await host.getByText("Start Game", { exact: true }).click();
        const guestAction = guest.locator(
            'button[data-action="check"], button[data-action="call"]',
        );
        await expect(guestAction).toBeVisible();
        await guestAction.click();

        await expect(host.locator('button[data-action="fold"]')).toBeVisible();
        const revisionBeforeRefresh = await savedRevision(host);

        await host.reload();
        await expect(host.locator('button[data-action="fold"]')).toBeVisible({ timeout: 15_000 });
        expect(await savedRevision(host)).toBeGreaterThanOrEqual(revisionBeforeRefresh);

        const hostAction = host.locator('button[data-action="check"], button[data-action="call"]');
        await expect(hostAction).toBeVisible();
        await hostAction.click();

        await expect(host.getByText("flop", { exact: true })).toBeVisible({ timeout: 10_000 });
        await expect(guest.getByText("flop", { exact: true })).toBeVisible({ timeout: 10_000 });
    } finally {
        await close();
    }
});

test("an unsaved host revision is not published", async ({ browser }) => {
    const { host, guest, close } = await joinGame(browser, { failableStorage: true });

    try {
        await host.getByText("Start Game", { exact: true }).click();
        const guestAction = guest.locator(
            'button[data-action="check"], button[data-action="call"]',
        );
        await expect(guestAction).toBeVisible();
        const guestStateBefore = await guest.evaluate(() =>
            JSON.stringify((window as Window & { __pokerGameState?: unknown }).__pokerGameState),
        );

        const storageFailureInstalled = await host.evaluate(() => {
            (window as Window & { __failPokerPersistence?: boolean }).__failPokerPersistence = true;
            try {
                localStorage.setItem("poker_game_state", "test");
                return false;
            } catch {
                return true;
            }
        });
        expect(storageFailureInstalled).toBe(true);
        await guestAction.click();

        await expect(host.getByText(/The game could not be saved/)).toBeVisible();
        await host.waitForTimeout(500);
        const guestStateAfter = await guest.evaluate(() =>
            JSON.stringify((window as Window & { __pokerGameState?: unknown }).__pokerGameState),
        );
        expect(guestStateAfter).toBe(guestStateBefore);
    } finally {
        await close();
    }
});

test("four players can act in turn", async ({ browser }) => {
    const contexts = await Promise.all(Array.from({ length: 4 }, () => browser.newContext()));
    const pages = await Promise.all(contexts.map((context) => context.newPage()));
    const [host, second, third, fourth] = pages;

    try {
        const roomCode = await createRoom(host!, "First");
        for (const [index, page] of [second!, third!, fourth!].entries()) {
            await joinRoom(host!, page, roomCode, ["Second", "Third", "Fourth"][index]!, index + 2);
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
    const { host, guest, close } = await joinGame(browser, { digital: true });

    try {
        await host.getByText("Start Game", { exact: true }).click();

        await expect(host.getByText("Your hand", { exact: true })).toBeVisible({ timeout: 5_000 });
        await expect(guest.getByText("Your hand", { exact: true })).toBeVisible({ timeout: 5_000 });
    } finally {
        await close();
    }
});

test("digital dealer state survives a host refresh", async ({ browser }) => {
    const { host, guest, close } = await joinGame(browser, { digital: true });

    try {
        await host.getByText("Start Game", { exact: true }).click();
        const hostHand = host.getByText("Your hand", { exact: true }).locator("..");
        await expect(hostHand).toBeVisible();
        const cardsBeforeRefresh = await hostHand.textContent();

        await host.reload();
        const restoredHand = host.getByText("Your hand", { exact: true }).locator("..");
        await expect(restoredHand).toBeVisible({ timeout: 15_000 });
        expect(await restoredHand.textContent()).toBe(cardsBeforeRefresh);

        await guest.locator('button[data-action="check"], button[data-action="call"]').click();
        await host.locator('button[data-action="check"], button[data-action="call"]').click();
        await expect(host.getByText("flop", { exact: true })).toBeVisible({ timeout: 10_000 });
        await expect(guest.getByText("flop", { exact: true })).toBeVisible({ timeout: 10_000 });
    } finally {
        await close();
    }
});

test("digital hole cards arrive from a Chromium host to a Firefox guest", async () => {
    const hostBrowser = await chromium.launch();
    const guestBrowser = await firefox.launch();

    try {
        const host = await hostBrowser.newPage();
        const guest = await guestBrowser.newPage();
        const roomCode = await createRoom(host, "Host", { digital: true });
        await joinRoom(host, guest, roomCode, "Guest", 2);

        await host.getByText("Start Game", { exact: true }).click();
        await expect(guest.getByText("Your hand", { exact: true })).toBeVisible({ timeout: 5_000 });
    } finally {
        await Promise.all([guestBrowser.close(), hostBrowser.close()]);
    }
});

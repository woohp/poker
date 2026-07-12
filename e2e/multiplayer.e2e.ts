import { expect, test } from "@playwright/test";

test("a player can join and leave a game", async ({ browser }) => {
    const hostContext = await browser.newContext();
    const guestContext = await browser.newContext();
    const host = await hostContext.newPage();
    const guest = await guestContext.newPage();

    await host.goto("/");
    await host.getByLabel("Your name").fill("Host");
    await host.getByText("Create Game", { exact: true }).click();
    await host.getByText("Create Room", { exact: true }).click();

    const roomCode = host.url().split("/").at(-1);
    expect(roomCode).toBeTruthy();

    await guest.goto(`/#/join/${roomCode}`);
    await guest.getByLabel("Your name").fill("Guest");
    await guest.getByText("Join", { exact: true }).click();

    await expect(host.getByText("Players (2/10)")).toBeVisible({ timeout: 15_000 });
    await expect(host.getByText("Guest", { exact: true })).toBeVisible();

    await guest.getByText("Leave Game", { exact: true }).click();

    await expect(host.getByText("Players (1/10)")).toBeVisible({ timeout: 5_000 });
    await expect(host.getByText("Guest", { exact: true })).not.toBeVisible();

    await guestContext.close();
    await hostContext.close();
});

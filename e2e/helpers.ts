import { expect, type Page } from "@playwright/test";

export async function createRoom(
    host: Page,
    name: string,
    { digital = false, startingChips }: { digital?: boolean; startingChips?: number } = {},
): Promise<string> {
    await host.goto("./");
    await host.getByLabel("Your name").fill(name);
    await host.getByText("Create Game", { exact: true }).click();
    if (digital) await host.getByText("Digital cards", { exact: true }).click();
    if (startingChips) await host.getByLabel("Starting Chips").fill(String(startingChips));
    await host.getByText("Create Room", { exact: true }).click();
    await host.waitForURL(/#\/room\//);

    const roomCode = host.url().split("/").at(-1);
    expect(roomCode).toBeTruthy();
    return roomCode!;
}

export async function joinRoom(
    host: Page,
    guest: Page,
    roomCode: string,
    name: string,
    expectedPlayerCount: number,
): Promise<void> {
    await guest.goto(`./#/join/${roomCode}`);
    await guest.getByLabel("Your name").fill(name);
    await guest.getByText("Join", { exact: true }).click();
    await expect(host.getByText(`Players (${expectedPlayerCount}/10)`)).toBeVisible({
        timeout: 15_000,
    });
}

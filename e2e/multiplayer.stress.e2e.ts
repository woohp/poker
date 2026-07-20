import {
    expect,
    test,
    type Browser,
    type BrowserContext,
    type Page,
    type TestInfo,
} from "@playwright/test";

const HAND_COUNT = Number(process.env.POKER_STRESS_HANDS || 100);
const PLAYER_COUNT = Number(process.env.POKER_STRESS_PLAYERS || 4);
const SEED = Number(process.env.POKER_STRESS_SEED || 20260320);
const STARTING_CHIPS = 1_000_000;

interface StoredPlayer {
    chips: number;
    currentBet: number;
    handContribution: number;
    isActive: boolean;
    hasFolded: boolean;
    hasActed: boolean;
    isCurrentTurn: boolean;
}

interface StoredState {
    phase: string;
    pot: number;
    currentBet: number;
    round: number;
    players: StoredPlayer[];
}

interface BotTable {
    contexts: BrowserContext[];
    pages: Page[];
    host: Page;
}

test.skip(!process.env.POKER_STRESS, "Run with npm run test:stress");
test.setTimeout(Math.max(120_000, HAND_COUNT * 5_000));

test(`randomized ${PLAYER_COUNT}-player table remains synchronized for ${HAND_COUNT} hands`, async ({
    browser,
}, testInfo) => {
    const runSeed = SEED + testInfo.repeatEachIndex;
    const random = createRandom(runSeed);
    const log: string[] = [`seed=${runSeed} hands=${HAND_COUNT} players=${PLAYER_COUNT}`];
    const table = await createTable(browser, PLAYER_COUNT);

    try {
        for (let hand = 1; hand <= HAND_COUNT; hand++) {
            if (hand === 1 || hand % 10 === 0) {
                console.log(`seed ${runSeed}: stress hand ${hand}/${HAND_COUNT}`);
            }
            if (hand > 1) {
                await expect(table.host.getByText("New Hand", { exact: true })).toBeVisible();
                await table.host.getByText("New Hand", { exact: true }).click();
            }

            await playHand(table, random, log);
            const state = await readState(table.host);
            expect(state.round, `unexpected round after stress hand ${hand}`).toBe(hand);
            assertStateInvariants(state);

            if (hand % 10 === 0) {
                log.push(`completed hand ${hand}`);
            }
        }
    } catch (error) {
        await attachDiagnostics(testInfo, table.pages, log);
        throw error;
    } finally {
        await Promise.all(table.contexts.map((context) => context.close()));
    }
});

async function createTable(browser: Browser, playerCount: number): Promise<BotTable> {
    const contexts = await Promise.all(
        Array.from({ length: playerCount }, () => browser.newContext()),
    );
    const pages = await Promise.all(contexts.map((context) => context.newPage()));
    for (const page of pages) page.setDefaultTimeout(5_000);
    const host = pages[0]!;

    await host.goto("./");
    await host.getByLabel("Your name").fill("Bot 1");
    await host.getByText("Create Game", { exact: true }).click();
    await host.getByText("Digital cards", { exact: true }).click();
    await host.getByLabel("Starting Chips").fill(String(STARTING_CHIPS));
    await host.getByText("Create Room", { exact: true }).click();
    const roomCode = host.url().split("/").at(-1)!;

    for (let index = 1; index < pages.length; index++) {
        const page = pages[index]!;
        await page.goto(`./#/join/${roomCode}`);
        await page.getByLabel("Your name").fill(`Bot ${index + 1}`);
        await page.getByText("Join", { exact: true }).click();
        await expect(host.getByText(`Players (${index + 1}/10)`)).toBeVisible({
            timeout: 15_000,
        });
    }

    await host.getByText("Start Game", { exact: true }).click();
    await waitForConvergence(pages);
    return { contexts, pages, host };
}

async function playHand(table: BotTable, random: () => number, log: string[]): Promise<void> {
    for (let actionIndex = 0; actionIndex < 100; actionIndex++) {
        const state = await readState(table.host);
        if (state.phase === "showdown" && state.pot === 0) {
            await waitForConvergence(table.pages);
            return;
        }

        const initialCurrentPage = await findCurrentPlayerPage(table.pages);
        if (!initialCurrentPage) return;
        await queueRandomChecks(table.pages, initialCurrentPage, random);
        const currentPage = await findCurrentPlayerPage(table.pages);
        if (!currentPage) return;
        const before = JSON.stringify(await readState(table.host));
        const action = await chooseAndPerformAction(currentPage, random);
        if (!action) {
            await waitForConvergence(table.pages);
            continue;
        }
        const actionLog = `round=${(await readState(table.host)).round} action=${action}`;
        log.push(actionLog);
        await expect
            .poll(async () => JSON.stringify(await readStateWithTimeout(table.host, 0)), {
                message: `${action} did not change the host state`,
                timeout: 5_000,
            })
            .not.toBe(before);
        await waitForConvergence(table.pages);
        const convergedState = await readState(table.host);
        assertStateInvariants(convergedState);
        if (isBettingRoundComplete(convergedState)) {
            try {
                await expect
                    .poll(async () => (await readStateWithTimeout(table.host, 0)).phase, {
                        message: "Completed betting round did not advance",
                        timeout: 5_000,
                    })
                    .not.toBe(convergedState.phase);
            } catch (error) {
                throw new Error(
                    `${String(error)}\nState: ${JSON.stringify(convergedState)}\nRecent actions:\n${log.slice(-20).join("\n")}`,
                );
            }
            await waitForConvergence(table.pages);
        }
        await currentPage.waitForTimeout(Math.floor(random() * 25));
    }

    throw new Error("Hand exceeded 100 actions without reaching showdown");
}

async function findCurrentPlayerPage(pages: Page[]): Promise<Page | null> {
    let current: Page | undefined;
    try {
        await expect
            .poll(
                async () => {
                    const state = await readStateWithTimeout(pages[0]!, 0);
                    if (state.phase === "showdown" && state.pot === 0) {
                        current = undefined;
                        return "showdown";
                    }

                    const currentPlayerIndex = state.players.findIndex(
                        (player) => player.isCurrentTurn,
                    );
                    current = pages[currentPlayerIndex];
                    if (
                        current &&
                        (await current.locator('button[data-action="fold"]').isVisible())
                    ) {
                        return "current";
                    }
                    return "waiting";
                },
                { message: "The current player did not receive action buttons", timeout: 5_000 },
            )
            .not.toBe("waiting");
    } catch (error) {
        const states = await Promise.all(
            pages.map((page, index) => readStateWithTimeout(page, index)),
        );
        throw new Error(`${String(error)}\nPlayer states: ${JSON.stringify(states)}`);
    }
    return current || null;
}

async function queueRandomChecks(
    pages: Page[],
    currentPage: Page,
    random: () => number,
): Promise<void> {
    for (const page of pages) {
        if (page === currentPage || random() >= 0.15) continue;
        const check = page.locator("button[data-queue-check]");
        const canQueue = await check.isEnabled({ timeout: 100 }).catch(() => false);
        if (canQueue && (await check.isVisible())) {
            await check.click({ timeout: 500 }).catch(() => {
                // Another queued check can advance the turn while this optional click is in flight.
            });
        }
    }
}

async function chooseAndPerformAction(page: Page, random: () => number): Promise<string | null> {
    const choices: Array<{ name: string; weight: number }> = [];
    if (await page.locator('button[data-action="check"]').isVisible()) {
        choices.push({ name: "check", weight: 55 });
    }
    if (await page.locator('button[data-action="call"]').isVisible()) {
        choices.push({ name: "call", weight: 55 });
    }
    if (await page.locator('button[data-action="raise"]').isVisible()) {
        choices.push({ name: "raise", weight: 20 });
    }
    choices.push({ name: "fold", weight: 12 });

    const action = weightedChoice(choices, random);
    try {
        switch (action) {
            case "check":
                await page.locator('button[data-action="check"]').click({ timeout: 1_000 });
                break;
            case "call":
                await page.locator('button[data-action="call"]').click({ timeout: 1_000 });
                break;
            case "raise": {
                const input = page.getByPlaceholder("Raise amount");
                await input.fill((await input.getAttribute("min")) || "0", { timeout: 1_000 });
                await page.locator('button[data-action="raise"]').click({ timeout: 1_000 });
                break;
            }
            case "allin":
                await page.locator('button[data-action="allin"]').click({ timeout: 1_000 });
                break;
            case "fold":
                await page.locator('button[data-action="fold"]').click({ timeout: 1_000 });
                break;
        }
    } catch (error) {
        if (!(await page.locator('button[data-action="fold"]').isVisible())) {
            return null;
        }
        throw error;
    }
    return action;
}

async function waitForConvergence(pages: Page[]): Promise<void> {
    await expect
        .poll(
            async () => {
                const snapshots = await Promise.all(
                    pages.map(async (page, index) =>
                        JSON.stringify(await readStateWithTimeout(page, index)),
                    ),
                );
                return new Set(snapshots).size;
            },
            { message: "Player game states did not converge", timeout: 5_000 },
        )
        .toBe(1);
}

async function readStateWithTimeout(page: Page, playerIndex: number): Promise<StoredState> {
    return Promise.race([
        readState(page),
        new Promise<never>((_, reject) => {
            setTimeout(
                () => reject(new Error(`Bot ${playerIndex + 1} page became unresponsive`)),
                1000,
            );
        }),
    ]);
}

async function readState(page: Page): Promise<StoredState> {
    return page.evaluate(() => {
        const state = (
            window as Window & {
                __pokerGameState?: StoredState;
            }
        ).__pokerGameState;
        if (!state) throw new Error("No game state available");
        return state;
    });
}

function assertStateInvariants(state: StoredState): void {
    expect(state.pot).toBeGreaterThanOrEqual(0);
    expect(state.currentBet).toBeGreaterThanOrEqual(0);
    expect(state.players.every((player) => player.chips >= 0)).toBe(true);
    expect(
        state.players.reduce((sum, player) => sum + player.chips, 0) + state.pot,
        "chips plus pot must remain constant",
    ).toBe(STARTING_CHIPS * PLAYER_COUNT);

    const currentPlayers = state.players.filter((player) => player.isCurrentTurn);
    if (state.phase === "waiting" || state.phase === "showdown") {
        expect(currentPlayers).toHaveLength(0);
    } else {
        expect(currentPlayers).toHaveLength(1);
        expect(currentPlayers[0]!.isActive).toBe(true);
        expect(currentPlayers[0]!.hasFolded).toBe(false);
    }
}

function isBettingRoundComplete(state: StoredState): boolean {
    if (state.phase === "waiting" || state.phase === "showdown") return false;
    return state.players
        .filter((player) => player.isActive && !player.hasFolded)
        .every(
            (player) =>
                player.chips === 0 || (player.hasActed && player.currentBet === state.currentBet),
        );
}

function weightedChoice(
    choices: Array<{ name: string; weight: number }>,
    random: () => number,
): string {
    const total = choices.reduce((sum, choice) => sum + choice.weight, 0);
    let value = random() * total;
    for (const choice of choices) {
        value -= choice.weight;
        if (value <= 0) return choice.name;
    }
    return choices.at(-1)!.name;
}

function createRandom(seed: number): () => number {
    let value = seed >>> 0;
    return () => {
        value = (value * 1664525 + 1013904223) >>> 0;
        return value / 0x1_0000_0000;
    };
}

async function attachDiagnostics(testInfo: TestInfo, pages: Page[], log: string[]): Promise<void> {
    const states = await Promise.all(
        pages.map(async (page, index) => {
            try {
                return {
                    player: index + 1,
                    state: await readStateWithTimeout(page, index),
                };
            } catch (error) {
                return { player: index + 1, error: String(error) };
            }
        }),
    );
    await testInfo.attach("stress-log", {
        body: Buffer.from(log.join("\n")),
        contentType: "text/plain",
    });
    await testInfo.attach("player-states", {
        body: Buffer.from(JSON.stringify(states, null, 2)),
        contentType: "application/json",
    });
}

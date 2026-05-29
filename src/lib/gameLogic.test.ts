import { beforeEach, describe, expect, it } from "vite-plus/test";
import {
    addPlayer,
    advancePhase,
    applyPotWinners,
    applyPayouts,
    calculatePotAllocations,
    clearGameState,
    clearSession,
    createInitialGameState,
    getCurrentPlayerIndex,
    getNextPlayerIndex,
    getValidActions,
    isBettingRoundComplete,
    loadGameState,
    loadSession,
    processAction,
    removePlayer,
    saveGameState,
    saveSession,
    setCurrentPlayer,
    startNewHand,
} from "./gameLogic";
import type { GameConfig, GameState } from "./types";

const config: GameConfig = {
    startingChips: 1000,
    smallBlind: 5,
    bigBlind: 10,
    ante: 0,
};

function installLocalStorageMock() {
    const store = new Map<string, string>();

    Object.defineProperty(globalThis, "localStorage", {
        value: {
            getItem: (key: string) => store.get(key) ?? null,
            setItem: (key: string, value: string) => {
                store.set(key, value);
            },
            removeItem: (key: string) => {
                store.delete(key);
            },
            clear: () => {
                store.clear();
            },
        },
        configurable: true,
    });
}

function createState(playerCount = 2, overrides: Partial<GameConfig> = {}): GameState {
    const state = createInitialGameState({ ...config, ...overrides }, "Host", "host");
    const names = [
        "Guest",
        "Third",
        "Fourth",
        "Fifth",
        "Sixth",
        "Seventh",
        "Eighth",
        "Ninth",
        "Tenth",
    ];

    for (let i = 0; i < playerCount - 1; i++) {
        addPlayer(state, names[i]!, `p${i + 2}`);
    }

    return state;
}

function currentPlayerId(state: GameState): string | undefined {
    return state.players.find((player) => player.isCurrentTurn)?.id;
}

beforeEach(() => {
    installLocalStorageMock();
});

describe("session and game persistence", () => {
    it("saves and loads session data", () => {
        saveSession({
            localPlayerId: "p1",
            isHost: true,
            roomCode: "ROOM123",
            playerName: "Host",
        });

        expect(loadSession()).toEqual({
            localPlayerId: "p1",
            isHost: true,
            roomCode: "ROOM123",
            playerName: "Host",
        });

        clearSession();
        expect(loadSession()).toBeNull();
    });

    it("saves and loads game state", () => {
        const state = createState(3);
        saveGameState(state);
        expect(loadGameState()).toEqual(state);

        clearGameState();
        expect(loadGameState()).toBeNull();
    });
});

describe("player management", () => {
    it("creates the host with expected defaults", () => {
        const state = createInitialGameState(config, "Host", "host");

        expect(state.phase).toBe("waiting");
        expect(state.players).toHaveLength(1);
        expect(state.lastPayouts).toEqual([]);
        expect(state.players[0]).toMatchObject({
            id: "host",
            name: "Host",
            chips: 1000,
            isDealer: true,
            isHost: true,
            hasFolded: false,
            hasActed: false,
            isCurrentTurn: false,
        });
    });

    it("adds up to 10 players and rejects the 11th", () => {
        const state = createState(10);
        expect(state.players).toHaveLength(10);
        expect(addPlayer(state, "Overflow", "overflow")).toBeNull();
    });

    it("removes a player by id", () => {
        const state = createState(3);
        removePlayer(state, "p2");
        expect(state.players.map((player) => player.id)).toEqual(["host", "p3"]);
    });
});

describe("turn helpers", () => {
    it("finds the next active player and skips folded players", () => {
        const state = createState(3);
        state.players[1]!.hasFolded = true;

        expect(getNextPlayerIndex(state.players, 0)).toBe(2);
    });

    it("sets and reports the current player", () => {
        const state = createState(3);
        setCurrentPlayer(state.players, "p3");

        expect(getCurrentPlayerIndex(state.players)).toBe(2);
        expect(currentPlayerId(state)).toBe("p3");
    });
});

describe("hand setup", () => {
    it("assigns heads-up blinds correctly and makes the dealer act first preflop", () => {
        const state = createState(2);

        startNewHand(state);

        expect(state.players.find((player) => player.isDealer)?.id).toBe("p2");
        expect(state.players.find((player) => player.isSmallBlind)?.id).toBe("p2");
        expect(state.players.find((player) => player.isBigBlind)?.id).toBe("host");
        expect(currentPlayerId(state)).toBe("p2");
        expect(state.pot).toBe(15);
        expect(state.currentBet).toBe(10);
    });

    it("applies antes to the pot before blinds", () => {
        const state = createState(3, { ante: 2 });

        startNewHand(state);

        expect(state.pot).toBe(21);
        expect(state.players.map((player) => player.chips)).toEqual([988, 998, 993]);
    });

    it("does not start a hand when fewer than two players have chips", () => {
        const state = createState(2);
        state.players[1]!.chips = 0;

        startNewHand(state);

        expect(state.phase).toBe("waiting");
        expect(state.statusMessage).toContain("Need at least 2 players");
    });
});

describe("valid actions", () => {
    it("returns no actions when it is not the player turn", () => {
        const state = createState(2);
        startNewHand(state);

        const host = state.players.find((player) => player.id === "host")!;
        expect(getValidActions(state, host)).toEqual([]);
    });

    it("offers call and raise when facing a bet, and check when not", () => {
        const state = createState(2);
        startNewHand(state);

        const guest = state.players.find((player) => player.id === "p2")!;
        expect(getValidActions(state, guest)).toEqual(["fold", "call", "raise", "allin"]);

        processAction(state, "p2", "call");
        const host = state.players.find((player) => player.id === "host")!;
        expect(getValidActions(state, host)).toEqual(["fold", "check", "raise", "allin"]);
    });
});

describe("betting actions", () => {
    it("rejects out-of-turn and invalid raises", () => {
        const state = createState(2);
        startNewHand(state);

        expect(processAction(state, "host", "call")).toBe(false);
        expect(processAction(state, "p2", "raise", 15)).toBe(false);
    });

    it("processes call and keeps the round open until the other player acts", () => {
        const state = createState(2);
        startNewHand(state);

        expect(processAction(state, "p2", "call")).toBe(true);
        expect(state.players.find((player) => player.id === "p2")?.currentBet).toBe(10);
        expect(state.players.find((player) => player.id === "p2")?.chips).toBe(990);
        expect(state.pot).toBe(20);
        expect(currentPlayerId(state)).toBe("host");
        expect(isBettingRoundComplete(state)).toBe(false);
    });

    it("processes raise and resets other active players to needing action", () => {
        const state = createState(3);
        startNewHand(state);

        expect(processAction(state, "p2", "call")).toBe(true);
        expect(processAction(state, "p3", "raise", 30)).toBe(true);

        expect(state.currentBet).toBe(30);
        expect(state.minRaise).toBe(20);
        expect(state.players.find((player) => player.id === "p2")?.hasActed).toBe(false);
        expect(state.players.find((player) => player.id === "host")?.hasActed).toBe(false);
        expect(currentPlayerId(state)).toBe("host");
        expect(isBettingRoundComplete(state)).toBe(false);
    });

    it("processes all-in that increases the bet", () => {
        const state = createState(2);
        startNewHand(state);

        const guest = state.players.find((player) => player.id === "p2")!;
        guest.chips = 40;

        expect(processAction(state, "p2", "allin")).toBe(true);
        expect(guest.chips).toBe(0);
        expect(guest.currentBet).toBe(45);
        expect(state.currentBet).toBe(45);
        expect(state.minRaise).toBe(35);
        expect(currentPlayerId(state)).toBe("host");
    });

    it("marks folded players and auto-awards the pot when only one player remains", () => {
        const state = createState(2);
        startNewHand(state);

        expect(processAction(state, "p2", "fold")).toBe(true);
        expect(state.phase).toBe("showdown");
        expect(state.lastPayouts).toEqual([{ playerId: "host", playerName: "Host", amount: 15 }]);
        expect(state.players.find((player) => player.id === "host")?.chips).toBe(1005);
        expect(state.pot).toBe(0);
    });
});

describe("betting round completion and phase progression", () => {
    it("requires all active non-all-in players to act and match the current bet", () => {
        const state = createState(3);
        startNewHand(state);

        expect(isBettingRoundComplete(state)).toBe(false);
        processAction(state, "p2", "call");
        expect(isBettingRoundComplete(state)).toBe(false);
        processAction(state, "p3", "call");
        expect(isBettingRoundComplete(state)).toBe(false);
        processAction(state, "host", "check");
        expect(isBettingRoundComplete(state)).toBe(true);
    });

    it("advances phases, resets bets/acted state, and adds community placeholders", () => {
        const state = createState(3);
        startNewHand(state);
        processAction(state, "p2", "call");
        processAction(state, "p3", "call");
        processAction(state, "host", "check");

        advancePhase(state);
        expect(state.phase).toBe("flop");
        expect(state.communityCards).toEqual([0, 0, 0]);
        expect(currentPlayerId(state)).toBe("p3");

        advancePhase(state);
        expect(state.phase).toBe("turn");
        expect(state.communityCards).toEqual([0, 0, 0, 0]);

        advancePhase(state);
        expect(state.phase).toBe("river");
        expect(state.communityCards).toEqual([0, 0, 0, 0, 0]);

        advancePhase(state);
        expect(state.phase).toBe("showdown");
    });
});

describe("manual outcome recording", () => {
    it("applies a single winner payout and clears the pot", () => {
        const state = createState(3);
        startNewHand(state);
        state.phase = "showdown";
        state.pot = 120;

        expect(applyPayouts(state, [{ playerId: "p2", amount: 120 }])).toBe(true);
        expect(state.players.find((player) => player.id === "p2")?.chips).toBe(1120);
        expect(state.pot).toBe(0);
        expect(state.lastPayouts).toEqual([{ playerId: "p2", playerName: "Guest", amount: 120 }]);
    });

    it("calculates side pots and applies winners by pot", () => {
        const state = createState(3);
        state.phase = "showdown";
        state.pot = 120;
        state.players[0]!.handContribution = 20;
        state.players[1]!.handContribution = 50;
        state.players[2]!.handContribution = 50;

        const pots = calculatePotAllocations(state);
        expect(pots).toEqual([
            { amount: 60, eligiblePlayerIds: ["host", "p2", "p3"] },
            { amount: 60, eligiblePlayerIds: ["p2", "p3"] },
        ]);

        expect(applyPotWinners(state, [["host"], ["p3"]])).toBe(true);
        expect(state.players.find((player) => player.id === "host")?.chips).toBe(1060);
        expect(state.players.find((player) => player.id === "p3")?.chips).toBe(1060);
    });

    it("supports split pots when host records multiple payouts", () => {
        const state = createState(3);
        state.phase = "showdown";
        state.pot = 90;

        expect(
            applyPayouts(state, [
                { playerId: "host", amount: 45 },
                { playerId: "p2", amount: 45 },
            ]),
        ).toBe(true);

        expect(state.players.find((player) => player.id === "host")?.chips).toBe(1045);
        expect(state.players.find((player) => player.id === "p2")?.chips).toBe(1045);
    });

    it("rejects invalid pot winner selections and bad payouts", () => {
        const state = createState(2);
        state.phase = "showdown";
        state.pot = 50;

        expect(applyPayouts(state, [{ playerId: "host", amount: 40 }])).toBe(false);
        expect(applyPayouts(state, [{ playerId: "missing", amount: 50 }])).toBe(false);
        state.players[0]!.handContribution = 20;
        state.players[1]!.handContribution = 30;
        expect(applyPotWinners(state, [[], ["p2"]])).toBe(false);
        expect(applyPotWinners(state, [["missing"], ["p2"]])).toBe(false);
        expect(state.pot).toBe(50);
    });
});

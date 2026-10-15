import { describe, expect, it } from "vite-plus/test";
import {
    addPlayer,
    advancePhase,
    applyPayouts,
    applyPotWinners,
    calculatePotAllocations,
    createInitialGameState,
    getValidActions,
    isBettingRoundComplete,
    processAction,
    removePlayer,
    startNewHand,
} from "./gameLogic";
import type { GameConfig, GameState, Player } from "./types";

const config: GameConfig = {
    mode: "physical",
    startingChips: 1000,
    smallBlind: 5,
    bigBlind: 10,
    ante: 0,
};

/** Seats the host plus players p2..pN; p2 is named "Guest". */
function createState(playerCount = 2, overrides: Partial<GameConfig> = {}): GameState {
    const state = createInitialGameState({ ...config, ...overrides }, "Host", "host");
    for (let seat = 2; seat <= playerCount; seat++) {
        addPlayer(state, seat === 2 ? "Guest" : `Player ${seat}`, `p${seat}`);
    }
    return state;
}

function player(state: GameState, id: string): Player {
    return state.players.find((entry) => entry.id === id)!;
}

describe("player management", () => {
    it("adds up to 10 players and rejects the 11th", () => {
        const state = createState(10);
        expect(state.players).toHaveLength(10);
        expect(addPlayer(state, "Overflow", "overflow")).toBeNull();
    });

    it("removes a player by id", () => {
        const state = createState(3);
        removePlayer(state, "p2");
        expect(state.players.map((entry) => entry.id)).toEqual(["host", "p3"]);
    });
});

describe("hand setup", () => {
    it("assigns heads-up blinds correctly and makes the dealer act first preflop", () => {
        const state = createState(2);

        startNewHand(state);

        expect(state.dealerId).toBe("p2");
        expect(state.smallBlindId).toBe("p2");
        expect(state.bigBlindId).toBe("host");
        expect(state.currentPlayerId).toBe("p2");
        expect(state.pot).toBe(15);
        expect(state.currentBet).toBe(10);
    });

    it("rotates the button and blinds each hand", () => {
        const state = createState(3);

        startNewHand(state);
        expect([state.dealerId, state.smallBlindId, state.bigBlindId]).toEqual([
            "p2",
            "p3",
            "host",
        ]);
        startNewHand(state);
        expect([state.dealerId, state.smallBlindId, state.bigBlindId]).toEqual([
            "p3",
            "host",
            "p2",
        ]);
    });

    it("applies antes to the pot before blinds", () => {
        const state = createState(3, { ante: 2 });

        startNewHand(state);

        expect(state.pot).toBe(21);
        expect(state.players.map((entry) => entry.chips)).toEqual([988, 998, 993]);
    });

    it("does not start a hand when fewer than two players have chips", () => {
        const state = createState(2);
        player(state, "p2").chips = 0;

        startNewHand(state);

        expect(state.phase).toBe("waiting");
        expect(state.statusMessage).toContain("Need at least 2 players");
    });
});

describe("valid actions", () => {
    it("returns no actions when it is not the player turn", () => {
        const state = createState(2);
        startNewHand(state);

        expect(getValidActions(state, player(state, "host"))).toEqual([]);
    });

    it("offers call and raise when facing a bet, and check when not", () => {
        const state = createState(2);
        startNewHand(state);

        expect(getValidActions(state, player(state, "p2"))).toEqual([
            "fold",
            "call",
            "raise",
            "allin",
        ]);

        processAction(state, "p2", "call");
        expect(getValidActions(state, player(state, "host"))).toEqual([
            "fold",
            "check",
            "raise",
            "allin",
        ]);
    });
});

describe("betting actions", () => {
    it("rejects out-of-turn actions, short raises, and unfunded raises", () => {
        const state = createState(2);
        startNewHand(state);

        expect(processAction(state, "host", "call")).toBe(false);
        expect(processAction(state, "p2", "raise", 15)).toBe(false);
        player(state, "p2").chips = 10;
        expect(processAction(state, "p2", "raise", 30)).toBe(false);
    });

    it("processes call and keeps the round open until the other player acts", () => {
        const state = createState(2);
        startNewHand(state);

        expect(processAction(state, "p2", "call")).toBe(true);
        expect(player(state, "p2")).toMatchObject({ currentBet: 10, chips: 990 });
        expect(state.pot).toBe(20);
        expect(state.currentPlayerId).toBe("host");
        expect(isBettingRoundComplete(state)).toBe(false);
    });

    it("processes raise and resets other active players to needing action", () => {
        const state = createState(3);
        startNewHand(state);

        expect(processAction(state, "p2", "call")).toBe(true);
        expect(processAction(state, "p3", "raise", 30)).toBe(true);

        expect(state.currentBet).toBe(30);
        expect(state.minRaise).toBe(20);
        expect(player(state, "p2").hasActed).toBe(false);
        expect(player(state, "host").hasActed).toBe(false);
        expect(state.currentPlayerId).toBe("host");
        expect(isBettingRoundComplete(state)).toBe(false);
    });

    it("processes a full all-in raise and reopens betting", () => {
        const state = createState(2);
        startNewHand(state);
        const guest = player(state, "p2");
        guest.chips = 40;

        expect(processAction(state, "p2", "allin")).toBe(true);
        expect(guest).toMatchObject({ chips: 0, currentBet: 45 });
        expect(state.currentBet).toBe(45);
        expect(state.minRaise).toBe(35);
        expect(state.currentPlayerId).toBe("host");
    });

    it("does not reopen betting or reduce the minimum raise after a short all-in", () => {
        const state = createState(3);
        startNewHand(state);
        expect(processAction(state, "p2", "call")).toBe(true);

        player(state, "p3").chips = 10;
        expect(processAction(state, "p3", "allin")).toBe(true);

        expect(state.currentBet).toBe(15);
        expect(state.minRaise).toBe(10);
        expect(player(state, "p2").hasActed).toBe(true);
        expect(processAction(state, "host", "call")).toBe(true);
        expect(getValidActions(state, player(state, "p2"))).toEqual(["fold", "call"]);
        expect(processAction(state, "p2", "call")).toBe(true);
        expect(isBettingRoundComplete(state)).toBe(true);
    });

    it("reopens raising after cumulative short all-ins reach a full raise", () => {
        const state = createState(4);
        state.phase = "preflop";
        state.currentBet = 100;
        state.minRaise = 100;
        const host = player(state, "host");
        Object.assign(host, { currentBet: 100, hasActed: true, actedAtBet: 100 });
        state.currentPlayerId = "p2";

        player(state, "p2").chips = 150;
        expect(processAction(state, "p2", "allin")).toBe(true);
        expect(host.hasActed).toBe(true);

        expect(processAction(state, "p3", "call")).toBe(true);
        const interveningCaller = player(state, "p3");
        expect(interveningCaller.actedAtBet).toBe(150);

        player(state, "p4").chips = 200;
        expect(processAction(state, "p4", "allin")).toBe(true);

        expect(host.hasActed).toBe(false);
        expect(getValidActions(state, host)).toContain("raise");
        expect(interveningCaller.hasActed).toBe(true);
    });

    it("auto-awards the pot when only one player remains", () => {
        const state = createState(2);
        startNewHand(state);

        expect(processAction(state, "p2", "fold")).toBe(true);
        expect(state.phase).toBe("showdown");
        expect(state.currentPlayerId).toBeNull();
        expect(state.lastPayouts).toEqual([{ playerId: "host", playerName: "Host", amount: 15 }]);
        expect(player(state, "host").chips).toBe(1005);
        expect(state.pot).toBe(0);
    });
});

describe("betting round completion and phase progression", () => {
    it("completes immediately when no more than one player can still act", () => {
        const state = createState(3);
        startNewHand(state);
        player(state, "p2").chips = 0;
        player(state, "p3").chips = 0;

        expect(isBettingRoundComplete(state)).toBe(true);
    });

    it("waits for the sole remaining actor when they still owe chips", () => {
        const state = createState(3);
        startNewHand(state);
        player(state, "p2").chips = 0;
        player(state, "p3").chips = 0;
        state.currentBet = 20;

        expect(isBettingRoundComplete(state)).toBe(false);
    });

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

    it("advances phases with the first player after the dealer acting", () => {
        const state = createState(3);
        startNewHand(state);
        processAction(state, "p2", "call");
        processAction(state, "p3", "call");
        processAction(state, "host", "check");

        advancePhase(state);
        expect(state.phase).toBe("flop");
        expect(state.currentBet).toBe(0);
        expect(state.players.every((entry) => !entry.hasActed && entry.currentBet === 0)).toBe(
            true,
        );
        expect(state.currentPlayerId).toBe("p3");

        advancePhase(state);
        expect(state.phase).toBe("turn");
        advancePhase(state);
        expect(state.phase).toBe("river");
        advancePhase(state);
        expect(state.phase).toBe("showdown");
        expect(state.currentPlayerId).toBeNull();
    });
});

describe("outcome recording", () => {
    it("applies single and split payouts and clears the pot", () => {
        const state = createState(3);
        state.phase = "showdown";
        state.pot = 90;

        expect(
            applyPayouts(state, [
                { playerId: "host", amount: 45 },
                { playerId: "p2", amount: 45 },
            ]),
        ).toBe(true);

        expect(player(state, "host").chips).toBe(1045);
        expect(player(state, "p2").chips).toBe(1045);
        expect(state.pot).toBe(0);
        expect(state.lastPayouts).toEqual([
            { playerId: "host", playerName: "Host", amount: 45 },
            { playerId: "p2", playerName: "Guest", amount: 45 },
        ]);
    });

    it("rejects invalid payouts without changing chip balances", () => {
        const state = createState(2);
        state.phase = "showdown";
        state.pot = 50;
        const chipsBefore = state.players.map((entry) => entry.chips);

        expect(applyPayouts(state, [{ playerId: "host", amount: 40 }])).toBe(false);
        expect(
            applyPayouts(state, [
                { playerId: "host", amount: 25 },
                { playerId: "missing", amount: 25 },
            ]),
        ).toBe(false);
        expect(state.players.map((entry) => entry.chips)).toEqual(chipsBefore);
        expect(state.pot).toBe(50);
    });

    it("calculates side pots and applies winners by pot", () => {
        const state = createState(3);
        state.phase = "showdown";
        state.pot = 120;
        player(state, "host").handContribution = 20;
        player(state, "p2").handContribution = 50;
        player(state, "p3").handContribution = 50;

        expect(calculatePotAllocations(state)).toEqual([
            { amount: 60, eligiblePlayerIds: ["host", "p2", "p3"] },
            { amount: 60, eligiblePlayerIds: ["p2", "p3"] },
        ]);
        expect(applyPotWinners(state, [[], ["p3"]])).toBe(false);
        expect(applyPotWinners(state, [["host"], ["host"]])).toBe(false);

        expect(applyPotWinners(state, [["host"], ["p3"]])).toBe(true);
        expect(player(state, "host").chips).toBe(1060);
        expect(player(state, "p3").chips).toBe(1060);
    });
});

import { describe, expect, it } from "vite-plus/test";
import { addPlayer, createInitialGameState, startNewHand } from "./gameLogic";
import { PokerGame, reducePokerState, type PokerCommand } from "./pokerGame";
import type { GameState } from "./types";

function createState(): GameState {
    const state = createInitialGameState(
        {
            mode: "physical",
            startingChips: 1000,
            smallBlind: 5,
            bigBlind: 10,
            ante: 0,
        },
        "Host",
        "host",
    );
    addPlayer(state, "Guest", "guest");
    startNewHand(state);
    return state;
}

function createCommand(state: GameState): PokerCommand {
    const player = state.players.find((entry) => entry.isCurrentTurn)!;
    return { playerId: player.id, round: state.round, action: "fold" };
}

describe("PokerGame", () => {
    it("owns its state while using the pure poker reducer", () => {
        const initial = createState();
        const command = createCommand(initial);
        const game = new PokerGame(initial);

        const result = game.execute(command, { actorId: command.playerId });

        expect(result.accepted).toBe(true);
        expect(initial.players.find((player) => player.id === command.playerId)?.hasFolded).toBe(
            false,
        );
        expect(
            game.snapshot().players.find((player) => player.id === command.playerId)?.hasFolded,
        ).toBe(true);
    });

    it("does not change its state when the reducer rejects a command", () => {
        const initial = createState();
        const command = createCommand(initial);
        const game = new PokerGame(initial);

        const result = game.execute(command, { actorId: "different-player" });

        expect(result).toEqual({ accepted: false, reason: "wrong-player" });
        expect(game.snapshot()).toEqual(initial);
    });

    it("exposes the poker transition as a pure function", () => {
        const initial = createState();
        const command = createCommand(initial);

        const result = reducePokerState(initial, command, { actorId: command.playerId });

        expect(result.accepted).toBe(true);
        expect(initial.players.find((player) => player.id === command.playerId)?.hasFolded).toBe(
            false,
        );
    });
});

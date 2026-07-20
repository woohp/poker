import { describe, expect, it } from "vite-plus/test";
import { GameCommandProcessor } from "./commandProcessor";
import { addPlayer, createInitialGameState, startNewHand } from "./gameLogic";
import type { ActionMessage, GameState } from "./types";

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
    state.revision = 7;
    return state;
}

function createCommand(state: GameState, overrides: Partial<ActionMessage> = {}): ActionMessage {
    const currentPlayer = state.players.find((player) => player.isCurrentTurn)!;
    return {
        type: "action",
        commandId: "command-1",
        authorityEpoch: state.authorityEpoch,
        playerId: currentPlayer.id,
        round: state.round,
        expectedRevision: state.revision,
        action: "fold",
        ...overrides,
    };
}

describe("GameCommandProcessor", () => {
    it("applies a valid command without mutating the input state", () => {
        const processor = new GameCommandProcessor();
        const state = createState();
        const command = createCommand(state);

        const processed = processor.process(state, command, command.playerId);

        expect(processed.result).toMatchObject({
            commandId: command.commandId,
            accepted: true,
            revision: 8,
        });
        expect(processed.state).not.toBe(state);
        expect(state.players.find((player) => player.id === command.playerId)?.hasFolded).toBe(
            false,
        );
        expect(
            processed.state.players.find((player) => player.id === command.playerId)?.hasFolded,
        ).toBe(true);
    });

    it("returns the original result without applying a duplicate command twice", () => {
        const processor = new GameCommandProcessor();
        const state = createState();
        const command = createCommand(state);

        const first = processor.process(state, command, command.playerId);
        const duplicate = processor.process(first.state, command, command.playerId);

        expect(duplicate.duplicate).toBe(true);
        expect(duplicate.result).toEqual(first.result);
        expect(duplicate.state).toEqual(first.state);
    });

    it.each([
        ["wrong-player", { playerId: "other" }],
        ["wrong-hand", { round: 99 }],
        ["stale-state", { expectedRevision: 6 }],
        ["stale-authority", { authorityEpoch: "old-authority" }],
    ] as const)("rejects %s commands with the authoritative state", (reason, overrides) => {
        const processor = new GameCommandProcessor();
        const state = createState();
        const command = createCommand(state, overrides);
        const sender = reason === "wrong-player" ? "different-peer" : command.playerId;

        const processed = processor.process(state, command, sender);

        expect(processed.result).toMatchObject({
            accepted: false,
            reason,
            revision: state.revision,
            state,
        });
        expect(processed.state).toEqual(state);
    });
});

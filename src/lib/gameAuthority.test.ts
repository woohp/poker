import { describe, expect, it } from "vite-plus/test";
import { GameAuthority } from "./gameAuthority";
import { addPlayer, createInitialGameState, startNewHand } from "./gameLogic";
import type { ActionMessage, GameSnapshot } from "./types";

function createSnapshot(): GameSnapshot {
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
    return { authorityEpoch: "authority-test", revision: 7, state };
}

function createCommand(
    snapshot: GameSnapshot,
    overrides: Partial<ActionMessage> = {},
): ActionMessage {
    const currentPlayer = snapshot.state.players.find((player) => player.isCurrentTurn)!;
    return {
        type: "action",
        commandId: "command-1",
        authorityEpoch: snapshot.authorityEpoch,
        playerId: currentPlayer.id,
        round: snapshot.state.round,
        expectedRevision: snapshot.revision,
        action: "fold",
        ...overrides,
    };
}

describe("GameAuthority", () => {
    it("applies a valid command without mutating the input snapshot", () => {
        const authority = new GameAuthority();
        const snapshot = createSnapshot();
        const command = createCommand(snapshot);

        const processed = authority.processRemote(snapshot, command, command.playerId);

        expect(processed.result).toMatchObject({
            commandId: command.commandId,
            accepted: true,
            revision: 8,
        });
        expect(processed.snapshot).not.toBe(snapshot);
        expect(
            snapshot.state.players.find((player) => player.id === command.playerId)?.hasFolded,
        ).toBe(false);
        expect(
            processed.snapshot.state.players.find((player) => player.id === command.playerId)
                ?.hasFolded,
        ).toBe(true);
    });

    it("returns the original result without applying a duplicate command twice", () => {
        const authority = new GameAuthority();
        const snapshot = createSnapshot();
        const command = createCommand(snapshot);

        const first = authority.processRemote(snapshot, command, command.playerId);
        const duplicate = authority.processRemote(first.snapshot, command, command.playerId);

        expect(duplicate.duplicate).toBe(true);
        expect(duplicate.result).toEqual(first.result);
        expect(duplicate.snapshot).toEqual(first.snapshot);
    });

    it.each([
        ["wrong-player", { playerId: "other" }],
        ["wrong-hand", { round: 99 }],
        ["stale-state", { expectedRevision: 6 }],
        ["stale-authority", { authorityEpoch: "old-authority" }],
    ] as const)("rejects %s commands with the authoritative snapshot", (reason, overrides) => {
        const authority = new GameAuthority();
        const snapshot = createSnapshot();
        const command = createCommand(snapshot, overrides);
        const sender = reason === "wrong-player" ? "different-peer" : command.playerId;

        const processed = authority.processRemote(snapshot, command, sender);

        expect(processed.result).toMatchObject({
            accepted: false,
            reason,
            revision: snapshot.revision,
            snapshot,
        });
        expect(processed.snapshot).toEqual(snapshot);
    });
});

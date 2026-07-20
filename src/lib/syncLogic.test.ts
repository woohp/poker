import { describe, expect, it } from "vite-plus/test";
import { createInitialGameState } from "./gameLogic";
import { isCurrentAction, shouldApplyState } from "./syncLogic";
import type { ActionMessage, GameState } from "./types";

function createState(revision: number, round = 1): GameState {
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
    state.revision = revision;
    state.round = round;
    return state;
}

function createAction(overrides: Partial<ActionMessage> = {}): ActionMessage {
    return {
        type: "action",
        commandId: "command-1",
        playerId: "guest",
        round: 3,
        expectedRevision: 12,
        action: "fold",
        ...overrides,
    };
}

describe("state synchronization", () => {
    it("ignores a delayed state older than the state already applied", () => {
        expect(shouldApplyState(createState(12), createState(11))).toBe(false);
    });

    it("accepts a newer authoritative state", () => {
        expect(shouldApplyState(createState(11), createState(12))).toBe(true);
    });

    it("rejects a replayed command from an earlier revision", () => {
        expect(isCurrentAction(createState(13, 3), createAction(), "guest")).toBe(false);
    });

    it("rejects commands from an earlier hand and commands claiming another peer", () => {
        const state = createState(12, 4);

        expect(isCurrentAction(state, createAction(), "guest")).toBe(false);
        expect(isCurrentAction(state, createAction({ round: 4, playerId: "other" }), "guest")).toBe(
            false,
        );
    });

    it("accepts a command targeting the current state from its owning peer", () => {
        expect(isCurrentAction(createState(12, 3), createAction(), "guest")).toBe(true);
    });
});

import { describe, expect, it } from "vite-plus/test";
import { createInitialGameState } from "./gameLogic";
import { shouldApplyState } from "./syncLogic";
import type { GameState } from "./types";

function createState(revision: number): GameState {
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
    return state;
}

describe("state synchronization", () => {
    it("ignores a delayed state older than the state already applied", () => {
        expect(shouldApplyState(createState(12), createState(11))).toBe(false);
    });

    it("accepts a newer authoritative state", () => {
        expect(shouldApplyState(createState(11), createState(12))).toBe(true);
    });
});

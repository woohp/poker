import { describe, expect, it } from "vite-plus/test";
import { createInitialGameState } from "./gameLogic";
import { shouldApplyState } from "./syncLogic";
import type { GameSnapshot } from "./types";

function createSnapshot(revision: number, epoch = "authority-1"): GameSnapshot {
    return {
        epoch,
        revision,
        state: createInitialGameState(
            {
                mode: "physical",
                startingChips: 1000,
                smallBlind: 5,
                bigBlind: 10,
                ante: 0,
            },
            "Host",
            "host",
        ),
    };
}

describe("state synchronization", () => {
    it("ignores a delayed state older than the state already applied", () => {
        expect(shouldApplyState(createSnapshot(12), createSnapshot(11))).toBe(false);
    });

    it("accepts a newer authoritative state", () => {
        expect(shouldApplyState(createSnapshot(11), createSnapshot(12))).toBe(true);
    });

    it("accepts a snapshot from a new authority epoch", () => {
        expect(shouldApplyState(createSnapshot(12), createSnapshot(1, "authority-2"))).toBe(true);
    });
});

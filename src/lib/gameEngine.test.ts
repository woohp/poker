import { describe, expect, it } from "vite-plus/test";
import { GameEngine, type Game, type GameCommand, type GameExecutionResult } from "./gameEngine";

class CounterGame implements Game<number, number, number, { maximum: number }, "invalid-amount"> {
    constructor(private state = 2) {}

    snapshot(): number {
        return this.state;
    }

    execute(
        amount: number,
        context: { maximum: number },
    ): GameExecutionResult<number, "invalid-amount"> {
        if (amount <= 0 || this.state + amount > context.maximum) {
            return { accepted: false, reason: "invalid-amount" };
        }
        this.state += amount;
        return { accepted: true, events: [this.state] };
    }
}

function createCommand(overrides: Partial<GameCommand<number>> = {}): GameCommand<number> {
    return {
        id: "command-1",
        epoch: "authority-1",
        expectedRevision: 4,
        payload: 3,
        ...overrides,
    };
}

function createEngine() {
    return new GameEngine(new CounterGame(), {
        epoch: "authority-1",
        revision: 4,
        history: [2],
    });
}

describe("GameEngine", () => {
    it("runs a game command and appends its events to history", () => {
        const engine = createEngine();

        const result = engine.dispatch(createCommand(), { maximum: 10 });

        expect(result).toMatchObject({ accepted: true, revision: 5, duplicate: false });
        expect(result.snapshot.state).toBe(5);
        expect(result.events).toEqual([5]);
        expect(engine.history()).toEqual([2, 5]);
    });

    it("returns the original result for duplicate commands", () => {
        const engine = createEngine();
        const command = createCommand();
        const first = engine.dispatch(command, { maximum: 10 });
        const duplicate = engine.dispatch(command, { maximum: 10 });

        expect(duplicate).toEqual({ ...first, duplicate: true });
        expect(engine.snapshot().state).toBe(5);
        expect(engine.history()).toEqual([2, 5]);
    });

    it("rejects stale revisions and authority epochs", () => {
        const engine = createEngine();

        expect(
            engine.dispatch(createCommand({ expectedRevision: 3 }), { maximum: 10 }),
        ).toMatchObject({ accepted: false, reason: "stale-state", revision: 4 });
        expect(
            engine.dispatch(createCommand({ id: "command-2", epoch: "old" }), {
                maximum: 10,
            }),
        ).toMatchObject({ accepted: false, reason: "stale-authority", revision: 4 });
        expect(engine.history()).toEqual([2]);
    });
});

import { describe, expect, it } from "vite-plus/test";
import { GameEngine, type Game, type GameCommand, type GameExecutionResult } from "./gameEngine";

class CounterGame implements Game<number, number, { maximum: number }, "invalid-amount"> {
    constructor(private state = 2) {}

    snapshot(): number {
        return this.state;
    }

    execute(amount: number, context: { maximum: number }): GameExecutionResult<"invalid-amount"> {
        if (amount <= 0 || this.state + amount > context.maximum) {
            return { accepted: false, reason: "invalid-amount" };
        }
        this.state += amount;
        return { accepted: true };
    }

    restore(state: number): void {
        this.state = state;
    }
}

function createCommand(overrides: Partial<GameCommand<number>> = {}): GameCommand<number> {
    return {
        id: "command-1",
        actorId: "player-1",
        epoch: "authority-1",
        expectedRevision: 4,
        payload: 3,
        ...overrides,
    };
}

function createEngine() {
    return new GameEngine(new CounterGame(), { epoch: "authority-1", revision: 4 });
}

describe("GameEngine", () => {
    it("runs a game command and records its transition", () => {
        const engine = createEngine();

        const result = engine.dispatch(createCommand(), { maximum: 10 });

        expect(result).toMatchObject({ accepted: true, revision: 5, duplicate: false });
        expect(result.snapshot.state).toBe(5);
        expect(engine.history()).toEqual([
            {
                revision: 5,
                command: createCommand(),
                before: 2,
                after: 5,
            },
        ]);
    });

    it("returns the original result for duplicate commands", () => {
        const engine = createEngine();
        const command = createCommand();
        const first = engine.dispatch(command, { maximum: 10 });
        const duplicate = engine.dispatch(command, { maximum: 10 });

        expect(duplicate).toEqual({ ...first, duplicate: true });
        expect(engine.snapshot().state).toBe(5);
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
    });

    it("records trusted state commits", () => {
        const engine = createEngine();

        const snapshot = engine.commit(8);

        expect(snapshot).toEqual({ epoch: "authority-1", revision: 5, state: 8 });
        expect(engine.history()[0]).toEqual({
            revision: 5,
            command: null,
            before: 2,
            after: 8,
        });
    });
});

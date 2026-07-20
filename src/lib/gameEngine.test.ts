import { describe, expect, it } from "vite-plus/test";
import {
    GameEngine,
    type Game,
    type GameCommand,
    type GameExecutionResult,
    type GameHistoryEntry,
} from "./gameEngine";

class CounterGame implements Game<number, number, number, { maximum: number }, "invalid-amount"> {
    constructor(private state = 2) {}

    snapshot(): number {
        return this.state;
    }

    decide(
        amount: number,
        context: { maximum: number },
    ): GameExecutionResult<number, "invalid-amount"> {
        if (amount <= 0 || this.state + amount > context.maximum) {
            return { accepted: false, reason: "invalid-amount" };
        }
        return { accepted: true, events: [this.state + amount] };
    }

    apply(events: readonly number[]): void {
        let nextState = this.state;
        for (const event of events) nextState = event;
        this.state = nextState;
    }
}

function createCommand(overrides: Partial<GameCommand<number>> = {}): GameCommand<number> {
    return {
        id: "command-1",
        expectedRevision: 4,
        payload: 3,
        ...overrides,
    };
}

const history: GameHistoryEntry<number>[] = [1, 2, 3, 4].map((index) => ({
    commandId: `history-${index}`,
    events: [],
}));

function createEngine() {
    return new GameEngine(new CounterGame(), { history });
}

describe("GameEngine", () => {
    it("decides, applies, and records an accepted command batch", () => {
        const engine = createEngine();

        const result = engine.dispatch(createCommand(), { maximum: 10 });

        expect(result).toMatchObject({ accepted: true, revision: 5, duplicate: false });
        expect(result.snapshot.state).toBe(5);
        expect(result.events).toEqual([5]);
        expect(engine.history().at(-1)).toEqual({ commandId: "command-1", events: [5] });
    });

    it("returns the accepted result for duplicate commands", () => {
        const engine = createEngine();
        const command = createCommand();
        engine.dispatch(command, { maximum: 10 });
        const duplicate = engine.dispatch(command, { maximum: 10 });

        expect(duplicate).toMatchObject({
            commandId: command.id,
            accepted: true,
            revision: 5,
            duplicate: true,
        });
        expect(duplicate.snapshot.state).toBe(5);
        expect(engine.history()).toHaveLength(5);
    });

    it("restores duplicate-command handling from history", () => {
        const engine = createEngine();

        const duplicate = engine.dispatch(createCommand({ id: "history-2", expectedRevision: 0 }), {
            maximum: 10,
        });

        expect(duplicate).toMatchObject({ accepted: true, revision: 4, duplicate: true });
    });

    it("rejects stale revisions", () => {
        const engine = createEngine();

        expect(
            engine.dispatch(createCommand({ expectedRevision: 3 }), { maximum: 10 }),
        ).toMatchObject({ accepted: false, reason: "stale-state", revision: 4 });
        expect(engine.history()).toEqual(history);
    });
});

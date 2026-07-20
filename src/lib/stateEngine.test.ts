import { describe, expect, it } from "vite-plus/test";
import {
    AuthoritativeStateEngine,
    type CommandEnvelope,
    type StateTransition,
    type VersionedState,
} from "./stateEngine";

interface CounterState {
    count: number;
}

type CounterCommand = { amount: number };
type CounterReason = "invalid-amount";

function createEngine() {
    return new AuthoritativeStateEngine<
        CounterState,
        CounterCommand,
        { maximum: number },
        CounterReason
    >(
        (state, command, context): StateTransition<CounterState, CounterReason> => {
            if (command.amount <= 0 || state.count + command.amount > context.maximum) {
                return { accepted: false, reason: "invalid-amount" };
            }
            state.count += command.amount;
            return { accepted: true, state };
        },
        (state) => ({ ...state }),
    );
}

function createState(): VersionedState<CounterState> {
    return { epoch: "authority-1", revision: 4, value: { count: 2 } };
}

function createCommand(
    overrides: Partial<CommandEnvelope<CounterCommand>> = {},
): CommandEnvelope<CounterCommand> {
    return {
        id: "command-1",
        actorId: "player-1",
        epoch: "authority-1",
        expectedRevision: 4,
        payload: { amount: 3 },
        ...overrides,
    };
}

describe("AuthoritativeStateEngine", () => {
    it("applies accepted commands immutably and increments the revision", () => {
        const engine = createEngine();
        const current = createState();

        const result = engine.process(current, createCommand(), { maximum: 10 });
        const acceptedState = engine.getAcceptedState("command-1");

        expect(result).toMatchObject({ accepted: true, revision: 5, duplicate: false });
        expect(acceptedState).toEqual({
            epoch: "authority-1",
            revision: 5,
            value: { count: 5 },
        });
        expect(current.value.count).toBe(2);
    });

    it("versions authoritative state changes that do not come from player commands", () => {
        const engine = createEngine();
        const current = createState();

        const committed = engine.commit(current, { count: 8 });

        expect(committed).toEqual({
            epoch: "authority-1",
            revision: 5,
            value: { count: 8 },
        });
        expect(current.value.count).toBe(2);
    });

    it("returns the original result for duplicate command IDs", () => {
        const engine = createEngine();
        const command = createCommand();
        const first = engine.process(createState(), command, { maximum: 10 });
        const duplicate = engine.process(createState(), command, { maximum: 10 });

        expect(duplicate).toEqual({ ...first, duplicate: true });
        expect(engine.getAcceptedState(command.id)?.value.count).toBe(5);
    });

    it("rejects commands for stale revisions and authority epochs", () => {
        const engine = createEngine();

        expect(
            engine.process(createState(), createCommand({ expectedRevision: 3 }), {
                maximum: 10,
            }),
        ).toMatchObject({ accepted: false, reason: "stale-state", revision: 4 });
        expect(
            engine.process(createState(), createCommand({ id: "command-2", epoch: "old" }), {
                maximum: 10,
            }),
        ).toMatchObject({ accepted: false, reason: "stale-authority", revision: 4 });
    });

    it("delegates game-specific validation to the reducer", () => {
        const engine = createEngine();
        const result = engine.process(createState(), createCommand({ payload: { amount: 20 } }), {
            maximum: 10,
        });

        expect(result).toMatchObject({ accepted: false, reason: "invalid-amount" });
    });
});

export type GameExecutionResult<Event, Reason extends string> =
    | { accepted: true; events: readonly Event[] }
    | { accepted: false; reason: Reason };

export interface Game<State, Command, Event, Context, Reason extends string> {
    snapshot(): State;
    decide(command: Command, context: Context): GameExecutionResult<Event, Reason>;
    /** Apply the complete batch atomically: on failure, leave game state unchanged and throw. */
    apply(events: readonly Event[]): void;
}

export interface GameSnapshot<State> {
    revision: number;
    state: State;
}

export interface GameCommand<Command> {
    id: string;
    expectedRevision: number;
    payload: Command;
}

export interface GameHistoryEntry<Event> {
    commandId: string;
    events: readonly Event[];
}

export interface GameCommandResult<State, Event, Reason extends string> {
    commandId: string;
    accepted: boolean;
    revision: number;
    reason?: Reason | "stale-state";
    events: readonly Event[];
    snapshot: GameSnapshot<State>;
    duplicate: boolean;
}

export interface GameEngineOptions<Event> {
    history?: readonly GameHistoryEntry<Event>[];
}

interface CachedCommandResult<Event, Reason extends string> {
    accepted: boolean;
    reason?: Reason | "stale-state";
    events: readonly Event[];
}

export class GameEngine<State, Command, Event, Context, Reason extends string> {
    private readonly entries: GameHistoryEntry<Event>[];
    private readonly results = new Map<string, CachedCommandResult<Event, Reason>>();

    /** The supplied game must be freshly constructed; this constructor replays all history into it. */
    constructor(
        private readonly game: Game<State, Command, Event, Context, Reason>,
        options: GameEngineOptions<Event> = {},
    ) {
        this.entries = [...structuredClone(options.history ?? [])];

        for (const entry of this.entries) {
            if (this.results.has(entry.commandId)) {
                throw new Error(`Duplicate command in game history: ${entry.commandId}`);
            }
            this.game.apply(entry.events);
            this.results.set(entry.commandId, {
                accepted: true,
                events: structuredClone(entry.events),
            });
        }
    }

    snapshot(): GameSnapshot<State> {
        return {
            revision: this.entries.length,
            state: this.game.snapshot(),
        };
    }

    history(): readonly GameHistoryEntry<Event>[] {
        return structuredClone(this.entries);
    }

    dispatch(
        command: GameCommand<Command>,
        context: Context,
    ): GameCommandResult<State, Event, Reason> {
        const cached = this.results.get(command.id);
        if (cached) return this.result(command.id, cached, true);

        if (command.expectedRevision !== this.entries.length) {
            return this.reject(command.id, "stale-state");
        }

        const decision = this.game.decide(command.payload, context);
        if (!decision.accepted) {
            return this.reject(command.id, decision.reason);
        }

        const events = structuredClone(decision.events);
        this.game.apply(events);
        this.entries.push({ commandId: command.id, events });
        return this.cacheAndReturn(command.id, { accepted: true, events });
    }

    private reject(
        commandId: string,
        reason: Reason | "stale-state",
    ): GameCommandResult<State, Event, Reason> {
        return this.cacheAndReturn(commandId, { accepted: false, reason, events: [] });
    }

    private cacheAndReturn(
        commandId: string,
        result: CachedCommandResult<Event, Reason>,
    ): GameCommandResult<State, Event, Reason> {
        this.results.set(commandId, structuredClone(result));
        return this.result(commandId, result, false);
    }

    private result(
        commandId: string,
        result: CachedCommandResult<Event, Reason>,
        duplicate: boolean,
    ): GameCommandResult<State, Event, Reason> {
        return {
            commandId,
            accepted: result.accepted,
            reason: result.reason,
            events: structuredClone(result.events),
            revision: this.entries.length,
            snapshot: this.snapshot(),
            duplicate,
        };
    }
}

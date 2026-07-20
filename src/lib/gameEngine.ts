export type GameExecutionResult<Event, Reason extends string> =
    | { accepted: true; events: readonly Event[] }
    | { accepted: false; reason: Reason };

export interface Game<State, Command, Event, Context, Reason extends string> {
    snapshot(): State;
    execute(command: Command, context: Context): GameExecutionResult<Event, Reason>;
}

export interface GameSnapshot<State> {
    epoch: string;
    revision: number;
    state: State;
}

export interface GameCommand<Command> {
    id: string;
    epoch: string;
    expectedRevision: number;
    payload: Command;
}

export interface GameCommandResult<State, Event, Reason extends string> {
    commandId: string;
    accepted: boolean;
    revision: number;
    reason?: Reason | "stale-authority" | "stale-state";
    events: readonly Event[];
    snapshot: GameSnapshot<State>;
    duplicate: boolean;
}

export interface GameEngineOptions<Event> {
    epoch?: string;
    revision?: number;
    history?: readonly Event[];
}

export class GameEngine<State, Command, Event, Context, Reason extends string> {
    private epoch: string;
    private revision: number;
    private results = new Map<string, GameCommandResult<State, Event, Reason>>();
    private events: Event[];

    constructor(
        private readonly game: Game<State, Command, Event, Context, Reason>,
        options: GameEngineOptions<Event> = {},
    ) {
        this.epoch = options.epoch ?? crypto.randomUUID();
        this.events = [...structuredClone(options.history ?? [])];
        this.revision = options.revision ?? this.events.length;
    }

    snapshot(): GameSnapshot<State> {
        return {
            epoch: this.epoch,
            revision: this.revision,
            state: this.game.snapshot(),
        };
    }

    history(): readonly Event[] {
        return structuredClone(this.events);
    }

    dispatch(
        command: GameCommand<Command>,
        context: Context,
    ): GameCommandResult<State, Event, Reason> {
        const cached = this.results.get(command.id);
        if (cached) return { ...structuredClone(cached), duplicate: true };

        if (command.epoch !== this.epoch) {
            return this.reject(command.id, "stale-authority");
        }
        if (command.expectedRevision !== this.revision) {
            return this.reject(command.id, "stale-state");
        }

        const execution = this.game.execute(command.payload, context);
        if (!execution.accepted) {
            return this.reject(command.id, execution.reason);
        }

        this.revision += 1;
        this.events.push(...structuredClone(execution.events));
        return this.cache({
            commandId: command.id,
            accepted: true,
            revision: this.revision,
            events: structuredClone(execution.events),
            snapshot: this.snapshot(),
            duplicate: false,
        });
    }

    private reject(
        commandId: string,
        reason: Reason | "stale-authority" | "stale-state",
    ): GameCommandResult<State, Event, Reason> {
        return this.cache({
            commandId,
            accepted: false,
            revision: this.revision,
            reason,
            events: [],
            snapshot: this.snapshot(),
            duplicate: false,
        });
    }

    private cache(
        result: GameCommandResult<State, Event, Reason>,
    ): GameCommandResult<State, Event, Reason> {
        this.results.set(result.commandId, structuredClone(result));
        return result;
    }
}

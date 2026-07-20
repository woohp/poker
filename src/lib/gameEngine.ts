export interface GameExecutionResult<Reason extends string> {
    accepted: boolean;
    reason?: Reason;
}

export interface Game<State, Command, Context, Reason extends string> {
    snapshot(): State;
    execute(command: Command, context: Context): GameExecutionResult<Reason>;
    restore(state: State): void;
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

export interface GameCommandResult<State, Reason extends string> {
    commandId: string;
    accepted: boolean;
    revision: number;
    reason?: Reason | "stale-authority" | "stale-state";
    snapshot: GameSnapshot<State>;
    duplicate: boolean;
}

export interface GameHistoryEntry<State, Command> {
    revision: number;
    command: GameCommand<Command> | null;
    before: State;
    after: State;
}

export interface GameEngineOptions {
    epoch?: string;
    revision?: number;
}

export class GameEngine<State, Command, Context, Reason extends string> {
    private epoch: string;
    private revision: number;
    private results = new Map<string, GameCommandResult<State, Reason>>();
    private entries: Array<GameHistoryEntry<State, Command>> = [];

    constructor(
        private readonly game: Game<State, Command, Context, Reason>,
        options: GameEngineOptions = {},
    ) {
        this.epoch = options.epoch ?? crypto.randomUUID();
        this.revision = options.revision ?? 0;
    }

    snapshot(): GameSnapshot<State> {
        return {
            epoch: this.epoch,
            revision: this.revision,
            state: this.game.snapshot(),
        };
    }

    history(): readonly GameHistoryEntry<State, Command>[] {
        return structuredClone(this.entries);
    }

    dispatch(command: GameCommand<Command>, context: Context): GameCommandResult<State, Reason> {
        const cached = this.results.get(command.id);
        if (cached) return { ...structuredClone(cached), duplicate: true };

        if (command.epoch !== this.epoch) {
            return this.reject(command.id, "stale-authority");
        }
        if (command.expectedRevision !== this.revision) {
            return this.reject(command.id, "stale-state");
        }

        const before = this.game.snapshot();
        const execution = this.game.execute(command.payload, context);
        if (!execution.accepted) {
            return this.reject(command.id, execution.reason as Reason);
        }

        this.revision += 1;
        const after = this.game.snapshot();
        this.entries.push({
            revision: this.revision,
            command: structuredClone(command),
            before,
            after,
        });
        return this.cache({
            commandId: command.id,
            accepted: true,
            revision: this.revision,
            snapshot: this.snapshot(),
            duplicate: false,
        });
    }

    commit(state: State): GameSnapshot<State> {
        const before = this.game.snapshot();
        this.game.restore(state);
        this.revision += 1;
        const after = this.game.snapshot();
        this.entries.push({ revision: this.revision, command: null, before, after });
        return this.snapshot();
    }

    private reject(
        commandId: string,
        reason: Reason | "stale-authority" | "stale-state",
    ): GameCommandResult<State, Reason> {
        return this.cache({
            commandId,
            accepted: false,
            revision: this.revision,
            reason,
            snapshot: this.snapshot(),
            duplicate: false,
        });
    }

    private cache(result: GameCommandResult<State, Reason>): GameCommandResult<State, Reason> {
        this.results.set(result.commandId, structuredClone(result));
        return result;
    }
}

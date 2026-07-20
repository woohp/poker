export interface VersionedState<State> {
    epoch: string;
    revision: number;
    value: State;
}

export interface CommandEnvelope<Command> {
    id: string;
    actorId: string;
    epoch: string;
    expectedRevision: number;
    payload: Command;
}

export interface AcceptedTransition<State> {
    accepted: true;
    state: State;
}

export interface RejectedTransition<Reason extends string> {
    accepted: false;
    reason: Reason;
}

export type StateTransition<State, Reason extends string> =
    | AcceptedTransition<State>
    | RejectedTransition<Reason>;

export interface EngineCommandResult<State, Reason extends string> {
    commandId: string;
    accepted: boolean;
    revision: number;
    reason?: Reason | "stale-authority" | "stale-state";
    state?: VersionedState<State>;
    duplicate: boolean;
}

interface CachedResult<State, Reason extends string> {
    result: EngineCommandResult<State, Reason>;
    state: VersionedState<State>;
}

export class AuthoritativeStateEngine<State, Command, Context, Reason extends string> {
    private results = new Map<string, CachedResult<State, Reason>>();

    constructor(
        private readonly reduce: (
            state: State,
            command: Command,
            context: Context,
        ) => StateTransition<State, Reason>,
        private readonly clone: (state: State) => State,
    ) {}

    process(
        current: VersionedState<State>,
        command: CommandEnvelope<Command>,
        context: Context,
    ): EngineCommandResult<State, Reason> {
        const cached = this.results.get(command.id);
        if (cached) {
            return { ...this.cloneResult(cached.result), duplicate: true };
        }

        if (command.epoch !== current.epoch) {
            return this.reject(current, command.id, "stale-authority");
        }
        if (command.expectedRevision !== current.revision) {
            return this.reject(current, command.id, "stale-state");
        }

        const transition = this.reduce(this.clone(current.value), command.payload, context);
        if (!transition.accepted) {
            return this.reject(current, command.id, transition.reason);
        }

        const next: VersionedState<State> = {
            epoch: current.epoch,
            revision: current.revision + 1,
            value: transition.state,
        };
        const result: EngineCommandResult<State, Reason> = {
            commandId: command.id,
            accepted: true,
            revision: next.revision,
            duplicate: false,
        };
        this.cache(command.id, result, next);
        return result;
    }

    getAcceptedState(commandId: string): VersionedState<State> | null {
        const cached = this.results.get(commandId);
        if (!cached?.result.accepted) return null;
        return this.cloneVersionedState(cached.state);
    }

    clear(): void {
        this.results.clear();
    }

    private reject(
        current: VersionedState<State>,
        commandId: string,
        reason: Reason | "stale-authority" | "stale-state",
    ): EngineCommandResult<State, Reason> {
        const state = this.cloneVersionedState(current);
        const result: EngineCommandResult<State, Reason> = {
            commandId,
            accepted: false,
            revision: current.revision,
            reason,
            state,
            duplicate: false,
        };
        this.cache(commandId, result, state);
        return result;
    }

    private cache(
        commandId: string,
        result: EngineCommandResult<State, Reason>,
        state: VersionedState<State>,
    ): void {
        this.results.set(commandId, {
            result: this.cloneResult(result),
            state: this.cloneVersionedState(state),
        });
    }

    private cloneResult(
        result: EngineCommandResult<State, Reason>,
    ): EngineCommandResult<State, Reason> {
        return {
            ...result,
            state: result.state ? this.cloneVersionedState(result.state) : undefined,
        };
    }

    private cloneVersionedState(state: VersionedState<State>): VersionedState<State> {
        return { ...state, value: this.clone(state.value) };
    }
}

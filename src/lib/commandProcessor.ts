import { processAction } from "./gameLogic";
import type {
    ActionMessage,
    CommandRejectionReason,
    CommandResultMessage,
    GameState,
} from "./types";

export interface ProcessedCommand {
    result: CommandResultMessage;
    state: GameState;
    duplicate: boolean;
}

interface CachedCommandResult {
    result: CommandResultMessage;
    state: GameState;
}

export class GameCommandProcessor {
    private results = new Map<string, CachedCommandResult>();

    process(state: GameState, command: ActionMessage, fromPeerId: string): ProcessedCommand {
        const cached = this.results.get(command.commandId);
        if (cached) {
            return {
                result: cached.result,
                state: cached.state,
                duplicate: true,
            };
        }

        const reason = validateCommand(state, command, fromPeerId);
        if (reason) {
            return this.cache(command.commandId, state, false, reason);
        }

        const nextState = cloneState(state);
        if (!processAction(nextState, command.playerId, command.action, command.amount)) {
            return this.cache(command.commandId, state, false, "invalid-action");
        }

        return this.cache(command.commandId, nextState, true);
    }

    clear(): void {
        this.results.clear();
    }

    private cache(
        commandId: string,
        state: GameState,
        accepted: boolean,
        reason?: CommandRejectionReason,
    ): ProcessedCommand {
        const result: CommandResultMessage = {
            type: "commandResult",
            commandId,
            accepted,
            revision: state.revision + (accepted ? 1 : 0),
            reason,
            state: accepted ? undefined : state,
        };
        this.results.set(commandId, {
            result: JSON.parse(JSON.stringify(result)) as CommandResultMessage,
            state: cloneState(state),
        });
        return { result, state, duplicate: false };
    }
}

function cloneState(state: GameState): GameState {
    return JSON.parse(JSON.stringify(state)) as GameState;
}

function validateCommand(
    state: GameState,
    command: ActionMessage,
    fromPeerId: string,
): CommandRejectionReason | null {
    if (command.playerId !== fromPeerId) return "wrong-player";
    if (command.round !== state.round) return "wrong-hand";
    if (command.expectedRevision !== state.revision) return "stale-state";
    return null;
}

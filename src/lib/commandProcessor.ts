import { processAction } from "./gameLogic";
import {
    AuthoritativeStateEngine,
    type CommandEnvelope,
    type StateTransition,
    type VersionedState,
} from "./stateEngine";
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

type PokerRejectionReason = "invalid-action" | "wrong-hand" | "wrong-player";

export class GameCommandProcessor {
    private engine = new AuthoritativeStateEngine<
        GameState,
        ActionMessage,
        { fromPeerId: string },
        PokerRejectionReason
    >(reducePokerAction, cloneState);

    process(state: GameState, command: ActionMessage, fromPeerId: string): ProcessedCommand {
        const result = this.engine.process(toVersionedState(state), toCommandEnvelope(command), {
            fromPeerId,
        });
        const acceptedState = this.engine.getAcceptedState(command.commandId);
        const nextState = acceptedState
            ? fromVersionedState(acceptedState)
            : result.state
              ? fromVersionedState(result.state)
              : state;

        return {
            result: {
                type: "commandResult",
                commandId: result.commandId,
                accepted: result.accepted,
                revision: result.revision,
                reason: result.reason as CommandRejectionReason | undefined,
                state: result.accepted ? undefined : nextState,
            },
            state: nextState,
            duplicate: result.duplicate,
        };
    }

    clear(): void {
        this.engine.clear();
    }
}

function reducePokerAction(
    state: GameState,
    command: ActionMessage,
    context: { fromPeerId: string },
): StateTransition<GameState, PokerRejectionReason> {
    if (command.playerId !== context.fromPeerId) {
        return { accepted: false, reason: "wrong-player" };
    }
    if (command.round !== state.round) {
        return { accepted: false, reason: "wrong-hand" };
    }
    if (!processAction(state, command.playerId, command.action, command.amount)) {
        return { accepted: false, reason: "invalid-action" };
    }
    return { accepted: true, state };
}

function toVersionedState(state: GameState): VersionedState<GameState> {
    return {
        epoch: state.authorityEpoch,
        revision: state.revision,
        value: state,
    };
}

function fromVersionedState(state: VersionedState<GameState>): GameState {
    return {
        ...state.value,
        authorityEpoch: state.epoch,
        revision: state.revision,
    };
}

function toCommandEnvelope(command: ActionMessage): CommandEnvelope<ActionMessage> {
    return {
        id: command.commandId,
        actorId: command.playerId,
        epoch: command.authorityEpoch,
        expectedRevision: command.expectedRevision,
        payload: command,
    };
}

function cloneState(state: GameState): GameState {
    return JSON.parse(JSON.stringify(state)) as GameState;
}

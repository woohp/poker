import type { Game, GameExecutionResult } from "./gameEngine";
import { processAction } from "./gameLogic";
import type { GameState, PlayerAction } from "./types";

export interface PokerCommand {
    playerId: string;
    round: number;
    action: PlayerAction;
    amount?: number;
}

export interface PokerCommandContext {
    actorId: string;
}

export type PokerRejectionReason = "invalid-action" | "wrong-hand" | "wrong-player";

export class PokerGame implements Game<
    GameState,
    PokerCommand,
    PokerCommandContext,
    PokerRejectionReason
> {
    private state: GameState;

    constructor(initialState: GameState) {
        this.state = cloneState(initialState);
    }

    snapshot(): GameState {
        return cloneState(this.state);
    }

    execute(
        command: PokerCommand,
        context: PokerCommandContext,
    ): GameExecutionResult<PokerRejectionReason> {
        const transition = reducePokerState(this.state, command, context);
        if (transition.accepted) this.state = transition.state;
        return transition;
    }

    restore(state: GameState): void {
        this.state = cloneState(state);
    }
}

export type PokerTransition =
    | { accepted: true; state: GameState }
    | { accepted: false; reason: PokerRejectionReason };

export function reducePokerState(
    state: GameState,
    command: PokerCommand,
    context: PokerCommandContext,
): PokerTransition {
    if (command.playerId !== context.actorId) {
        return { accepted: false, reason: "wrong-player" };
    }
    if (command.round !== state.round) {
        return { accepted: false, reason: "wrong-hand" };
    }

    const nextState = cloneState(state);
    if (!processAction(nextState, command.playerId, command.action, command.amount)) {
        return { accepted: false, reason: "invalid-action" };
    }
    return { accepted: true, state: nextState };
}

function cloneState(state: GameState): GameState {
    return JSON.parse(JSON.stringify(state)) as GameState;
}

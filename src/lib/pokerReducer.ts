import { processAction } from "./gameLogic";
import type { StateTransition } from "./stateEngine";
import type { ActionMessage, GameState } from "./types";

export type PokerRejectionReason = "invalid-action" | "wrong-hand" | "wrong-player";

export function reducePokerAction(
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

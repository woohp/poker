import type { ActionMessage, GameState } from "./types";

export function shouldApplyState(
    currentState: GameState | null,
    incomingState: GameState,
): boolean {
    return currentState === null || incomingState.revision > currentState.revision;
}

export function isCurrentAction(
    state: GameState,
    message: ActionMessage,
    fromPeerId: string,
): boolean {
    return (
        message.playerId === fromPeerId &&
        message.round === state.round &&
        message.expectedRevision === state.revision
    );
}

import type { GameState } from "./types";

export function shouldApplyState(
    currentState: GameState | null,
    incomingState: GameState,
): boolean {
    return currentState === null || incomingState.revision > currentState.revision;
}

import type { GameSnapshot } from "./types";

export function shouldApplyState(current: GameSnapshot | null, incoming: GameSnapshot): boolean {
    return current === null || incoming.revision > current.revision;
}

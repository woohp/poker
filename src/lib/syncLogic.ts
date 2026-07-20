import type { GameSnapshot } from "./types";

export function shouldApplyState(current: GameSnapshot | null, incoming: GameSnapshot): boolean {
    return (
        current === null ||
        incoming.authorityEpoch !== current.authorityEpoch ||
        incoming.revision > current.revision
    );
}

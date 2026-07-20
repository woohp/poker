import type { GameCommand, GameCommandResult, GameEngine } from "./gameEngine";
import type { PokerCommand, PokerCommandContext, PokerRejectionReason } from "./pokerGame";
import type { ActionMessage, CommandResultMessage, GameState } from "./types";

export type PokerEngine = GameEngine<
    GameState,
    PokerCommand,
    PokerCommandContext,
    PokerRejectionReason
>;

export type PokerEngineResult = GameCommandResult<GameState, PokerRejectionReason>;

export function toEngineCommand(
    message: ActionMessage,
    actorId: string,
): GameCommand<PokerCommand> {
    return {
        id: message.commandId,
        actorId,
        epoch: message.epoch,
        expectedRevision: message.expectedRevision,
        payload: {
            playerId: message.playerId,
            round: message.round,
            action: message.action,
            amount: message.amount,
        },
    };
}

export function toCommandResultMessage(result: PokerEngineResult): CommandResultMessage {
    return {
        type: "commandResult",
        commandId: result.commandId,
        accepted: result.accepted,
        revision: result.revision,
        reason: result.reason,
        snapshot: result.accepted ? undefined : result.snapshot,
    };
}

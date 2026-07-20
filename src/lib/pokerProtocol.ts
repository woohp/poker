import type { GameCommand, GameCommandResult, GameEngine } from "./gameEngine";
import type {
    PokerCommand,
    PokerCommandContext,
    PokerEvent,
    PokerRejectionReason,
} from "./pokerGame";
import type { ActionMessage, CommandResultMessage, GameState } from "./types";

export type PokerEngine = GameEngine<
    GameState,
    PokerCommand,
    PokerEvent,
    PokerCommandContext,
    PokerRejectionReason
>;

export type PokerEngineResult = GameCommandResult<GameState, PokerEvent, PokerRejectionReason>;

export function toEngineCommand(message: ActionMessage): GameCommand<PokerCommand> {
    return {
        id: message.commandId,
        epoch: message.epoch,
        expectedRevision: message.expectedRevision,
        payload: {
            type: "player-action",
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

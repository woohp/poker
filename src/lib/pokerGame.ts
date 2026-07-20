import type { Game, GameExecutionResult } from "./gameEngine";
import {
    addPlayer,
    advancePhase,
    applyPotWinners,
    createInitialGameState,
    processAction,
    removePlayer,
    startNewHand,
} from "./gameLogic";
import type { Card, GameConfig, GameState, PlayerAction, RevealedHand } from "./types";

export interface PokerGameConfig {
    game: GameConfig;
    hostPlayerName: string;
    hostPeerId: string;
}

export type PokerCommand =
    | {
          type: "player-action";
          playerId: string;
          round: number;
          action: PlayerAction;
          amount?: number;
      }
    | { type: "add-player"; playerId: string; playerName: string }
    | { type: "remove-player"; playerId: string }
    | { type: "start-hand" }
    | {
          type: "advance-phase";
          cards: Card[];
          winnersByPot?: string[][];
          revealedHands?: RevealedHand[];
      }
    | { type: "record-outcome"; winnersByPot: string[][] };

export interface PokerCommandContext {
    actorId: string;
    trusted?: boolean;
}

export interface PokerEvent {
    type: "command-executed";
    command: PokerCommand;
    context: PokerCommandContext;
}

export type PokerRejectionReason =
    | "invalid-action"
    | "unauthorized"
    | "wrong-hand"
    | "wrong-player";

export class PokerGame implements Game<
    GameState,
    PokerCommand,
    PokerEvent,
    PokerCommandContext,
    PokerRejectionReason
> {
    private state: GameState;

    constructor(config: PokerGameConfig) {
        this.state = createInitialGameState(config.game, config.hostPlayerName, config.hostPeerId);
    }

    snapshot(): GameState {
        return cloneState(this.state);
    }

    decide(
        command: PokerCommand,
        context: PokerCommandContext,
    ): GameExecutionResult<PokerEvent, PokerRejectionReason> {
        return decidePokerCommand(this.state, command, context);
    }

    apply(events: readonly PokerEvent[]): void {
        let nextState = this.state;
        for (const event of events) nextState = evolvePokerState(nextState, event);
        this.state = nextState;
    }
}

export type PokerDecision = GameExecutionResult<PokerEvent, PokerRejectionReason>;
export type PokerTransition =
    | { accepted: true; state: GameState }
    | { accepted: false; reason: PokerRejectionReason };

export function decidePokerCommand(
    state: GameState,
    command: PokerCommand,
    context: PokerCommandContext,
): PokerDecision {
    const transition = transitionPokerState(state, command, context);
    if (!transition.accepted) return transition;
    return {
        accepted: true,
        events: [{ type: "command-executed", command, context }],
    };
}

export function evolvePokerState(state: GameState, event: PokerEvent): GameState {
    const transition = transitionPokerState(state, event.command, event.context);
    if (!transition.accepted) {
        throw new Error(`Invalid poker history: ${transition.reason}`);
    }
    return transition.state;
}

function transitionPokerState(
    state: GameState,
    command: PokerCommand,
    context: PokerCommandContext,
): PokerTransition {
    const nextState = cloneState(state);

    switch (command.type) {
        case "player-action":
            if (command.playerId !== context.actorId) {
                return { accepted: false, reason: "wrong-player" };
            }
            if (command.round !== state.round) {
                return { accepted: false, reason: "wrong-hand" };
            }
            if (!processAction(nextState, command.playerId, command.action, command.amount)) {
                return { accepted: false, reason: "invalid-action" };
            }
            break;

        case "add-player":
            if (!context.trusted) return { accepted: false, reason: "unauthorized" };
            if (!addPlayer(nextState, command.playerName, command.playerId)) {
                return { accepted: false, reason: "invalid-action" };
            }
            break;

        case "remove-player":
            if (!context.trusted) return { accepted: false, reason: "unauthorized" };
            removePlayer(nextState, command.playerId);
            break;

        case "start-hand":
            if (!context.trusted) return { accepted: false, reason: "unauthorized" };
            startNewHand(nextState);
            if (nextState.phase === "waiting") {
                return { accepted: false, reason: "invalid-action" };
            }
            break;

        case "advance-phase":
            if (!context.trusted) return { accepted: false, reason: "unauthorized" };
            advancePhase(nextState);
            nextState.communityCards.push(...command.cards);
            if (command.revealedHands) nextState.revealedHands = command.revealedHands;
            if (command.winnersByPot && !applyPotWinners(nextState, command.winnersByPot)) {
                return { accepted: false, reason: "invalid-action" };
            }
            break;

        case "record-outcome":
            if (!context.trusted) return { accepted: false, reason: "unauthorized" };
            if (!applyPotWinners(nextState, command.winnersByPot)) {
                return { accepted: false, reason: "invalid-action" };
            }
            break;
    }

    return { accepted: true, state: nextState };
}

function cloneState(state: GameState): GameState {
    return JSON.parse(JSON.stringify(state)) as GameState;
}

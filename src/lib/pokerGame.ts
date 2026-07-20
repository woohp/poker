import type { Game, GameExecutionResult } from "./gameEngine";
import {
    addPlayer,
    advancePhase,
    applyPotWinners,
    createInitialGameState,
    isBettingRoundComplete,
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
        validatePokerGameConfig(config);
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
            if (
                state.phase !== "waiting" ||
                !command.playerId ||
                !command.playerName.trim() ||
                state.players.some((player) => player.id === command.playerId) ||
                !addPlayer(nextState, command.playerName.trim(), command.playerId)
            ) {
                return { accepted: false, reason: "invalid-action" };
            }
            break;

        case "remove-player": {
            if (!context.trusted) return { accepted: false, reason: "unauthorized" };
            const player = state.players.find((entry) => entry.id === command.playerId);
            if (state.phase !== "waiting" || !player || player.isHost) {
                return { accepted: false, reason: "invalid-action" };
            }
            removePlayer(nextState, command.playerId);
            break;
        }

        case "start-hand":
            if (!context.trusted) return { accepted: false, reason: "unauthorized" };
            if (state.phase !== "waiting" && !(state.phase === "showdown" && state.pot === 0)) {
                return { accepted: false, reason: "invalid-action" };
            }
            startNewHand(nextState);
            if (nextState.phase === "waiting") {
                return { accepted: false, reason: "invalid-action" };
            }
            break;

        case "advance-phase":
            if (!context.trusted) return { accepted: false, reason: "unauthorized" };
            if (!isValidPhaseAdvance(state, command)) {
                return { accepted: false, reason: "invalid-action" };
            }
            advancePhase(nextState);
            nextState.communityCards.push(...command.cards);
            if (command.revealedHands) nextState.revealedHands = command.revealedHands;
            if (command.winnersByPot && !applyPotWinners(nextState, command.winnersByPot)) {
                return { accepted: false, reason: "invalid-action" };
            }
            break;

        case "record-outcome":
            if (!context.trusted) return { accepted: false, reason: "unauthorized" };
            if (
                state.config.mode !== "physical" ||
                state.phase !== "showdown" ||
                state.pot <= 0 ||
                !applyPotWinners(nextState, command.winnersByPot)
            ) {
                return { accepted: false, reason: "invalid-action" };
            }
            break;
    }

    return { accepted: true, state: nextState };
}

function isValidPhaseAdvance(
    state: GameState,
    command: Extract<PokerCommand, { type: "advance-phase" }>,
): boolean {
    if (state.phase === "waiting" || state.phase === "showdown" || !isBettingRoundComplete(state)) {
        return false;
    }

    if (state.config.mode === "physical") {
        return (
            command.cards.length === 0 &&
            command.winnersByPot === undefined &&
            command.revealedHands === undefined
        );
    }

    const expectedCommunityCards = {
        preflop: 0,
        flop: 3,
        turn: 4,
        river: 5,
    }[state.phase];
    const expectedDrawCount = state.phase === "preflop" ? 3 : state.phase === "river" ? 0 : 1;
    if (
        state.communityCards.length !== expectedCommunityCards ||
        command.cards.length !== expectedDrawCount ||
        !hasUniqueValidCards([...state.communityCards, ...command.cards])
    ) {
        return false;
    }

    if (state.phase !== "river") {
        return command.winnersByPot === undefined && command.revealedHands === undefined;
    }

    return (
        command.winnersByPot !== undefined &&
        command.revealedHands !== undefined &&
        hasValidRevealedHands(state, command.revealedHands)
    );
}

function hasValidRevealedHands(state: GameState, hands: readonly RevealedHand[]): boolean {
    const playerIds = new Set<string>();
    const cards = [...state.communityCards];
    for (const hand of hands) {
        if (
            playerIds.has(hand.playerId) ||
            !state.players.some(
                (player) => player.id === hand.playerId && player.isActive && !player.hasFolded,
            ) ||
            hand.cards.length !== 2 ||
            !hand.handName.trim()
        ) {
            return false;
        }
        playerIds.add(hand.playerId);
        cards.push(...hand.cards);
    }
    return hasUniqueValidCards(cards);
}

function hasUniqueValidCards(cards: readonly Card[]): boolean {
    return (
        cards.every((card) => /^[2-9TJQKA][cdhs]$/.test(card)) &&
        new Set(cards).size === cards.length
    );
}

function validatePokerGameConfig(config: PokerGameConfig): void {
    const { startingChips, smallBlind, bigBlind, ante } = config.game;
    if (
        !config.hostPeerId ||
        !config.hostPlayerName.trim() ||
        !Number.isSafeInteger(startingChips) ||
        !Number.isSafeInteger(smallBlind) ||
        !Number.isSafeInteger(bigBlind) ||
        !Number.isSafeInteger(ante) ||
        startingChips <= 0 ||
        smallBlind <= 0 ||
        bigBlind <= smallBlind ||
        ante < 0 ||
        ante + bigBlind > startingChips
    ) {
        throw new Error("Invalid poker game configuration");
    }
}

function cloneState(state: GameState): GameState {
    return JSON.parse(JSON.stringify(state)) as GameState;
}

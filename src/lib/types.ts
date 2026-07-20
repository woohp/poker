import type { GameSnapshot as EngineGameSnapshot } from "./gameEngine";

/**
 * Poker Game Types
 */

export type Card =
    `${"2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "T" | "J" | "Q" | "K" | "A"}${"c" | "d" | "h" | "s"}`;
export type GameMode = "physical" | "digital";

export interface RevealedHand {
    playerId: string;
    cards: Card[];
    handName: string;
}

export interface Payout {
    playerId: string;
    playerName: string;
    amount: number;
}

export interface Player {
    id: string;
    name: string;
    chips: number;
    isActive: boolean;
    hasFolded: boolean;
    hasActed: boolean;
    actedAtBet: number;
    handContribution: number;
    currentBet: number;
    isDealer: boolean;
    isSmallBlind: boolean;
    isBigBlind: boolean;
    isHost: boolean;
    isCurrentTurn: boolean;
}

export type GamePhase = "waiting" | "preflop" | "flop" | "turn" | "river" | "showdown";

export interface GameConfig {
    mode: GameMode;
    startingChips: number;
    smallBlind: number;
    bigBlind: number;
    ante: number;
}

export interface GameState {
    players: Player[];
    phase: GamePhase;
    pot: number;
    currentBet: number;
    minRaise: number;
    round: number;
    communityCards: Card[];
    revealedHands: RevealedHand[];
    config: GameConfig;
    statusMessage: string;
    lastPayouts: Payout[];
}

export type PlayerAction = "fold" | "check" | "call" | "raise" | "allin";

export interface ActionMessage {
    type: "action";
    commandId: string;
    playerId: string;
    round: number;
    expectedRevision: number;
    action: PlayerAction;
    amount?: number;
}

export interface HoleCardsRequestMessage {
    type: "requestHoleCards";
    playerId: string;
    round: number;
}

export interface HoleCardsMessage {
    type: "holeCards";
    round: number;
    cards: Card[];
}

export type CommandRejectionReason =
    | "invalid-action"
    | "stale-state"
    | "unauthorized"
    | "wrong-hand"
    | "wrong-player";

export type GameSnapshot = EngineGameSnapshot<GameState>;

export interface CommandResultMessage {
    type: "commandResult";
    commandId: string;
    accepted: boolean;
    revision: number;
    reason?: CommandRejectionReason;
    snapshot?: GameSnapshot;
}

export interface StateUpdateMessage {
    type: "state";
    snapshot: GameSnapshot;
}

export interface JoinRequestMessage {
    type: "join";
    requestId: string;
    playerName: string;
    peerId: string;
}

export interface JoinResponseMessage {
    type: "joinResponse";
    requestId: string;
    accepted: boolean;
    playerId?: string;
    snapshot?: GameSnapshot;
    message?: string;
}

export type PeerMessage =
    | ActionMessage
    | CommandResultMessage
    | HoleCardsRequestMessage
    | HoleCardsMessage
    | StateUpdateMessage
    | JoinRequestMessage
    | JoinResponseMessage;

export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

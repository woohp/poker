/**
 * Poker Game Types
 */

export interface Player {
    id: string;
    name: string;
    chips: number;
    isActive: boolean;
    hasFolded: boolean;
    currentBet: number;
    isDealer: boolean;
    isSmallBlind: boolean;
    isBigBlind: boolean;
    isHost: boolean;
    isCurrentTurn: boolean;
}

export type GamePhase = "waiting" | "preflop" | "flop" | "turn" | "river" | "showdown";

export interface GameConfig {
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
    deck: number[];
    communityCards: number[];
    config: GameConfig;
}

export type PlayerAction = "fold" | "check" | "call" | "raise" | "allin";

export interface ActionMessage {
    type: "action";
    playerId: string;
    action: PlayerAction;
    amount?: number;
}

export interface StateUpdateMessage {
    type: "state";
    state: GameState;
}

export interface JoinRequestMessage {
    type: "join";
    playerName: string;
    peerId: string;
}

export interface JoinResponseMessage {
    type: "joinResponse";
    accepted: boolean;
    playerId?: string;
    state?: GameState;
    message?: string;
}

export type PeerMessage = ActionMessage | StateUpdateMessage | JoinRequestMessage | JoinResponseMessage;

export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

import type { GameHistoryEntry } from "./gameEngine";
import type { PokerEvent, PokerGameConfig } from "./pokerGame";
import type { Card } from "./types";
const GAME_STORAGE_KEY = "poker_game_state";
const SESSION_STORAGE_KEY = "poker_session";

export interface SavedDealerState {
    round: number;
    deck: Card[];
    hands: Array<[string, Card[]]>;
}

export interface SavedGame {
    config: PokerGameConfig;
    history: readonly GameHistoryEntry<PokerEvent>[];
    dealer?: SavedDealerState;
}

export interface SessionData {
    isHost: boolean;
    roomCode: string;
    playerName: string;
}

export function saveSession(data: SessionData): void {
    try {
        localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(data));
    } catch (error) {
        console.error("Failed to save session:", error);
    }
}

export function loadSession(): SessionData | null {
    try {
        const saved = localStorage.getItem(SESSION_STORAGE_KEY);
        return saved ? (JSON.parse(saved) as SessionData) : null;
    } catch (error) {
        console.error("Failed to load session:", error);
        return null;
    }
}

export function clearSession(): void {
    localStorage.removeItem(SESSION_STORAGE_KEY);
}

export function saveGame(savedGame: SavedGame): void {
    try {
        localStorage.setItem(GAME_STORAGE_KEY, JSON.stringify(savedGame));
    } catch (error) {
        console.error("Failed to save game state:", error);
    }
}

export function loadGame(): SavedGame | null {
    try {
        const saved = localStorage.getItem(GAME_STORAGE_KEY);
        return saved ? (JSON.parse(saved) as SavedGame) : null;
    } catch (error) {
        console.error("Failed to load game state:", error);
        return null;
    }
}

export function clearGame(): void {
    localStorage.removeItem(GAME_STORAGE_KEY);
}

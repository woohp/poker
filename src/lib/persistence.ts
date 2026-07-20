import type { GameHistoryEntry } from "./gameEngine";
import type { PokerEvent, PokerGameConfig } from "./pokerGame";
import type { Card } from "./types";

const GAME_STORAGE_KEY = "poker_game_state";
const SESSION_STORAGE_KEY = "poker_session";
export const SAVED_GAME_VERSION = 1;

export interface SavedDealerState {
    round: number;
    deck: Card[];
    hands: Array<[string, Card[]]>;
}

export interface SavedGame {
    version: typeof SAVED_GAME_VERSION;
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
    localStorage.setItem(GAME_STORAGE_KEY, JSON.stringify(savedGame));
}

export function loadGame(): SavedGame | null {
    const saved = localStorage.getItem(GAME_STORAGE_KEY);
    if (!saved) return null;

    const parsed = JSON.parse(saved) as unknown;
    if (!isSavedGame(parsed)) {
        throw new Error("Unsupported saved game format");
    }
    return parsed;
}

export function clearGame(): void {
    localStorage.removeItem(GAME_STORAGE_KEY);
}

function isSavedGame(value: unknown): value is SavedGame {
    if (!isRecord(value) || value["version"] !== SAVED_GAME_VERSION) return false;
    if (!isRecord(value["config"]) || !Array.isArray(value["history"])) return false;

    return value["history"].every(
        (entry) =>
            isRecord(entry) &&
            typeof entry["commandId"] === "string" &&
            Array.isArray(entry["events"]),
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

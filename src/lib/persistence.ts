import type { GameSnapshot } from "./types";

const GAME_STORAGE_KEY = "poker_game_state";
const SESSION_STORAGE_KEY = "poker_session";

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

export function saveGameSnapshot(snapshot: GameSnapshot): void {
    try {
        localStorage.setItem(GAME_STORAGE_KEY, JSON.stringify(snapshot));
    } catch (error) {
        console.error("Failed to save game state:", error);
    }
}

export function loadGameSnapshot(): GameSnapshot | null {
    try {
        const saved = localStorage.getItem(GAME_STORAGE_KEY);
        return saved ? (JSON.parse(saved) as GameSnapshot) : null;
    } catch (error) {
        console.error("Failed to load game state:", error);
        return null;
    }
}

export function clearGameSnapshot(): void {
    localStorage.removeItem(GAME_STORAGE_KEY);
}

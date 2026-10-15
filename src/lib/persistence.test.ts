import { beforeEach, describe, expect, it } from "vite-plus/test";
import {
    clearGame,
    clearSession,
    loadGame,
    loadSession,
    SAVED_GAME_VERSION,
    saveGame,
    saveSession,
    type SavedGame,
} from "./persistence";
import { installMemoryStorage } from "./testStorage";

describe("session and game persistence", () => {
    beforeEach(() => {
        installMemoryStorage("localStorage");
    });

    it("saves and clears session data", () => {
        const session = { isHost: true, roomCode: "ROOM123", playerName: "Host" };
        saveSession(session);
        expect(loadSession()).toEqual(session);

        clearSession();
        expect(loadSession()).toBeNull();
    });

    it("saves and clears game history", () => {
        const savedGame: SavedGame = {
            version: SAVED_GAME_VERSION,
            config: {
                game: {
                    mode: "physical",
                    startingChips: 1000,
                    smallBlind: 5,
                    bigBlind: 10,
                    ante: 0,
                },
                hostPlayerName: "Host",
                hostPeerId: "host",
            },
            history: [
                {
                    commandId: "command-1",
                    events: [
                        {
                            type: "command-executed",
                            command: { type: "add-player", playerId: "guest", playerName: "Guest" },
                            context: { actorId: "host", trusted: true },
                        },
                    ],
                },
            ],
        };
        saveGame(savedGame);
        expect(loadGame()).toEqual(savedGame);

        clearGame();
        expect(loadGame()).toBeNull();
    });

    it("rejects an unsupported persistence envelope", () => {
        localStorage.setItem("poker_game_state", JSON.stringify({ history: [] }));

        expect(() => loadGame()).toThrow("Unsupported saved game format");
    });
});

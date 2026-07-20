import { describe, expect, it } from "vite-plus/test";
import {
    PokerGame,
    decidePokerCommand,
    type PokerCommand,
    type PokerEvent,
    type PokerGameConfig,
} from "./pokerGame";

const config: PokerGameConfig = {
    game: {
        mode: "physical",
        startingChips: 1000,
        smallBlind: 5,
        bigBlind: 10,
        ante: 0,
    },
    hostPlayerName: "Host",
    hostPeerId: "host",
};

function execute(
    game: PokerGame,
    command: PokerCommand,
    context: { actorId: string; trusted?: boolean },
) {
    const decision = game.decide(command, context);
    if (decision.accepted) game.apply(decision.events);
    return decision;
}

function createStartedGame(): PokerGame {
    const game = new PokerGame(config);
    execute(
        game,
        { type: "add-player", playerId: "guest", playerName: "Guest" },
        { actorId: "host", trusted: true },
    );
    execute(game, { type: "start-hand" }, { actorId: "host", trusted: true });
    return game;
}

function createFoldCommand(game: PokerGame): Extract<PokerCommand, { type: "player-action" }> {
    const state = game.snapshot();
    const player = state.players.find((entry) => entry.isCurrentTurn)!;
    return {
        type: "player-action",
        playerId: player.id,
        round: state.round,
        action: "fold",
    };
}

describe("PokerGame", () => {
    it("owns its state while using pure poker decisions", () => {
        const game = createStartedGame();
        const before = game.snapshot();
        const command = createFoldCommand(game);

        const result = execute(game, command, { actorId: command.playerId });

        expect(result.accepted).toBe(true);
        expect(before.players.find((player) => player.id === command.playerId)?.hasFolded).toBe(
            false,
        );
        expect(
            game.snapshot().players.find((player) => player.id === command.playerId)?.hasFolded,
        ).toBe(true);
    });

    it("does not change its state when a decision is rejected", () => {
        const game = createStartedGame();
        const before = game.snapshot();
        const command = createFoldCommand(game);

        const result = execute(game, command, { actorId: "different-player" });

        expect(result).toEqual({ accepted: false, reason: "wrong-player" });
        expect(game.snapshot()).toEqual(before);
    });

    it("reconstructs its state by applying events", () => {
        const original = new PokerGame(config);
        const events: PokerEvent[] = [];
        const addResult = execute(
            original,
            { type: "add-player", playerId: "guest", playerName: "Guest" },
            { actorId: "host", trusted: true },
        );
        if (!addResult.accepted) throw new Error("Expected player to be added");
        events.push(...addResult.events);
        const startResult = execute(
            original,
            { type: "start-hand" },
            { actorId: "host", trusted: true },
        );
        if (!startResult.accepted) throw new Error("Expected hand to start");
        events.push(...startResult.events);
        const command = createFoldCommand(original);
        const actionResult = execute(original, command, { actorId: command.playerId });
        if (!actionResult.accepted) throw new Error("Expected accepted command");
        events.push(...actionResult.events);

        const restored = new PokerGame(config);
        restored.apply(events);

        expect(restored.snapshot()).toEqual(original.snapshot());
    });

    it("applies an event batch atomically", () => {
        const game = new PokerGame(config);
        const before = game.snapshot();
        const events: PokerEvent[] = [
            {
                type: "command-executed",
                command: { type: "add-player", playerId: "guest", playerName: "Guest" },
                context: { actorId: "host", trusted: true },
            },
            {
                type: "command-executed",
                command: {
                    type: "player-action",
                    playerId: "guest",
                    round: 0,
                    action: "check",
                },
                context: { actorId: "guest" },
            },
        ];

        expect(() => game.apply(events)).toThrow("Invalid poker history");
        expect(game.snapshot()).toEqual(before);
    });

    it("keeps command decisions pure", () => {
        const game = createStartedGame();
        const state = game.snapshot();
        const command = createFoldCommand(game);

        const result = decidePokerCommand(state, command, { actorId: command.playerId });

        expect(result.accepted).toBe(true);
        expect(state.players.find((player) => player.id === command.playerId)?.hasFolded).toBe(
            false,
        );
    });
});

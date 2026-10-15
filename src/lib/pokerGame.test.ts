import { describe, expect, it } from "vite-plus/test";
import {
    PokerGame,
    decidePokerCommand,
    type PokerCommand,
    type PokerCommandContext,
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

/** Decides and applies an accepted command, returning its events. */
function execute(
    game: PokerGame,
    command: PokerCommand,
    context: PokerCommandContext,
): readonly PokerEvent[] {
    const decision = game.decide(command, context);
    if (!decision.accepted) throw new Error(`Rejected ${command.type}: ${decision.reason}`);
    game.apply(decision.events);
    return decision.events;
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
    return {
        type: "player-action",
        playerId: state.currentPlayerId!,
        round: state.round,
        action: "fold",
    };
}

describe("PokerGame", () => {
    it("rejects invalid configuration", () => {
        expect(
            () =>
                new PokerGame({
                    ...config,
                    game: { ...config.game, smallBlind: 10, bigBlind: 10 },
                }),
        ).toThrow("Invalid poker game configuration");
    });

    it("allows blinds and antes to put starting stacks all-in", () => {
        expect(
            () =>
                new PokerGame({
                    ...config,
                    game: {
                        ...config.game,
                        startingChips: 10,
                        smallBlind: 5,
                        bigBlind: 10,
                        ante: 10,
                    },
                }),
        ).not.toThrow();
    });

    it("decides without mutating state and returns detached snapshots", () => {
        const game = createStartedGame();
        const before = game.snapshot();
        const command = createFoldCommand(game);

        expect(decidePokerCommand(before, command, { actorId: command.playerId }).accepted).toBe(
            true,
        );
        expect(game.snapshot()).toEqual(before);

        execute(game, command, { actorId: command.playerId });
        expect(before.players.find((player) => player.id === command.playerId)?.hasFolded).toBe(
            false,
        );
        expect(
            game.snapshot().players.find((player) => player.id === command.playerId)?.hasFolded,
        ).toBe(true);
    });

    it("rejects actions for another player without changing state", () => {
        const game = createStartedGame();
        const before = game.snapshot();

        expect(game.decide(createFoldCommand(game), { actorId: "different-player" })).toEqual({
            accepted: false,
            reason: "wrong-player",
        });
        expect(game.snapshot()).toEqual(before);
    });

    it("reconstructs its state by applying events", () => {
        const original = new PokerGame(config);
        const events = [
            ...execute(
                original,
                { type: "add-player", playerId: "guest", playerName: "Guest" },
                { actorId: "host", trusted: true },
            ),
            ...execute(original, { type: "start-hand" }, { actorId: "host", trusted: true }),
        ];
        const command = createFoldCommand(original);
        events.push(...execute(original, command, { actorId: command.playerId }));

        const restored = new PokerGame(config);
        restored.apply(events);

        expect(restored.snapshot()).toEqual(original.snapshot());
    });

    it("rejects unknown command and event discriminants", () => {
        const game = new PokerGame(config);
        const unknownCommand = { type: "unknown" } as unknown as PokerCommand;
        const unknownEvent = { type: "unknown" } as unknown as PokerEvent;

        expect(game.decide(unknownCommand, { actorId: "host", trusted: true })).toEqual({
            accepted: false,
            reason: "invalid-action",
        });
        expect(() => game.apply([unknownEvent])).toThrow(
            "Invalid poker history: unknown event type",
        );
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

    it("enforces lifecycle and phase invariants", () => {
        const game = createStartedGame();

        expect(game.decide({ type: "start-hand" }, { actorId: "host", trusted: true })).toEqual({
            accepted: false,
            reason: "invalid-action",
        });
        expect(
            game.decide(
                { type: "add-player", playerId: "late", playerName: "Late" },
                { actorId: "host", trusted: true },
            ),
        ).toEqual({ accepted: false, reason: "invalid-action" });
        expect(
            game.decide({ type: "advance-phase", cards: [] }, { actorId: "host", trusted: true }),
        ).toEqual({ accepted: false, reason: "invalid-action" });
        expect(
            game.decide(
                { type: "record-outcome", winnersByPot: [["host"]] },
                { actorId: "host", trusted: true },
            ),
        ).toEqual({ accepted: false, reason: "invalid-action" });
    });
});

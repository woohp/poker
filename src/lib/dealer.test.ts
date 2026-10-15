import { describe, expect, it } from "vite-plus/test";
import { dealHand, drawCommunityCards, resolveShowdown, restoreDealer } from "./dealer";
import { addPlayer, createInitialGameState, startNewHand } from "./gameLogic";
import type { Card, GameState } from "./types";

function createHand(playerCount = 3): GameState {
    const state = createInitialGameState(
        { mode: "digital", startingChips: 1000, smallBlind: 5, bigBlind: 10, ante: 0 },
        "Host",
        "host",
    );
    for (let seat = 2; seat <= playerCount; seat++) addPlayer(state, `Player ${seat}`, `p${seat}`);
    startNewHand(state);
    return state;
}

function cards(value: string): Card[] {
    return value.split(" ") as Card[];
}

describe("digital dealer", () => {
    it("deals two cards to each active player from one unique deck", () => {
        const dealer = dealHand(createHand());

        expect(dealer.hands.map(([playerId, hand]) => [playerId, hand.length])).toEqual([
            ["host", 2],
            ["p2", 2],
            ["p3", 2],
        ]);
        expect(new Set([...dealer.deck, ...dealer.hands.flatMap(([, hand]) => hand)]).size).toBe(
            52,
        );
    });

    it("draws three, one, one, then no community cards", () => {
        const dealer = dealHand(createHand());

        const flop = drawCommunityCards(dealer, "preflop");
        expect(flop.cards).toHaveLength(3);
        expect(flop.deck).toHaveLength(dealer.deck.length - 3);
        expect(drawCommunityCards(dealer, "turn").cards).toHaveLength(1);
        expect(drawCommunityCards(dealer, "river").cards).toHaveLength(0);
    });

    it("awards each pot to the best eligible hand and splits ties", () => {
        const state = createHand();
        state.communityCards = cards("2c 7d 9h Js Qd");
        for (const player of state.players) player.handContribution = 100;
        const dealer = {
            round: state.round,
            deck: [],
            hands: [
                ["host", cards("Ah Kh")],
                ["p2", cards("As Kd")],
                ["p3", cards("3c 4c")],
            ] as Array<[string, Card[]]>,
        };

        expect(resolveShowdown(state, dealer)).toEqual({
            winnersByPot: [["host", "p2"]],
            revealedHands: [
                { playerId: "host", cards: cards("Ah Kh"), handName: "High card" },
                { playerId: "p2", cards: cards("As Kd"), handName: "High card" },
            ],
        });
    });

    it("restores consistent dealer state and rejects inconsistent or stale state", () => {
        const state = createHand();
        const dealer = dealHand(state);

        expect(restoreDealer(dealer, state)).toBe(dealer);
        expect(() => restoreDealer({ ...dealer, deck: dealer.deck.slice(1) }, state)).toThrow(
            "Invalid digital dealer state",
        );
        expect(() => restoreDealer({ ...dealer, round: 0 }, state)).toThrow(
            "Missing digital dealer state",
        );
    });

    it("has no dealer state for physical games", () => {
        const state = createHand();
        state.config.mode = "physical";

        expect(restoreDealer(undefined, state)).toBeNull();
    });
});

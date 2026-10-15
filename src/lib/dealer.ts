import { calculatePotAllocations, communityCardsAfter } from "./gameLogic";
import { compareHands, createShuffledDeck, evaluateHand, isValidCard } from "./poker";
import type { Card, GamePhase, GameState, RevealedHand } from "./types";

/** Host-private digital dealer state for the current hand. */
export interface DealerState {
    round: number;
    deck: Card[];
    hands: Array<[string, Card[]]>;
}

export interface Showdown {
    winnersByPot: string[][];
    revealedHands: RevealedHand[];
}

export function dealHand(state: GameState): DealerState {
    const deck = createShuffledDeck();
    const hands = state.players
        .filter((player) => player.isActive)
        .map((player): [string, Card[]] => [player.id, deck.splice(-2)]);
    return { round: state.round, deck, hands };
}

export function holeCardsFor(dealer: DealerState, playerId: string): Card[] | undefined {
    return dealer.hands.find(([id]) => id === playerId)?.[1];
}

export function drawCommunityCards(
    dealer: DealerState,
    phase: GamePhase,
): { cards: Card[]; deck: Card[] } {
    const remaining = dealer.deck.length - communityCardsAfter(phase);
    return { cards: dealer.deck.slice(remaining), deck: dealer.deck.slice(0, remaining) };
}

export function resolveShowdown(state: GameState, dealer: DealerState): Showdown {
    const handOf = (playerId: string) => [
        ...holeCardsFor(dealer, playerId)!,
        ...state.communityCards,
    ];
    const winnersByPot = calculatePotAllocations(state).map((pot) => {
        let winners: string[] = [];
        for (const playerId of pot.eligiblePlayerIds) {
            const comparison =
                winners.length === 0 ? 1 : compareHands(handOf(playerId), handOf(winners[0]!));
            if (comparison > 0) winners = [playerId];
            else if (comparison === 0) winners.push(playerId);
        }
        return winners;
    });
    const revealedHands = [...new Set(winnersByPot.flat())].map((playerId) => ({
        playerId,
        cards: holeCardsFor(dealer, playerId)!,
        handName: evaluateHand(handOf(playerId)).name,
    }));
    return { winnersByPot, revealedHands };
}

/** Returns the dealer state for a restored hand, or null when the hand has no digital dealer. */
export function restoreDealer(
    saved: DealerState | undefined,
    state: GameState,
): DealerState | null {
    if (state.config.mode !== "digital" || state.phase === "waiting") return null;
    if (!saved || saved.round !== state.round) {
        throw new Error("Missing digital dealer state");
    }

    const activePlayerIds = state.players
        .filter((player) => player.isActive)
        .map((player) => player.id);
    const allCards = [
        ...saved.deck,
        ...saved.hands.flatMap(([, cards]) => cards),
        ...state.communityCards,
    ];
    if (
        new Set(saved.hands.map(([playerId]) => playerId)).size !== saved.hands.length ||
        saved.hands.length !== activePlayerIds.length ||
        activePlayerIds.some((playerId) => holeCardsFor(saved, playerId)?.length !== 2) ||
        allCards.length !== 52 ||
        !allCards.every(isValidCard) ||
        new Set(allCards).size !== allCards.length
    ) {
        throw new Error("Invalid digital dealer state");
    }
    return saved;
}

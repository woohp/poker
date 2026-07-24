import type { Card } from "./types";

const RANKS = "23456789TJQKA";
const SUITS = ["c", "d", "h", "s"] as const;

export interface HandResult {
    score: number[];
    name: string;
}

export function createShuffledDeck(): Card[] {
    const deck: Card[] = [];
    for (const suit of SUITS) {
        for (const rank of RANKS) deck.push(`${rank}${suit}` as Card);
    }

    const random = new Uint32Array(deck.length);
    crypto.getRandomValues(random);
    for (let index = deck.length - 1; index > 0; index--) {
        const swapIndex = random[index]! % (index + 1);
        [deck[index], deck[swapIndex]] = [deck[swapIndex]!, deck[index]!];
    }
    return deck;
}

export function evaluateHand(cards: Card[]): HandResult {
    if (cards.length < 5 || cards.length > 7) throw new Error("A poker hand requires 5 to 7 cards");
    let best: HandResult | null = null;
    for (const five of combinations(cards, 5)) {
        const result = evaluateFive(five);
        if (!best || compareScores(result.score, best.score) > 0) best = result;
    }
    return best!;
}

export function compareHands(left: Card[], right: Card[]): number {
    return compareScores(evaluateHand(left).score, evaluateHand(right).score);
}

export function formatCard(card: Card): string {
    const suits: Record<string, string> = { c: "♣", d: "♦", h: "♥", s: "♠" };
    const rank = card[0] === "T" ? "10" : card[0];
    return `${rank}${suits[card[1]!]}`;
}

function evaluateFive(cards: Card[]): HandResult {
    const ranks = cards.map((card) => RANKS.indexOf(card[0]!) + 2).sort((a, b) => b - a);
    const counts = new Map<number, number>();
    for (const rank of ranks) counts.set(rank, (counts.get(rank) || 0) + 1);
    const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
    const flush = cards.every((card) => card[1] === cards[0]![1]);
    const unique = [...new Set(ranks)];
    if (unique[0] === 14) unique.push(1);
    let straightHigh = 0;
    for (let index = 0; index <= unique.length - 5; index++) {
        if (unique[index]! - unique[index + 4]! === 4) {
            straightHigh = unique[index]!;
            break;
        }
    }

    if (flush && straightHigh) return { score: [8, straightHigh], name: "Straight flush" };
    if (groups[0]![1] === 4)
        return { score: [7, groups[0]![0], groups[1]![0]], name: "Four of a kind" };
    if (groups[0]![1] === 3 && groups[1]![1] === 2)
        return { score: [6, groups[0]![0], groups[1]![0]], name: "Full house" };
    if (flush) return { score: [5, ...ranks], name: "Flush" };
    if (straightHigh) return { score: [4, straightHigh], name: "Straight" };
    if (groups[0]![1] === 3)
        return {
            score: [3, groups[0]![0], ...groups.slice(1).map(([rank]) => rank)],
            name: "Three of a kind",
        };
    if (groups[0]![1] === 2 && groups[1]![1] === 2)
        return { score: [2, groups[0]![0], groups[1]![0], groups[2]![0]], name: "Two pair" };
    if (groups[0]![1] === 2)
        return {
            score: [1, groups[0]![0], ...groups.slice(1).map(([rank]) => rank)],
            name: "Pair",
        };
    return { score: [0, ...ranks], name: "High card" };
}

function compareScores(left: number[], right: number[]): number {
    for (let index = 0; index < Math.max(left.length, right.length); index++) {
        const difference = (left[index] || 0) - (right[index] || 0);
        if (difference !== 0) return difference;
    }
    return 0;
}

function combinations<T>(items: T[], size: number): T[][] {
    const output: T[][] = [];
    function visit(start: number, selected: T[]): void {
        if (selected.length === size) {
            output.push(selected);
            return;
        }
        for (let index = start; index <= items.length - (size - selected.length); index++) {
            visit(index + 1, [...selected, items[index]!]);
        }
    }
    visit(0, []);
    return output;
}

import { describe, expect, it } from "vite-plus/test";
import { compareHands, createShuffledDeck, evaluateHand, formatCard } from "./poker";
import type { Card } from "./types";

function cards(value: string): Card[] {
    return value.split(" ") as Card[];
}

describe("digital poker cards", () => {
    it("creates a unique standard deck", () => {
        const deck = createShuffledDeck();
        expect(deck).toHaveLength(52);
        expect(new Set(deck)).toHaveLength(52);
    });

    it("formats tens with the familiar two-digit rank", () => {
        expect(formatCard("Th")).toBe("10♥");
        expect(formatCard("As")).toBe("A♠");
    });

    it("recognizes major hand categories", () => {
        expect(evaluateHand(cards("Ah Kh Qh Jh Th 2c 3d")).name).toBe("Straight flush");
        expect(evaluateHand(cards("Ac Ad Ah Kc Kd 2s 3h")).name).toBe("Full house");
        expect(evaluateHand(cards("As 2d 3h 4c 5s 9d Th")).name).toBe("Straight");
    });

    it("selects the best five cards and breaks ties", () => {
        expect(
            compareHands(cards("Ah Ad 2c 3c 4c 5c 9d"), cards("Kh Kd 2c 3c 4c 5c 9d")),
        ).toBeGreaterThan(0);
        expect(compareHands(cards("Ah Kd 2c 3c 4c 5c 6d"), cards("As Kh 2c 3c 4c 5c 6d"))).toBe(0);
    });
});

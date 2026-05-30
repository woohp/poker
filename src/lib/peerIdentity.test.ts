import { beforeEach, describe, expect, it } from "vite-plus/test";
import { getStablePeerId, loadStablePeerId, resetStablePeerId } from "./peerIdentity";

function installSessionStorageMock() {
    const store = new Map<string, string>();

    Object.defineProperty(globalThis, "sessionStorage", {
        value: {
            getItem: (key: string) => store.get(key) ?? null,
            setItem: (key: string, value: string) => {
                store.set(key, value);
            },
            removeItem: (key: string) => {
                store.delete(key);
            },
            clear: () => {
                store.clear();
            },
        },
        configurable: true,
    });
}

describe("peer identity", () => {
    beforeEach(() => {
        installSessionStorageMock();
    });

    it("reuses a stable peer id from session storage", () => {
        const peerId = getStablePeerId();

        expect(peerId).toHaveLength(20);
        expect(getStablePeerId()).toBe(peerId);
        expect(loadStablePeerId()).toBe(peerId);
    });

    it("ignores invalid cached peer ids", () => {
        sessionStorage.setItem("poker-peer-id", btoa("too-short"));

        const peerId = getStablePeerId();

        expect(peerId).toHaveLength(20);
        expect(peerId).not.toBe("too-short");
    });

    it("can reset the stable peer id", () => {
        const firstPeerId = getStablePeerId();
        const nextPeerId = resetStablePeerId();

        expect(nextPeerId).toHaveLength(20);
        expect(nextPeerId).not.toBe(firstPeerId);
        expect(loadStablePeerId()).toBe(nextPeerId);
    });
});

import { beforeEach, describe, expect, it } from "vite-plus/test";
import { getStablePeerId, loadStablePeerId } from "./peerIdentity";

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
});

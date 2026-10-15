import { beforeEach, describe, expect, it } from "vite-plus/test";
import { getStablePeerId, loadStablePeerId, resetStablePeerId } from "./peerIdentity";
import { installMemoryStorage } from "./testStorage";

describe("peer identity", () => {
    beforeEach(() => {
        installMemoryStorage("sessionStorage");
    });

    it("reuses a stable peer id from session storage", () => {
        const peerId = getStablePeerId();

        expect(peerId).toHaveLength(20);
        expect(getStablePeerId()).toBe(peerId);
        expect(loadStablePeerId()).toBe(peerId);
    });

    it("ignores invalid cached peer ids", () => {
        sessionStorage.setItem("poker-peer-id", "too-short");

        expect(getStablePeerId()).toHaveLength(20);
    });

    it("can reset the stable peer id", () => {
        const firstPeerId = getStablePeerId();
        const nextPeerId = resetStablePeerId();

        expect(nextPeerId).not.toBe(firstPeerId);
        expect(loadStablePeerId()).toBe(nextPeerId);
    });
});

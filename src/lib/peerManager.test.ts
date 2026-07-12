import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type * as Y from "yjs";
import type { GameState, PeerMessage } from "./types";

interface MockProviderInstance {
    roomName: string;
    doc: Y.Doc;
    opts: { peerId?: string; rtcConfig?: RTCConfiguration };
    handlers: Map<string, Array<(payload: unknown) => void>>;
    destroyed: boolean;
    ready: Promise<void>;
    on: (event: string, handler: (payload: unknown) => void) => void;
    emit: (event: string, payload: unknown) => void;
    destroy: () => void;
}

const webtorrentMock = vi.hoisted(() => ({
    instances: [] as MockProviderInstance[],
}));

vi.mock("y-webtorrent", async () => {
    class MockWebtorrentProvider {
        roomName: string;
        doc: Y.Doc;
        opts: { peerId?: string; rtcConfig?: RTCConfiguration };
        handlers = new Map<string, Array<(payload: unknown) => void>>();
        destroyed = false;
        ready = Promise.resolve();

        constructor(
            roomName: string,
            doc: Y.Doc,
            opts: { peerId?: string; rtcConfig?: RTCConfiguration },
        ) {
            this.roomName = roomName;
            this.doc = doc;
            this.opts = opts;
            webtorrentMock.instances.push(this as MockProviderInstance);
        }

        on(event: string, handler: (payload: unknown) => void) {
            const handlers = this.handlers.get(event) || [];
            handlers.push(handler);
            this.handlers.set(event, handlers);
        }

        emit(event: string, payload: unknown) {
            for (const handler of this.handlers.get(event) || []) {
                handler(payload);
            }
        }

        destroy() {
            this.destroyed = true;
        }
    }

    return {
        WebtorrentProvider: MockWebtorrentProvider,
    };
});

import { PeerManager } from "./peerManager";

function parseLastMessage(doc: Y.Doc): unknown {
    const messages = doc.getArray<string>("messages").toArray();
    return JSON.parse(messages.at(-1) || "null");
}

function sampleState(): GameState {
    return {
        players: [],
        phase: "waiting",
        pot: 0,
        currentBet: 0,
        minRaise: 10,
        round: 0,
        deck: [],
        communityCards: [],
        config: {
            startingChips: 1000,
            smallBlind: 5,
            bigBlind: 10,
            ante: 0,
        },
        statusMessage: "",
        lastPayouts: [],
    };
}

describe("PeerManager", () => {
    beforeEach(() => {
        webtorrentMock.instances.length = 0;
    });

    it("creates a host with the provided peer id and room code", async () => {
        const peerManager = new PeerManager(
            () => {},
            () => {},
        );

        const peerId = await peerManager.createHost("host-1", "room-1");
        const provider = webtorrentMock.instances[0]!;

        expect(peerId).toBe("host-1");
        expect(peerManager.getLocalPeerId()).toBe("host-1");
        expect(peerManager.getRoomCode()).toBe("room-1");
        expect(provider.roomName).toBe("room-1");
        expect(provider.opts.peerId).toBe("host-1");
        expect(provider.opts.rtcConfig?.iceServers).toEqual([
            { urls: "stun:stun.l.google.com:19302" },
            { urls: "stun:stun.cloudflare.com:3478" },
        ]);
    });

    it("joins a room and publishes a join message", async () => {
        const peerManager = new PeerManager(
            () => {},
            () => {},
        );

        const peerId = await peerManager.joinGame("room-2", "Alice", "guest-1");
        const provider = webtorrentMock.instances[0]!;
        const message = parseLastMessage(provider.doc) as {
            from: string;
            to: string | null;
            message: PeerMessage;
        };

        expect(peerId).toBe("guest-1");
        expect(peerManager.getRoomCode()).toBe("room-2");
        expect(message.from).toBe("guest-1");
        expect(message.to).toBeNull();
        expect(message.message).toEqual({
            type: "join",
            playerName: "Alice",
            peerId: "guest-1",
        });
    });

    it("sends targeted messages and broadcasts shared state", async () => {
        const peerManager = new PeerManager(
            () => {},
            () => {},
        );
        await peerManager.createHost("host-2", "room-3");

        const provider = webtorrentMock.instances[0]!;
        const state = sampleState();

        peerManager.sendToPeer("guest-2", {
            type: "joinResponse",
            accepted: true,
            playerId: "guest-2",
            state,
        });
        peerManager.broadcastState(state);

        const message = parseLastMessage(provider.doc) as {
            to: string | null;
            message: PeerMessage;
        };

        expect(message.to).toBe("guest-2");
        expect(message.message).toMatchObject({
            type: "joinResponse",
            accepted: true,
            playerId: "guest-2",
        });
        expect(provider.doc.getMap<string>("state").get("game")).toBe(JSON.stringify(state));
    });

    it("delivers broadcast room messages to the host", async () => {
        const onMessage = vi.fn();
        const peerManager = new PeerManager(onMessage, () => {});
        await peerManager.createHost("host-3", "room-4");

        const provider = webtorrentMock.instances[0]!;
        provider.doc.getArray<string>("messages").push([
            JSON.stringify({
                id: "msg-1",
                from: "guest-3",
                to: null,
                message: {
                    type: "join",
                    playerName: "Bob",
                    peerId: "guest-3",
                },
            }),
        ]);

        expect(onMessage).toHaveBeenCalledWith(
            {
                type: "join",
                playerName: "Bob",
                peerId: "guest-3",
            },
            "guest-3",
        );
    });

    it("delivers targeted messages to the matching client only", async () => {
        const onMessage = vi.fn();
        const peerManager = new PeerManager(onMessage, () => {});
        await peerManager.joinGame("room-5", "Cara", "guest-4");

        const provider = webtorrentMock.instances[0]!;
        provider.doc.getArray<string>("messages").push([
            JSON.stringify({
                id: "msg-ignore",
                from: "host-4",
                to: "someone-else",
                message: {
                    type: "joinResponse",
                    accepted: false,
                    message: "ignore",
                },
            }),
            JSON.stringify({
                id: "msg-hit",
                from: "host-4",
                to: "guest-4",
                message: {
                    type: "joinResponse",
                    accepted: true,
                    playerId: "guest-4",
                    state: sampleState(),
                },
            }),
        ]);

        expect(onMessage).toHaveBeenCalledTimes(1);
        expect(onMessage).toHaveBeenCalledWith(
            {
                type: "joinResponse",
                accepted: true,
                playerId: "guest-4",
                state: sampleState(),
            },
            "host-4",
        );
    });

    it("delivers shared state updates to clients", async () => {
        const onMessage = vi.fn();
        const peerManager = new PeerManager(onMessage, () => {});
        await peerManager.joinGame("room-6", "Dana", "guest-5");

        const provider = webtorrentMock.instances[0]!;
        const state = sampleState();
        state.pot = 55;

        provider.doc.getMap<string>("state").set("game", JSON.stringify(state));

        expect(onMessage).toHaveBeenCalledWith({ type: "state", state }, "host");
    });

    it("emits peer connect and disconnect changes from provider peer events", async () => {
        const onConnectionChange = vi.fn();
        const peerManager = new PeerManager(() => {}, onConnectionChange);
        await peerManager.createHost("host-5", "room-7");

        const provider = webtorrentMock.instances[0]!;
        provider.emit("peers", {
            added: ["peer-a", "peer-b"],
            removed: [],
            webrtcPeers: ["peer-a", "peer-b"],
        });
        provider.emit("peers", {
            added: ["peer-c"],
            removed: ["peer-a"],
            webrtcPeers: ["peer-b", "peer-c"],
        });

        expect(onConnectionChange.mock.calls).toEqual([
            ["peer-a", true],
            ["peer-b", true],
            ["peer-c", true],
            ["peer-a", false],
        ]);
    });

    it("disconnect destroys the provider and allows repeated calls", async () => {
        const peerManager = new PeerManager(
            () => {},
            () => {},
        );
        await peerManager.createHost("host-6", "room-8");

        const provider = webtorrentMock.instances[0]!;
        peerManager.disconnect();
        peerManager.disconnect();

        expect(provider.destroyed).toBe(true);
    });
});

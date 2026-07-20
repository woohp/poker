import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type * as Y from "yjs";
import type { GameSnapshot, GameState, PeerMessage } from "./types";

interface MockProviderInstance {
    roomName: string;
    doc: Y.Doc;
    opts: { peerId?: string; rtcConfig?: RTCConfiguration };
    handlers: Map<string, Array<(...payload: unknown[]) => void>>;
    awareness: MockAwareness;
    peers: Map<string, never>;
    sentDirectMessages: Array<{ peerId: string; payload: Uint8Array }>;
    destroyed: boolean;
    ready: Promise<void>;
    on: (event: string, handler: (...payload: unknown[]) => void) => void;
    emit: (event: string, ...payload: unknown[]) => void;
    destroy: () => void;
}

class MockAwareness {
    private states = new Map<number, Record<string, unknown>>();
    private handlers: Array<() => void> = [];

    setLocalState(state: Record<string, unknown> | null): void {
        if (state) this.states.set(1, state);
        else this.states.delete(1);
        this.emitChange();
    }

    setRemotePeerIds(peerIds: string[]): void {
        const localState = this.states.get(1);
        this.states = new Map(peerIds.map((peerId, index) => [index + 2, { peerId }]));
        if (localState) this.states.set(1, localState);
        this.emitChange();
    }

    getStates(): Map<number, Record<string, unknown>> {
        return this.states;
    }

    on(_event: "change", handler: () => void): void {
        this.handlers.push(handler);
    }

    private emitChange(): void {
        for (const handler of this.handlers) handler();
    }
}

const webtorrentMock = vi.hoisted(() => ({
    instances: [] as MockProviderInstance[],
}));

vi.mock("y-webtorrent", async () => {
    class MockWebtorrentProvider {
        roomName: string;
        doc: Y.Doc;
        opts: { peerId?: string; rtcConfig?: RTCConfiguration };
        handlers = new Map<string, Array<(...payload: unknown[]) => void>>();
        awareness = new MockAwareness();
        peers = new Map<string, never>();
        sentDirectMessages: Array<{ peerId: string; payload: Uint8Array }> = [];
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

        on(event: string, handler: (...payload: unknown[]) => void) {
            const handlers = this.handlers.get(event) || [];
            handlers.push(handler);
            this.handlers.set(event, handlers);
        }

        emit(event: string, ...payload: unknown[]) {
            for (const handler of this.handlers.get(event) || []) {
                handler(...payload);
            }
        }

        sendToPeer(peerId: string, payload: Uint8Array) {
            this.sentDirectMessages.push({ peerId, payload });
            return true;
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
        communityCards: [],
        revealedHands: [],
        config: {
            mode: "physical",
            startingChips: 1000,
            smallBlind: 5,
            bigBlind: 10,
            ante: 0,
        },
        statusMessage: "",
        lastPayouts: [],
    };
}

function sampleSnapshot(revision = 0): GameSnapshot {
    return {
        authorityEpoch: "authority-test",
        revision,
        state: sampleState(),
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
        expect(message.message).toMatchObject({
            type: "join",
            playerName: "Alice",
            peerId: "guest-1",
        });
        expect(message.message.type === "join" && message.message.requestId).toBeTruthy();
    });

    it("sends targeted messages and broadcasts shared state", async () => {
        const peerManager = new PeerManager(
            () => {},
            () => {},
        );
        await peerManager.createHost("host-2", "room-3");

        const provider = webtorrentMock.instances[0]!;
        const snapshot = sampleSnapshot();

        peerManager.sendToPeer("guest-2", {
            type: "joinResponse",
            requestId: "request-2",
            accepted: true,
            playerId: "guest-2",
            snapshot,
        });
        peerManager.broadcastState(snapshot);

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
        expect(provider.doc.getMap<string>("state").get("game")).toBe(JSON.stringify(snapshot));
    });

    it("broadcasts state through Yjs without a second unordered direct delivery", async () => {
        const peerManager = new PeerManager(
            () => {},
            () => {},
        );
        await peerManager.createHost("host-direct", "room-direct");

        const provider = webtorrentMock.instances[0]!;
        provider.awareness.setRemotePeerIds(["peer-a", "peer-b"]);
        const snapshot = sampleSnapshot();
        snapshot.state.pot = 75;

        peerManager.broadcastState(snapshot);

        expect(snapshot.revision).toBe(0);
        expect(provider.doc.getMap<string>("state").get("game")).toBe(JSON.stringify(snapshot));
        expect(provider.sentDirectMessages).toHaveLength(0);
    });

    it("keeps the newest Yjs state", async () => {
        const receivedStates: GameSnapshot[] = [];
        const peerManager = new PeerManager(
            (message) => {
                if (message.type === "state") receivedStates.push(message.snapshot);
            },
            () => {},
        );
        await peerManager.joinGame("room-state-order", "Guest", "guest-state-order");

        const provider = webtorrentMock.instances[0]!;
        const olderState = sampleSnapshot(1);
        olderState.state.pot = 10;
        const newerState = sampleSnapshot(2);
        newerState.state.pot = 20;

        provider.doc.getMap<string>("state").set("game", JSON.stringify(olderState));
        provider.doc.getMap<string>("state").set("game", JSON.stringify(newerState));

        expect(receivedStates.at(-1)).toEqual(newerState);
        expect(provider.sentDirectMessages).toHaveLength(0);
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
                    requestId: "request-3",
                    playerName: "Bob",
                    peerId: "guest-3",
                },
            }),
        ]);

        expect(onMessage).toHaveBeenCalledWith(
            {
                type: "join",
                requestId: "request-3",
                playerName: "Bob",
                peerId: "guest-3",
            },
            "guest-3",
        );
    });

    it("delivers messages inserted before previously processed messages", async () => {
        const onMessage = vi.fn();
        const peerManager = new PeerManager(onMessage, () => {});
        await peerManager.createHost("host-ordered", "room-ordered");

        const messages = webtorrentMock.instances[0]!.doc.getArray<string>("messages");
        messages.push([
            JSON.stringify({
                id: "msg-later",
                from: "guest-later",
                to: null,
                message: {
                    type: "join",
                    requestId: "request-later",
                    playerName: "Later",
                    peerId: "guest-later",
                },
            }),
        ]);
        messages.insert(0, [
            JSON.stringify({
                id: "msg-earlier",
                from: "guest-earlier",
                to: "host-ordered",
                message: {
                    type: "action",
                    commandId: "command-earlier",
                    authorityEpoch: "authority-test",
                    playerId: "guest-earlier",
                    round: 1,
                    expectedRevision: 1,
                    action: "check",
                },
            }),
        ]);

        expect(onMessage).toHaveBeenCalledTimes(2);
        expect(onMessage).toHaveBeenLastCalledWith(
            {
                type: "action",
                commandId: "command-earlier",
                authorityEpoch: "authority-test",
                playerId: "guest-earlier",
                round: 1,
                expectedRevision: 1,
                action: "check",
            },
            "guest-earlier",
        );
    });

    it("delivers only the join response matching the current request", async () => {
        const onMessage = vi.fn();
        const peerManager = new PeerManager(onMessage, () => {});
        await peerManager.joinGame("room-5", "Cara", "guest-4");

        const provider = webtorrentMock.instances[0]!;
        const joinEnvelope = parseLastMessage(provider.doc) as {
            message: { type: "join"; requestId: string };
        };
        const response = {
            type: "joinResponse" as const,
            requestId: joinEnvelope.message.requestId,
            accepted: true,
            playerId: "guest-4",
            snapshot: sampleSnapshot(),
        };
        provider.doc.getArray<string>("messages").push([
            JSON.stringify({
                id: "msg-stale",
                from: "host-4",
                to: "guest-4",
                message: {
                    type: "joinResponse",
                    requestId: "old-request",
                    accepted: false,
                    message: "stale rejection",
                },
            }),
            JSON.stringify({
                id: "msg-hit",
                from: "host-4",
                to: "guest-4",
                message: response,
            }),
        ]);

        expect(onMessage).toHaveBeenCalledTimes(1);
        expect(onMessage).toHaveBeenCalledWith(response, "host-4");
    });

    it("delivers shared state updates to clients", async () => {
        const onMessage = vi.fn();
        const peerManager = new PeerManager(onMessage, () => {});
        await peerManager.joinGame("room-6", "Dana", "guest-5");

        const provider = webtorrentMock.instances[0]!;
        const snapshot = sampleSnapshot();
        snapshot.state.pot = 55;

        provider.doc.getMap<string>("state").set("game", JSON.stringify(snapshot));

        expect(onMessage).toHaveBeenCalledWith({ type: "state", snapshot }, "host");
    });

    it("emits peer connect and disconnect changes from awareness", async () => {
        const onConnectionChange = vi.fn();
        const peerManager = new PeerManager(() => {}, onConnectionChange);
        await peerManager.createHost("host-5", "room-7");

        const provider = webtorrentMock.instances[0]!;
        provider.awareness.setRemotePeerIds(["peer-a", "peer-b"]);
        provider.awareness.setRemotePeerIds(["peer-b", "peer-c"]);

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

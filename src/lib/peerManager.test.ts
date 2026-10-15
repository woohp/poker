import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type * as Y from "yjs";
import { createInitialGameState } from "./gameLogic";
import type { GameSnapshot, PeerMessage } from "./types";

const { MockMultiProvider } = vi.hoisted(() => {
    class MockAwareness {
        private states = new Map<number, Record<string, unknown>>();

        setLocalState(state: Record<string, unknown> | null): void {
            if (state) this.states.set(1, state);
            else this.states.delete(1);
        }

        setRemotePeerIds(peerIds: string[]): void {
            const localState = this.states.get(1);
            this.states = new Map(peerIds.map((peerId, index) => [index + 2, { peerId }]));
            if (localState) this.states.set(1, localState);
        }

        getStates(): Map<number, Record<string, unknown>> {
            return this.states;
        }
    }

    class MockMultiProvider {
        static instances: MockMultiProvider[] = [];
        handlers = new Map<string, Array<(...payload: unknown[]) => void>>();
        awareness = new MockAwareness();
        sentDirectMessages: Array<{ peerId: string; payload: Uint8Array }> = [];
        destroyed = false;
        ready = Promise.resolve();

        constructor(
            readonly roomName: string,
            readonly doc: Y.Doc,
            readonly opts: { providers: unknown[] },
        ) {
            MockMultiProvider.instances.push(this);
        }

        on(event: string, handler: (...payload: unknown[]) => void) {
            this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
        }

        emit(event: string, ...payload: unknown[]) {
            for (const handler of this.handlers.get(event) ?? []) handler(...payload);
        }

        sendToPeer(peerId: string, payload: Uint8Array) {
            this.sentDirectMessages.push({ peerId, payload });
            return true;
        }

        destroy() {
            this.destroyed = true;
        }
    }

    return { MockMultiProvider };
});

vi.mock("y-multiprovider", () => ({ MultiProvider: MockMultiProvider }));

import { PeerManager } from "./peerManager";

interface Envelope {
    id: string;
    from: string;
    to: string | null;
    message: PeerMessage;
}

function lastProvider(): InstanceType<typeof MockMultiProvider> {
    return MockMultiProvider.instances.at(-1)!;
}

function parseLastMessage(doc: Y.Doc): Envelope {
    return JSON.parse(doc.getArray<string>("messages").toArray().at(-1)!) as Envelope;
}

function pushEnvelopes(doc: Y.Doc, ...envelopes: Envelope[]): void {
    doc.getArray<string>("messages").push(envelopes.map((envelope) => JSON.stringify(envelope)));
}

function sampleSnapshot(revision = 0): GameSnapshot {
    return {
        revision,
        state: createInitialGameState(
            { mode: "physical", startingChips: 1000, smallBlind: 5, bigBlind: 10, ante: 0 },
            "Host",
            "host",
        ),
    };
}

describe("PeerManager", () => {
    beforeEach(() => {
        MockMultiProvider.instances.length = 0;
    });

    it("hosts the provided room, or generates a room code", async () => {
        const peerManager = new PeerManager(
            () => {},
            () => {},
        );

        expect(await peerManager.createHost("host-1", "room-1")).toBe("room-1");
        expect(lastProvider().roomName).toBe("room-1");
        expect(lastProvider().opts.providers).toHaveLength(2);

        const generatedRoomCode = await peerManager.createHost("host-1");
        expect(generatedRoomCode).toHaveLength(10);
        expect(lastProvider().roomName).toBe(generatedRoomCode);
    });

    it("joins a room and publishes a join message", async () => {
        const peerManager = new PeerManager(
            () => {},
            () => {},
        );

        await peerManager.joinGame("room-2", "Alice", "guest-1");
        const provider = lastProvider();
        const message = parseLastMessage(provider.doc);

        expect(provider.roomName).toBe("room-2");
        expect(message.from).toBe("guest-1");
        expect(message.to).toBeNull();
        expect(message.message).toMatchObject({
            type: "join",
            playerName: "Alice",
            peerId: "guest-1",
        });
        expect(message.message.type === "join" && message.message.requestId).toBeTruthy();
    });

    it("sends targeted room messages", async () => {
        const peerManager = new PeerManager(
            () => {},
            () => {},
        );
        await peerManager.createHost("host-2", "room-3");

        peerManager.sendToPeer("guest-2", {
            type: "joinResponse",
            requestId: "request-2",
            accepted: false,
        });

        expect(parseLastMessage(lastProvider().doc)).toMatchObject({
            from: "host-2",
            to: "guest-2",
            message: { type: "joinResponse", requestId: "request-2", accepted: false },
        });
    });

    it("broadcasts state directly with Yjs as a synchronization fallback", async () => {
        const peerManager = new PeerManager(
            () => {},
            () => {},
        );
        await peerManager.createHost("host-direct", "room-direct");

        const provider = lastProvider();
        provider.awareness.setRemotePeerIds(["peer-a", "peer-b"]);
        const snapshot = sampleSnapshot();
        snapshot.state.pot = 75;

        peerManager.broadcastState(snapshot);

        expect(provider.doc.getMap<string>("state").get("game")).toBe(JSON.stringify(snapshot));
        expect(
            provider.sentDirectMessages.map(({ peerId, payload }) => ({
                peerId,
                message: JSON.parse(new TextDecoder().decode(payload)) as PeerMessage,
            })),
        ).toEqual([
            { peerId: "peer-a", message: { type: "state", snapshot } },
            { peerId: "peer-b", message: { type: "state", snapshot } },
        ]);
    });

    it("delivers broadcast room messages to the host", async () => {
        const onMessage = vi.fn();
        const peerManager = new PeerManager(onMessage, () => {});
        await peerManager.createHost("host-3", "room-4");

        const join: PeerMessage = {
            type: "join",
            requestId: "request-3",
            playerName: "Bob",
            peerId: "guest-3",
        };
        pushEnvelopes(lastProvider().doc, {
            id: "msg-1",
            from: "guest-3",
            to: null,
            message: join,
        });

        expect(onMessage).toHaveBeenCalledWith(join, "guest-3");
    });

    it("delivers messages inserted before previously processed messages", async () => {
        const onMessage = vi.fn();
        const peerManager = new PeerManager(onMessage, () => {});
        await peerManager.createHost("host-ordered", "room-ordered");

        const doc = lastProvider().doc;
        pushEnvelopes(doc, {
            id: "msg-later",
            from: "guest-later",
            to: null,
            message: {
                type: "join",
                requestId: "request-later",
                playerName: "Later",
                peerId: "guest-later",
            },
        });
        const action: PeerMessage = {
            type: "action",
            commandId: "command-earlier",
            playerId: "guest-earlier",
            round: 1,
            expectedRevision: 1,
            action: "check",
        };
        doc.getArray<string>("messages").insert(0, [
            JSON.stringify({
                id: "msg-earlier",
                from: "guest-earlier",
                to: "host-ordered",
                message: action,
            }),
        ]);

        expect(onMessage).toHaveBeenCalledTimes(2);
        expect(onMessage).toHaveBeenLastCalledWith(action, "guest-earlier");
    });

    it("delivers only the join response matching the current request", async () => {
        const onMessage = vi.fn();
        const peerManager = new PeerManager(onMessage, () => {});
        await peerManager.joinGame("room-5", "Cara", "guest-4");

        const doc = lastProvider().doc;
        const join = parseLastMessage(doc).message;
        const response: PeerMessage = {
            type: "joinResponse",
            requestId: join.type === "join" ? join.requestId : "",
            accepted: true,
            playerId: "guest-4",
            snapshot: sampleSnapshot(),
        };
        pushEnvelopes(
            doc,
            {
                id: "msg-stale",
                from: "host-4",
                to: "guest-4",
                message: { type: "joinResponse", requestId: "old-request", accepted: false },
            },
            { id: "msg-hit", from: "host-4", to: "guest-4", message: response },
        );

        expect(onMessage).toHaveBeenCalledTimes(1);
        expect(onMessage).toHaveBeenCalledWith(response, "host-4");
    });

    it("delivers shared state updates to clients", async () => {
        const onMessage = vi.fn();
        const peerManager = new PeerManager(onMessage, () => {});
        await peerManager.joinGame("room-6", "Dana", "guest-5");

        const provider = lastProvider();
        const snapshot = sampleSnapshot();
        snapshot.state.pot = 55;

        provider.doc.getMap<string>("state").set("game", JSON.stringify(snapshot));

        expect(onMessage).toHaveBeenCalledWith({ type: "state", snapshot }, "host");
    });

    it("emits aggregate logical peer connect and disconnect changes", async () => {
        const onConnectionChange = vi.fn();
        const peerManager = new PeerManager(() => {}, onConnectionChange);
        await peerManager.createHost("host-5", "room-7");

        const provider = lastProvider();
        provider.emit("peer-change", {
            peerId: "peer-a",
            connected: true,
            transports: ["nostr"],
        });
        provider.emit("peer-change", {
            peerId: "peer-b",
            connected: true,
            transports: ["nostr", "webtorrent"],
        });
        provider.emit("peer-change", {
            peerId: "peer-c",
            connected: true,
            transports: ["webtorrent"],
        });
        provider.emit("peer-change", {
            peerId: "peer-a",
            connected: false,
            transports: [],
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

        const provider = lastProvider();
        peerManager.disconnect();
        peerManager.disconnect();

        expect(provider.destroyed).toBe(true);
    });
});

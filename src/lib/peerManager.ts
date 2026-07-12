import * as Y from "yjs";
import { WebtorrentProvider } from "y-webtorrent";
import type { GameState, PeerMessage } from "./types";

type MessageHandler = (message: PeerMessage, fromPeerId: string) => void;
type ConnectionChangeHandler = (peerId: string, connected: boolean) => void;
type WebtorrentDoc = ConstructorParameters<typeof WebtorrentProvider>[1];

interface MessageEnvelope {
    id: string;
    from: string;
    to: string | null;
    message: Exclude<PeerMessage, { type: "state" }>;
}

const TRACKER_URLS = ["wss://tracker.openwebtorrent.com", "wss://tracker.webtorrent.dev"];
const RTC_CONFIG: RTCConfiguration = {
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun.cloudflare.com:3478" },
    ],
};

export function generateRoomCode(length = 10): string {
    return randomId(length);
}

export function generatePeerId(length = 20): string {
    return randomId(length);
}

export class PeerManager {
    private provider: WebtorrentProvider | null = null;
    private doc: Y.Doc | null = null;
    private messages: Y.Array<string> | null = null;
    private stateMap: Y.Map<string> | null = null;
    private onMessage: MessageHandler;
    private onConnectionChange: ConnectionChangeHandler;
    private localPeerId = "";
    private roomCode = "";
    private isHost = false;
    private knownMessageCount = 0;
    private connectedPeerIds: Set<string> = new Set();
    private wrappedPrivatePeers: Set<string> = new Set();

    constructor(onMessage: MessageHandler, onConnectionChange: ConnectionChangeHandler) {
        this.onMessage = onMessage;
        this.onConnectionChange = onConnectionChange;
    }

    async createHost(peerId?: string, roomCode?: string): Promise<string> {
        this.isHost = true;
        this.localPeerId = peerId || generatePeerId();
        this.roomCode = roomCode || generateRoomCode();
        await this.initializeProvider();
        return this.localPeerId;
    }

    async joinGame(roomCode: string, playerName: string, peerId?: string): Promise<string> {
        this.isHost = false;
        this.localPeerId = peerId || generatePeerId();
        this.roomCode = roomCode;
        await this.initializeProvider();

        this.messages?.push([
            JSON.stringify({
                id: randomId(16),
                from: this.localPeerId,
                to: null,
                message: {
                    type: "join",
                    playerName,
                    peerId: this.localPeerId,
                },
            } satisfies MessageEnvelope),
        ]);

        return this.localPeerId;
    }

    private async initializeProvider(): Promise<void> {
        this.disconnect();

        this.doc = new Y.Doc();
        this.messages = this.doc.getArray<string>("messages");
        this.stateMap = this.doc.getMap<string>("state");
        this.knownMessageCount = this.messages.length;
        this.connectedPeerIds.clear();

        this.messages.observe(() => {
            this.handleMessageUpdates();
        });

        this.stateMap.observe((event) => {
            if (this.isHost || !event.keysChanged.has("game")) {
                return;
            }

            const rawState = this.stateMap?.get("game");
            if (!rawState) {
                return;
            }

            try {
                const state = JSON.parse(rawState) as GameState;
                this.onMessage({ type: "state", state }, "host");
            } catch (error) {
                console.error("Failed to parse shared game state:", error);
            }
        });

        this.provider = new WebtorrentProvider(
            this.roomCode,
            this.doc as unknown as WebtorrentDoc,
            {
                trackers: TRACKER_URLS,
                peerId: this.localPeerId,
                rtcConfig: RTC_CONFIG,
            },
        );

        this.provider.awareness.setLocalState({ peerId: this.localPeerId });
        this.provider.awareness.on("change", () => {
            this.installPrivateMessageHandlers();
            this.handlePeerList(this.getAwarenessPeerIds());
        });

        this.provider.on("connection-error", (error: unknown) => {
            console.error("Webtorrent connection error:", error);
        });

        this.provider.on("peer-error", (error: unknown) => {
            console.error("Webtorrent peer error:", error);
        });

        await this.provider.ready;
    }

    private handleMessageUpdates(): void {
        if (!this.messages) {
            return;
        }

        const nextMessages = this.messages.toArray().slice(this.knownMessageCount);
        this.knownMessageCount += nextMessages.length;

        for (const rawEnvelope of nextMessages) {
            try {
                const envelope = JSON.parse(rawEnvelope) as MessageEnvelope;
                if (envelope.from === this.localPeerId) {
                    continue;
                }

                if (envelope.to && envelope.to !== this.localPeerId) {
                    continue;
                }

                if (envelope.to === null && !this.isHost) {
                    continue;
                }

                this.onMessage(envelope.message, envelope.from);
            } catch (error) {
                console.error("Failed to parse room message:", error);
            }
        }
    }

    private installPrivateMessageHandlers(): void {
        if (!this.provider) return;
        for (const [peerId, peer] of this.provider.peers) {
            if (this.wrappedPrivatePeers.has(peerId)) continue;
            const mutablePeer = peer as unknown as {
                onMessage: (peer: unknown, data: ArrayBuffer) => void;
                remotePeerId: string | null;
            };
            const originalHandler = mutablePeer.onMessage;
            mutablePeer.onMessage = (source, data) => {
                const bytes = new Uint8Array(data);
                if (bytes[0] !== 4) {
                    originalHandler(source, data);
                    return;
                }
                try {
                    const message = JSON.parse(new TextDecoder().decode(bytes.slice(1))) as Exclude<
                        PeerMessage,
                        { type: "state" }
                    >;
                    this.onMessage(message, mutablePeer.remotePeerId || peerId);
                } catch (error) {
                    console.error("Failed to parse private peer message:", error);
                }
            };
            this.wrappedPrivatePeers.add(peerId);
        }
    }

    private getAwarenessPeerIds(): string[] {
        if (!this.provider) {
            return [];
        }

        return Array.from(this.provider.awareness.getStates().values())
            .map((state) => state["peerId"])
            .filter(
                (peerId): peerId is string =>
                    typeof peerId === "string" && peerId !== this.localPeerId,
            );
    }

    private handlePeerList(peerIds: string[]): void {
        const nextPeerIds = new Set(peerIds);

        for (const peerId of nextPeerIds) {
            if (!this.connectedPeerIds.has(peerId)) {
                this.onConnectionChange(peerId, true);
            }
        }

        for (const peerId of this.connectedPeerIds) {
            if (!nextPeerIds.has(peerId)) {
                this.onConnectionChange(peerId, false);
            }
        }

        this.connectedPeerIds = nextPeerIds;
    }

    sendPrivateToPeer(peerId: string, message: Exclude<PeerMessage, { type: "state" }>): boolean {
        const peer = this.provider?.peers.get(peerId);
        if (!peer?.connected) return false;
        const payload = new TextEncoder().encode(JSON.stringify(message));
        const packet = new Uint8Array(payload.length + 1);
        packet[0] = 4;
        packet.set(payload, 1);
        peer.send(packet);
        return true;
    }

    sendToPeer(peerId: string, message: Exclude<PeerMessage, { type: "state" }>): void {
        this.messages?.push([
            JSON.stringify({
                id: randomId(16),
                from: this.localPeerId,
                to: peerId,
                message,
            } satisfies MessageEnvelope),
        ]);
    }

    broadcast(message: Exclude<PeerMessage, { type: "state" }>, excludePeerId?: string): void {
        this.messages?.push([
            JSON.stringify({
                id: randomId(16),
                from: this.localPeerId,
                to: null,
                message: excludePeerId
                    ? {
                          ...message,
                      }
                    : message,
            } satisfies MessageEnvelope),
        ]);
    }

    broadcastState(state: GameState, _excludePeerId?: string): void {
        this.stateMap?.set("game", JSON.stringify(state));
    }

    getLocalPeerId(): string {
        return this.localPeerId;
    }

    getRoomCode(): string {
        return this.roomCode;
    }

    isHostConnection(): boolean {
        return this.isHost;
    }

    announceDeparture(): void {
        this.provider?.awareness.setLocalState(null);
    }

    disconnect(): void {
        this.announceDeparture();
        this.provider?.destroy();
        this.provider = null;
        this.doc?.destroy();
        this.doc = null;
        this.messages = null;
        this.stateMap = null;
        this.knownMessageCount = 0;
        this.connectedPeerIds.clear();
        this.wrappedPrivatePeers.clear();
    }
}

function randomId(length: number): string {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);

    let output = "";
    for (const byte of bytes) {
        output += alphabet[byte % alphabet.length];
    }
    return output;
}

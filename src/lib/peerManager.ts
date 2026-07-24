import * as Y from "yjs";
import { WebtorrentProvider } from "y-webtorrent";
import type { GameSnapshot, PeerMessage } from "./types";

type MessageHandler = (message: PeerMessage, fromPeerId: string) => void;
type ConnectionChangeHandler = (peerId: string, connected: boolean) => void;
type WebtorrentDoc = ConstructorParameters<typeof WebtorrentProvider>[1];

interface MessageEnvelope {
    id: string;
    from: string;
    to: string | null;
    message: Exclude<PeerMessage, { type: "state" }>;
}

const DEFAULT_TRACKER_URLS = ["wss://tracker.openwebtorrent.com", "wss://tracker.webtorrent.dev"];
const TRACKER_URLS = import.meta.env.VITE_TRACKER_URLS
    ? import.meta.env.VITE_TRACKER_URLS.split(",").map((url: string) => url.trim())
    : DEFAULT_TRACKER_URLS;
const WEBRTC_DEBUG_STORAGE_KEY = "poker-webrtc-debug";
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
    private processedMessageIds: Set<string> = new Set();
    private connectedPeerIds: Set<string> = new Set();
    private pendingJoinRequestId: string | null = null;
    private readonly debugEnabled = isWebrtcDebugEnabled();
    private debugStartedAt = 0;

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

        this.pendingJoinRequestId = randomId(16);
        this.messages?.push([
            JSON.stringify({
                id: randomId(16),
                from: this.localPeerId,
                to: null,
                message: {
                    type: "join",
                    requestId: this.pendingJoinRequestId,
                    playerName,
                    peerId: this.localPeerId,
                },
            } satisfies MessageEnvelope),
        ]);

        return this.localPeerId;
    }

    private async initializeProvider(): Promise<void> {
        this.disconnect();
        this.debugStartedAt = performance.now();
        this.logDebug("provider-start", { trackers: TRACKER_URLS });

        this.doc = new Y.Doc();
        this.messages = this.doc.getArray<string>("messages");
        this.stateMap = this.doc.getMap<string>("state");
        this.processedMessageIds.clear();
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
                const snapshot = JSON.parse(rawState) as GameSnapshot;
                this.onMessage({ type: "state", snapshot }, "host");
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
                debug: this.debugEnabled,
            },
        );

        this.provider.on("direct-message", (peerId: unknown, payload: unknown) => {
            if (typeof peerId !== "string" || !(payload instanceof Uint8Array)) return;
            try {
                const message = JSON.parse(new TextDecoder().decode(payload)) as PeerMessage;
                this.onMessage(message, peerId);
            } catch (error) {
                console.error("Failed to parse private peer message:", error);
            }
        });

        this.provider.awareness.setLocalState({ peerId: this.localPeerId });
        this.provider.awareness.on("change", () => {
            this.handlePeerList(this.getAwarenessPeerIds());
        });

        this.provider.on("status", (status: unknown) => {
            this.logDebug("tracker-status", status);
        });

        this.provider.on("debug", (event: unknown) => {
            this.logDebug("provider", event);
        });

        this.provider.on("connection-error", (error: unknown) => {
            this.logDebug("connection-error", formatError(error));
            console.error("Webtorrent connection error:", error);
        });

        this.provider.on("peer-error", (error: unknown) => {
            this.logDebug("peer-error", formatError(error));
            console.error("Webtorrent peer error:", error);
        });

        await this.provider.ready;
    }

    private logDebug(event: string, details: unknown): void {
        if (!this.debugEnabled) return;
        const elapsedMs = Math.round(performance.now() - this.debugStartedAt);
        console.debug(`[WebRTC +${elapsedMs}ms] ${event}`, details);
    }

    private handleMessageUpdates(): void {
        if (!this.messages) {
            return;
        }

        for (const rawEnvelope of this.messages.toArray()) {
            try {
                const envelope = JSON.parse(rawEnvelope) as MessageEnvelope;
                if (this.processedMessageIds.has(envelope.id)) {
                    continue;
                }
                this.processedMessageIds.add(envelope.id);

                if (envelope.from === this.localPeerId) {
                    continue;
                }

                if (envelope.to && envelope.to !== this.localPeerId) {
                    continue;
                }

                if (envelope.to === null && !this.isHost) {
                    continue;
                }

                if (envelope.message.type === "joinResponse") {
                    if (envelope.message.requestId !== this.pendingJoinRequestId) {
                        continue;
                    }
                    this.pendingJoinRequestId = null;
                }

                this.onMessage(envelope.message, envelope.from);
            } catch (error) {
                console.error("Failed to parse room message:", error);
            }
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

    sendPrivateToPeer(peerId: string, message: PeerMessage): boolean {
        const payload = new TextEncoder().encode(JSON.stringify(message));
        return this.provider?.sendToPeer(peerId, payload) || false;
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

    broadcastState(snapshot: GameSnapshot): void {
        this.stateMap?.set("game", JSON.stringify(snapshot));
        for (const peerId of this.getAwarenessPeerIds()) {
            this.sendPrivateToPeer(peerId, { type: "state", snapshot });
        }
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
        this.processedMessageIds.clear();
        this.connectedPeerIds.clear();
        this.pendingJoinRequestId = null;
    }
}

function isWebrtcDebugEnabled(): boolean {
    if (typeof window === "undefined") return false;

    try {
        const params = new URLSearchParams(window.location.search);
        if (params.get("debugWebrtc") === "1") {
            localStorage.setItem(WEBRTC_DEBUG_STORAGE_KEY, "1");
            return true;
        }
        if (params.get("debugWebrtc") === "0") {
            localStorage.removeItem(WEBRTC_DEBUG_STORAGE_KEY);
            return false;
        }
        return localStorage.getItem(WEBRTC_DEBUG_STORAGE_KEY) === "1";
    } catch {
        return false;
    }
}

function formatError(error: unknown): unknown {
    if (!(error instanceof Error)) return error;
    return { name: error.name, message: error.message, stack: error.stack };
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

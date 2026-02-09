import Peer, { type DataConnection } from "peerjs";
import type { GameState, PeerMessage, Player } from "./types";

type MessageHandler = (message: PeerMessage, fromPeerId: string) => void;
type ConnectionChangeHandler = (peerId: string, connected: boolean) => void;

export class PeerManager {
    private peer: Peer | null = null;
    private connections: Map<string, DataConnection> = new Map();
    private onMessage: MessageHandler;
    private onConnectionChange: ConnectionChangeHandler;
    private localPeerId: string = "";
    private isHost: boolean = false;

    constructor(onMessage: MessageHandler, onConnectionChange: ConnectionChangeHandler) {
        this.onMessage = onMessage;
        this.onConnectionChange = onConnectionChange;
    }

    async createHost(): Promise<string> {
        this.isHost = true;
        this.peer = new Peer();

        return new Promise((resolve, reject) => {
            if (!this.peer) {
                reject(new Error("Peer not initialized"));
                return;
            }

            this.peer.on("open", (id) => {
                this.localPeerId = id;
                console.log("Host peer ID:", id);
                resolve(id);
            });

            this.peer.on("connection", (conn) => {
                this.handleIncomingConnection(conn);
            });

            this.peer.on("error", (err) => {
                console.error("Peer error:", err);
                reject(err);
            });
        });
    }

    async joinGame(hostPeerId: string, playerName: string): Promise<string> {
        this.isHost = false;
        this.peer = new Peer();

        return new Promise((resolve, reject) => {
            if (!this.peer) {
                reject(new Error("Peer not initialized"));
                return;
            }

            this.peer.on("open", (id) => {
                this.localPeerId = id;
                console.log("Joined with peer ID:", id);

                const conn = this.peer!.connect(hostPeerId, {
                    reliable: true,
                });

                conn.on("open", () => {
                    this.connections.set(hostPeerId, conn);
                    this.setupConnectionHandlers(conn, hostPeerId);

                    // Send join request
                    this.sendToPeer(hostPeerId, {
                        type: "join",
                        playerName,
                        peerId: id,
                    });

                    resolve(id);
                });

                conn.on("error", (err) => {
                    console.error("Connection error:", err);
                    reject(err);
                });
            });

            this.peer.on("error", (err) => {
                console.error("Peer error:", err);
                reject(err);
            });
        });
    }

    private handleIncomingConnection(conn: DataConnection): void {
        conn.on("open", () => {
            console.log("Incoming connection from:", conn.peer);
            this.setupConnectionHandlers(conn, conn.peer);
        });
    }

    private setupConnectionHandlers(conn: DataConnection, peerId: string): void {
        conn.on("data", (data: unknown) => {
            try {
                const message = data as PeerMessage;
                this.onMessage(message, peerId);
            } catch (error) {
                console.error("Error handling message:", error);
            }
        });

        conn.on("close", () => {
            console.log("Connection closed:", peerId);
            this.connections.delete(peerId);
            this.onConnectionChange(peerId, false);
        });

        conn.on("error", (err) => {
            console.error("Connection error:", peerId, err);
        });
    }

    sendToPeer(peerId: string, message: PeerMessage): void {
        const conn = this.connections.get(peerId);
        if (conn && conn.open) {
            conn.send(message);
        } else {
            console.warn("Connection not open for peer:", peerId);
        }
    }

    broadcast(message: PeerMessage, excludePeerId?: string): void {
        for (const [peerId, conn] of this.connections) {
            if (peerId !== excludePeerId && conn.open) {
                conn.send(message);
            }
        }
    }

    broadcastState(state: GameState, excludePeerId?: string): void {
        this.broadcast(
            {
                type: "state",
                state,
            },
            excludePeerId,
        );
    }

    getLocalPeerId(): string {
        return this.localPeerId;
    }

    isHostConnection(): boolean {
        return this.isHost;
    }

    disconnect(): void {
        for (const conn of this.connections.values()) {
            conn.close();
        }
        this.connections.clear();
        this.peer?.destroy();
        this.peer = null;
    }
}

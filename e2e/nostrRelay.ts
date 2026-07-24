import { WebSocket, WebSocketServer, type RawData } from "ws";

interface Subscription {
    id: string;
    topics: Set<string>;
}

interface NostrEvent {
    tags: string[][];
}

const port = 8000;
const server = new WebSocketServer({ host: "127.0.0.1", port });
const subscriptions = new Map<WebSocket, Map<string, Subscription>>();

server.on("connection", (socket) => {
    subscriptions.set(socket, new Map());

    socket.on("message", (data) => {
        let message: unknown;
        try {
            message = JSON.parse(rawDataToString(data));
        } catch {
            return;
        }
        if (!Array.isArray(message) || typeof message[0] !== "string") return;

        if (message[0] === "REQ" && typeof message[1] === "string") {
            const filter = message[2] as Record<string, unknown> | undefined;
            const topics = Array.isArray(filter?.["#x"])
                ? new Set(
                      filter["#x"].filter((topic): topic is string => typeof topic === "string"),
                  )
                : new Set<string>();
            subscriptions.get(socket)?.set(message[1], { id: message[1], topics });
            socket.send(JSON.stringify(["EOSE", message[1]]));
            return;
        }

        if (message[0] === "CLOSE" && typeof message[1] === "string") {
            subscriptions.get(socket)?.delete(message[1]);
            return;
        }

        if (message[0] !== "EVENT" || !isEvent(message[1])) return;
        const event = message[1];
        const eventTopics = new Set(
            event.tags.filter((tag) => tag[0] === "x" && tag[1]).map((tag) => tag[1]!),
        );

        for (const [client, clientSubscriptions] of subscriptions) {
            if (client.readyState !== WebSocket.OPEN) continue;
            for (const subscription of clientSubscriptions.values()) {
                if ([...eventTopics].some((topic) => subscription.topics.has(topic))) {
                    client.send(JSON.stringify(["EVENT", subscription.id, event]));
                }
            }
        }
        socket.send(JSON.stringify(["OK", event.id, true, ""]));
    });

    socket.on("close", () => subscriptions.delete(socket));
});

function rawDataToString(data: RawData): string {
    if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
    if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
    return data.toString("utf8");
}

function isEvent(value: unknown): value is NostrEvent & { id: string } {
    if (!value || typeof value !== "object") return false;
    const event = value as Record<string, unknown>;
    return typeof event["id"] === "string" && Array.isArray(event["tags"]);
}

console.log(`Local Nostr relay listening on ws://127.0.0.1:${port}`);

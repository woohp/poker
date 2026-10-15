const PEER_ID_STORAGE_KEY = "poker-peer-id";
const PEER_ID_LENGTH = 20;
const ID_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

export function loadStablePeerId(): string | null {
    const cachedPeerId = sessionStorage.getItem(PEER_ID_STORAGE_KEY);
    return cachedPeerId?.length === PEER_ID_LENGTH ? cachedPeerId : null;
}

export function getStablePeerId(): string {
    return loadStablePeerId() ?? resetStablePeerId();
}

export function resetStablePeerId(): string {
    const peerId = randomId(PEER_ID_LENGTH);
    sessionStorage.setItem(PEER_ID_STORAGE_KEY, peerId);
    return peerId;
}

export function randomId(length: number): string {
    const bytes = crypto.getRandomValues(new Uint8Array(length));
    return Array.from(bytes, (byte) => ID_ALPHABET[byte % ID_ALPHABET.length]).join("");
}

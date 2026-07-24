const PEER_ID_STORAGE_KEY = "poker-peer-id";
const PEER_ID_LENGTH = 20;

export function loadStablePeerId(): string | null {
    const cachedPeerId = sessionStorage.getItem(PEER_ID_STORAGE_KEY);
    if (!cachedPeerId) {
        return null;
    }

    return decodePeerId(cachedPeerId);
}

export function getStablePeerId(): string {
    const cachedPeerId = loadStablePeerId();
    if (cachedPeerId) {
        return cachedPeerId;
    }

    return resetStablePeerId();
}

export function resetStablePeerId(): string {
    const peerId = randomPeerId();
    sessionStorage.setItem(PEER_ID_STORAGE_KEY, encodePeerId(peerId));
    return peerId;
}

function randomPeerId(): string {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
    const bytes = crypto.getRandomValues(new Uint8Array(PEER_ID_LENGTH));
    return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

function encodePeerId(peerId: string): string {
    return btoa(peerId);
}

function decodePeerId(value: string): string | null {
    try {
        const peerId = atob(value);
        return peerId.length === PEER_ID_LENGTH ? peerId : null;
    } catch {
        return null;
    }
}

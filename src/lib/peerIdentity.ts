import { createPeerId } from "y-webtorrent";

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

    const peerId = createPeerId();
    sessionStorage.setItem(PEER_ID_STORAGE_KEY, encodePeerId(peerId));
    return peerId;
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

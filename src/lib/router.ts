export type Route =
    | { name: "home" }
    | { name: "create" }
    | { name: "join"; roomCode?: string }
    | { name: "room"; roomCode: string };

export function parseRoute(hash: string, search = ""): Route {
    const legacyJoinCode = new URLSearchParams(search).get("join");
    if (legacyJoinCode) {
        return { name: "join", roomCode: legacyJoinCode };
    }

    const path = hash.startsWith("#") ? hash.slice(1) : hash;
    const segments = path
        .split("/")
        .map((segment) => segment.trim())
        .filter(Boolean)
        .map((segment) => decodeURIComponent(segment));

    if (segments.length === 0) {
        return { name: "home" };
    }

    switch (segments[0]) {
        case "create":
            return { name: "create" };
        case "join":
            return segments[1] ? { name: "join", roomCode: segments[1] } : { name: "join" };
        case "room":
            return segments[1] ? { name: "room", roomCode: segments[1] } : { name: "home" };
        default:
            return { name: "home" };
    }
}

export function routeToHash(route: Route): string {
    switch (route.name) {
        case "home":
            return "#/";
        case "create":
            return "#/create";
        case "join":
            return route.roomCode ? `#/join/${encodeURIComponent(route.roomCode)}` : "#/join";
        case "room":
            return `#/room/${encodeURIComponent(route.roomCode)}`;
    }
}

export function navigate(route: Route, replace = false): void {
    const url = `${window.location.pathname}${routeToHash(route)}`;
    if (replace) {
        window.history.replaceState(null, "", url);
    } else {
        window.history.pushState(null, "", url);
    }
    window.dispatchEvent(new HashChangeEvent("hashchange"));
}

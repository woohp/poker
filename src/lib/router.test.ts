import { describe, expect, it } from "vite-plus/test";
import { parseRoute, routeToHash } from "./router";

describe("router", () => {
    it("parses home routes", () => {
        expect(parseRoute("")).toEqual({ name: "home" });
        expect(parseRoute("#/")).toEqual({ name: "home" });
    });

    it("parses create and join routes", () => {
        expect(parseRoute("#/create")).toEqual({ name: "create" });
        expect(parseRoute("#/join")).toEqual({ name: "join" });
        expect(parseRoute("#/join/ABC123")).toEqual({ name: "join", roomCode: "ABC123" });
    });

    it("parses room routes", () => {
        expect(parseRoute("#/room/ABC123")).toEqual({ name: "room", roomCode: "ABC123" });
    });

    it("falls back to home for unknown routes", () => {
        expect(parseRoute("#/wat")).toEqual({ name: "home" });
        expect(parseRoute("#/room")).toEqual({ name: "home" });
    });

    it("builds hashes", () => {
        expect(routeToHash({ name: "home" })).toBe("#/");
        expect(routeToHash({ name: "create" })).toBe("#/create");
        expect(routeToHash({ name: "join" })).toBe("#/join");
        expect(routeToHash({ name: "join", roomCode: "ABC123" })).toBe("#/join/ABC123");
        expect(routeToHash({ name: "room", roomCode: "ABC123" })).toBe("#/room/ABC123");
    });
});

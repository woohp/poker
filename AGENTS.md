# Poker agent guide

Poker is a browser-only Svelte 5 app for running a casual poker table among friends. One player's browser hosts the authoritative game; other players connect peer-to-peer over Yjs/WebRTC (Nostr and WebTorrent signaling via `y-multiprovider`). There is no server. Tables use physical cards (the app tracks chips, blinds, and pots) or digital cards (the host also deals).

## Scope and trust model

Anyone with the room code is a trusted participant. Host authority provides consistent coordination, not cryptographic security or cheat resistance. Do not add signatures, public-key identities, or adversarial transport hardening unless public rooms, matchmaking, stakes, or untrusted participants become product goals. Keep basic sender consistency checks and input validation where they prevent accidental corruption; a sender ID inside the shared Yjs document is a consistency field, not verified identity.

Favor simple solutions for that scope. Do not add machinery for rare local races (timers versus disconnects, refresh during a transient network blip) unless a concrete recurring failure justifies it.

The root `README.md` is still the Vite starter. Replacing it is deliberately deferred until setup, gameplay assumptions, recovery behavior, and limitations stabilize.

## Architecture boundaries

The host is authoritative. Clients send versioned commands and render replicated snapshots; they never apply poker actions locally.

```text
client command -> PeerManager -> GameEngine -> PokerGame decision/events
               -> append history -> persist -> publish snapshot + command result
```

- `gameEngine.ts` is generic: command revision, deduplication, and event history. Revision is always `history.length`. It restores a fresh game by replaying history, asks the game to decide without mutation, applies accepted batches atomically, and only then appends them. It knows nothing about poker, networking, persistence, or Svelte. Do not add arbitrary state replacement or a `commit()` escape hatch; state changes originate as game commands.
- `pokerGame.ts` owns poker state transitions and validation of untrusted command payloads. `gameLogic.ts` holds side-effect-free rule primitives that mutate a state passed to them.
- `dealer.ts` is the host-private digital dealer (deck, hole cards, showdown evaluation). Dealer state never enters the replicated `GameState`; hole cards travel only by direct peer message.
- `peerManager.ts` is transport only. It must not apply rules or touch revisions. `pokerProtocol.ts` translates wire messages to engine commands and results.
- `App.svelte` composes UI, engine, transport, persistence, and dealer timing. Shared state changes must go through game commands.

To add another game, implement a new `Game` and protocol adapter rather than adding game-specific behavior to `GameEngine`.

## Persistence and recovery invariants

- The host persists the versioned config plus **command history**, never the derived `GameState`. `GameState` and snapshot shapes can change freely (clients just receive new snapshots), but `PokerEvent` currently records whole commands with their context, so the persisted history format is version-sensitive: changing command shapes or decision rules can make old histories replay differently or fail. Bump `SAVED_GAME_VERSION` deliberately.
- Digital dealer state is saved in the same aggregate as history so a reload cannot advance one without the other.
- Persist an accepted revision before publishing it, including to the host's own UI. If persistence fails, freeze host command processing instead of exposing an unsaved revision.
- Clients do not persist game state. After refresh they rejoin with their session-scoped peer ID and receive a current snapshot.
- The host publishes snapshots both through the shared Yjs map and as direct peer messages; clients accept only newer revisions. Keep both paths: either can lag or drop during WebRTC churn.

## Testing

- Unit tests run under Node with Vite+ test (`vite-plus/test`); browser storage is stubbed with `installMemoryStorage` from `src/lib/testStorage.ts`.
- Playwright tests start a local Nostr relay (`e2e/nostrRelay.ts`) and a dev server with a short phase-advance delay. They read game state through the DEV-only `window.__pokerGameState` hook. Shared room setup lives in `e2e/helpers.ts`.
- Run `npm run test:stress` (deterministic, seeded, 100 hands) after synchronization, engine, or turn-order changes. One cross-browser test needs Playwright's Firefox (`npx playwright install firefox`).
- After signaling or NAT changes, run `npm run test:cross-network -- <ssh-host>` with the remote Firefox on a genuinely different network (for example, cellular). Read `e2e/cross-network/README.md` first; it covers remote setup and testing uncommitted code with matching local dev servers.
- Prefer outcome-focused tests through public rule functions; do not export internals just to test them.

## Commands and workflow

`npm run check` (format check, lint, and types), `npm run lint`, `npm run format`, `npm test`, `npm run test:e2e`, `npm run test:stress`, `npm run test:cross-network`, `npm run build`. Run format, check, unit tests, and relevant e2e tests before committing.

`npm run build` writes the GitHub Pages site into the tracked `docs/` directory.

## Code conventions

Formatting and lint rules are enforced by `npm run check`. Beyond those:

- Use Svelte 5 runes; derive values with `$derived` rather than mirroring state or syncing it in `$effect`.
- Prefer `interface` for object shapes; avoid `any` (use `unknown` and narrow).
- Validate at untyped boundaries (parsed storage, peer messages, form input) and for semantic constraints the type system cannot express. Do not re-check internal typed values at runtime.

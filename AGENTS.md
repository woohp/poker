# AGENTS.md - Coding Guidelines for Poker

## Build/Lint/Test Commands

```bash
# Development server
npm run dev

# Production build
npm run build

# Preview production build
npm run preview

# Type checking / verification (MUST run after changes)
npm run check

# Linting (Vite+ / oxlint)
npm run lint

# Formatting (Vite+ / oxfmt)
npm run format

# Unit tests
npm test

# Playwright multiplayer tests
npm run test:e2e

# Deterministic 100-hand multiplayer stress test
npm run test:stress
```

**Note:** Unit tests are run with Vite+ test (`vite-plus/test`).

## Tech Stack

- **Framework:** Svelte 5 with runes ($state, $derived, etc.)
- **Build Tool:** Vite+ (Vite-based)
- **Language:** TypeScript (strict)
- **Package Manager:** npm
- **Linting/Formatting:** Vite+ with oxlint / oxfmt

## High-Level Architecture

The host is authoritative. Clients send versioned commands to the host and render replicated snapshots; they do not apply poker actions locally.

### Trust Model

This is currently a casual, trusted-room app. Anyone with the room code is treated as a trusted participant; host authority provides consistent game coordination, not cryptographic security or cheat resistance. Do not add signatures, public-key identities, or adversarial transport hardening unless public rooms, matchmaking, stakes, or untrusted participants become product goals. Still preserve basic sender consistency checks and normal input validation where they prevent accidental corruption. A sender ID declared inside the shared Yjs document is only a consistency field, not verified identity; meaningful sender authentication would require a different transport or credentials.

Canonical construction and restoration:

```typescript
const game = new PokerGame(config);
const engine = new GameEngine(game, { history });
```

- `gameEngine.ts` is generic infrastructure. It owns command revision, deduplication, and authoritative event history. History retains accepted command boundaries and command IDs; revision is always `history.length`. The engine restores a fresh game by applying history, asks the game to decide commands without mutation, atomically applies accepted event batches, and only then appends them. It knows nothing about poker, networking, persistence, or Svelte. Do not add arbitrary state replacement or a `commit()` escape hatch; state changes must originate as game commands and events.
- `pokerGame.ts` is the stateful poker implementation. `PokerGame(config)` begins from initial state and does not retain history. `decide()` delegates to pure `decidePokerCommand()` logic, `apply(events)` evolves a temporary state and commits only after the complete batch succeeds, and `snapshot()` returns a detached UI/network view. `PokerEvent` currently records accepted commands and their context rather than granular domain facts; treat the persisted format as version-sensitive until versioned domain events and migrations are introduced.
- The host's event history is the durable source of truth for public game state. `persistence.ts` stores a versioned host configuration/history aggregate together with private digital dealer state (deck and hole cards) so a reload cannot advance one without the other. Persist an accepted revision successfully before publishing it; if persistence fails, freeze host command processing rather than exposing an unsaved revision. Clients do not persist game state; after refresh they reconnect and receive a current snapshot.
- `pokerProtocol.ts` translates poker network messages to/from generic engine commands and results.
- `peerManager.ts` is transport only: Yjs/WebRTC discovery, commands, acknowledgements, awareness, and replicated snapshots. Transport must not apply rules or mutate revisions.
- `gameLogic.ts` contains poker rule primitives and has no networking or persistence side effects.
- `App.svelte` composes UI, `GameEngine`, `PokerGame`, transport, and persistence. Shared state changes must go through game commands; do not mutate replicated state directly.

Typical host flow:

```text
client command -> PeerManager -> GameEngine -> PokerGame decision/events
               -> append history -> publish snapshot + command result
```

Keep these boundaries when adding games: implement another `Game` class and protocol adapter rather than adding game-specific behavior to `GameEngine`.

## Code Style Guidelines

### Formatting

- **Formatter:** oxfmt via Vite+
- **Indent:** 4 spaces (no tabs)
- **Line ending:** LF
- **Quote style:** Double quotes for strings

### TypeScript

- Enable strict mode checks
- Use explicit types for function parameters and return values
- Prefer `interface` over `type` for object shapes
- Use PascalCase for types/interfaces, camelCase for variables/functions
- Avoid `any` - use `unknown` with type guards instead
- Do not duplicate guarantees already enforced by TypeScript with runtime checks for internal typed values. Use runtime validation at actual untyped boundaries such as parsed storage or network input, and for semantic constraints the type system cannot express.

### Svelte Components

- Use `<script lang="ts">` for TypeScript support
- Use Svelte 5 runes: `$state()`, `$derived()`, `$effect()`, `$props()`
- Keep components focused and small
- Use scoped `<style>` for component-specific styles
- Props interface: `interface Props { ... }`

### Imports

- Group imports: external libs first, then internal modules
- Use named imports when possible
- Import order: Svelte, external deps, internal modules, types
- Example:

```typescript
import { mount } from "svelte";
import { writable } from "svelte/store";
import Counter from "./lib/Counter.svelte";
import type { GameState } from "./types";
```

### Naming Conventions

- **Components:** PascalCase (e.g., `Counter.svelte`)
- **Files:** camelCase for utilities, PascalCase for components
- **Variables/Functions:** camelCase
- **Constants:** UPPER_SNAKE_CASE for true constants
- **Types/Interfaces:** PascalCase with descriptive names
- **Event handlers:** `handle<Event>` (e.g., `handleClick`)

### Error Handling

- Use try-catch for async operations
- Prefer early returns over nested conditionals
- Validate props with TypeScript interfaces
- Use non-null assertion (`!`) sparingly and only when certain

### State Management

- Use Svelte 5 runes for local component state
- External stores in `src/lib/stores/` for shared state
- Example:

```typescript
let count = $state(0);
let doubled = $derived(count * 2);
```

### CSS/Styling

- Component-scoped styles in `<style>` blocks
- Global styles in `src/app.css`
- Use CSS custom properties (variables) for theming
- Mobile-first responsive design

### Project Structure

```
.
├── .github/workflows/   # CI
├── docs/                # Production build output for GitHub Pages
├── src/
│   ├── main.ts
│   ├── App.svelte
│   ├── app.css
│   └── lib/
│       ├── gameEngine.ts      # Generic event-history/command engine
│       ├── pokerGame.ts       # Stateful poker game and pure decisions
│       ├── gameLogic.ts       # Poker rule primitives
│       ├── pokerProtocol.ts   # Network/engine message adapter
│       ├── peerManager.ts     # Yjs/WebRTC transport
│       ├── persistence.ts     # Host history and session persistence
│       ├── syncLogic.ts       # Replica snapshot freshness
│       ├── poker.ts           # Cards and hand evaluation
│       ├── types.ts           # Poker and wire types
│       └── *.test.ts
├── package.json
├── tsconfig.app.json
├── tsconfig.json
├── tsconfig.node.json
└── vite.config.ts
```

## Pre-commit Checklist

1. Run `npm run format` - code is formatted
2. Run `npm run check` - no TypeScript errors
3. Run `npm run lint` - no linting errors
4. Run `npm test` - unit tests pass
5. Run relevant E2E tests; use `npm run test:stress` for synchronization/state-engine changes
6. Verify `npm run build` succeeds

## Documentation

The root `README.md` is still a starter document. Replacing it with detailed project architecture is intentionally low priority while the architecture is changing; do that near the end once setup, gameplay assumptions, recovery behavior, and limitations are stable. Continue updating focused documentation when public behavior or operational steps change.

## Dependencies

- `y-nostr` and `y-webtorrent` - Redundant signaling transports coordinated by `MultiProvider`
- `yjs` - Shared CRDT state
- `qrcode` - QR code generation

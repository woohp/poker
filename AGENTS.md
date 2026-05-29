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
```

**Note:** Tests are run with Vite+ test (`vite-plus/test`).

## Tech Stack

- **Framework:** Svelte 5 with runes ($state, $derived, etc.)
- **Build Tool:** Vite+ (Vite-based)
- **Language:** TypeScript (strict)
- **Package Manager:** npm
- **Linting/Formatting:** Vite+ with oxlint / oxfmt

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
│       ├── gameLogic.ts
│       ├── gameLogic.test.ts
│       ├── peerManager.ts
│       ├── peerManager.test.ts
│       ├── poker.ts
│       └── types.ts
├── package.json
├── tsconfig.app.json
├── tsconfig.json
├── tsconfig.node.json
└── vite.config.ts
```

## Pre-commit Checklist

1. Run `npm run check` - no TypeScript errors
2. Run `npm run lint` - no linting errors
3. Run `npm run format` - code is formatted
4. Verify `npm run build` succeeds

## Dependencies

- `y-webtorrent` - WebRTC peer discovery/signaling + Yjs sync
- `yjs` - Shared CRDT state
- `qrcode` - QR code generation

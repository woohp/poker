# AGENTS.md - Coding Guidelines for Poker

## Build/Lint/Test Commands

```bash
# Development server
bun run dev

# Production build
bun run build

# Preview production build
bun run preview

# Type checking (MUST run after changes)
bun run check

# Linting
bun run lint
bun run lint -- --write    # Fix issues

# Formatting
bun run format
bun run format -- --write  # Apply formatting
```

**Note:** No test framework is currently configured. If adding tests, use Vitest for unit tests.

## Tech Stack

- **Framework:** Svelte 5 with runes ($state, $derived, etc.)
- **Build Tool:** Vite
- **Language:** TypeScript (strict)
- **Package Manager:** Bun
- **Linting/Formatting:** Biome

## Code Style Guidelines

### Formatting (Biome Configuration)
- **Indent:** 4 spaces (no tabs)
- **Line width:** 120 characters
- **Line ending:** LF
- **Semicolons:** Always required
- **Trailing commas:** Always (except JSON)
- **Arrow parentheses:** Always
- **Bracket spacing:** Yes (`{ foo: bar }`)
- **Quote style:** Double quotes for strings
- **Property quotes:** As needed

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
src/
├── main.ts           # Entry point
├── App.svelte        # Root component
├── app.css           # Global styles
├── lib/              # Reusable components and utilities
│   └── Counter.svelte
└── assets/           # Static assets (images, etc.)
```

## Pre-commit Checklist

1. Run `bun run check` - no TypeScript errors
2. Run `bun run lint` - no linting errors
3. Run `bun run format -- --write` - code is formatted
4. Verify `bun run build` succeeds

## Dependencies

- `peerjs` - WebRTC peer connections
- `qrcode` - QR code generation

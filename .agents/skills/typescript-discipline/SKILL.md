---
name: typescript-discipline
description: >-
  TypeScript type-system and boundary-validation standards for
  dsh-markdown-studio. Activate when designing domain types, parser/storage
  schemas, host HTTP handlers, or refactoring `as` assertions in `src/`,
  `host/`, or `index.ts`.
license: MIT
---

<!-- Adapted from typescript-best-practices and principle-type-system-discipline in cursor/plugins/pstack (MIT, © Lauren Tan). See THIRD_PARTY_NOTICES.md. -->

# TypeScript Discipline (`dsh-markdown-studio`)

Make the compiler reject impossible states, mismatched primitives, and unhandled variants. Validate untyped data once at system boundaries, then trust domain types inside.

## 1. Core Rules

| Rule | Standard in `dsh-markdown-studio` |
| :--- | :--- |
| **Discriminated unions** | Model multi-phase UI/async state with a literal discriminant (`kind` or `type`) instead of optional-field/boolean bags. |
| **Exhaustiveness** | End every discriminated `switch` default arm with `const _exhaustive: never = value; return _exhaustive;` (or `void _exhaustive;` for statement switches) so adding a variant fails compilation. |
| **Constructive modeling** | Encode structural invariants in the type itself (`type NonEmpty<T> = [T, ...T[]]`, `{ start: number; length: number }`) instead of repeating runtime guards or comments. |
| **Simplest total type** | Do not over-strengthen types. Keep `T[]` while every operation on it is total (`reduce`, `map`). Strengthen to `NonEmpty<T>` (or return `T \| undefined`) only when a loose type forces `!`, `arr[0] as T`, or a `"should never happen"` throw. |
| **Branded primitives** | When distinct semantic IDs share `string` and can be swapped across parameters, brand them (`string & { readonly __brand: 'DocId' }`) and issue the brand **only** from a verifying type guard (`isDocId`), never from a raw `as` cast. |
| **`unknown` at boundaries** | `JSON.parse`, `localStorage`, `IndexedDB`, HTTP request bodies, `postMessage`, ZIP headers, and DSH host globals enter as `unknown`. Parse once at the adapter/schema boundary (`src/domain/schema.ts`, `src/adapters/storage.ts`, `host/http/`), never re-validate deep in domain logic. `Record<string, unknown>` must stop at the boundary parser. |
| **No lying type guards** | A user-defined guard (`x is T`) must verify every required field it claims. A partial check (`'id' in x`) that lies about the remaining fields is worse than `as`. |
| **`satisfies` over `as`** | Use `satisfies` to validate object literals against a contract while keeping literal key/value types intact. |
| **Derive, do not duplicate** | Prefer `Pick`, `Omit`, `Parameters`, `ReturnType`, `Awaited`, and `typeof` over hand-copying interfaces that drift from their source module. |
| **Object arguments** | Use named option objects for functions taking 3+ arguments or adjacent same-type arguments. Skip wrapper object allocations on tight hot paths (Markdown/CSS tokenizers, diff loops, per-frame render). |

## 2. Narrowing Hierarchy (Best → Last Resort)

1. **Discriminated union `switch` / `if`** (automatic compiler narrowing).
2. **`in` operator** (`'field' in value`).
3. **`typeof` / cross-realm DOM shape guards**: Use `typeof` for primitives; for DOM nodes in `src/`, **never use `instanceof Element` or `instanceof HTMLElement`** (banned by `test/architecture.test.ts` because host iframes/portals are cross-realm) — check `nodeType === 1` / `tagName` / helper guards in `src/runtime/dom-surfaces.ts` instead.
4. **Verifying `isX` / `hasX` type guard** (actually validates every claimed property).
5. **`as` cast** — only after validation or at an unavoidable untyped host/DOM interop boundary, never as a shortcut to silence TypeScript.

## 3. Automated Ratchet (`test/architecture.test.ts`)

`test/architecture.test.ts` enforces hard ceilings on production files (`src/`, `host/`, `index.ts`):
- **Zero** `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`, or `biome-ignore` suppressions.
- **Zero** double casts (`as ... as ...`) in `src/domain/`.
- **High-water-mark ratchets** on total non-`as const` assertions (`src/` + `host/` + `index.ts`), `src/domain/` non-`as const` assertions, and double casts (`as ... as ...`).

When removing legacy `as` assertions in a PR, lower the corresponding ceiling in `test/architecture.test.ts` in the same change so the count never drifts back up.

## 4. Refactoring an `as` Cast

Identify why TypeScript failed to infer before picking a fix:
- **Missing discriminant** → add a literal `kind` tag and narrow with `switch`.
- **Overly wide source (`Record<string, unknown>`, `string`)** → narrow at the boundary parser or tighten the return type.
- **Object literal widened to `string`/`number`** → replace `as Config` with `satisfies Config` or `as const satisfies Config`.
- **Host / DOM API gap** → isolate the single typed adapter inside `src/adapters/`, `src/runtime/`, or `src/types/dsh.ts` so domain/application code stays cast-free.

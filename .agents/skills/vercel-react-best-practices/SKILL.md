---
name: vercel-react-best-practices
description: >-
  Vercel Engineering's React optimization and AI-friendly architecture guide
  (adapted from vercel-labs/agent-skills for React 18/19 and DeepSeek Harness
  plugins). Activate this skill whenever authoring, refactoring, or reviewing
  React components, hooks, state management, bundle splits, or async flows in
  src/.
license: MIT
---

<!-- Adapted from https://github.com/vercel-labs/agent-skills/tree/main/skills/react-best-practices (MIT, © Vercel, Inc.). See THIRD_PARTY_NOTICES.md. -->

# Vercel React Best Practices (`dsh-markdown-studio` Edition)

Prioritized performance, render-purity, and AI-maintainability rules adapted from Vercel Engineering's `vercel-react-best-practices` skill for `dsh-markdown-studio`. Apply higher-priority categories first when writing or reviewing code.

For concrete Bad vs. Good TypeScript patterns across all 8 categories, read [references/rules-catalog.md](./references/rules-catalog.md).

---

## Priority Matrix

| Priority | Category | Prefix | Core Rule in `dsh-markdown-studio` |
| :--- | :--- | :--- | :--- |
| **1 · CRITICAL** | Eliminating Waterfalls | `async-` | Parallelize independent work with `Promise.all()`; check cheap sync guards before `await`. |
| **2 · CRITICAL** | Bundle Size Optimization | `bundle-` | Keep cold-boot `dist/client.js < 50 KiB`; ban barrel `index.ts` files in `src/`; lazy-load Studio, MathJax, and Mermaid. |
| **3 · HIGH** | Effect-Free Business Layer | `lifecycle-` | Zero `useEffect` / `useLayoutEffect` outside `src/runtime/`; prefer render derivation, `key` remounts, or `DocumentStore` subscriptions. |
| **4 · HIGH** | Render Purity & Ref Discipline | `purity-` | Never mutate `ref.current` during render; use `useLatest` (`src/runtime/react-lifecycle.ts`) or lazy `useState(() => new Service())`. |
| **5 · MEDIUM** | Re-render Optimization | `rerender-` | Defer expensive scans (`markdownHeadings`, `collectReferencedAssets`, `searchLibrary`) until their UI surface is open; use lazy `useState(() => init())`. |
| **6 · MEDIUM** | Component Contracts | `contract-` | Keep `*Props` interfaces `<= 15` fields via domain grouping (`state`, `actions`, `ui: UiKit`); never define components inside components. |
| **7 · MEDIUM** | Rendering Performance | `rendering-` | Use explicit ternaries (`count > 0 ? ... : null`) instead of `&&`; use stable entity IDs as `key`. |
| **8 · LOW-MED** | JS Hot Paths & Advanced Refs | `js-` / `advanced-` | Use `Set`/`Map` for repeated membership checks; isolate callback-latest refs via `useLatest`. |

---

## Mandatory Pre-Submit Checklist

1. **Zero Business Effects**: Run `rg "useEffect|useLayoutEffect" src/` — matches are allowed **only** inside `src/runtime/`.
2. **Zero Render-Phase Ref Writes**: Never write `someRef.current = ...` at the top level of a component or `use*` hook outside `src/runtime/`. Use `useLatest(React, value)` for live callback values and `useState(() => new Service())` for singletons.
3. **Zero Barrel Files & Waterfalls**: Import directly from concrete module files; wrap independent async tasks (e.g. `mermaidAssets.ensure` + `mathAssets.ensure`, multi-asset fetches) in `Promise.all()`.
4. **Bounded Component Props**: Pass `ui: UiKit` uniformly and group domain callbacks (`actions`, `toolbar`, `search`) so every `*Props` interface in `src/ui/` stays `<= 15` fields.
5. **Automated Gate Verification**: Run `tsx test/architecture.test.ts` and `npm run quality` to verify architectural invariants, `CRAP <= 30`, and bundle budgets.

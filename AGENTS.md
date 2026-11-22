# Agent Engineering Guidelines (`dsh-markdown-studio`)

Always-on architecture and React quality rules for AI coding agents working in this repository. Activate workspace skills as relevant:
- [vercel-react-best-practices](./.agents/skills/vercel-react-best-practices/SKILL.md) for React components, hooks, state management, bundle splits, or async flows in `src/`.
- [verify-state-machines](./.agents/skills/verify-state-machines/SKILL.md) before modifying concurrent UI overlays, Escape/focus routing, local file sessions, multi-tab sync, or asset GC.
- [bug-to-rule](./.agents/skills/bug-to-rule/SKILL.md) after fixing any non-trivial bug to encode the root cause into a permanent automated gate.

## 1. DeepSeek Harness (Cordis) Plugin Contract

- **Official Seams Only**: Integrate exclusively through documented DSH APIs (`sidebar.panellist`, `main`, `locale`, `@deepseek-ai/dsh-client-ui-primitives`, `window.__ModuleLoader__.load` + `require.async`, and Cordis `webServer`). Verify with `npm run check:host-api`.
- **Five-Bundle Lazy Budget (Raw + Gzip)**: Keep cold-boot `dist/client.js` strictly minimal (`<= 12 KiB` raw / `<= 5 KiB` gzip hard gate, `~5 KiB` raw target). CodeMirror 6 (`dist/client.studio.js`), MathJax 3 (`dist/math.js`), and Mermaid 11 (`dist/mermaid.js`) must remain lazy-loaded and stay under both raw and gzip ceilings in `scripts/bundle-budget.ts`.
- **Reversible Lifecycle**: Register disposable resources via `ctx.effect(...)` and tag every `<style>` / `<script>` element with `data-plugin="dsh-markdown-studio"` (enforced by `test/architecture.test.ts`) so hot disabling/re-enabling leaves zero leaked DOM or listeners.

## 2. Clean Unidirectional Architecture

- Dependency direction: `ui → application → domain`, with `adapters` implementing host/browser seams and `src/runtime/` encapsulating low-level React lifecycle & imperative DOM bindings.
- `src/domain/`, `src/theme-system/`, and `src/engine.ts` (`markdown-parser.ts` + `css-inliner.ts`) must have **zero** React, DOM global, storage, or network dependencies.
- `DocumentStore` (`src/application/document-store.ts`) is the single source of truth for library documents, recycle bin, and custom CSS themes.
- `host/` and `src/` must never cross-import implementation modules.

## 3. Strict React & Vercel Best-Practices Guardrails (Enforced by `test/architecture.test.ts`)

1. **Business-Layer `useEffect` Ban**: Direct `useEffect` and `useLayoutEffect` calls are **strictly forbidden** everywhere outside `src/runtime/`. Derive state during render, reset transient form state with React `key`, subscribe via `useExternalStore`, or add reusable primitives to `src/runtime/`.
2. **Zero Render-Phase `ref.current` Mutations**: Never assign `someRef.current = ...` at the top level of a component or hook body outside `src/runtime/`. Use `useLatest(React, value)` from `src/runtime/react-lifecycle.ts` for live callback refs, `useState(() => new Service())` for singletons (`rerender-lazy-state-init`), and ref/event callbacks for DOM handles.
3. **Honest Hook Naming**: Every `src/application/use-*.ts` module must invoke real React or `src/runtime/` hooks. Stateless command builders must use `create*` file/function names (e.g. `article-exporter.ts`, `editor-formatting.ts`).
4. **No Barrel Files (`bundle-barrel-imports`)**: Do not add `index.ts` barrel files under `src/`. Import directly from concrete module paths.
5. **Bounded Component Props & Uniform Vocabulary**: Keep every exported `*Props` interface in `src/ui/` at `<= 15` direct fields by grouping cohesive state/callbacks (`state`, `actions`, `toolbar`, `assets`) and passing `ui: UiKit` uniformly instead of unpacking individual primitive components. Never declare nested component functions inside another component.
6. **Eliminate Async Waterfalls & Hidden Re-render Work**: Use `Promise.all()` for independent async tasks (`async-parallel`), gate expensive document/library scans behind panel `open` flags (`rerender-defer-reads`), model multi-step UI flows as discriminated unions instead of boolean state soup, and use explicit ternaries (`cond ? node : null`) rather than numeric `&&`.
7. **Filepath Contract (`*.machine.ts`) & Formal Model Verification**: Pure concurrent state machines live in `src/domain/*.machine.ts`, must have zero nondeterminism/DOM/timer/React dependencies (enforced by `test/architecture.test.ts`), share policy predicates directly with production callers, and must pass exhaustive bounded BFS verification in `test/formal-models.test.ts` (`npm run verify:models`).
8. **Bug → Permanent Automated Gate**: Never leave a recurring defect protected only by convention. Encode structural regressions in `test/architecture.test.ts` (cross-realm `instanceof Element/HTMLElement` ban, monotonic `Z_LAYERS` table with zero raw numeric `z-index`, container `.clientWidth` vs `window.innerWidth` guard, `data-plugin` DOM tagging), state interleavings in `test/formal-models.test.ts`, and security/parser boundaries in `test/fuzz-and-perf.test.ts` + `scripts/mutation-smoke.ts`.

## 4. Verification Commands

Run before concluding code changes:

```bash
npm run format && npm run lint && npm run typecheck
npm test              # includes architecture AST gates, formal model checks & fuzz/perf budgets
npm run verify:models # exhaustive BFS state-machine invariant & Escape liveness verification
npm run test:fuzz     # deterministic Markdown/CSS/URL fuzzing + 10k-char hot-path perf budgets
npm run quality       # >= 90% coverage, CRAP <= 30 across all AST functions, raw+gzip bundle budgets
npm run mutation      # deterministic security & state-machine mutation gate
npm run check:host-api
```

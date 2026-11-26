# Agent Engineering Guidelines (`dsh-markdown-studio`)

Always-on architecture, type-safety, and verification rules for AI coding agents working in this repository. Activate workspace skills as relevant:
- [vercel-react-best-practices](./.agents/skills/vercel-react-best-practices/SKILL.md) for React components, hooks, state management, bundle splits, or async flows in `src/`.
- [verify-state-machines](./.agents/skills/verify-state-machines/SKILL.md) before modifying concurrent UI overlays, Escape/focus routing, local file sessions, multi-tab sync, or asset GC — and for formal-model drift audits.
- [bug-to-rule](./.agents/skills/bug-to-rule/SKILL.md) after fixing any non-trivial bug to encode the root cause into the highest-level permanent gate.
- [blast-radius](./.agents/skills/blast-radius/SKILL.md) before high-risk refactors, host/security changes, or releases to hunt non-grep breakage and prove load-bearing safety facts.
- [typescript-discipline](./.agents/skills/typescript-discipline/SKILL.md) when designing domain types, boundary parsers, or removing `as` assertions in `src/`, `host/`, or `index.ts`.
- [perf-benchmark](./.agents/skills/perf-benchmark/SKILL.md) before reporting a speedup/regression or iterating on parser, inliner, DOM morph, dark preview, or bundle boot latency.

## 1. DeepSeek Harness (Cordis) Plugin Contract

- **Official Seams Only**: Integrate exclusively through documented DSH APIs (`sidebar.panellist`, `main`, `locale`, `@deepseek-ai/dsh-client-ui-primitives`, `window.__ModuleLoader__.load` + `require.async`, and Cordis `webServer`). Verify with `npm run check:host-api`.
- **Real Host Route Contract**: Cordis `webServer.register({ kind: 'prefix', path })` matches `pathname === prefix || pathname.startsWith(prefix + '/')` — never pass a trailing slash on `prefix` routes, and verify every registered host route against the real DSH runtime in `test/dsh-e2e.ts` rather than relying solely on standalone `http.createServer` mocks.
- **Six-Bundle Lazy Budget (Raw + Gzip)**: Keep cold-boot `dist/client.js` strictly minimal (`<= 12 KiB` raw / `<= 5 KiB` gzip hard gate, `~5 KiB` raw target). CodeMirror 6 (`dist/client.studio.js`), MathJax 3 (`dist/math.js`), Mermaid 11 (`dist/mermaid.js`), and `mp-darkmode` (`dist/darkmode.js`) must remain lazy-loaded and stay under both raw and gzip ceilings in `scripts/bundle-budget.ts`.
- **Reversible Lifecycle**: Register disposable resources via `ctx.effect(...)` and tag every `<style>` / `<script>` element with `data-plugin="dsh-markdown-studio"` so hot disabling/re-enabling leaves zero leaked DOM or listeners.

## 2. Clean Unidirectional Architecture

- Dependency direction: `ui → application → domain`, with `adapters` implementing host/browser seams and `src/runtime/` encapsulating low-level React lifecycle & imperative DOM bindings.
- `src/domain/`, `src/theme-system/`, and `src/engine.ts` (`markdown-parser.ts` + `css-inliner.ts`) must have **zero** React, DOM global, storage, or network dependencies.
- `DocumentStore` (`src/application/document-store.ts`) is the single source of truth for library documents, recycle bin, and custom CSS themes.
- `host/` and `src/` must never cross-import implementation modules.

## 3. Rule ↔ Enforcer Table

Every structural invariant maps to an automated gate; drop prose once architecture or types make a mistake impossible:

| Rule | Automated Enforcer |
| :--- | :--- |
| Zero `useEffect` / `useLayoutEffect` & zero render-phase `ref.current` writes outside `src/runtime/` (use `useLatest` / lazy `useState` / `key`) | `test/architecture.test.ts` |
| Honest `use-*` hook naming, zero `src/**/index.ts` barrels, `<= 15` direct fields per `*Props` interface, no nested component definitions | `test/architecture.test.ts` |
| Cross-realm `instanceof Element/HTMLElement` ban, monotonic `Z_LAYERS`, `data-plugin` DOM tags, container `.clientWidth` guard, Cordis `prefix` trailing-slash ban, CodeMirror `Escape` hijack ban, danger confirm `Cancel` focus guard, Unicode `toLowerCase().indexOf` slice ban | `test/architecture.test.ts` |
| TypeScript `as` cast high-water-mark ratchet, zero `src/domain/` double casts, zero `@ts-ignore`/`@ts-expect-error`/`biome-ignore` in production code | `test/architecture.test.ts` |
| Pure `src/domain/*.machine.ts` determinism, skill frontmatter/link hygiene & `verify-state-machines` machine coverage | `test/architecture.test.ts` |
| Bounded BFS state-machine safety invariants, `Escape` `<= 8` liveness, multi-tab merge & 128-state AssetGC matrix | `test/formal-models.test.ts` (`npm run verify:models`) |
| Markdown/CSS/URL security fuzzing, ReDoS bounds, semantic CJK diff quality & 10k-char performance ceilings | `test/fuzz-and-perf.test.ts` (`npm run test:fuzz`) |
| Cold-boot + lazy 6-chunk raw/gzip ceilings, `>= 90%` coverage, `CRAP <= 30`, mutation killing | `npm run quality` & `npm run mutation` |
| Official DSH host APIs, real Chromium visual/a11y/SSRF/extreme-matrix smoke & real DSH runtime E2E | `npm run check:host-api`, `npm run test:browser`, `npm run test:dsh` |

## 4. Judgment Guardrails (Not Mechanically Checkable Alone)

1. **Eliminate Async Waterfalls & Hidden Re-render Work**: Use `Promise.all()` for independent async tasks, gate expensive scans behind panel `open` flags, model multi-step UI flows as discriminated unions (`kind`) with `never` exhaustiveness, and use explicit ternaries (`cond ? node : null`) rather than numeric `&&`.
2. **Bug → Highest-Level Gate (`bug-to-rule`)**: Try encoding top-down — architecture → types / actionable lint or AST ratchet → behavioral test → prose last. After 2 failed fixes sharing one premise fail the same gate, stop and falsify the premise first (**Attack the Premise**).
3. **Test Behavior, Not Implementation**: Every test must fail when observable behavior breaks and survive pure internal refactors. Never rely on self-oracles (`detector(sanitizer(x))`) or weak "no crash / fast" checks; pair with independent runtime/semantic oracles (`0` Chromium SSRF hits, `getComputedStyle`, `addRatio < 0.1`, real DSH `200 OK`) and single canonical guard predicates shared across UI `disabled` and keyboard shortcuts.
4. **Evidence-Backed Impact & Benchmarks**: Before high-risk merges, use `blast-radius` (prove the 1–2 load-bearing safety facts with runnable code; drop unrun review claims). Before reporting a speedup, pass `perf-benchmark`'s 7-question checklist (limiter, production parity, Amdahl check, error count, `>= 5` alternating runs median+range, end-to-end share, work verified).
5. **Comment Discipline**: Do not leave `IMPORTANT` / `do not remove` / workaround sermons for our own code — encode the invariant in types, AST rules, or tests and delete the comment. Keep comments only for legal headers, public contracts, or verified external platform quirks.

## 5. Verification Commands

Run before concluding code changes:

```bash
npm run format && npm run lint && npm run typecheck
npm test              # includes architecture AST gates, formal model checks & fuzz/perf budgets
npm run verify:models # exhaustive BFS state-machine invariant & Escape liveness verification
npm run test:fuzz     # deterministic Markdown/CSS/URL fuzzing + semantic & 10k-char perf budgets
npm run quality       # >= 90% coverage, CRAP <= 30 across all AST functions, raw+gzip bundle budgets
npm run mutation      # deterministic security & state-machine mutation gate
npm run check:host-api
npm run test:browser  # real Chromium visual, a11y, SSRF external-oracle & extreme-matrix smoke
npm run test:dsh      # real local DeepSeek Harness host routes, dark mode & lifecycle E2E
```

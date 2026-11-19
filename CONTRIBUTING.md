# Contributing to `dsh-markdown-studio`

Thank you for helping improve `dsh-markdown-studio`! By participating in this project, you agree to abide by our [Code of Conduct](./CODE_OF_CONDUCT.md). For a deep dive into the 5-bundle lazy architecture, `Tone × Rhythm × Atoms` theme compiler, inline-CSS cascade, and local image security model, read [docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md) ([简体中文](./docs/DEVELOPMENT.zh-CN.md)) first.

## Architectural Guardrails

1. **Unidirectional Clean Architecture (`ui → application → domain`) & Effect-Free Business Layer**:
   - `src/domain/`, `src/theme-system/`, and `src/engine.ts` (`src/markdown-parser.ts` + `src/css-inliner.ts`) must stay pure TypeScript with zero React, DOM global, storage, or network dependencies.
   - Direct `useEffect` / `useLayoutEffect` calls are banned everywhere outside `src/runtime/` (`react-lifecycle.ts` and `dom-surfaces.ts`). Prefer render-time derivation, React `key` resets, store subscriptions, or `src/runtime/` hooks; `src/application/use-*.ts` files must hold genuine reactive hooks while stateless command builders use `create*` module names.
   - `DocumentStore` (`src/application/document-store.ts`) is the single source of truth for articles, recycle bin state, and named custom themes.
   - Architectural boundaries are enforced automatically by `test/architecture.test.ts`.
2. **Zero Host Hacks & Reversible Lifecycle**:
   - Consume only documented DeepSeek Harness extension seams (`sidebar.panellist`, `main`, `locale`, `@deepseek-ai/dsh-client-ui-primitives`, `window.__ModuleLoader__`, and Cordis `webServer`).
   - Tag plugin style sheets with `data-plugin="dsh-markdown-studio"` so hot disabling and re-enabling the plugin leaves zero orphaned styles.
3. **Cold-Boot Budget (`< 50 KiB` Hard Gate, `~4.2 KiB` Target)**:
   - Keep `src/shell-entry.ts` (`dist/client.js`) strictly minimal. CodeMirror 6, `mp-darkmode`, theme recipes, MathJax 3 (`dist/math.js`), and Mermaid 11 (`dist/mermaid.js`) must remain in lazy chunks.
4. **Local-First Privacy & Security**:
   - Never add telemetry, mandatory cloud accounts, unrequested external network calls, or secrets. If you discover a security vulnerability, report it privately per [SECURITY.md](./SECURITY.md).

## Local Development Workflow (macOS, Linux, & Windows)

Requires Node.js LTS (`^22.18.0 || >=24.11.0`).

```bash
# 1. Install locked dependencies
npm ci

# 2. Lint, verify third-party licenses, then typecheck + build all 5 bundles + run all test suites
npm run lint
npm run licenses:check
npm test

# 3. Install Chromium once for source-mapped browser coverage
npx playwright install chromium

# Run coverage (>= 90% statements/lines/functions), CRAP <= 30, and bundle budgets
npm run quality

# 4. Run mutation smoke tests and the DSH app.asar API drift check
#    (check:host-api is skipped when DeepSeek Harness Desktop is not installed;
#     set DSH_ASAR_PATH to point at a custom app.asar location)
npm run mutation
npm run check:host-api

# 5. Run Chromium smoke, axe-core WCAG 2 AA scan, and visual baseline
npm run test:browser

# 6. Link locally into DeepSeek Harness Desktop
dsh plugin --profile desktop add link:.
```

To intentionally refresh the macOS visual baseline after an approved typography change:

```bash
UPDATE_VISUAL=1 npm run test:browser
```

## Third-Party Licenses

Every npm package that esbuild bundles into `dist/*.js` must have its license text in [THIRD_PARTY_LICENSES.txt](./THIRD_PARTY_LICENSES.txt). After adding, removing, or upgrading a runtime dependency (including Dependabot bumps), run `npm run licenses` and commit the regenerated file; CI runs `npm run licenses:check` and fails on drift or on any bundled license outside the allowlist (`MIT`, `ISC`, `BSD-2-Clause`, `BSD-3-Clause`, `Apache-2.0`, `MPL-2.0 OR Apache-2.0`).

## Schema & Storage Compatibility

When changing persisted `localStorage`, JSON backup, or `.zip` archive fields:

1. Update both readers and writers, rejecting unknown future `schemaVersion` values.
2. Add forward/backward migration tests in `test/storage-migration.test.ts` or `test/schema.test.ts`.
3. Document the schema change in [docs/schema.md](./docs/schema.md) and [CHANGELOG.md](./CHANGELOG.md).

## Pull Request Checklist

- [ ] `npm run lint` passes with 0 errors.
- [ ] `npm run typecheck` passes with 0 errors.
- [ ] `npm run licenses:check` passes (run `npm run licenses` after runtime dependency changes).
- [ ] `npm run quality` and `npm run mutation` pass (`CRAP <= 30`, `dist/client.js < 50 KiB`).
- [ ] `npm run test:browser` passes with 0 serious/critical accessibility violations.
- [ ] Both [README.md](./README.md) (Chinese) and [README.en.md](./README.en.md) (English) and [CHANGELOG.md](./CHANGELOG.md) reflect user-visible changes.

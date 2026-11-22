---
name: bug-to-rule
description: >-
  Permanent regression prevention workflow for dsh-markdown-studio. Activate
  after diagnosing and fixing any non-trivial bug (architecture, concurrency,
  security, responsive layout, z-index, or lifecycle) to encode the root cause
  into an automated static AST rule, Biome lint rule, formal invariant, fuzz
  probe, or mutation test.
license: MIT
---

# Every Bug → Permanent Automated Gate (`dsh-markdown-studio`)

Never stop at fixing a symptom. Whenever you diagnose a recurring or structural bug, close the entire defect class by placing the cheapest, strongest automated gate at the right layer:

## Gate Selection Matrix

| Bug Class | Permanent Gate Location | Example in Repository |
| :--- | :--- | :--- |
| **Syntax / JS Pitfall** (`var`, unused vars, implicit `any`, missing `node:`) | `biome.json` | `noVar`, `noUnusedVariables`, `noExplicitAny`, `useConst` |
| **Structural / API / Cross-Realm / Layering Mistake** | `test/architecture.test.ts` | Zero business `useEffect`, zero render-phase `ref.current` writes, ban `instanceof Element/HTMLElement`, monotonic `Z_LAYERS`, `data-plugin` DOM tags, container `.clientWidth` vs `window.innerWidth`, pure `*.machine.ts` |
| **Concurrent / Interleaving State Bug** | `src/domain/*.machine.ts` + `test/formal-models.test.ts` | Exiting immersive back to preview leaving orphaned search bar; stale file writes across document switch; dual modal collision |
| **Security Filter / Parser / ReDoS Edge Case** | `test/fuzz-and-perf.test.ts` + `scripts/mutation-smoke.ts` | CSS `@import` / hex-escape `url()` smuggling, origin-escaping URLs, WeChat HTML lint regressions, ZIP bomb budgets |
| **Bundle Bloat / Cold-Boot Regression** | `scripts/bundle-budget.ts` | Hard raw + gzip budgets for all 5 chunks (`dist/client.js <= 12 KiB raw / 5 KiB gzip`) |
| **Narrow Container / Real DOM / A11y Regression** | `test/browser-smoke.ts` | Narrow viewport matrix (`360px`–`760px`), seeded interactive Monkey Bot, axe-core WCAG AA |

## Pre-Commit Checklist After Any Bug Fix

1. Write the minimal reproduction test that fails before the fix and passes after.
2. Ask: *"Could an AI agent or contributor re-introduce a cousin of this bug in another file?"*
3. If yes, add the corresponding gate from the matrix above — and verify the gate actually catches the bug (e.g. via `npm run mutation` or by temporarily reverting the fix).
4. Run the full verification stack: `npm run format && npm run lint && npm run typecheck && npm test && npm run quality && npm run mutation && npm run check:host-api`.

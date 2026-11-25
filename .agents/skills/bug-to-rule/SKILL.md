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
| **Structural / API / Cross-Realm / Layering / Single-Guard Mistake** | `test/architecture.test.ts` | Zero business `useEffect`, zero render-phase `ref.current` writes, ban `instanceof Element/HTMLElement`, monotonic `Z_LAYERS`, `data-plugin` DOM tags, container `.clientWidth` vs `window.innerWidth`, pure `*.machine.ts`, Cordis `prefix` route trailing-slash ban, CodeMirror `Escape` hijack ban, danger confirm `Cancel` focus guard |
| **Host / Third-Party Runtime Contract Drift** | `test/dsh-e2e.ts` + `test/browser-smoke.ts` | Real DSH `GET/HEAD /api/markdown-studio/assets/* === 200`, CodeMirror active selection + 1st `Escape` closing Outline/Immersive |
| **Concurrent / Cross-Subsystem State Bug** | `src/domain/*.machine.ts` + `test/formal-models.test.ts` | Exiting immersive back to preview leaving orphaned search bar; multi-tab `EXTERNAL_STORAGE_SYNC` detaching linked local files; field-level `DocumentStore` & `pendingThemeIntents` merges; stale file writes & dual modal collision |
| **Lexical Security / Parser / ReDoS Edge Case** | `test/fuzz-and-perf.test.ts` + `scripts/mutation-smoke.ts` + `test/browser-smoke.ts` | CSS Syntax L3 comment-token (`red/**/url()`, unclosed `/*`) & escaped-quote `@import`, Mermaid 11 YAML `"img"`/`!!str img` SSRF verified via Chromium network interception (`0` outbound hits), linear $O(N)$ MD/CSS scanners, Darwin (`hostOS=19`) ZIP symlinks |
| **Silent Functional / Semantic Degradation** | `test/fuzz-and-perf.test.ts` + `test/browser-smoke.ts` | 600-char CJK diff quality bound (`addRatio < 0.1`, not just `< 150ms`), Turkish `İ` case-folding highlight accuracy, destructive dialog safe initial focus & focus restoration |
| **Bundle Bloat / Cold-Boot Regression** | `scripts/bundle-budget.ts` | Hard raw + gzip budgets for all 5 chunks (`dist/client.js <= 12 KiB raw / 5 KiB gzip`) |
| **Extreme Device × Locale × Theme × Viewport Regression** | `test/browser-smoke.ts` | `360px`–`760px` matrix, `736px + pointer: coarse + EN` header clearance, `960×265 + SearchBar` SlashMenu clamp, `dark + Night theme + GitHub Light codeTheme` luminance, seeded Monkey Bot, axe-core WCAG AA |

## Four Anti-Blindspot Rules

1. **External Oracle Over Self-Oracle**: Never prove a sanitizer works only by feeding its output back into a detector sharing the same tokenizer (`detector(sanitizer(x))`). Always pair lexical tests with an independent runtime oracle — Chromium network interception (`0` SSRF hits), computed DOM styles (`getComputedStyle`), or real DSH HTTP responses (`200 OK`).
2. **Audit Cross-Subsystem Seams**: Most severe bugs hide between two individually verified modules (`DocumentStore` ↔ `FileSession`, `useWorkspace` ↔ `FileSession`, CodeMirror `defaultKeymap` ↔ `StudioOverlayMachine`). Whenever adding a side effect or third-party integration, add its event to the affected state machine and write one real-browser seam test.
3. **Single Canonical Guard Across Entry Points**: Never duplicate guard logic between UI `disabled` props and keyboard shortcuts (`Mod+S`, `Escape`), between sanitizer and detector, or between mock server and Cordis route registration. Extract one shared helper/constant.
4. **Never Settle for "No Crash / Fast"**: Replace weak oracles (`elapsed < 150ms`, `dialog opened`) with semantic assertions (`addRatio < 0.1`, `activeElement` is Cancel not red Delete, `pre` background luminance `< 0.35`, highlighted text equals exact target substring).

## Pre-Commit Checklist After Any Bug Fix

1. Write the minimal reproduction test that fails before the fix and passes after — using an external/semantic oracle whenever applicable.
2. Ask: *"Could an AI agent or contributor re-introduce a cousin of this bug in another file, locale, theme combo, or shortcut entry point?"*
3. If yes, add the corresponding gate from the matrix above — and verify the gate actually catches the bug (e.g. via `npm run mutation` or by temporarily reverting the fix).
4. Run the full verification stack: `npm run format && npm run lint && npm run typecheck && npm test && npm run quality && npm run mutation && npm run check:host-api`, plus `npm run test:browser` and `npm run test:dsh` when touching UI, rendering, security, or host seams.

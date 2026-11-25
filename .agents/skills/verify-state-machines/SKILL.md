---
name: verify-state-machines
description: >-
  Formal bounded state-space verification workflow for concurrent UI overlays,
  local file sessions, multi-tab DocumentStore sync, and async asset lifecycle
  in dsh-markdown-studio. Activate whenever modifying Escape/overlay/focus
  coordination, Immersive/CssWorkbench transitions, FileSystem Access
  autosave/conflict logic, DocumentStore sync, AssetGC, or AI review sessions.
license: MIT
---

# Formal State Machine Verification (`dsh-markdown-studio`)

Use bounded exhaustive BFS model checking (`test/formal-models.test.ts`) to verify every reachable interleaving of concurrent subsystems instead of relying only on happy-path unit tests.

## 1. Filepath Contract (`src/domain/*.machine.ts`)

Every pure state-machine module uses the `.machine.ts` suffix inside `src/domain/`:
- **Strict determinism** (enforced by `test/architecture.test.ts`): zero React, DOM, `window`, `document`, `Date`, `Math.random`, timers, `fetch`, or storage calls.
- **Single source of truth**: Production code (`src/app.ts`, `src/application/use-file-context.ts`) imports the exact policy predicates (`computePaneVisibility`, `resolveEditorEscapeOutcome`, `resolveDocumentEscapeAction`, `resolveWindowEscapeAction`, `canHandleImmersiveShortcutPolicy`, `isParentModalOpen`, `shouldKeepCssWorkbenchOnViewChange`, `shouldRestoreSplitOnResize`, `isGenerationCurrent`, `isReloadRequestValid`, `canStartAutosave`, `normalizePermissionState`) that the exhaustive state-space reducer executes — preventing model-vs-code drift.

## 2. Modeled Subsystems & Core Invariants

1. **Studio Surface & Overlay Machine (`src/domain/studio-overlay.machine.ts`)**
   - Parallel axes: `Immersive × View × CssWorkbench × ContainerWidth(<=720) × Menu × Drawer × Slash × Outline × Search × AI Session × ParentModal × ChildModal × SelectionBubble`.
   - Safety invariants:
     - Editor and CSS Workbench are never both visible.
     - CSS Workbench draft is never silently active while hidden outside narrow (`<= 720px`) preview mode.
     - Parent and child modals are never simultaneously visible.
     - Active modals or AI sessions suppress the floating selection bubble.
     - Immersive mode never coexists with CSS Workbench, Settings Drawer, or Header Menu.
     - Editor-scoped overlays (`slash`, `outline`, `search`) are always closed whenever `showMarkdownEditor === false`.
   - Liveness invariant: repeated `Escape` from any reachable state converges to a clean state in `<= 8` steps.

2. **Local File Session Machine (`src/domain/file-session.machine.ts`)**
   - Parallel axes: `restoreAssociation × write queue × 1200ms autosave × focus external check × reload × permission × document switch/detach × external storage sync`.
   - Safety invariants:
     - Linked handle always matches `activeDocId`.
     - Detached library documents never retain `conflict`, `dirtyDisk`, or armed autosave.
     - Stale writes from older generations never commit across document/handle switches.
     - Conflicted files are never silently overwritten without explicit `overwrite: true`.
     - External cross-tab `storage` markdown updates (`EXTERNAL_STORAGE_SYNC` with `markdownChanged: true`) immediately detach any linked local file handle and disarm autosave so sibling tabs can never silently overwrite a local disk file.

3. **Multi-Tab `DocumentStore` + Deterministic History (`src/application/document-store.ts`, `src/application/use-document-history.ts`)**
   - Injects deterministic `now` / `nextId` to verify cross-tab merges: `docs.length >= 1`, global ID uniqueness across `docs ∪ trash`, `activeId ∈ docs`, field-level dirty preservation (`title` / `markdown` / `settings` / `view` so toggling view never clobbers sibling markdown edits), per-theme concurrent intent merges (`pendingThemeIntents` preserving simultaneous custom themes), and preservation of local dirty drafts during sibling tab flushes.

4. **Async Asset GC, Optimistic Concurrency & AI Patch Guards (`src/application/asset-gc.ts`, `host/application/image-store.ts`, `src/domain/writing-skills.ts`)**
   - Exhaustive 128-state truth table (`2^7` combinations of `docs / trash / history / inFlight / mermaid / graceWindow / bypassGrace`) proving zero live-asset deletion, paired with `expectedStoredAt` optimistic concurrency locks on `deleteAsset` to close TOCTOU re-upload races.

## 3. Closed-World Blindspot Checklist (Before Calling a Model "Verified")

Exhaustive BFS only verifies the events present in `STUDIO_EVENTS` / `FILE_EVENTS`. Before finalizing any stateful change, audit these external seam sources:
- **Cross-subsystem events**: Does `window` `storage` sync, workspace file open/flush (`useWorkspace.openEntry`), or document replacement mutate state owned by another machine? If so, add the event to that machine first.
- **Third-party library interception**: Does CodeMirror (`defaultKeymap`), a DSH host primitive (`Modal` / `Menu`), or a browser default shortcut consume `Escape` / `Mod+S` / `Tab` before our state-machine router sees it? Verify the live event path in `test/browser-smoke.ts` or `test/dsh-e2e.ts`.
- **Parallel entry points**: Are toolbar buttons, menu items, and keyboard shortcuts (`Mod+S`, `Escape`) gated by the exact same state predicate?

## 4. Verification Commands & Workflow

Before finalizing any change touching stateful orchestration:

1. Run `npm run verify:models` to exhaustively check all state spaces and print minimal counterexample traces on any violation.
2. If you add a new UI surface, modal, shortcut mode, cross-subsystem sync hook, or async lifecycle phase, **update the corresponding `.machine.ts` model and invariants first**, let BFS check for counterexamples, and then wire the production code.
3. Whenever a real interleaving bug is discovered, add its minimal sequence as a named regression trace in `test/formal-models.test.ts`, a mutant in `scripts/mutation-smoke.ts`, and (when runtime/DOM seams are involved) a live check in `test/browser-smoke.ts` or `test/dsh-e2e.ts`.

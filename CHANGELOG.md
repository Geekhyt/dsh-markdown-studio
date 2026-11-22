# Changelog

All notable changes to `dsh-markdown-studio` are documented in this file.

## [0.1.14] - 2026-11-23

### Fixed
- **Single-Pane-Aware Drawer Docking & Container-Resize Popover Invalidation**:
  - Scoped `@container mdstudio (max-width: 1140px)` overlay `.mdstudio-drawer` strictly to `.mdstudio-body[data-mdstudio-view="split"] .mdstudio-drawer`, keeping single-pane `edit` and `preview` views docked (`336px`, compact `308px` at `<= 820px`, full-screen overlay at `<= 720px`) (`src/ui/styles.ts`). Eliminates SettingsDrawer covering AI inline diff `拒绝/采纳` controls, SearchBar actions, and PreviewHead `同步` / `手机/PC` toggles on `721–1140px` surfaces (including real DeepSeek Harness sidebar-expanded windows).
  - Dismissed open `Outline` popovers inside `handleSurfaceResize()` and modeled `outlineOpen: false` in `RESIZE` (`src/app.ts`, `src/domain/studio-overlay.machine.ts`) so host sidebar resizing via `ResizeObserver` never leaves stale overlapping outlines.
- **Stacking-Context-Free Fallback Portals, Capture-Phase Menu Escape LIFO & Vertical Tooltip Clamping**:
  - Added `portalOverlay()` in `src/ui/dsh-primitives.ts` so `FallbackMenu` and `FallbackTooltip` portal to `document.body` when `ReactDOM.createPortal` is available, escaping ancestor stacking contexts (such as `SkillSplitTrigger` at `z-index: 32` vs `SettingsDrawer` at `z-index: 40`).
  - Registered a capture-phase `document` `keydown` `Escape` handler in `FallbackMenuPanel` so pressing `Escape` after focus leaves `[role="menuitem"]` (e.g., clicking a non-focusable group header) still closes the open menu first and restores focus to its trigger without leaking through to close underlying `SearchBar` or `FallbackModal`.
  - Added vertical viewport edge flipping and clamping (`computeTooltipTop`) in `alignFixedTooltip` (`src/ui/dsh-primitives.ts`) and body-portal typography/box-sizing rules (`src/ui/styles.ts`).
- **Modal-Guarded Background Editor Focus Handoff**:
  - Added pure shared predicate `canFocusMarkdownEditor({ hasModal, showMarkdownEditor })` (`src/domain/studio-overlay.machine.ts`) and guarded `focusRange`, `focusEditor`, and `onCodeMirrorReady` (`src/app.ts`) so deleting the active article inside `LibraryDialog` never steals focus out of the open modal into the background editor.
- **Continuous CodeMirror Editing Sessions Across First Save (`editorEpoch`)**:
  - Replaced mutable draft/saved entity IDs on CodeMirror `key` with monotonic `editorEpoch` session keys in `CssWorkbench` (`src/ui/css-workbench.ts`) and `SkillManagerDialog` (`src/ui/skill-manager-dialog.ts`), preserving the DOM instance, cursor focus, scroll offset, and undo stack on first `⌘/Ctrl+S` save.
- **Caret-Safe Bounded `SlashMenu`, Single-Frame Layout-Scroll Guard & Bidirectional Hidden-Pane Scroll Continuity**:
  - Added pure solver `computeCaretPopoverPos()` (`src/domain/surface-geometry.ts`) wired into `useSlashMenu` (`src/application/use-slash-menu.ts`) and `EditorPane` (`src/ui/editor-pane.ts`) so short-viewport mid-page `/` popovers bound `maxHeight` to free space and anchor by `bottom` above the caret line without covering it.
  - Added a spec-aligned single-animation-frame `requestAnimationFrame` layout-scroll guard (`onEditorScroll`) in `useSlashMenu` so post-edit document shrinking or `scrollIntoView` does not dismiss a freshly opened slash menu while subsequent user scrolls still dismiss it immediately.
  - Tracked `pendingEditorSyncRef` and added `restoreEditorScroll()` in `useScrollSync` (`src/application/use-scroll-sync.ts`) wired via `useDebouncedKeyTask` (`src/app.ts`) so scrolling while the editor is hidden (`Preview → Edit → Split`, `Immersive Write → Preview → Write`) restores the matching editor scroll ratio bidirectionally.
- **`FallbackInput` `wrapClassName` Parity & Immersive Narrow SearchBar Clearance**:
  - Preserved `wrapClassName` on iconless `FallbackInput` controls (`src/ui/dsh-primitives.ts`), raised `.mdstudio-searchbar .mdstudio-searchbar-field` specificity (`min-width: 96px; height: 28px;`), and dropped immersive SearchBar below top chrome at `<= 720px` (and `<= 920px` when `[data-mdstudio-host-titlebar]` is present) (`src/ui/styles.ts`).

### Verification & Regression Gates
- Added permanent gates across `test/architecture.test.ts` (split-scoped 1140px overlay drawer CSS check & `editorEpoch` session-key contract), `test/domain.test.ts` (`computeCaretPopoverPos` bounds & obstacle tests), `test/formal-models.test.ts` (`canFocusMarkdownEditor` & `RESIZE` outline invalidation), `test/dsh-primitives.test.ts` (portal escape, capture-phase LIFO Escape, `FallbackInput` `wrapClassName`, and vertical tooltip flip), `test/app-dom.test.ts` (`LibraryDialog` active-delete focus retention & single-frame slash scroll guard), `test/browser-smoke.ts` (single-pane 860px docked drawer, `Preview → Edit` scroll restore, and `CssWorkbench` first-save continuity), and `scripts/mutation-smoke.ts` (17/17 killed mutants).

## [0.1.13] - 2026-11-22

### Fixed
- **Unified Floating Popover Obstacle Avoidance (`src/domain/surface-geometry.ts`)**:
  - Added pure domain placement solver (`computeUnobstructedWidth`, `computeSafePopoverPos`) paired with runtime `collectSurfaceObstacles(rootEl)` (`src/runtime/dom-surfaces.ts`) and wired `Outline`, floating AI `SelectionBubble`, and `SlashMenu` into the same obstacle-aware geometry model (`src/ui/editor-pane.ts`, `src/ui/selection-bubble.ts`, `src/application/use-slash-menu.ts`). Eliminates popover truncation behind overlay `SettingsDrawer` (both standalone and real DeepSeek Harness `840px` sidebar layouts) and top-line floating AI pill collisions with `ImmersiveDock`.
- **Containing-Block-Safe Immersive Dock Glass & Scroll-Quiet `FallbackTooltip`**:
  - Moved `.mdstudio-immersive-dock` `backdrop-filter` and shadow onto `.mdstudio-immersive-dock::before` (`src/ui/styles.ts`) so `position: fixed` tooltips are never trapped in a local containing block and displaced off-screen.
  - Added post-mount containing-block/viewport compensation (`alignFixedTooltip`), capture-phase `window` `scroll` dismissal, and a 250ms scroll-quiet window (preserving immediate keyboard focus) to `FallbackTooltip` (`src/ui/dsh-primitives.ts`), eliminating stale tooltips and synthetic hover strobing during modal list scrolling.
- **Unified Document-Replacement Surface Reset (`REPLACE_DOCUMENT`)**:
  - Modeled `REPLACE_DOCUMENT` in `src/domain/studio-overlay.machine.ts` and routed all 7 document replacement paths (switch, new, clear, load sample, import, file drop, and cross-tab sync) through `resetDocumentSurface()` (`src/app.ts`, `src/application/document-commands.ts`), cleanly closing `CssWorkbench`, resetting active AI sessions, dismissing transient overlays, and resetting `PreviewPane` scroll position even when Scroll Sync is disabled.
- **Cross-View Scroll Continuity & AI Preview Consistency**:
  - Persisted editor scroll ratio in `useScrollSync` (`src/application/use-scroll-sync.ts`) and added `onMountSurface` / `onPreviewMounted` (`src/runtime/dom-surfaces.ts`, `src/ui/preview-pane.ts`) so switching from scrolled `Immersive Write` to `Immersive Preview` restores the matching reading position instead of resetting to top.
  - Extracted `shouldApplyAiPreview(cssOpen, hasAiSession)` (`src/domain/studio-overlay.machine.ts`) so preview content stays consistent with an active AI inline diff across `Split ↔ Preview-only` view toggles.
- **Responsive Container Breakpoint & Narrow Skill Card Wrapping**:
  - Raised the `@container mdstudio` overlay `SettingsDrawer` breakpoint from `1080px` to `1140px` with compact toolbar spacing under `1220px` (`src/ui/styles.ts`), preventing docked drawers at `1080–1140px` from crushing split-view toolbars while preserving `336px` docked layout on wide viewports.
  - Fixed `@media (max-width: 720px)` `.mdstudio-skill-builtin-head` wrapping so built-in Skill cards never overflow horizontally on `390px` mobile viewports.
- **SearchBar `Mod+F` Interception & Focus Handoff Hardening**:
  - Intercepted `Mod+F` (`isModFindEvent`) inside `.mdstudio-searchbar` (`src/ui/editor-pane.ts`) to re-focus and select the query instead of leaking to native browser Find.
  - Tracked workbench instances via `data-mdstudio-wb-seq` in `CssWorkbench` and `SettingsDrawer` (`src/ui/css-workbench.ts`, `src/ui/settings-drawer.ts`) to eliminate transient focus steals on drawer re-entry over an existing workbench, and guarded async `LibraryDialog` `onSwitch` focus restoration (`src/app.ts`).

### Verification & Regression Gates
- Added permanent CSS containing-block gate in `test/architecture.test.ts`, 100% branch tests for `surface-geometry.ts` in `test/domain.test.ts`, `FallbackTooltip` scroll-dismissal/alignment tests in `test/dsh-primitives.test.ts`, `REPLACE_DOCUMENT` + `shouldApplyAiPreview` formal BFS checks in `test/formal-models.test.ts` (1,256 states / 38,936 transitions), and 5 cross-component browser assertions in `test/browser-smoke.ts`.

## [0.1.12] - 2026-11-22

### Fixed
- **Orphaned Search Bar on Immersive Exit to Preview (Caught by Formal BFS Model Checking)**:
  - Fixed `exitImmersive()` in `src/app.ts` to preserve Find & Replace only when returning to an editor-bearing view (`keepSearch: view !== 'preview'`), eliminating the 5-step counterexample (`preview → Enter Immersive → Immersive Write → ⌘/Ctrl+F → Exit Immersive`) that left an orphaned search bar active in pure preview mode.
- **Cross-Realm Focus Safety**:
  - Replaced remaining `document.activeElement instanceof HTMLElement` checks in `src/app.ts` and `src/application/use-copy-actions.ts` with feature duck-typing (`typeof el.focus === 'function'`).

### Engineering & Verification Hardening
- **Pure Deterministic State Machines (`*.machine.ts`) & Exhaustive Bounded BFS Model Checking**:
  - Extracted shared single-source-of-truth policy predicates and formal transition models into `src/domain/studio-overlay.machine.ts` and `src/domain/file-session.machine.ts` wired directly into `src/app.ts` and `src/application/use-file-context.ts`.
  - Added `test/formal-models.test.ts` (`npm run verify:models`) covering 1,256 reachable `StudioOverlayMachine` states (37,680 transitions + `<= 8`-step `Escape` liveness convergence), 25,000 reachable `FileSessionMachine` states (475,000 transitions), deterministic multi-tab `DocumentStore` / `useDocumentHistory` replay, and an exhaustive 128-state `AssetGC` safety truth table with non-vacuity self-tests.
  - Added optional deterministic `now` / `nextId` clock & ID injection to `DocumentStore`, `useDocumentHistory`, and `createAssetGarbageCollector`, and replaced `Date.now()` Mermaid render IDs with a monotonic sequence counter in `useMermaidAssets`.
- **Permanent Automated Gates ("Bug → Rule") & Tightened Biome Rules**:
  - Enabled 7 strict Biome `error` rules (`noVar`, `noUnusedVariables`, `noExplicitAny`, `noImplicitAnyLet`, `noShadowRestrictedNames`, `useConst`, `useNodejsImportProtocol`) across the codebase (cleaning 462 legacy `var` declarations and 60 unused `catch` bindings).
  - Centralized overlay stacking order into a monotonic `Z_LAYERS` table (`src/ui/styles.ts`) and expanded `test/architecture.test.ts` with AST/contract gates enforcing pure `*.machine.ts` determinism, zero `instanceof Element/HTMLElement`, zero raw numeric `z-index`, mandatory `data-plugin="dsh-markdown-studio"` tagging on dynamic `<style>`/`<script>` tags, and container `.clientWidth` discipline over `window.innerWidth` breakpoints.
  - Added dedicated AI engineering workflow skills in `.agents/skills/verify-state-machines/SKILL.md` and `.agents/skills/bug-to-rule/SKILL.md`.
- **Fuzzing, Hot-Path Perf Budgets, Raw + Gzip Bundle Ceilings & Browser Resilience**:
  - Added `test/fuzz-and-perf.test.ts` (`npm run test:fuzz`) with 300 seeded Markdown fuzz cases, 200 CSS attack vectors, 7 pathological ReDoS probes, dangerous URL rejection checks, and a ~15k-char large-document hot-path benchmark.
  - Tightened cold-boot `dist/client.js` budget from `50 KiB` raw down to `12 KiB` raw / `5 KiB` gzip and enforced hard gzip ceilings across all 5 bundles (`scripts/bundle-budget.ts`).
  - Expanded deterministic mutation testing (`scripts/mutation-smoke.ts`) from 9 to 15 killed mutants covering CSS sanitization, WeChat HTML lint, ZIP budgets, and both state machines.
  - Added a narrow-container layout matrix (`360px` / `640px` / `720px` / `760px`) and a 36-step seeded interactive Monkey Bot with `Escape` convergence verification to `test/browser-smoke.ts`.

## [0.1.11] - 2026-11-22

### Fixed
- **Unified LIFO Escape Stack, Monotonic Overlay Layering & Surface Visibility Invariants**:
  - Replaced scattered Escape checks across editor shortcuts and document listeners with a unified LIFO priority chain (`Menu → Slash → Outline → SearchBar → AI Review → Drawer → Immersive`) via a tri-state `'handled' | 'defer' | false` contract (`src/app.ts`, `src/application/editor-shortcuts.ts`). Fixes dead `Escape` when editor content is focused with Find & Replace open in Immersive Write, preserves active AI inline diffs when dismissing an overlapping Outline popover, keeps focused `SettingsDrawer` closing before background `SearchBar`, and respects `event.defaultPrevented` in `FallbackModal` (`src/ui/dsh-primitives.ts`).
  - Established a strict monotonic `z-index` hierarchy (`outline 30 < slash 31 < floating AI pill 32 < overlay drawer 40 < immersive dock 55 < modal 70 < menu 75 < toast 85 < tooltip 90`) and added `visibleEditorWidth()` in `src/application/use-slash-menu.ts` so `.mdstudio-slash` never paints over or hides behind the overlay `SettingsDrawer` in sidebar-expanded DeepSeek Harness windows (`src/ui/styles.ts`, `src/application/use-slash-menu.ts`).
  - Reset active AI writing sessions on `openCssWorkbench()`, scoped `effectivePreviewMarkdown` and document-level Escape strictly to `panes.showMarkdownEditor`, and replaced `event.target instanceof Element` with cross-realm safe `isEventInside()` (`src/app.ts`).
- **Floating Overlay Lifecycle & Clean Focus Handoff**:
  - Closed `.mdstudio-slash` on CodeMirror/textarea scroll, Outline toggle, and container resize so slash palettes never float detached mid-air (`src/app.ts`).
  - Dismissed the floating AI selection pill on outside `mousedown` while preserving editor interactions and native DSH portaled menus (`[role="menu"]`, `[data-menu-material]`) and widened its right-edge clamp margin (`src/ui/selection-bubble.ts`).
  - Snapshotted `SettingsDrawer` root and pre-existing workbench state at mount time so React 18 unmount ref clearing never steals focus from `CssWorkbench` when editing existing custom themes, while still restoring focus to the Settings trigger when dismissing a drawer opened from inside `CssWorkbench`; auto-focused the CSS editor surface when editing an existing custom theme (`src/ui/settings-drawer.ts`, `src/ui/css-workbench.ts`).
- **Dark Mode Immersive Stage Sync & Alpha-Aware WCAG AA Contrast**:
  - Extended `paintStageBackground` (`src/runtime/dom-surfaces.ts`) and `PreviewPane` (`src/ui/preview-pane.ts`) to synchronize `.mdstudio-stage.is-desktop` alongside `.mdstudio-device` and `.mdstudio-device-screen` across dark-mode resolution and `mobile ↔ desktop` switches, eliminating the 52px top background seam on dark custom themes in PC immersive preview.
  - Updated `resolveFgHex` (`src/adapters/dark-preview.ts`) to alpha-composite translucent `mp-darkmode` foreground colors against their effective blended dark surface with a `4.6:1` rounding margin, reducing dark-mode kitchen-sink WCAG 2 AA text contrast violations across all 8 built-in themes from 9 to 0.
- **Responsive Container Layout vs Touch Density Decoupling & Narrow Convergence**:
  - Extended `observeHostTitlebarInset` (`src/adapters/host-shell.ts`) with an optional `onResize` callback so widening a narrow container past `720px` while `CssWorkbench` is in mobile preview automatically restores `split` view instead of leaving an invisible CSS draft hijacking live preview (`src/app.ts`).
  - Decoupled container-width layout collapsing (`@container mdstudio (max-width: 720px)` with compact `32×30px` icon-only copy button) from mobile `44px` touch-target inflation (`@media (max-width: 720px)`), and dropped narrow immersive SearchBar (`@container mdstudio (max-width: 640px)`) cleanly below the floating dock at full width (`src/ui/styles.ts`).
- **Concurrency & State Hardening**:
  - Switched `.md` drag-and-drop imports to `claimOpenTransition()` (`src/app.ts`) and converted Skill Manager instruction updates to a functional `setForm((prev) => ...)` updater (`src/ui/skill-manager-dialog.ts`).

## [0.1.10] - 2026-11-22

### Fixed
- **Container-Driven Responsive Layout (`@container mdstudio`)**:
  - Declared `container-type: inline-size; container-name: mdstudio` on `.mdstudio-root` and migrated panel-internal responsive breakpoints (`1080px` drawer overlay, `960px` compact header/toolbar, `720px` single-pane collapse) from viewport `@media` to `@container mdstudio` while keeping body-portaled modals on `@media (max-width: 720px)` (`src/ui/styles.ts`). Expanded DeepSeek Harness sidebars (e.g. 1040px window with 280px sidebar -> 760px studio container) no longer crush split panes or overflow the formatting toolbar.
  - Switched `SettingsDrawer` focus-trap width detection and narrow `CssWorkbench` view retention from `window.innerWidth` to `.mdstudio-root` `clientWidth` (`src/ui/settings-drawer.ts`, `src/app.ts`).
- **Unified Transient Overlay Coordination, LIFO Escape & CSS Workbench Sync**:
  - Consolidated transient overlay dismissal (`dismissTransientOverlays`) and draft cleanup (`clearCssWorkbenchDraft`) in `src/app.ts`; reset portaled `FormatMenu` declaratively via React `key` (`visible + overlayEpoch`) without `useEffect` so entering immersive mode or switching views never leaves orphaned floating menus (`src/ui/editor-pane.ts`).
  - Exited any open `CssWorkbench` live draft when picking a saved custom theme, resetting styles, or importing a theme JSON so unsaved CSS drafts never hijack preview rendering (`src/app.ts`).
  - Dismissed editor overlays on `ImmersiveDock` `write ↔ preview` switches and scoped `canHandleImmersiveShortcut('exit')` to visible editor panes so hidden search bars can no longer trap `Escape` in immersive preview; added LIFO `Escape` handling between `.mdstudio-outline` and `.mdstudio-searchbar` plus a document-level `Escape` fallback for active AI review sessions (`src/app.ts`, `src/ui/editor-pane.ts`).
  - Hid the floating AI selection pill whenever a modal dialog is open (`hasActiveModal()`) while preserving the underlying selection on modal close, switched `FallbackToast` to `position: fixed`, prevented `SettingsDrawer` unmount from stealing focus from `CssWorkbench` or open modals, cleared `FallbackTooltip` on window blur/resize, and aligned `ImportModeDialog`/`MergeConflictDialog`/`WorkspaceDialog` close guards (`src/app.ts`, `src/ui/styles.ts`, `src/ui/settings-drawer.ts`, `src/ui/library-dialogs.ts`, `src/ui/dsh-primitives.ts`).
- **Structural Editor-Wrap Overlay Anchoring & Caret-Aware Slash Menu**:
  - Made `.mdstudio-editor-wrap` `position: relative` and moved `.mdstudio-slash`, `.mdstudio-outline`, and the floating AI `SkillSplitTrigger` inside it, eliminating hardcoded `top: 46px` / `top: 88px` offsets so wrapped multi-row search bars and 50px mobile toolbars never overlap popovers (`src/ui/editor-pane.ts`, `src/ui/selection-bubble.ts`, `src/ui/styles.ts`).
  - Anchored `.mdstudio-slash` dynamically near the active caret via CodeMirror `coordsAtPos()` (with automatic above-caret flip when near the bottom edge) so `/` in centered immersive writing no longer collides with the top-left macOS titlebar zone (`src/application/use-slash-menu.ts`).
- **Programmatic vs User Selection Classification for Floating AI Pill**:
  - Tagged CodeMirror `revealRange`, `focusRange`, `setInlineBlocks`, and `setDiffTransition` dispatches with a `ProgrammaticSelection` annotation (`src/domain/editor-types.ts`, `src/ui/codemirror-core.ts`) and guarded `useSelectionBubble` against programmatic ranges and non-editor focus (searchbar/title/modal), eliminating false AI pill popups on Find Next, Outline jump, toolbar formatting, and `⌘/Ctrl+F` (`src/ui/selection-bubble.ts`, `src/app.ts`).
- **Export Mermaid Theme Cache Consistency**:
  - Extended `useMermaidAssets.ensure(markdown, targetTheme?)` and passed `mermaidThemeFor(settings)` explicitly in `useCopyActions` and `createArticleExporter.exportHtml` so copying or exporting HTML while `CssWorkbench` previews a different palette never falls back to raw Mermaid source (`src/application/use-mermaid-assets.ts`, `src/application/use-copy-actions.ts`, `src/application/article-exporter.ts`).
- **Tinted-Paper Dark Mode & Inverted Surface Inline Contrast**:
  - Included the `#mdstudio` root element in `normalizeDarkSurfaces` and `liftDarkText` (`src/adapters/dark-preview.ts`), fixing muddy light-gray paper backgrounds and 15 WCAG AA contrast violations across `warm`, `gallery`, and `ink` themes in Dark Mode.
  - Added `u` and `b` to `invertedInlineRules` (`src/theme-system/core.ts`) and reused it in `poster` `LEAD.sticker` alongside an inverted ink-on-yellow `.mdstudio-lead mark` badge so highlighted text inside poster lead banners remains legible (`src/theme-system/atoms/inline.ts`).

## [0.1.9] - 2026-11-21

### Security
- **Unified CSS Syntax Level 3, MathJax, Mermaid & WHATWG URL Hardening**:
  - Updated `decodeCssEscapes` and `scanIdentBeforeParen` (`src/domain/custom-css.ts`) per CSS Syntax Level 3 §4.3.7 to consume trailing LF / CRLF / FF whitespace after hex escapes (blocking `\75\nrl(...)`), and shared `hasCssUrlRef` across custom CSS, MathJax, and clipboard SVG sanitizers.
  - Replaced manual URL prefix checks (`src/domain/urls.ts`) with a WHATWG `new URL(probe, 'https://dsh.invalid/')` origin-escape guard blocking `\/`, `\\`, `//`, `/\`, and all protocol-relative variants.
  - Blocked the MathJax `unicode` TeX macro package, isolated each `render()` call with a fresh `TeX` instance (eliminating cross-document `\label`/`\renewcommand`/`\definecolor` leakage), and enforced an SVG root + descendant style property allowlist (`src/math-entry.ts`, `src/adapters/wechat-clipboard-dom.ts`).
  - Locked `themeCSS`, `htmlLabels`, `flowchart`, and `fontFamily` in Mermaid's `secure` array and stripped external `url()` references from generated `<style>` blocks (`src/mermaid-entry.ts`).
  - Added whole-archive aggregate compression-ratio protection (`total / totalCompressed <= 100` above 1 MiB) in `src/adapters/zip.ts` and unified strict loopback `Host` + remote-address validation (`isLoopbackReq`) across `/math`, `/mermaid`, asset, and AI routes (`host/http/`).

### Fixed
- **Multi-Tab Undo Sync, Document Session Transactions & Storage Integrity**:
  - Tagged external React/storage updates to CodeMirror with `ProgrammaticUpdate` (`setValue(value, silent=true)`) so programmatic sync never echoes back into `onChange`; cross-tab `storage` sync now resets `docHistory` and detaches deleted linked files, eliminating `⌘Z` rollback corruption after concurrent tab edits (`src/ui/codemirror-core.ts`, `src/app.ts`, `src/application/document-store.ts`).
  - Added a shared `claimOpenTransition()` sequence guard across local-file open, drag-drop, workspace open, and library switches, flushed linked files before switch/new/delete/archive-replace/unmount, normalized workspace `moveEntry` target paths with case-only rename support, and fixed `saveLocalFile` / conflict-reload / permission-request races (`src/app.ts`, `src/application/`).
  - Snapshotted and restored backup/unreadable keys if quota-retry writes fail (`src/adapters/storage.ts`), prevented corrupted v3 libraries from silently falling back to stale v2 data, deduplicated merged backup IDs while preserving custom-theme unions (`src/domain/library-backup.ts`), and added follow-up GC pruning with `storedAt` touch on deduplicated asset re-uploads (`src/application/asset-gc.ts`, `host/application/image-store.ts`).
  - Allowed `useMathAssets` retry after transient bundle-load errors, switched `useMermaidAssets` cache pinning to ref-counted keys (`Map<string, number>`) respecting `previewSettings`, isolated CodeMirror undo stacks by entity `key` in the CSS Workbench and Skill Manager, and resolved superseded confirm dialogs cleanly (`src/ui/css-workbench.ts`, `src/ui/skill-manager-dialog.ts`, `src/ui/dialog-host.ts`).
- **Single-Source Markdown Metadata & Structured CSS Theme View**:
  - Delegated `containsMath()` directly to `renderMarkdown()` (`src/markdown-parser.ts`), removing 50 lines of drifting regexes so cold-boot multiline block formulas (`$$ E=mc^2\n... $$`) always load `math.js` while keeping currency prose untouched.
  - Extended `assetFilesInMarkdown` (`src/domain/images.ts`) to cover balanced-bracket inline images and reference definitions while excluding external CDN URLs, unified `stripLeadingFrontmatter` and directive/callout stripping across headings & plain-text extraction (`src/domain/article.ts`), tightened WeChat HTML inline-style lint boundaries (`src/domain/wechat-html-lint.ts`), and hardened balanced-paren URL protection & surrogate-safe snippets (`src/domain/writing-skills.ts`, `src/domain/library-search.ts`).
  - Rewrote `extractCustomThemePreview` and `isStandaloneCustomCss` (`src/domain/custom-themes.ts`, `src/themes.ts`) on top of a lightweight `parseCssRules` + `isRootThemeSelector` view supporting `:root`/`html`/`body` and `background:` shorthand while ignoring CSS comments and non-root rules.
- **DSH Real-Host Modal Escape, Find Focus, Narrow Immersive & Touch Layout**:
  - Replaced the 50 ms wall-clock cooldown in `useModalMenuState` (`src/ui/library-dialogs.ts`) with an event-driven `dismissSuppressRef` so exporting `.zip` from the Library modal and immediately pressing `Escape` dismisses reliably in real DeepSeek Harness hosts (restoring `npm run test:dsh` to 100% pass).
  - Split `revealRange` (scroll/select without stealing focus) from `focusRange` (`src/ui/codemirror-core.ts`, `src/application/editor-search.ts`) so repeated `Enter` presses in Find & Replace step cleanly through matches without overwriting article text.
  - Fixed narrow-screen (`<= 720px`) immersive preview blank screen (`:not([data-mdstudio-immersive="preview"])`) and widened `@media (pointer: coarse)` preview header and typography capsule tracks to zero overflow while keeping `>= 44px` touch targets (`src/ui/styles.ts`).
- **Contrast, Accessibility, Lifecycle & Release Pipeline**:
  - Lifted `poster` theme yellow `:::lead` `<del>` contrast (`4.32:1` → `>= 5.14:1` WCAG AA) in `src/theme-system/atoms/inline.ts`, aligned `ensureContrast` target selection with `readableOn` (`src/theme-system/color.ts`), and added true Porter-Duff alpha compositing for semi-transparent ancestor backgrounds in dark preview (`src/adapters/dark-preview.ts`).
  - Numbered duplicate scroll regions (`代码块 1` / `Code block 1`) to bring desktop axe-core violations to `0` (`landmark-unique`), localized MathJax SVG `aria-label` prefixes (`Formula: ` / `公式：`), cleaned up `<script data-plugin="dsh-markdown-studio">` and `localeService` on hot disable, bounded thumbnail encoding on tall images (`width > 640 || height > 640`), deduplicated `docs/theme-gallery.html`, and added `npm run test:browser` to `.github/workflows/release.yml`.

## [0.1.8] - 2026-11-21

### Security
- **Single-Pass CSS Escape Decoding & Function Sanitizer**: Replaced two-pass CSS escape decoding with a CSS Syntax Level 3 single-pass decoder and extended external resource stripping to cover `src()`, `cross-fade()`, CDO/CDC HTML comment tokens, hex-escaped function names (`\75 rl(...)`), C0 control characters, and backslash-relative URLs (`/\attacker...`) while preserving inline `data:image/svg+xml` assets (`src/domain/custom-css.ts`, `src/css-inliner.ts`).
- **Host Route, MathJax & ZIP Boundary Hardening**: Enforced strict `Host`/origin/body-size validation across host asset, AI, and chunk routes (`host/http/`), blocked `\href` / `\style` injection vectors in MathJax (`src/math-entry.ts`), and tightened ZIP path-traversal and decompression budget enforcement (`src/adapters/zip.ts`).

### Fixed
- **Markdown Parser, CSS Inliner & WeChat Clipboard**:
  - Fixed CommonMark link-reference definitions (`[id]: url`), task-list & blockquote lazy continuation, currency `$` vs inline math disambiguation (preserving prose around `$100` / `$200`), and CSS `var()` fallback + `[attr$="..."]` selector handling (`src/markdown-parser.ts`, `src/css-inliner.ts`).
  - Unwrapped `<section>` elements nested inside `<p>` during clipboard DOM preparation (`src/adapters/wechat-clipboard-dom.ts`).
  - Scoped `inspectWechatHtml` (`src/domain/wechat-html-lint.ts`) so `<code class="mdstudio-lang-katex">` and literal code examples inside `<code>...</code>` no longer trigger false-positive WeChat lint warnings.
- **Multi-Tab Persistence, Backup & Asset Lifecycle**:
  - Upgraded cross-tab `DocumentStore` synchronization (`src/application/document-store.ts`) to merge edits at the individual document level (preserving concurrent edits across open tabs without clobbering sibling drafts or hijacking the active tab).
  - Seeded `LIBRARY_BACKUP_KEY` immediately on first write (`src/adapters/storage.ts`), bypassed the GC grace window and flushed immediately on explicit trash purge (`src/application/asset-gc.ts`, `src/application/use-document-library.ts`), and skipped redundant overwrite prompts when linked files are already marked conflicted (`src/application/file-commands.ts`).
  - Serialized `mermaid.render()` calls through a Promise queue with parent-agnostic temporary DOM cleanup (`src/mermaid-entry.ts`), added a fast `/mermaid/i` precheck (`src/application/use-mermaid-assets.ts`), and replaced raw regex math detection with parser-consistent `containsMath()` so `math.js` never fetches on currency, bash variables, or code blocks (`src/application/use-math-assets.ts`).
  - Hardened `ImageHostService`, `LocalAssetServer`, and host routes against concurrent writes and keep-alive leaks (`host/application/image-store.ts`, `host/local-server.ts`, `host/http/routes.ts`).
- **Custom Theme Isolation, Dark Preview & Editorial Contrast**:
  - Added explicit `/* @base: standalone | classic */` pragma support and relaxed structural standalone detection (`src/themes.ts`) so minimalist standalone custom themes without `h1`/`pre`/`blockquote` no longer fall back into the Classic base.
  - Generalized inverted-surface inline contrast rules (`src/theme-system/`) to guarantee WCAG 2 AA (`>= 4.5:1`) across all 8 themes × 5 accents × 6 containers (including `ruby` table headers and `poster` `:::pull` quotes).
  - Replaced the 24-selector allowlist and absolute luminance cutoff in `liftDarkText` (`src/adapters/dark-preview.ts`) with a text-bearing DOM walker backed by real WCAG `contrast` / `ensureContrast` (`>= 4.5:1`) and unified dark stage surface constants (`DARK_STAGE_DEFAULT` / `DARK_STAGE_PAPER`) in `src/theme-system/color.ts`.

### Changed & UX
- **Multi-Line `Tab` / `Shift+Tab` Block Indentation**: Selecting multiple lines (or a full line) and pressing `Tab` now indents every selected line cleanly instead of replacing the selection with two spaces, `Shift+Tab` outdents every selected line, and WCAG 2.1.2 `Esc → Tab` focus escape automatically disarms on editor blur or pointer interaction (`src/application/editor-shortcuts.ts`, `src/ui/editor-pane.ts`).
- **Parser-Consistent AI Protected Token Guard & Structured Error Classification**:
  - Replaced overlapping regexes in `extractProtectedTokens()` (`src/domain/writing-skills.ts`) with a single-pass lexical scanner covering ```` ``` ```` / `~~~` fences, multi-backtick inline code, `$`/`$$`/`\(...\)`/`\[...\]` math, URLs/assets, and footnotes while excluding currency ranges such as `$100/$200`.
  - Prioritized structured error codes in `formatAiClientError()` (`src/adapters/ai-client.ts`) over loose substring matching, added bilingual `err.aiRateLimited` localization (`src/locales/ui-strings.ts`), and removed hardcoded Chinese strings from `httpStatusError`.
- **Responsive `FallbackMenu` & Explicit Locale Propagation**:
  - Honored the `side` (`top` | `bottom` | `right`) prop in `FallbackMenu` and added live `resize` / capture-phase `scroll` repositioning (`src/ui/dsh-primitives.ts`) so open menus stay anchored inside resized viewports.
  - Propagated explicit `locale` through `UiKit` for relative timestamps, dates, and CSS Workbench starter templates (`src/ui/ui-kit.ts`, `src/ui/css-workbench.ts`, `src/ui/library-dialogs.ts`), and aligned English view labels in `docs/DETAIL.md`.

## [0.1.7] - 2026-11-21

### Security
- **Quote- & Paren-Aware Custom CSS Sanitizer**: Replaced regex-only external resource stripping (`src/domain/custom-css.ts`) with a quote- and parenthesis-aware scanner that strips comments and line continuations first, blocking escaped quotes (`\"` / `\22 `), `image-set()`/`src()`/`url()` modifiers, unclosed quotes, and URLs containing `)` or `;` while preserving inline `data:image/svg+xml` assets.
- **Host Loopback Allowlist**: Tightened `Host` validation on the local asset and AI routes (`host/http/routes.ts`, `host/http/ai-route.ts`) to an explicit loopback host allowlist (`127.0.0.1`, `localhost`, `[::1]`, `::1`) to prevent DNS-rebinding bypasses.

### Fixed
- **Standalone Custom CSS Theme Isolation**: Fixed `isStandaloneCustomCss` (`src/themes.ts`) to strip comments and declaration bodies before matching selectors; standalone `custom:*` themes no longer forcibly prepend `classic` base rules (allowing users to remove default `01` heading counters) and use zero-specificity `:where(...)` for first-child heading flush while keeping all 8 built-in themes pixel-identical.
- **Markdown Parser & CSS Inliner Accuracy**:
  - Fixed link reference definitions immediately following a footnote (`[^1]: ...` + `[ref]: url`), nested `***bold** and italic* and **more**`, GFM table interruption before headings/blockquotes/lists containing `|`, single-column GFM tables, and `:::scroll-x` directive depth tracking across nested `---` / multi-paragraph callouts (`src/markdown-parser.ts`).
  - Fixed balanced `:is()`/`:not()`/`:where()` specificity calculation, uppercase CSS property lowercasing, and element-scoped counter variable resolution (`src/css-inliner.ts`).
- **WeChat Clipboard Nested List Order**: Fixed `moveNestedLists` (`src/adapters/wechat-clipboard-dom.ts`) to preserve original sibling order when a single `<li>` contains multiple consecutive nested `<ul>`/`<ol>` lists, while maintaining full WeChat Official Account `plugin_spec` compliance.
- **Asset GC, Mermaid & Local File Concurrency**:
  - Parsed serialized import-recovery JSON properly in `collectImportRecoveryAssets` (`src/application/use-library-archive.ts`) so pre-import recovery assets are protected from orphan GC.
  - Deduplicated in-flight `useMermaidAssets` renders per `(markdown, theme)` and guarded uploads by generation token (`src/application/use-mermaid-assets.ts`).
  - Verified permission and seeded file timestamps in `useFileContext` (`src/application/use-file-context.ts`), guarded `onOpenFile` against stale handle switches (`src/app.ts`), closed keep-alive HTTP connections cleanly on `LocalAssetServer.stop()` (`host/local-server.ts`), and wrapped `getDefaultModel()?.currentSelection()` in `try/catch` (`host/application/ai-service.ts`).
- **Dark Preview & Selection Bubble Lifecycle**: Guarded `applyDarkPreview` against unmount/cancellation across async `mp-darkmode` import, cleaned up stale `js_darkmode_style` tags when switching from light themes into built-in dark themes (`night`), removed duplicate `dangerouslySetInnerHTML` on `PreviewPane`, tracked `darkApplied` state for StrictMode / fast theme switches (`src/adapters/dark-preview.ts`, `src/runtime/dom-surfaces.ts`, `src/ui/preview-pane.ts`), and canceled pending `requestAnimationFrame` work in `useSelectionBubble` while lifting `minTop` to `88px` when `.has-search` is open (`src/ui/selection-bubble.ts`).

### Accessibility & UX
- **WCAG 2 AA Contrast Across Code & Editorial Themes**: Lifted token contrast across 6 built-in code themes (`github`, `one-dark`, `dracula`, `nord`, `solarized-light`, `monokai` in `src/code-themes.ts`) and clamped theme accent/link/muted/del colors against callout and quote surfaces (`src/theme-system/compose.ts`) to meet WCAG 2 AA (`>= 4.5:1`).
- **Keyboard Navigation, ARIA & Mobile Touch Targets**:
  - Scoped editor `Tab` interception to `.cm-content`/`<textarea>` (leaving `.cm-scroller` and inline AI diff buttons unaffected) and added WCAG 2.1.2 `Escape → Tab` / `Escape → Shift+Tab` focus escape (`src/application/editor-shortcuts.ts`, `src/ui/codemirror-core.ts`).
  - Added `role="option"` + `aria-selected` on draft skills and focus restoration when closing `SkillManagerDialog`, roving `tabIndex` + Arrow/Home/End navigation in `LibraryDialog`, `:not([tabindex="-1"])` container wrap in `trapModalTab`, and `aria-expanded` on Settings Drawer / Outline triggers (`src/ui/skill-manager-dialog.ts`, `src/ui/library-dialogs.ts`, `src/ui/dsh-primitives.ts`, `src/ui/header-bar.ts`, `src/ui/editor-pane.ts`).
  - Raised mobile (`<= 720px`) CSS Workbench action buttons to `>= 44px` touch targets (`src/ui/styles.ts`) and updated `docs/glossary.md` & `docs/wechat-html.md`.

## [0.1.6] - 2026-11-21

### Security
- **Custom CSS Remote Resource Bypass Hardening**: Stripped CSS comments and backslash newline continuations before URL sanitization (`src/domain/custom-css.ts`), and added post-`var()` external `url()` blocking inside the CSS inliner (`src/css-inliner.ts`) so remote tracking URLs cannot be smuggled through CSS custom properties or split tokens.
- **Host Desktop Origin Allowlist**: Restricted non-HTTP(S) `Origin` headers on the local asset and AI routes (`host/http/routes.ts`, `host/http/ai-route.ts`) to explicit desktop shell schemes (`dsh-app:`, `dsh:`, `app:`, `file:`) instead of accepting arbitrary custom protocols.

### Fixed
- **Binary Image SHA-256 Hashing & Atomic Store Concurrency**: Fixed `ImageHostService` (`host/application/image-store.ts`) to hash raw PNG/JPEG `Buffer` bytes directly rather than UTF-8-corrupted strings, added random temp suffixes, cloned manifests immutably, and serialized all file writes/deletes through the manifest queue.
- **Drag-and-Drop `.md` Safety & Autosave Race Protection**: Dropping a `.md`/`.txt` file onto the editor (`src/app.ts`) now detaches any previously linked local file handle, resets active AI review state, and guards against article switches across async reads; debounced autosave tracks `(articleId, markdown)`, cancels cleanly on detach/switch, and syncs linked folder `assets/`.
- **Asset GC, Workspace & Archive Reliability**: Expanded `assetFilesInMarkdown` (`src/domain/images.ts`) to detect titled Markdown links, `./assets/`, `<img>`, and local server URLs; protected import-recovery snapshots, undo/redo history, and in-flight uploads from garbage collection; switched workspace open-file checks to async `isSameEntry` and blocked `.`/`..`; reconciled cross-`docs`/`trash` merge conflicts while guaranteeing non-empty `docs` after merge; and ensured switching articles preserves `updatedAt`.
- **Markdown Parser & CSS Inliner Edge Cases**: Fixed apostrophes/parentheses/currency inside table cells, currency `$100`/`$50` mixed with `$x+1$` formulas, intraword `C++17`/`a==1` guards with suffixed `==API==s`/`++UI++s`, nested `***` emphasis (`**a ***b*** c**`, `**bold and *italic***`, `**foo***`), apostrophes in link URLs, single-line editorial directives (`:::lead ...`) inside `:::scroll`, blockquote fenced code tracking, CSS `[attr$="..."]` selector splitting, `:is()`/`:not()`/`:where()` specificity, element-scoped CSS variables, and explicit `codeTheme` overriding custom theme `pre` colors.
- **Mermaid Concurrency & Dark Preview Lifecycle**: Fixed overlapping `ensure()` calls in `useMermaidAssets` so Mermaid diagrams never get stuck in `'loading'`; added CSS Color 4 `color(srgb ...)` parsing, `Darkmode.reset([])` cleanup with `data-plugin="dsh-markdown-studio"` tagging for leak-free repeated light/dark toggling, and full-width preview stage background alignment.
- **UI, Accessibility, Shortcuts & Mobile Polish**:
  - Preserved AI word-diff colors and strikethrough inside immersive writing mode; restored editor focus after accepting/rejecting AI patches so immediate `⌘/Ctrl + Z` undo works.
  - Raised WCAG 2 AA contrast for dark-mode danger confirmation buttons (`#dc2626`), `<del>` inside `:::tldr`/`blockquote` across all 8 built-in themes, and library search highlights/metadata.
  - Eliminated compact-viewport clipping in the Skill Manager dialog (`720×680`), corrected the draft chip label (`新 Skill` / `Draft`), prevented search bar and outline/slash overlap, kept mobile (`<= 720px`) CSS Workbench drafts intact across preview toggles, increased mobile touch header/toolbar heights, added `Shift+Tab` outdent and shortcut modifier guards (`Ctrl+Tab`, `Shift+⌘/Ctrl+I`), made Settings Drawer tabs controlled, added workspace tree `ArrowLeft`/`ArrowRight` collapse/expand, started fresh documents scrolled at the top, and localized the cold-boot shell loading/error states.

## [0.1.5] - 2026-11-20

### Added
- **Native TeX Math Delimiter Compatibility (`\(...\)` & `\[...\]`)**: The Markdown parser now natively renders standard LaTeX inline `\(...\)` and single-line/multiline display `\[...\]` math alongside `$...$` and `$$...$$` — matching DeepSeek Harness host chat rendering with zero extra UI and zero mutation of user source (while editor shortcuts and slash commands continue to insert portable `$...$` / `$$...$$`). Code blocks, inline code, escaped backslashes (`\\(...\\)`), single-escaped brackets (`\[note]`), empty delimiters, and unclosed delimiters remain untouched.

## [0.1.4] - 2026-11-20

### Fixed
- **Mermaid Error Node Leak**: Failed Mermaid renders (for example, incomplete syntax while typing a diagram) no longer leave Mermaid's temporary `#d<id>` "Syntax error" containers attached to `document.body`; every render now uses a unique id and removes its temporary node in a `finally` block, keeping hot enable/disable free of leaked DOM.
- **Immersive Mode Find & Replace Overlap**: In immersive writing mode, the `⌘/Ctrl + F` find & replace bar now reserves space for the floating immersive dock so the Next / Replace / Replace all / Close buttons are never covered.
- **Friendly AI Error When No API Key Is Configured**: Raw host failures such as `llm-deepseek: no API key for provider route …` (and `401 Unauthorized`) are mapped to a localized "No model API key is configured" message, and AI errors are shown once in the inline review card instead of being repeated in a toast and a banner.

## [0.1.3] - 2026-11-20

### Fixed
- **macOS Shortcut Labels in Chromium & DeepSeek Harness**: Matched `navigator.userAgentData.platform` case-insensitively (`"macOS"`) and checked the host `<html data-platform="darwin">` attribute so macOS users consistently see `⌘ / ⇧ / ⌥` shortcut glyphs across menus, tooltips, the Skill Manager, CSS Workbench, and Help drawer instead of Windows `Ctrl+` labels.
- **Unclipped Fallback Format Dropdown Menu**: Positioned fallback menus with `position: fixed` viewport anchoring (`FallbackMenu`) so the 5-group **Format** dropdown inside the horizontally scrollable editor toolbar renders in full without being clipped to the `40px` toolbar height.
- **Dark Mode Preview Card Border Bleed**: Synchronized the outer `.mdstudio-device` container background color with the inner dark preview canvas (`#191919` / `#0e1013` and resolved `mp-darkmode` surface) so rounded Retina edges no longer leak a white hairline halo in host dark mode.
- **Mobile Narrow-Screen Toolbar Scroll Affordance**: Added a subtle right-edge fade overlay and trailing padding on `<= 720px` viewports to visually indicate horizontal scrolling for off-screen editor toolbar buttons without affecting desktop layouts or menu popovers.

## [0.1.2] - 2026-11-20

### Fixed & Changed
- **Inline Code Toolbar Button Consistency**: Clicking the `</>` (**Inline code · `⌘/Ctrl + E`**) toolbar button with an empty cursor or single-line selection now consistently inserts inline `` `...` `` backticks (reserving fenced code blocks for multi-line selections or the dedicated **Code block · `⌘/Ctrl + Alt + C`** action).
- **Footnote & External Link Marker Disambiguation**: When an article uses both Markdown footnotes (`[^id]`) and WeChat external link reference footnotes (`linkFootnotes`), author footnotes automatically disambiguate as `[注1]` (`zh`) / `[n1]` (`en`) instead of colliding with external link `[1]` superscripts.
- **Document Library Modal Reopen Reset**: Reopening the **Library** modal from the top bar now resets cleanly to the **Articles** tab and clears stale search queries instead of remaining on an emptied **Trash** view from a previous session.
- **Toast Placement & Collapsible Workspace Folders**: Anchored fallback status/error toasts at the bottom of the workspace (`pointer-events: none`) so they never overlap editor sub-toolbar conflict actions, and added expandable/collapsible folder carets (`∨` / `>`) in the local folder workspace tree.

## [0.1.1] - 2026-11-20

Initial public release.

### Added
- **Local-First Markdown Studio & 5-Bundle Lazy Architecture for DeepSeek Harness**:
  - `4.2 KiB` (`2.1 KiB` gzip) cold-boot client shell (`dist/client.js`) that loads the full Studio runtime (`dist/client.studio.js`) via official `require.async`, plus on-demand MathJax 3 (`dist/math.js`) and Mermaid 11 (`dist/mermaid.js`) chunks and reversible hot-disable stylesheet cleanup.
  - Split, Edit-only, and Preview-only modes with mobile (`414 px`) and desktop viewport simulation, bidirectional scroll sync, document outline, find & replace, `/` slash command menu, Format toolbar dropdown, Notion-style conflict-free shortcuts (`⌘/Ctrl + Shift + E` inline math, `⌘/Ctrl + Alt + Shift + E` math block, `⌘/Ctrl + Alt + 4` task list, `⌘/Ctrl + Alt + -` divider) with a built-in **Settings → Help** slash-command & shortcut reference, and distraction-free immersive mode (`⌘/Ctrl + Shift + F` to toggle, `Esc` to exit).
  - Native integration with `@deepseek-ai/dsh-client-ui-primitives` (`Modal`, `Button`, `Input`, `Checkbox`, `SegmentedTabs`, `Toast`, `Tooltip`, `Menu`) with complete bilingual (`zh` / `en`) localization across UI chrome, initial sample articles, slash snippet templates, rendered `References` / `TL;DR` headings, host/AI error diagnostics, and Plugin Manager detail pages (`docs/DETAIL.zh.md` / `docs/DETAIL.md`).
- **WeChat Official Account Inline-Style Copy Pipeline & Dark Mode Simulation**:
  - Deterministic CSS custom-property resolution and specificity-ordered inline style compilation into `<section id="mdstudio">`, stripping unsupported rules, materializing `::before`/`::after`, supporting editorial directives (`:::lead`, `:::tldr`, `:::pull`, `:::meta`, `:::sign`), standalone figure auto-captions, 5 GitHub Alert callout types (`NOTE`, `TIP`, `IMPORTANT`, `WARNING`, `CAUTION`), vertical/horizontal scroll containers (`:::scroll` / `:::scroll-x`), external URL reference footnotes, inline vector MathJax SVGs, and rasterized Mermaid diagrams.
  - Real-time WeChat Dark Mode simulation powered by official `mp-darkmode` when DeepSeek Harness is in dark theme, while keeping clipboard output isolated in the clean authored light palette (preserving dark-canvas themes on standalone `.html` export).
- **8 Full-Spectrum Built-in Editorial Themes + Dedicated Custom CSS Workbench**:
  - `Tone × Rhythm × Atoms` composable theme engine (`src/theme-system/`) with automatic WCAG 2 AA (`4.5:1`) body and code contrast convergence across 8 distinct presets: 经典 Classic (`classic`), 画廊 Gallery (`gallery`), 新知 Insight (`tech`), 森系 Botanical (`warm`), 黑金 Noir Gold (`night`), 文集 Anthology (`ink`), 简报 Briefing (`ruby`), and 海报 Poster (`poster`), plus theme-linked `Follow theme` code surfaces and 8 independent code block highlight palettes.
  - Dedicated left-pane **Custom CSS Workbench** (**New theme**) to author, switch, rename, import/export, and delete multiple named CSS themes with live preview and automatic miniature color swatches inside the Theme presets grid.
- **Custom Writing Skills & Inline Red/Green Diff**:
  - Create, import, and export standard `SKILL.md` Writing Skills via the Writing Skill Manager; ships with the MIT-licensed `op7418/Humanizer-zh` ruleset as a ready-to-use preset.
  - Floating selection pill (`⌘/Ctrl + J`) that runs the active Writing Skill through the host's configured LLM service (`POST /api/markdown-studio/ai`) and streams a CodeMirror 6 word-level red/green inline diff (`Tab` to accept, `Esc` to reject) with Markdown syntax-loss guards, automatic fence unwrapping, and strict clipboard isolation prior to acceptance.
- **Content-Addressed Local Asset Server, Data Integrity & Document Library**:
  - Host-side content-addressed PNG/JPEG store (`$DSH_HOME/storages/dsh-markdown-studio/assets/`) with magic-byte validation, authenticated write routes, automatic reference-counted garbage collection on permanent article deletion, and a read-only loopback server (`127.0.0.1:4010-4019`) so Markdown stays portable as `assets/<hash>.png`.
  - Multi-article `localStorage` library with no artificial article/trash limits, future-schema overwrite protection, unreadable-payload preservation, keyword-highlighted search, conflict-aware merge dialog, `PK` magic-header `.zip` archive import/export (`4096` entries / `256 MiB` bounded decompression), and SHA-256 baseline conflict detection for local File System Access API `.md` / folder workspaces.

[0.1.8]: https://github.com/Geekhyt/dsh-markdown-studio/compare/v0.1.7...v0.1.8
[0.1.7]: https://github.com/Geekhyt/dsh-markdown-studio/compare/v0.1.6...v0.1.7
[0.1.6]: https://github.com/Geekhyt/dsh-markdown-studio/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/Geekhyt/dsh-markdown-studio/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/Geekhyt/dsh-markdown-studio/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/Geekhyt/dsh-markdown-studio/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/Geekhyt/dsh-markdown-studio/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/Geekhyt/dsh-markdown-studio/releases/tag/v0.1.1

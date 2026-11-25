# Changelog

All notable changes to `dsh-markdown-studio` are documented in this file.

## [0.1.19] - 2026-11-25

### Fixed
- **CSS Syntax L3 & Mermaid 11 YAML Lexical Security Hardening (`G1`, P0)**:
  - Upgraded `stripCssComments` in `src/domain/custom-css.ts` to replace CSS comments with single spaces by default (blocking `red/**/url(...)` token-merge bypasses), consume unclosed `/*` comments to EOF (preserving downstream `codeTheme` styles in `src/themes.ts` even when external CSS resources are enabled), strip escape-aware quoted strings before `@import` detection (`content: "\\"`), check both space- and collapsed-comment forms (`u/*x*/rl()`), and skip comments in `formatCssSource`.
  - Replaced regex `img:` filtering in `src/mermaid-entry.ts` with a YAML-aware node metadata directive parser handling double/single-quoted keys (`"img"`, `'img'`), YAML tags/anchors (`!!str img`), `#` comments inside braces, and explicit `? img` keys, eliminating outbound Mermaid 11 SSRF requests (`2 → 0 hits`) in both standalone Chromium and real DeepSeek Harness, and fixed `prependMermaidDirective` frontmatter ordering with trailing whitespace on closing `---`.
- **Real DeepSeek Harness Prefix Route Contract, RFC 9110 Security & Optimistic Asset Concurrency (`G2`, P0)**:
  - Fixed `index.ts` registering the Cordis `webServer` asset prefix route with a trailing slash (`/api/markdown-studio/assets/`), which caused real DeepSeek Harness `GET`/`HEAD` requests to fail with `404` (`pathname.startsWith(prefix + '/')`); real DSH asset routes now return `200 OK`, wired with transactional `AbortController` hot-disable cleanup across `index.ts`, `host/http/ai-route.ts`, and `host/local-server.ts`.
  - Tightened `host/http/routes.ts` to strict RFC 9110 loopback `Host` + port range (`1..65535`) and exact `parsed.origin` checks (blocking userinfo smuggling like `http://attacker@127.0.0.1`), added macOS Darwin (`hostOS=19`) symlink rejection in `src/adapters/zip.ts`, and threaded `expectedStoredAt` optimistic concurrency locks end-to-end across `host/application/image-store.ts`, `src/adapters/host-client.ts`, and `src/application/asset-gc.ts`.
  - Required HTTP/status context for AI auth/rate-limit classification (preventing `"worker failed at line 401"` false positives), scrubbed upstream provider error text in `host/application/ai-service.ts`, and localized `HOST_BAD_RESPONSE` / `RATE_LIMIT` / malformed NDJSON errors in `src/adapters/ai-client.ts` & `src/locales/ui-strings.ts`.
- **Cross-Tab Local Disk Protection, Field-Level Dirty Merge & Workspace Flush Ordering (`G3`, P0)**:
  - Modeled `EXTERNAL_STORAGE_SYNC` in `src/domain/file-session.machine.ts` (verified via exhaustive BFS) and updated `src/app.ts` to immediately detach linked local file handles and disarm autosave when another tab updates shared `localStorage` markdown, preventing sibling tabs from silently overwriting local `.md` disk files.
  - Upgraded `src/application/document-store.ts` with field-level dirty tracking (`title` / `markdown` / `settings` / `view`) and per-theme `pendingThemeIntents` (`upsert` / `delete`) so toggling view never clobbers sibling markdown edits and simultaneous custom themes merge cleanly.
  - Added `flushBeforeOpen` to `src/application/use-workspace.ts` so re-opening the currently dirty file flushes V2 to disk before calling `handle.getFile()`, preventing V2 → V1 reverts.
- **Engine Linear-Time Performance, WeChat DOM Validity & Dark-Root Code Theme Adaptation (`G4`)**:
  - Eliminated ReDoS/quadratic paths in `src/css-inliner.ts` (`evaluatePseudoContent` `77.7ms → 8.5ms`), `src/markdown-parser.ts` (`buildBracketMatchMap` + failure caching: `***a` `574.9ms → 15.7ms`, `[a` `149.5ms → 2.4ms`), and `src/domain/images.ts` (`<img ` linear scanner + code-fence masking); fixed `var()` depth/cycle leak prevention, sibling custom properties, repeated root-alias folding, attribute-selector specificity, `==url==` delimiter parity, 2-space nested lists across blank lines, and `$$` block link-def isolation.
  - Upgraded `src/adapters/wechat-clipboard-dom.ts` to downgrade `<section>` inside `<h1>..<h6>` to `inline-block` `<span>` and recursively lift `<section>` out of inline phrasing containers (`0` invalid nested sections).
  - Updated `src/adapters/dark-preview.ts` to run `finalizeDarkRoot(root)` even on natively dark themes (e.g., Night + GitHub Light codeTheme, adapting blinding white `lum=0.97` code blocks to `lum=0.22`), and moved `CssWorkbench` `Mod+S` handling to the container level.
- **Editor Escape LIFO, CJK Two-Stage Diff, Unicode Highlight, Short/Touch Layout & Safe Dialog Focus (`G5`)**:
  - Filtered `'Escape'` out of CodeMirror `defaultKeymap` (`src/ui/codemirror-core.ts`) so active selections never hijack 1st `Escape` from Outline or Immersive Write while keeping selections intact.
  - Implemented two-stage clause-LCS + word-level diff refinement in `src/domain/text-diff.ts` (`addRatio` on 600-char CJK edits `1.00 → 0.01`), replaced `toLowerCase().indexOf()` in `src/ui/library-dialogs.ts` with length-preserving RegExp `"i"` (zero `+1` offset drift after Turkish `İ`), fixed short-viewport `SlashMenu` clamping (`src/domain/surface-geometry.ts`), synced first narrow `split → preview` scroll (`src/app.ts`), eliminated phantom `160px` macOS traffic-light clearance on `736px` `pointer: coarse` tablets (`src/adapters/host-shell.ts`), focused safe `Cancel` on destructive confirm dialogs with visible focus restoration on `Escape` (`src/ui/dialog-host.ts`, `src/ui/dsh-primitives.ts`), added localized `ai.inlineCardLabel`, and unified `SkillManagerDialog` `Mod+S` with `!canSaveDraft`.

### Changed & Permanent Regression Gates
- Codified post-review anti-blindspot discipline into `AGENTS.md`, `.agents/skills/bug-to-rule/SKILL.md`, and `.agents/skills/verify-state-machines/SKILL.md` (external oracles over self-oracles, cross-subsystem seam audits, single canonical guards, and semantic/combinatorial assertions).
- Added permanent AST gates in `test/architecture.test.ts` (Cordis prefix trailing-slash ban, CodeMirror `Escape` hijack ban, danger confirm `Cancel` focus guard, `SkillManagerDialog` single-guard `Mod+S`, and `src/ui/` `toLowerCase().indexOf()` slice ban), semantic CJK diff precision oracle (`addRatio < 0.15`) in `test/fuzz-and-perf.test.ts`, and 7 real-Chromium external-oracle & extreme-matrix gates in `test/browser-smoke.ts` plus real DSH `/api/markdown-studio/assets/*` `200 OK` checks in `test/dsh-e2e.ts`.

### Verification & Regression Gates
- Passed 24/24 live BEFORE→AFTER audit probes (`0/24 → 24/24`, 16 annotated visual comparison pairs across standalone Chromium and real DeepSeek Harness).
- All release gates passed locally: `format` / `lint` / `typecheck` (170 files, 0 issues), `verify:models` (52,220 Overlay + 525,000 FileSession transitions + 128-state AssetGC), `test:fuzz`, `quality` (`>= 94%` statements / `>= 89%` branches / `>= 96%` functions; `0` AST functions `> CRAP 30`; 5/5 raw+gzip budgets with `dist/client.js` `5.9 / 2.7 KiB`), `mutation` (42/42 killed), `licenses:check`, `check:host-api`, `test:browser`, and `test:dsh`.

## [0.1.18] - 2026-11-24

### Changed & Refactored
- **Runtime Overlay Reducer & Unified Keyboard/Escape Router (Phase A)**:
  - Promoted `src/domain/studio-overlay.machine.ts` from a verification-only model into the real runtime `StudioShellState` / `reduceStudioShellState` reducer and single LIFO `resolveStudioEscape` priority ladder shared between production and exhaustive BFS verification.
  - Replaced 9 scattered overlay `useState` hooks in `src/app.ts` and 5 scattered global `keydown` listeners across `src/app.ts`, `src/ui/editor-pane.ts`, and `src/ui/immersive-dock.ts` with the single authoritative `useStudioKeyboard` router (`src/application/use-studio-keyboard.ts`), supporting plugin-owned portaled menus (`document.body`), Outline/AI-pill global shortcuts, universal `stopPropagation()` on handled Escapes, and strict external DeepSeek Harness host isolation.
- **Deterministic CSS Cascade Order & Native 1×1 Canvas CSS Color 4/5 Dark Preview (Phase B)**:
  - Reordered `src/ui/styles.ts` into strictly descending `@container mdstudio (max-width)` breakpoints → `@media (max-width: 720px)` → `@media (pointer: coarse)` → `@media (prefers-reduced-motion: reduce)` with an automated AST order gate in `test/architecture.test.ts`, fixing narrow touch copy-button shrinkage (`32×30px → 44×44px`), standalone mobile toolbar vertical overflow (`42/39px → 49/49px`), and `is-settings`/`<=960px` shorthand padding collisions.
  - Added a cached browser-native 1×1 `<canvas>` sRGB resolver in `src/adapters/dark-preview.ts` covering all CSS Color 4/5 syntax (`lch`, `lab`, `oklch`, `oklab`, `hwb`, `display-p3`, `color-mix`, relative colors) with O(1) fast paths for opaque `rgb()`/`#hex`, anchored regexes immune to nested `color-mix(..., rgba(...))` misparsing, and pure JS fallback for non-canvas JSDOM.
- **Monotonic Revision (`rev`) & Single Exclusive `pendingIntents` Multi-Tab Sync (Phase C)**:
  - Added backward-compatible optional monotonic `rev?: number` to `Article` (`src/domain/article.ts`, `src/adapters/storage.ts`) and replaced overlapping `dirtyDocIds` / `pendingDeletedIds` / `pendingPurgedIds` Sets in `src/application/document-store.ts` with a single exclusive `pendingIntents: Map<string, 'live' | 'trashed' | 'purged'>` plus structural `sameCustomThemes` comparison.
  - Eliminated a latent data-loss bug where `restore(id)` followed by `flush()` dropped restored articles during pre-write disk merge, fixed ID-collision restore purging live articles, preserved live custom-theme edits ahead of stale trashed snapshots, stopped cloned `sanitizeSettings()` arrays from overwriting sibling tabs' new custom themes, and cleared `pendingActiveSwitch` when remote tabs delete the switched-to doc.

### Fixed
- **CSS Syntax Level 3 Lexer, Inliner & Formatting Hardening (`G1`, P0)**:
  - Added shared `preprocessCssInput()` (`\r\n`/`\r`/`\f → \n`, `NUL → U+FFFD`) across `src/domain/custom-css.ts`, `src/css-inliner.ts`, and `src/themes.ts` to close CSS form-feed (`\f`) sanitizer bypasses; converted CSS counters to `Object.create(null)`; upgraded rule/declaration/formatter splitting to be quote- and escape-aware; preserved fallback declarations and stylesheet `!important` shorthand precedence; and fixed `:is(:nth-child)` specificity.
- **Mermaid 11 SSRF, Host Cross-Site & Asset Storage Security (`G2`, P0)**:
  - Added quote- and brace-balanced `stripMermaidImageDirectives()` in `src/mermaid-entry.ts` plus DOM-level SVG sanitization (`src/mermaid-entry.ts`, `src/math-entry.ts`), blocking Mermaid 11 `@{ img }` outbound HTTP requests (`1 → 0`) in standalone and real DeepSeek Harness hosts.
  - Enforced universal `Sec-Fetch-Site: cross-site` rejection across `file:` / `http:` / `https:` while preserving trusted Electron desktop protocols (`dsh-app://`, `dsh://`, `app://`) and `:80`/`:443` Host normalization in `host/http/routes.ts`; hardened local asset reads with `lstat` + `O_NOFOLLOW` in `host/application/image-store.ts`; rejected control-character URLs in `src/domain/urls.ts`; and made host/client lifecycle registration transactional (`index.ts`, `src/shell-entry.ts`).
- **Markdown Engine Performance (`71.5×`), AssetGC, WeChat DOM & WCAG AA Contrast (`G3`)**:
  - Added linear-time forward delimiter caching in `src/markdown-parser.ts` (10k pathological unclosed `*` `386ms → 5.4ms`), null-prototype HTML entity lookup, math/code isolation, bare URL trailing `==`/`++` protection, and multi-level nested list / YAML frontmatter fixes.
  - Fixed `scanInlineImages` (`src/domain/images.ts`) to continue scanning real assets past unbalanced `![` tokens so AssetGC and backup exports never miss downstream images.
  - Hardened `src/adapters/wechat-clipboard-dom.ts` and `src/domain/wechat-html-lint.ts` (Base64 copy placeholders, recursive `p > strong > section` unwrapping, `<ol start>` preservation, loose list trailing-prose order, and stack-based nested list linting) and guaranteed WCAG AA `>= 4.5:1` contrast for mid-luminance `onAccent` (`#797979`: `4.82:1`) and nested `==~~del~~==` / `==[link]==` (`13.44:1`) in `src/theme-system/compose.ts`.
- **Editor Ergonomics, Writing Skills, Search & UI/A11y Polish (`G4`–`G6`)**:
  - Preserved trailing Chinese paragraph text when invoking `/` SlashMenu (`src/application/use-slash-menu.ts`); fixed symmetric double-press Bold/Italic toggling (`src/application/editor-formatting.ts`); added W3C `AltGraph` modifier guards (`src/application/editor-shortcuts.ts`); added AI patch overlap/URL-hallucination guards, YAML block scalars, and HTTP 401/403/429 classification (`src/domain/writing-skills.ts`, `src/adapters/ai-client.ts`); and fixed Unicode (`İ`) case-folding search snippet offsets (`src/domain/library-search.ts`).
  - Fixed `FallbackModal` header horizontal layout, dark CodeMirror `.cm-selectionMatch` contrast (`3.92:1 → 12.47:1`), Immersive Write AI error banner dock clearance, 360px `WorkspaceDialog` two-row header & Chinese confirmation punctuation, `SkillManagerDialog` frontmatter-derived Save enablement, 360px macOS frameless titlebar width (`14px → 65px`), `LibraryDialog` keyboard-accessible row actions, `FallbackMenu` `ArrowUp` focus wrap, and caret-safe top-obstacle `SlashMenu` height clamping.

### Verification & Regression Gates
- Passed 36/36 live BEFORE→AFTER probes (Core 12/12 + Standalone Chromium 18/18 + Real DeepSeek Harness 6/6; 22 real BEFORE/AFTER screenshot pairs) and two full rounds of adversarial regression reviews (35 intercepted fixes).
- All permanent CI gates passed on the release tree: `format` / `lint` / `typecheck` (170 files, 0 issues), `verify:models` (1,492 Overlay + 25,000 FileSession states), `test:fuzz` (500 MD/CSS fuzz + ReDoS), `quality` (94.92% statements / 89.44% branches / 96.24% functions; all 2,494 runtime AST functions `CRAP <= 30`; all 5 raw+gzip budgets passed with `dist/client.js` `5.2 / 2.4 KiB` and `dist/client.studio.js` `1185.8 / 364.9 KiB`), `mutation` (36/36 killed), `check:host-api`, `licenses:check` (81 packages), `test:browser` (pixel baseline + axe 0 serious), and `test:dsh`.

## [0.1.17] - 2026-11-23

### Fixed
- **Handle-Identity Workspace FileSystem Operations (`G1`, P0)**:
  - Replaced string-based case-only rename heuristics in `src/application/use-workspace.ts` with `FileSystemHandle.isSameEntry` / `resolve` handle-identity checks and atomic two-hop temp renames (`renameFileTwoHop`, `renameDirectoryTwoHop`), preventing case-only directory renames on macOS APFS/Windows from erasing folders and preventing case-sensitive Linux ext4 sibling overwrites.
  - Hardened `moveEntry` with handle-level `isDescendantHandle` checks (blocking case-variant self/descendant moves) and aborted partial writables cleanly on error in `copyFileSafe` and `src/application/folder-assets.ts`.
- **Single Canonical Host Loopback & Origin Security Boundary (`G2`, P0)**:
  - Consolidated `isLoopbackHostHeader`, `isLoopbackReq`, and `isAllowedOrigin` in `host/http/routes.ts` and removed drifted duplicate parsers from `host/http/ai-route.ts` and `host/local-server.ts`, rejecting empty `Host` headers as well as userinfo/path-forged `Host` headers across every host route.
  - Preserved empty bodies for `HEAD` 404 responses on `createAssetRoute`.
- **Quote-Aware CSS Lexer, Container-Class Specificity Parity & URL Hardening (`G3`, P0)**:
  - Replaced naive `/* ... */` regexes with shared quote-aware `stripCssComments` across `src/domain/custom-css.ts`, `src/css-inliner.ts`, and `src/themes.ts` (blocking `--a:"/*" --b:url(...) --c:"*/"` external resource smuggling while preserving quoted `content: "/* "` / `" */"`).
  - Computed CSS selector specificity using container-class equivalent `.mdstudio-content` (`0,1,0`) for `:root`/`html`/`body` before DOM rewriting to `#mdstudio` so custom `body` / `body p` rules still override built-in `.mdstudio-content` / `.mdstudio-content p` by source order without inflating to `#mdstudio p` (`1,0,1`) and clobbering `.mdstudio-alert-warning .mdstudio-alert-title` or `.mdstudio-pull p`.
  - Scoped `stripStatementAtRules` to top-level brace depth, skipped quoted strings in `findNextVarCall`, guarded `var()` lookups with `Object.hasOwn`, and rejected control-character-injected URL schemes (e.g. `ht\ttp://`) in `src/domain/urls.ts`.
- **Dark-Mode Contrast, `BrandMark` Tokens & High-Contrast Toast Icons (`G4`)**:
  - Updated `src/adapters/dark-preview.ts` to lift contrast on every `<li>` and darkened surface, raising dark-preview `li::marker` contrast on loose/bold/code/link list items from `1.03:1` to `>= 4.63:1` across all themes (verified in both standalone Chromium and real DeepSeek Harness).
  - Added dedicated dark-surface toast icon tokens (`--mdstudio-ui-toast-success/info/error`) in `src/ui/styles.ts` (lifting light-mode toast icon contrast from `2.44:1` to `12.4:1`), bound `BrandMark` (`src/ui/brand-mark.ts`) to dark-aware UI surface tokens, and removed `data_color_scheme_dark` from `document.documentElement` on hot disable in `src/ui/style-lifecycle.ts`.
- **Markdown Engine & WeChat Clipboard DOM Correctness (`G5`)**:
  - Unified strict YAML frontmatter validation (`parseFrontmatterBlock`) across `src/domain/article.ts` and `src/markdown-parser.ts` so leading `---` horizontal rules never swallow article bodies; fixed multi-paragraph `:::pull` empty `<p>` artifacts and centered `.mdstudio-pull p` (`src/theme-system/core.ts`); fixed CJK-adjacent & uppercase `HTTPS://` bare URLs, `ctx.inLink` nested `<a>` guard, emphasis spanning links containing `==`/`++`, `normalizeLabel` preserving literal `C++`, `readingTime: false` alongside `category`, and tab-indented nested lists.
  - Updated `src/adapters/wechat-clipboard-dom.ts` to split mixed regular+task `<ul>` into contiguous `<ul>` and `<section class="mdstudio-task-list">` runs, convert nested task lists, and keep lists inside `<blockquote>`/`<td>` inside their containers.
  - Updated `src/adapters/render-article.ts` to emit `inline-block` `<span>` placeholders for inline missing local images (preserving `<section>` in block/figure contexts) and fall back to raw TeX text when `__MDSTUDIO_MATH__` is unavailable.
- **Tombstone Multi-Tab Persistence, File-Reload Guard & Archive/Client Hardening (`G6`, P0)**:
  - Replaced coarse `structuralDirty` with explicit `MergeTombstones` (`pendingDeletedIds`, `pendingPurgedIds`, `pendingEmptyTrash`, `pendingCustomThemes`, `pendingReplace`) and `isDocDirty(id)` in `src/application/document-store.ts`, re-unified shared `customThemes` across docs in `src/adapters/storage.ts`, and checked both `docs` and `trash` during backup ID deduplication (`src/domain/library-backup.ts`).
  - Added `suppressAutosaveRef` around linked local file reloads in `src/app.ts`, `Object.hasOwn` error-code lookups + NDJSON `content-type` validation in `src/adapters/ai-client.ts` & `src/adapters/host-client.ts`, single-flight / unmount-safe streaming archive import in `src/application/use-library-archive.ts`, and 24-theme-cap dangling-theme cleanup in `src/application/article-exporter.ts`.
- **CodeMirror GFM Optimization (`-118 KiB`), Linear `O(n)` Image Scanner & Editor Polish (`G7`)**:
  - Switched `src/ui/codemirror-core.ts` to direct `new LanguageSupport(markdownLanguage, [pasteURLAsLink, Prec.high(keymap.of(markdownKeymap))])`, restoring GFM table `.cm-md-mono-line` monospace alignment while eliminating ~106 KiB of unused `@codemirror/lang-html` / `@lezer/javascript` parser tables (`dist/client.studio.js`: `1273.4 KiB → 1155.3 KiB`, `gzip 354.9 KiB`).
  - Replaced quadratic image scans in `src/domain/images.ts` with strictly linear `O(n)` scanning (300×–2800× speedup on pathological unclosed syntax).
  - Normalized CRLF line endings at history/editor ingress (`src/application/use-document-history.ts`, `src/app.ts`) restoring AI Writing Skill diffs on Windows `.md` files; buffered IME composition frames with `compositionend` & immediate-`undo()` flushing; fixed inner caret placement for `insertFencedBlock` / `insertAlert` / `insertHr` and consecutive multi-line ordered numbering (`src/application/editor-formatting.ts`); fixed Unicode case-folding (`İ`) search/replace offsets (`src/application/editor-search.ts`); prevented `SlashMenu` undo re-pop and mid-token `/co|de` corruption (`src/application/use-slash-menu.ts`); fixed `Mermaid` ensure cache snapshot races (`src/application/use-mermaid-assets.ts`, `src/application/use-copy-actions.ts`); and persisted unchecking default custom skills (`src/application/use-writing-skills.ts`).
- **Fallback Primitive Guards, CSS Cascade Order & Mobile/Narrow Focus Polish (`G8`)**:
  - Moved base `.mdstudio-input`/`.mdstudio-select` declarations ahead of `.mdstudio-search-input` and `.mdstudio-css-name` in `src/ui/styles.ts`, bounded `.mdstudio-editor-stats` overflow, stacked `.mdstudio-conflict-row` on `<= 720px` viewports, and bounded modal `max-height: 100%`.
  - Guarded `FallbackModal` against drag-out text selection clicks on the scrim (while keeping synthetic `scrim.click()` compatible), trapped `Tab` inside `FallbackMenuPanel`, moved `FallbackTooltip` cleanup to `useMountDisposable` with delta re-alignment (`src/ui/dsh-primitives.ts`), added `is-danger` styling to Empty Trash (`src/ui/library-dialogs.ts`), and restored focus to visible controls on narrow `exitImmersive()` (`src/app.ts`).

### Verification & Regression Gates
- Verified 25/25 new live probes (Core 5 + Standalone Chromium 16 + real DeepSeek Harness 4) and 41/41 historical real-device component-composition regression probes with zero regressions.
- Expanded permanent gates across `test/architecture.test.ts`, `test/host.test.ts`, `test/custom-css.test.ts`, `test/fuzz-and-perf.test.ts`, `test/engine.test.ts`, `test/wechat-html.test.ts`, `test/dom.test.ts`, `test/document-store.test.ts`, `test/host-client.test.ts`, `test/file-session.test.ts`, `test/dsh-primitives.test.ts`, `test/shortcuts-regression.test.ts`, and `scripts/mutation-smoke.ts` (30/30 killed mutants, 95.14% statement coverage, all 2,355 runtime AST functions `CRAP <= 30`, `dist/client.studio.js` `1155.3 KiB` / `gzip 354.9 KiB`).

## [0.1.16] - 2026-11-23

### Fixed
- **Responsive Full-Screen `SettingsDrawer` State-Machine Model (`<= 720px`) (P0)**:
  - Extracted shared pure predicates `isFullscreenDrawer(drawerOpen, containerWidth)` and `shouldKeepDrawerOnNavigation(containerWidth)` in `src/domain/studio-overlay.machine.ts`, wired across `src/app.ts` and exhaustive BFS verification (`test/formal-models.test.ts`).
  - Narrow full-screen drawers (`<= 720px`) now automatically dismiss on view switches, new document creation, and document switches; `canFocusMarkdownEditor` / `canShowSelectionBubble` prevent the occluded background editor from stealing focus or showing floating bubbles; and `Escape` always dismisses the visible full-screen drawer even if background editor focus was active.
- **Host Shortcut Precedence for `Mod+Shift+F` Immersive Mode in Real DeepSeek Harness (P0)**:
  - Bound `Mod+Shift+F` on `document` bubble with an active `[aria-modal="true"], [role="dialog"]` host-dialog yield guard in `src/ui/immersive-dock.ts` (retaining `window` fallback and keeping `Escape` exit on `window` bubble to preserve LIFO ordering), preventing DeepSeek Harness host `window` listeners from swallowing `⌘/Ctrl+Shift+F`.
- **Short-Viewport Container Bounds for Editor Popovers & Flex-1 Scroll Surfaces**:
  - Bounded `.mdstudio-outline` and `.mdstudio-slash` height to `max-height: min(348px, calc(100% - 14px))` so short viewports never overlap `.mdstudio-editor-stats` or clip outside `.mdstudio-editor-wrap` (`src/ui/styles.ts`).
  - Replaced rigid positive pixel `min-height` rules (`320px / 280px / 260px / 200px`) with `min-height: 0` across flex-1 scroll surfaces (`.mdstudio-editor`, `.mdstudio-codemirror`, `.cm-editor`, `.cm-scroller`, `.mdstudio-stage`, `.mdstudio-css`, `.mdstudio-css-codemirror`) so short viewports with open `SearchBar` keep bottom lines and scrollbars fully reachable.
  - Collapsed secondary top clearance when `.mdstudio-file-banner` precedes `.mdstudio-searchbar` in narrow `Immersive Write` (`<= 720px` and host-titlebar `<= 920px`) via `.mdstudio-file-banner ~ .mdstudio-searchbar { padding-top: 6px; }`.
- **Unified Scroll Reset, Focus Handoff & Keyboard Re-Entry Ergonomics**:
  - Added monotonic `navSeq` to `SettingsDrawer` (`src/ui/settings-drawer.ts`, `src/app.ts`) so external re-entry (e.g., `More → Shortcuts` while scrolled down) resets `scrollTop = 0`, moves keyboard focus to the target tab, and dismisses transient editor popovers.
  - Reset scroll containers to `scrollTop = 0` on tab/query/entity changes in `LibraryDialog` (`.mdstudio-library-list`), `WorkspaceDialog` (`.mdstudio-workspace-body`), and `SkillManagerDialog` (`.mdstudio-skill-main`) via `useDebouncedKeyTask` (`src/ui/library-dialogs.ts`, `src/ui/skill-manager-dialog.ts`).
  - Narrowed the window `Escape` `inEditor` guard in `src/app.ts` to `.mdstudio-editor-pane:not(.mdstudio-css-workbench) .mdstudio-editor-wrap` so pressing `Escape` from Toolbar buttons or `CssWorkbench` inputs cleanly closes `SettingsDrawer` while preserving WCAG `Esc → Tab` inside the Markdown editor.
  - Updated `createEditorSearch.openSearch()` (`src/application/editor-search.ts`) to select existing query text on `Mod+F` re-entry for parity with `SearchBar`.
- **Dark-Mode Empty Stage Reconciliation & `FallbackTooltip` Precision / Lifecycle Hygiene**:
  - Reconciled `.mdstudio-stage` inline `backgroundColor` via `stageRef` in `usePreviewHtmlSurface` (`src/runtime/dom-surfaces.ts`, `src/ui/preview-pane.ts`) when the article surface unmounts/empties, clearing stale dark custom-theme stage backgrounds on document clear/new.
  - Fixed `FallbackTooltip` (`src/ui/dsh-primitives.ts`) to store the true anchor center for measured-width edge clamping, enforce global single-active tooltip exclusion (`dismissActiveTip`), gate `onFocus` tooltips behind W3C `:focus-visible` keyboard focus modality (eliminating phantom tooltips on mouse close), and clear stale `tip` state + global listeners immediately when `disabled` flips `true`.
- **End-to-End Preview & Editor Scroll Ratio Anchoring Across `CssWorkbench` Lifecycle**:
  - Generalized preview relayout scroll anchoring across theme/font/line-height changes and the full `CssWorkbench` lifecycle (opening, switching custom theme chips, live CSS edits, and closing) by pre-seeding target CSS atomically in `openCssWorkbench`, capturing ratio in `handleDraftCssChange`, and aligning `PreviewPane`'s `relayoutKey` with `deferredCssDraft` (`src/app.ts`, `src/runtime/dom-surfaces.ts`, `src/ui/preview-pane.ts`).
  - Added bidirectional `'restore'` scroll-sync locking, 8-frame CodeMirror 6 virtual-height convergence in `restoreEditorScroll`, and scroll-stable `focus()` (`src/application/use-scroll-sync.ts`, `src/ui/codemirror-core.ts`).
  - Added zero-warning build-time `CHROME_CSS` minification in `scripts/build.ts` (reclaiming ~8.8 KiB) and removed the duplicate `mdstudio-modal` class prefix in `src/ui/skill-manager-dialog.ts`.

### Verification & Regression Gates
- Added permanent regression gates in `test/formal-models.test.ts` (1,516 `StudioOverlayMachine` states / 48,512 transitions with full-screen drawer navigation & `Escape` liveness), `test/architecture.test.ts` (popover `min(..., calc(100% - ...))`, flex-1 `min-height: 0`, sibling banner collapse, `Mod+Shift+F` document bubble + dialog guard, `stageRef` cleanup, narrowed `inEditor` Escape guard, and `deferredCssDraft` `relayoutKey` alignment), `test/dsh-primitives.test.ts` (edge alignment, single-active exclusion, `:focus-visible` focus modality, and `disabled` flip hygiene), `test/app-dom.test.ts`, and `scripts/mutation-smoke.ts` (24/24 killed mutants).

## [0.1.15] - 2026-11-23

### Fixed
- **React 18 Portaled Menu Mouse-Click Survival Inside Floating `SkillSplitTrigger` (P0)**:
  - Unified portaled menu selectors into a single canonical `PORTALED_MENU_SELECTOR` (`.mdstudio-menu, .mdstudio-menu-scrim, [role="menu"], [data-menu-material]`) composed into both `EDITOR_OVERLAY_SELECTOR` and `BUBBLE_INTERACTIVE_SELECTOR` (`src/ui/selection-bubble.ts`). Prevents React 18 synthetic `onMouseDownCapture` on `.mdstudio-editor-wrap` from clearing `SelectionBubble` and unmounting floating skill dropdown menus (both native DeepSeek Harness `Menu` and `FallbackMenu`) before `click` fires.
  - Modeled `OPEN_PARENT_MODAL` (`'skills'`) during `immersive === 'write'` in `src/domain/studio-overlay.machine.ts` so `SkillManagerDialog` × `Immersive Write` interleavings and LIFO `Escape` convergence are verified exhaustively.
- **`CssWorkbench` View-Switch & Container-Resize State-Machine Invariants**:
  - Updated `shouldKeepCssWorkbenchOnViewChange` (`nextView === 'split' || containerWidth <= 720`) and `shouldRestoreSplitOnResize` (`view !== 'split' && containerWidth > 720`) in `src/domain/studio-overlay.machine.ts` so clicking the already-active `Split` button never wipes unsaved CSS drafts, and widening past `720px` from narrow mobile `edit` mode automatically restores side-by-side live preview.
- **Editor Floating Popover Mutual Exclusion (`Outline` × `SelectionBubble` × `FormatMenu`)**:
  - Extracted shared pure predicate `canShowSelectionBubble(...)` (`src/domain/studio-overlay.machine.ts`) wired into both formal BFS (`effectiveBubbleVisible`) and `src/app.ts`, suppressing floating `SelectionBubble` while `Outline`, `SlashMenu`, `HeaderMenu`, modals, or AI review sessions are active; also closes `Outline` when opening `FormatMenu` (`src/ui/editor-pane.ts`).
- **Universal Visible Focus Restoration (`SettingsDrawer` & Immersive Modals)**:
  - Added cross-browser/JSDOM `isElementVisible()` (excluding `document.body`, `document.documentElement`, detached nodes, and hidden/disabled ancestors) and `resolveSafeFocusTarget()` in `src/runtime/dom-surfaces.ts`, wired across `SettingsDrawer` (`src/ui/settings-drawer.ts`), `FallbackModal` (`src/ui/dsh-primitives.ts`), and dialog trigger focus handoff (`src/app.ts`). Closing `SettingsDrawer` opened from `More Menu → Shortcuts` restores focus to the visible `More` trigger instead of `document.body`, and closing `SkillManagerDialog` in `Immersive Write` restores focus directly to the active editor instead of hidden header chrome.
- **CodeMirror Minimal Prefix/Suffix Diff on `setValue`**:
  - Added pure O(N) `computeMinimalChange(current, next)` in `src/ui/codemirror-core.ts` so normalization updates (such as `CssWorkbench` `⌘/Ctrl+S` trimming trailing newlines, cross-tab sync, and reloads) dispatch only the minimal changed slice instead of replacing `[0, length]`, preventing mid-file carets from teleporting back to line 1 offset 0.
- **Preview `Mobile ↔ PC` Ratio-Preserving Scroll Anchor**:
  - Added `capturePreviewRatio()` and `applyCapturedPreviewRatio()` in `src/application/use-scroll-sync.ts` triggered synchronously before paint via `usePreviewRelayoutSync` (`useLayoutEffect` in `src/runtime/dom-surfaces.ts`, `src/ui/preview-pane.ts`, `src/app.ts`), preserving exact reading ratio (`0.000` drift) across `Mobile ↔ PC` width changes without yanking the editor via bidirectional scroll sync.
- **Unified Body-Portal Fallback Layer, Dedicated File-Conflict Banner & Responsive Polish**:
  - Routed `FallbackModal` and `FallbackToast` through `portalOverlay()` (`src/ui/dsh-primitives.ts`) alongside `FallbackMenu` and `FallbackTooltip` so all 4 fixed fallback overlays escape host stacking contexts cleanly.
  - Promoted linked local file conflict and reauthorize actions out of the horizontally scrolling `.mdstudio-toolbar` into a dedicated full-width `.mdstudio-file-banner` strip below the toolbar with `Immersive Write` dock clearance (`src/ui/editor-pane.ts`, `src/ui/styles.ts`).
  - Hid secondary `.mdstudio-file-name` at `@container mdstudio (max-width: 960px)` alongside `.mdstudio-brand-name` so `760px` English + Darwin `160px` titlebar inset retains wide editable document titles, and scoped mobile/coarse-pointer `44px` touch-target rules strictly to interactive `button.mdstudio-custom-chip` / `button.mdstudio-skill-item` instead of non-interactive `span.is-draft` badges (`src/ui/styles.ts`).
  - Converted `CHROME_CSS` to a single template literal and pruned 5 unused CSS rules (`src/ui/styles.ts`), keeping `dist/client.studio.js` under the `1,280.0 KiB` raw budget (`1,279.3 KiB` / `400.5 KiB` gzip) and `dist/client.js` at `5.1 KiB` (`2.3 KiB` gzip).

### Verification & Regression Gates
- Expanded `test/formal-models.test.ts` (`StudioOverlayMachine` 1,516 states / 48,512 transitions with wide-workbench live-preview invariant, `Outline`/`Slash`/`Menu` bubble exclusion, and `Immersive Write` → `SkillManagerDialog` LIFO `Escape` traces), `test/architecture.test.ts` (portaled menu selector parity, 4-overlay `portalOverlay` coverage, and `button.*` touch-target guards), `test/dsh-primitives.test.ts` (`FallbackModal`/`FallbackToast` body portaling, `isElementVisible`/`resolveSafeFocusTarget`, and `computeMinimalChange`), `test/app-dom.test.ts`, and `scripts/mutation-smoke.ts` (20/20 killed mutants).

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

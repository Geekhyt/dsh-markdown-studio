# Changelog

All notable changes to `dsh-markdown-studio` are documented in this file.

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

[0.1.6]: https://github.com/Geekhyt/dsh-markdown-studio/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/Geekhyt/dsh-markdown-studio/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/Geekhyt/dsh-markdown-studio/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/Geekhyt/dsh-markdown-studio/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/Geekhyt/dsh-markdown-studio/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/Geekhyt/dsh-markdown-studio/releases/tag/v0.1.1

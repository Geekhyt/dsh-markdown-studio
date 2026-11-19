# Changelog

All notable changes to `dsh-markdown-studio` are documented in this file.

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

[0.1.1]: https://github.com/Geekhyt/dsh-markdown-studio/releases/tag/v0.1.1

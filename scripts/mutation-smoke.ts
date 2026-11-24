import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const tsx = path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');

interface Mutation {
  name: string;
  file: string;
  find: string;
  replace: string;
  test: string;
}

const mutations: Mutation[] = [
  {
    name: 'allow unsafe URL schemes',
    file: 'src/domain/urls.ts',
    find: 'if (/^(?:https?:\\/\\/|mailto:)/i.test(probe) && /^(?:https?:\\/\\/|mailto:)/i.test(value)) return value;',
    replace: 'if (true) return value;',
    test: 'test/engine.test.ts',
  },
  {
    name: 'accept empty library backups',
    file: 'src/domain/library-backup.ts',
    find: 'if (!docs.length) return null;',
    replace: 'if (false) return null;',
    test: 'test/library-backup.test.ts',
  },
  {
    name: 'accept invalid accent colors',
    file: 'src/domain/settings.ts',
    find: "return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);",
    replace: "return typeof value === 'string';",
    test: 'test/domain.test.ts',
  },
  {
    name: 'skip search filtering',
    file: 'src/domain/library-search.ts',
    find: 'if (titleIndex < 0 && bodyIndex < 0) continue;',
    replace: 'if (false) continue;',
    test: 'test/library-search.test.ts',
  },
  {
    name: 'drop font-size clamping',
    file: 'src/domain/settings.ts',
    find: 'patch.fontSize = clamp(sourceValue.fontSize, 14, 20);',
    replace: 'patch.fontSize = sourceValue.fontSize;',
    test: 'test/domain.test.ts',
  },
  {
    name: 'allow unsafe image schemes',
    file: 'src/domain/urls.ts',
    find: 'if (/^https?:\\/\\//i.test(probe) && /^https?:\\/\\//i.test(value)) return value;',
    replace: 'return value;',
    test: 'test/engine.test.ts',
  },
  {
    name: 'allow origin-escaping relative URLs',
    file: 'src/domain/urls.ts',
    find: 'if (!SCHEME.test(probe)) return escapesBaseOrigin(probe) ? null : value;',
    replace: 'if (!SCHEME.test(probe)) return value;',
    test: 'test/engine.test.ts',
  },
  {
    name: 'ignore search result limit',
    file: 'src/domain/library-search.ts',
    find: 'return results.slice(0, limit);',
    replace: 'return results;',
    test: 'test/library-search.test.ts',
  },
  {
    name: 'drop line-height clamping',
    file: 'src/domain/settings.ts',
    find: 'patch.lineHeight = clamp(sourceValue.lineHeight, 1.4, 2.4);',
    replace: 'patch.lineHeight = sourceValue.lineHeight;',
    test: 'test/domain.test.ts',
  },
  {
    name: 'keep external CSS @import rules',
    file: 'src/domain/custom-css.ts',
    find: 'if (isAtImportSegment(segment)) {',
    replace: 'if (false && isAtImportSegment(segment)) {',
    test: 'test/custom-css.test.ts',
  },
  {
    name: 'bypass external CSS URL fallback strip',
    file: 'src/domain/custom-css.ts',
    find: "out += hasExternalCssUrl(replaced) ? '' : replaced;",
    replace: 'out += replaced;',
    test: 'test/fuzz-and-perf.test.ts',
  },
  {
    name: 'skip WeChat HTML style-tag detection',
    file: 'src/domain/wechat-html-lint.ts',
    find: "['html', /<style\\b/i, 'style-tag', '复制 HTML 仍包含 style 标签'],",
    replace: "['html', /(?!)/, 'style-tag', '复制 HTML 仍包含 style 标签'],",
    test: 'test/wechat-html.test.ts',
  },
  {
    name: 'disable ZIP budget enforcement',
    file: 'src/adapters/zip.ts',
    find: "throw new Error('ZIP_LIMIT_EXCEEDED');",
    replace: 'return;',
    test: 'test/zip.test.ts',
  },
  {
    name: 'allow orphaned search bar on immersive exit to preview',
    file: 'src/domain/studio-overlay.machine.ts',
    find: "case 'EXIT_IMMERSIVE':\n      if (!state.immersive || hasSurfaceModal(state)) return state;\n      return { ...dismissTransient(state, { keepSearch: state.view !== 'preview' }), immersive: null };",
    replace:
      "case 'EXIT_IMMERSIVE':\n      if (!state.immersive || hasSurfaceModal(state)) return state;\n      return { ...dismissTransient(state, { keepSearch: true }), immersive: null };",
    test: 'test/formal-models.test.ts',
  },
  {
    name: 'allow silent overwrite of conflicted disk file',
    file: 'src/domain/file-session.machine.ts',
    find: 'if (!op.overwrite && (state.conflict || externalChanged)) {',
    replace: 'if (false && !op.overwrite && (state.conflict || externalChanged)) {',
    test: 'test/formal-models.test.ts',
  },
  {
    name: 'studio overlay modal-focus guard blocks background editor focus when modal is open',
    file: 'src/domain/studio-overlay.machine.ts',
    find: 'return !flags.hasModal && flags.showMarkdownEditor && !flags.fullscreenDrawer;',
    replace: 'return flags.showMarkdownEditor && !flags.fullscreenDrawer;',
    test: 'test/formal-models.test.ts',
  },
  {
    name: 'narrow full-screen drawer dismisses on navigation instead of staying stuck',
    file: 'src/domain/studio-overlay.machine.ts',
    find: 'return containerWidth > NARROW_CONTAINER_PX;',
    replace: 'return true;',
    test: 'test/formal-models.test.ts',
  },
  {
    name: 'full-screen drawer Escape guard prevents editor focus from trapping Escape',
    file: 'src/domain/studio-overlay.machine.ts',
    find: "if (flags.fullscreenDrawer || (flags.drawerOpen && flags.inDrawer)) return 'close-drawer';",
    replace: "if (flags.drawerOpen && flags.inDrawer) return 'close-drawer';",
    test: 'test/formal-models.test.ts',
  },
  {
    name: 'caret popover bounds maxHeight above caret so SlashMenu never covers the caret line',
    file: 'src/domain/surface-geometry.ts',
    find: 'const maxHeight = Math.max(72, Math.min(spec.maxMenuHeight, freeSpan));',
    replace: 'const maxHeight = spec.maxMenuHeight;',
    test: 'test/domain.test.ts',
  },
  {
    name: 'keep CssWorkbench open on active Split click',
    file: 'src/domain/studio-overlay.machine.ts',
    find: "return cssOpen && (nextView === 'split' || containerWidth <= NARROW_CONTAINER_PX);",
    replace: "return cssOpen && containerWidth <= NARROW_CONTAINER_PX && nextView !== 'split';",
    test: 'test/formal-models.test.ts',
  },
  {
    name: 'suppress SelectionBubble while Outline or Slash menu is open',
    file: 'src/domain/studio-overlay.machine.ts',
    find: '!flags.outlineOpen &&\n    !flags.slashOpen &&\n    !flags.menuOpen',
    replace: 'true',
    test: 'test/formal-models.test.ts',
  },
  {
    name: 'protect portaled menu clicks from editor mousedown bubble clear',
    file: 'src/ui/selection-bubble.ts',
    find: "'.mdstudio-ai-inline-card, .mdstudio-skill-split, .mdstudio-slash, .mdstudio-outline, ' + PORTALED_MENU_SELECTOR",
    replace: "'.mdstudio-ai-inline-card, .mdstudio-skill-split, .mdstudio-slash, .mdstudio-outline'",
    test: 'test/architecture.test.ts',
  },
  {
    name: 'narrow window Escape inEditor guard away from toolbar & CSS workbench',
    file: 'src/application/use-studio-keyboard.ts',
    find: "const MARKDOWN_EDITOR_WRAP_SELECTOR = '.mdstudio-editor-pane:not(.mdstudio-css-workbench) .mdstudio-editor-wrap';",
    replace: "const MARKDOWN_EDITOR_WRAP_SELECTOR = '.mdstudio-editor-pane';",
    test: 'test/architecture.test.ts',
  },
  {
    name: 'clear FallbackTooltip stale state when target flips disabled',
    file: 'src/ui/dsh-primitives.ts',
    find: 'if (props.disabled && tip !== null) setTip(null);',
    replace: 'if (false && props.disabled && tip !== null) setTip(null);',
    test: 'test/dsh-primitives.test.ts',
  },
  {
    name: 'enforce canonical non-empty Host header in host/http/routes.ts',
    file: 'host/http/routes.ts',
    find: 'if (!trimmed) return false;',
    replace: 'if (!trimmed) return true;',
    test: 'test/host.test.ts',
  },
  {
    name: 'block CSS var(/*) external resource smuggling with quote-aware comment strip',
    file: 'src/domain/custom-css.ts',
    find: "return stripCssComments(value).replace(/\\\\(?:\\r\\n|\\r|\\n|\\f)/g, '');",
    replace: "return value.replace(/\\/\\*[\\s\\S]*?\\*\\//g, '').replace(/\\\\(?:\\r\\n|\\r|\\n|\\f)/g, '');",
    test: 'test/custom-css.test.ts',
  },
  {
    name: 'lift dark-preview <li> color for loose/bold list ::marker contrast',
    file: 'src/adapters/dark-preview.ts',
    find: "return element.tagName === 'LI' || darkened.has(element) || hasDirectTextOrMath(element);",
    replace: 'return hasDirectTextOrMath(element);',
    test: 'test/dom.test.ts',
  },
  {
    name: 'guard FallbackModal against drag-out text selection clicks on scrim',
    file: 'src/ui/dsh-primitives.ts',
    find: 'const shouldClose = !pointerDownInsideModalRef.current && event.target === event.currentTarget;',
    replace: 'const shouldClose = event.target === event.currentTarget;',
    test: 'test/dsh-primitives.test.ts',
  },
  {
    name: 'protect APFS case-only directory rename via handle identity check',
    file: 'src/application/use-workspace.ts',
    find: 'const sameEntry = existing ? await isSameHandle(existing, entry.handle) : false;',
    replace: 'const sameEntry = false;',
    test: 'test/file-session.test.ts',
  },
  {
    name: 'align Unicode case-folding search offsets without toLowerCase length drift',
    file: 'src/application/editor-search.ts',
    find: "const pattern = new RegExp(escapeRegExp(query), 'gi');\n  pattern.lastIndex = Math.max(0, Math.min(from, text.length));\n  let match = pattern.exec(text);\n  if (!match && from > 0) {\n    pattern.lastIndex = 0;\n    match = pattern.exec(text);\n  }\n  return match ? { start: match.index, end: match.index + match[0].length } : null;",
    replace:
      'const i = text.toLowerCase().indexOf(query.toLowerCase(), from);\n  return i >= 0 ? { start: i, end: i + query.length } : null;',
    test: 'test/shortcuts-regression.test.ts',
  },
  {
    name: 'normalize CSS form-feed (\\f) before sanitizer URL checks',
    file: 'src/domain/custom-css.ts',
    find: ".replace(/\\r\\n|\\r|\\f/g, '\\n')",
    replace: ".replace(/\\r\\n|\\r/g, '\\n')",
    test: 'test/custom-css.test.ts',
  },
  {
    name: 'reject cross-site Sec-Fetch-Site even for file:/https: origins',
    file: 'host/http/routes.ts',
    find: "if (site === 'cross-site') return false;",
    replace: "if (site === 'cross-site' && !origin) return false;",
    test: 'test/host.test.ts',
  },
  {
    name: 'preserve AssetGC discovery after unbalanced ![ markers',
    file: 'src/domain/images.ts',
    find: "if (source.indexOf(']', i + 2) < 0) break;\n      continue;",
    replace: 'break;',
    test: 'test/domain.test.ts',
  },
  {
    name: 'strip Mermaid 11 @{ img } directives before render',
    file: 'src/mermaid-entry.ts',
    find: '.filter((entry) => entry && !/^img\\s*:/i.test(entry))',
    replace: '.filter((entry) => Boolean(entry))',
    test: 'test/copy-spec.test.ts',
  },
  {
    name: 'clamp above-caret SlashMenu height under top obstacle',
    file: 'src/domain/surface-geometry.ts',
    find: 'if (clampedAbove >= 72) {\n      return { top: placed.top, left: placed.left, maxHeight: Math.min(maxHeight, clampedAbove) };\n    }',
    replace: 'if (false && clampedAbove >= 72) { return { top: placed.top, left: placed.left, maxHeight }; }',
    test: 'test/domain.test.ts',
  },
  {
    name: 'keep restored article live across pre-write disk merge in DocumentStore',
    file: 'src/application/document-store.ts',
    find: "this.pendingIntents.set(restored.id, 'live');",
    replace: "this.pendingIntents.set(restored.id, 'purged');",
    test: 'test/document-store.test.ts',
  },
];

let survived = 0;
for (const mutation of mutations) {
  const file = path.join(root, mutation.file);
  const original = fs.readFileSync(file, 'utf8');
  if (!original.includes(mutation.find)) {
    console.error(`FAIL ${mutation.name}: mutation target not found`);
    survived++;
    continue;
  }
  fs.writeFileSync(file, original.replace(mutation.find, mutation.replace));
  try {
    const result = spawnSync(process.execPath, [tsx, mutation.test], {
      cwd: root,
      encoding: 'utf8',
      timeout: 30_000,
    });
    if (result.status === 0) {
      console.error(`FAIL ${mutation.name}: test suite survived the mutation`);
      survived++;
    } else {
      console.log(`ok   ${mutation.name}: killed by ${mutation.test}`);
    }
  } finally {
    fs.writeFileSync(file, original);
  }
}
if (survived) process.exit(1);
console.log(`Mutation smoke passed (${mutations.length} mutations killed).`);

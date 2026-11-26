import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..');

function files(dir: string): string[] {
  const full = path.join(root, dir);
  if (!fs.existsSync(full)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
    const relative = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...files(relative));
    else if (/\.ts$/.test(entry.name)) out.push(relative);
  }
  return out;
}

function imports(file: string): string[] {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const found: string[] = [];
  const pattern = /(?:from\s+|import\s*\()(['"])([^'"]+)\1/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) found.push(match[2]);
  return found;
}

function stripComments(source: string): string {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, source);
  let out = '';
  let lastEnd = 0;
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    if (token === ts.SyntaxKind.SingleLineCommentTrivia || token === ts.SyntaxKind.MultiLineCommentTrivia) {
      const start = scanner.getTokenPos();
      const end = scanner.getTextPos();
      out += source.slice(lastEnd, start) + source.slice(start, end).replace(/[^\r\n]/g, ' ');
      lastEnd = end;
    }
  }
  return out + source.slice(lastEnd);
}

function forbidden(filesList: string[], patterns: RegExp[], label: string): void {
  for (const file of filesList) {
    for (const specifier of imports(file)) {
      for (const pattern of patterns) {
        assert.ok(!pattern.test(specifier), `${label}: ${file} imports ${specifier}`);
      }
    }
  }
}

const runtime = files('src/runtime');
assert.ok(runtime.length >= 2, 'low-level runtime files are discovered');
forbidden(
  runtime,
  [/domain\//, /theme-system\//, /adapters\//, /application\//, /locales\//, /ui\//, /^\.\.\/app$/, /host\//],
  'runtime bottom-layer boundary',
);

const domain = files('src/domain');
forbidden(
  domain,
  [/^react$/, /^react-dom/, /adapters\//, /application\//, /runtime\//, /ui\//, /host\//],
  'domain boundary',
);

const themeSystem = files('src/theme-system');
forbidden(
  themeSystem,
  [/^react$/, /^react-dom/, /adapters\//, /application\//, /runtime\//, /ui\//, /host\//],
  'theme-system boundary',
);

forbidden(
  ['src/engine.ts', 'src/markdown-parser.ts', 'src/css-inliner.ts'],
  [/^react$/, /^react-dom/, /adapters\//, /application\//, /runtime\//, /ui\//, /host\//],
  'engine boundary',
);

const application = files('src/application');
forbidden(application, [/^\.\.\/ui\//, /^\.\.\/app$/, /host\//], 'application boundary');

const ui = files('src/ui');
forbidden(ui, [/host\//, /^\.\.\/\.\.\/host/], 'ui boundary');

const host = files('host');
forbidden(host, [/^\.\.\/src\//, /^\.\.\/\.\.\/src\//, /^\.\.\/plugin\//], 'host boundary');

assert.ok(domain.length > 10, 'domain files are discovered');
assert.ok(application.length > 10, 'application files are discovered');

// Every `src/application/use-*.ts` must be a genuine stateful/lifecycle hook (not a 0-hook command factory)
const REAL_HOOK_CALL =
  /\b(?:useState|useRef|useMemo|useCallback|useSyncExternalStore|useLatest|useMountDisposable|useExternalStore|useWindowEvent|useDocumentEvent|useDebouncedKeyTask)\b/;
for (const file of application) {
  if (!path.basename(file).startsWith('use-')) continue;
  const code = stripComments(fs.readFileSync(path.join(root, file), 'utf8'));
  assert.ok(REAL_HOOK_CALL.test(code), `${file} is named use-* but invokes no React or runtime hooks`);
}

// Vercel `bundle-barrel-imports`: ban barrel `index.ts` files inside `src/`
for (const file of files('src')) {
  assert.notEqual(
    path.basename(file),
    'index.ts',
    `${file}: barrel index.ts files are banned inside src/ (use direct module imports)`,
  );
}

// AST-enforced Vercel & AI-friendly React invariants across `src/`:
// 1. Zero render-phase `ref.current` writes inside components or `use*` hooks outside `src/runtime/`
// 2. Zero nested PascalCase component definitions inside another PascalCase component
// 3. Every exported `*Props` interface in `src/ui/` stays <= 15 direct fields and uses `ui: UiKit` uniformly
function isFunctionBoundary(node: ts.Node): boolean {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node)
  );
}

function functionNameOf(node: ts.Node): string {
  if (ts.isFunctionDeclaration(node) && node.name) return node.name.text;
  if ((ts.isFunctionExpression(node) || ts.isArrowFunction(node)) && ts.isVariableDeclaration(node.parent)) {
    if (ts.isIdentifier(node.parent.name)) return node.parent.name.text;
  }
  return '';
}

function isDotCurrentTarget(expr: ts.Expression): boolean {
  return ts.isPropertyAccessExpression(expr) && expr.name.text === 'current';
}

function assertNoRenderPhaseRefWrites(file: string, sf: ts.SourceFile, body: ts.Node, ownerName: string): void {
  function walkSyncBody(node: ts.Node): void {
    if (node !== body && isFunctionBoundary(node)) return;
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment &&
      isDotCurrentTarget(node.left)
    ) {
      const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
      assert.fail(`${file}:${line} mutates ref.current during render in ${ownerName} (use useLatest or lazy useState)`);
    }
    if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) && isDotCurrentTarget(node.operand)) {
      const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
      assert.fail(`${file}:${line} mutates ref.current during render in ${ownerName}`);
    }
    ts.forEachChild(node, walkSyncBody);
  }
  walkSyncBody(body);
}

for (const file of files('src')) {
  const normalized = file.replace(/\\/g, '/');
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

  function visitAst(node: ts.Node, enclosingComponent: string | null): void {
    let nextComponent = enclosingComponent;
    if (isFunctionBoundary(node)) {
      const fnName = functionNameOf(node);
      const isPascalComponent = /^[A-Z][A-Za-z0-9]*$/.test(fnName);
      const isHook = /^use[A-Z]/.test(fnName);
      if (isPascalComponent && enclosingComponent) {
        const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
        assert.fail(
          `${file}:${line} defines nested component ${fnName} inside ${enclosingComponent} (causes remount on re-render)`,
        );
      }
      if ((isPascalComponent || isHook) && !normalized.startsWith('src/runtime/')) {
        const body = (node as ts.FunctionLikeDeclarationBase).body;
        if (body) assertNoRenderPhaseRefWrites(file, sf, body, fnName);
      }
      if (isPascalComponent) nextComponent = fnName;
    }

    if (normalized.startsWith('src/ui/') && ts.isInterfaceDeclaration(node) && node.name.text.endsWith('Props')) {
      const isExported = Boolean(node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword));
      if (isExported) {
        assert.ok(
          node.members.length <= 15,
          `${file}: ${node.name.text} has ${node.members.length} direct props (max 15; group domain state/actions)`,
        );
        for (const member of node.members) {
          if (!ts.isPropertySignature(member) || !member.name || !ts.isIdentifier(member.name)) continue;
          const propType = member.type ? member.type.getText(sf) : '';
          if (propType === 'UiKit') {
            assert.equal(
              member.name.text,
              'ui',
              `${file}: ${node.name.text}.${member.name.text} must be named "ui: UiKit" for uniform vocabulary`,
            );
          }
        }
      }
    }

    ts.forEachChild(node, (child) => visitAst(child, nextComponent));
  }

  visitAst(sf, null);
}

// Verify workspace AI rules & skills stay present
assert.ok(fs.existsSync(path.join(root, 'AGENTS.md')), 'AGENTS.md exists at repository root');
assert.ok(
  fs.existsSync(path.join(root, '.agents/skills/vercel-react-best-practices/SKILL.md')),
  '.agents/skills/vercel-react-best-practices/SKILL.md exists in workspace',
);
assert.ok(
  fs.existsSync(path.join(root, '.agents/skills/verify-state-machines/SKILL.md')),
  '.agents/skills/verify-state-machines/SKILL.md exists in workspace',
);
assert.ok(
  fs.existsSync(path.join(root, '.agents/skills/bug-to-rule/SKILL.md')),
  '.agents/skills/bug-to-rule/SKILL.md exists in workspace',
);

// Filepath contract: `src/domain/*.machine.ts` must stay pure & deterministic (zero browser/timer/clock/random/React)
const machineFiles = files('src').filter((file) => file.endsWith('.machine.ts'));
assert.ok(machineFiles.length >= 2, 'deterministic *.machine.ts modules are discovered');
const FORBIDDEN_MACHINE_IDENTIFIERS = new Set([
  'Date',
  'window',
  'document',
  'setTimeout',
  'setInterval',
  'requestAnimationFrame',
  'performance',
  'fetch',
  'localStorage',
  'indexedDB',
]);
for (const file of machineFiles) {
  const normalized = file.replace(/\\/g, '/');
  assert.ok(normalized.startsWith('src/domain/'), `${file} must live inside src/domain/`);
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  function checkMachineNode(node: ts.Node): void {
    if (ts.isPropertyAccessExpression(node) && node.getText(sf) === 'Math.random') {
      const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
      assert.fail(`${file}:${line} violates *.machine.ts determinism contract (Math.random)`);
    }
    if (ts.isIdentifier(node) && FORBIDDEN_MACHINE_IDENTIFIERS.has(node.text)) {
      const parent = node.parent;
      const isPropName =
        (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
        (ts.isPropertyAssignment(parent) && parent.name === node) ||
        (ts.isPropertySignature(parent) && parent.name === node);
      if (!isPropName) {
        const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
        assert.fail(`${file}:${line} violates *.machine.ts determinism contract (${node.text})`);
      }
    }
    ts.forEachChild(node, checkMachineNode);
  }
  checkMachineNode(sf);
}

// Monotonic Z-Index stacking hierarchy & zero raw numeric `z-index` literals in `src/`
const { Z_LAYERS } = await import('../src/ui/styles');
const CANONICAL_Z_ORDER: ReadonlyArray<keyof typeof Z_LAYERS> = [
  'toolbarFade',
  'drawerDocked',
  'outline',
  'slash',
  'selectionBubble',
  'drawerOverlay',
  'immersiveDock',
  'modalScrim',
  'menuScrim',
  'menu',
  'toast',
  'tooltip',
];
for (let i = 1; i < CANONICAL_Z_ORDER.length; i++) {
  const prev = CANONICAL_Z_ORDER[i - 1];
  const curr = CANONICAL_Z_ORDER[i];
  assert.ok(
    Z_LAYERS[prev] < Z_LAYERS[curr],
    `Z_LAYERS monotonicity violated: ${prev} (${Z_LAYERS[prev]}) must be < ${curr} (${Z_LAYERS[curr]})`,
  );
}

// Brand Naming Purity Gate, Bug->Rule Static Gates & Global Business-Layer useEffect / useLayoutEffect Ban
const allSrcFiles = [...files('src'), ...files('host'), 'index.ts'];
const ALLOWED_DATA_ATTRS = new Set([
  'data-window-drag',
  'data-ds-dark-theme',
  'data-platform',
  'data-fullscreen',
  'data-menu-material',
  'data-ignore-width',
  'data-tool',
  'data-plugin',
  'data-plugin-css',
  'data-icon',
]);
for (const file of allSrcFiles) {
  const normalized = file.replace(/\\/g, '/');
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const code = stripComments(source);

  if (!normalized.startsWith('src/runtime/')) {
    assert.ok(
      !/\buse(?:Layout)?Effect\b/.test(code),
      `${file} must not call useEffect/useLayoutEffect outside src/runtime/`,
    );
  }

  // Cross-realm safety: ban `instanceof Element` / `instanceof HTMLElement` in src/
  if (normalized.startsWith('src/')) {
    assert.ok(
      !/\binstanceof\s+(?:HTML)?Element\b/.test(code),
      `${file} must not use fragile cross-realm instanceof Element/HTMLElement (use feature duck-typing)`,
    );
    // Ban raw numeric `z-index: <digits>` in src/ (must reference Z_LAYERS)
    assert.ok(
      !/z-index\s*:\s*\d+/.test(code),
      `${file} must not hardcode raw numeric z-index (use Z_LAYERS from src/ui/styles.ts)`,
    );
    // Dynamic <style>/<script> injection must always tag data-plugin="dsh-markdown-studio" for clean hot-disable
    if (/createElement\(\s*['"](?:style|script)['"]\s*\)/.test(code)) {
      assert.ok(
        code.includes('data-plugin') && code.includes('dsh-markdown-studio'),
        `${file} dynamically creates <style>/<script> without tagging data-plugin="dsh-markdown-studio"`,
      );
    }
    // Container-driven responsive rule: panel UI files must not branch directly on `window.innerWidth <=/>`
    if (normalized.startsWith('src/ui/') && normalized !== 'src/ui/dsh-primitives.ts') {
      assert.ok(
        !/window\.innerWidth\s*[<>]=?/.test(code),
        `${file} must measure container .clientWidth (or @container mdstudio) instead of branching on window.innerWidth`,
      );
    }
    // Unicode case-folding length safety: never slice original text via `toLowerCase().indexOf(...)` in UI
    // (Turkish `İ`.toLowerCase() expands from 1 to 2 UTF-16 code units, causing +1 highlight offset drift).
    if (normalized.startsWith('src/ui/')) {
      assert.ok(
        !/\.to(?:Lower|Upper)Case\(\)\s*\.indexOf\(/.test(code),
        `${file} must not use toLowerCase()/toUpperCase().indexOf() in UI (use length-preserving RegExp "i" instead)`,
      );
    }
    // Single canonical storage key owner: localStorage keys (`dsh.markdown-studio.*`) must be declared in src/adapters/storage.ts only.
    if (normalized !== 'src/adapters/storage.ts') {
      assert.ok(
        !/['"]dsh\.markdown-studio\.[a-z0-9._-]+['"]/.test(code),
        `${file} must import storage keys from src/adapters/storage.ts instead of duplicating dsh.markdown-studio.* literals`,
      );
    }
    // Hidden file inputs must set native `hidden: true` so DSH Modal focus queries (`!el.closest('[hidden]')`) skip them.
    if (code.includes('mdstudio-hidden-input') && normalized !== 'src/ui/styles.ts') {
      const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
      let checked = 0;
      const visit = (node: ts.Node): void => {
        if (
          ts.isCallExpression(node) &&
          node.arguments.length >= 2 &&
          ts.isStringLiteral(node.arguments[0]) &&
          node.arguments[0].text === 'input' &&
          ts.isObjectLiteralExpression(node.arguments[1])
        ) {
          const props = node.arguments[1].properties;
          const hasHiddenClass = props.some(
            (p) =>
              ts.isPropertyAssignment(p) &&
              p.name.getText(sf) === 'className' &&
              p.initializer.getText(sf).includes('mdstudio-hidden-input'),
          );
          if (hasHiddenClass) {
            checked++;
            const hasNativeHidden = props.some(
              (p) =>
                ts.isPropertyAssignment(p) &&
                p.name.getText(sf) === 'hidden' &&
                p.initializer.kind === ts.SyntaxKind.TrueKeyword,
            );
            assert.ok(hasNativeHidden, `${file} renders .mdstudio-hidden-input without native hidden: true`);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
      assert.ok(checked > 0, `${file} references mdstudio-hidden-input on an input element`);
    }
  }

  assert.ok(!source.includes('#nice'), `${file} must not reference legacy #nice selector`);
  assert.ok(!source.includes('wechat-markdown-studio'), `${file} must not reference legacy storage directory`);
  assert.ok(!/\bmarkdown-body\b/.test(source), `${file} must not emit legacy markdown-body class`);
  assert.ok(!/--mds-/.test(source), `${file} must use --mdstudio-* / --mdstudio-ui-* instead of --mds-*`);
  assert.ok(!/__MDS_/.test(source), `${file} must use __MDSTUDIO_* instead of __MDS_*`);
  assert.ok(!/(?<!mdstudio-)\bcm-ai-/.test(source), `${file} must prefix CodeMirror AI classes with mdstudio-cm-ai-`);
  for (const attrMatch of source.matchAll(/\bdata-[a-z][a-z0-9-]+/g)) {
    const attr = attrMatch[0];
    assert.ok(
      attr.startsWith('data-mdstudio-') || ALLOWED_DATA_ATTRS.has(attr),
      `${file} uses unprefixed custom attribute ${attr} (expected data-mdstudio-*)`,
    );
  }
}
const iconSvg = fs.readFileSync(path.join(root, 'assets/icon.svg'), 'utf8');
assert.ok(!/\bmds-/.test(iconSvg), 'assets/icon.svg uses mdstudio-* gradient IDs');

// CSS containing-block safety: floating chrome hosting `FallbackTooltip` (`position: fixed`)
// must put `backdrop-filter` / `transform` / `filter` on a `::before` layer, never on the container itself.
const { CHROME_CSS } = await import('../src/ui/styles');
const dockRuleMatch = CHROME_CSS.match(/\.mdstudio-immersive-dock\s*\{([^}]*)\}/);
assert.ok(dockRuleMatch, 'CHROME_CSS defines .mdstudio-immersive-dock');
assert.ok(
  !/\b(?:backdrop-filter|-webkit-backdrop-filter|transform|filter)\s*:/.test(dockRuleMatch[1]),
  '.mdstudio-immersive-dock must keep backdrop-filter/transform on ::before so position:fixed tooltips escape it',
);
assert.ok(
  /\.mdstudio-immersive-dock::before\s*\{[^}]*backdrop-filter\s*:/.test(CHROME_CSS),
  '.mdstudio-immersive-dock::before owns the frosted glass backdrop-filter layer',
);

// Single-pane drawer docking invariant: @container (max-width: 1140px) must ONLY convert
// .mdstudio-drawer to an overlay in split view, keeping single-pane Edit/Preview docked.
const midDrawerQuery = CHROME_CSS.match(/@container\s+mdstudio\s*\(max-width:\s*1140px\)\s*\{([\s\S]*?)\n\}/);
assert.ok(midDrawerQuery, 'CHROME_CSS defines @container mdstudio (max-width: 1140px)');
assert.ok(
  midDrawerQuery[1].includes('[data-mdstudio-view="split"] .mdstudio-drawer'),
  '@container (max-width: 1140px) scopes overlay drawer strictly to split view',
);
assert.ok(
  !/^\s*\.mdstudio-drawer\s*\{/m.test(midDrawerQuery[1]),
  '@container (max-width: 1140px) must not force unscoped .mdstudio-drawer to overlay single-pane views',
);

// Stable editor-session key invariant: draft-to-saved transitions in CSS Workbench & Skill Manager
// must not key CodeMirror directly on mutable entity IDs (which unmounts the editor on first save).
for (const editorHostFile of ['src/ui/css-workbench.ts', 'src/ui/skill-manager-dialog.ts']) {
  const hostSrc = fs.readFileSync(path.join(root, editorHostFile), 'utf8');
  assert.ok(
    hostSrc.includes('editorEpoch'),
    `${editorHostFile} uses a monotonic editorEpoch key instead of mutable draft/saved IDs`,
  );
}

// React 18 synthetic portal mousedown invariant: editor overlay guard and outside-click guard
// must both recognize portaled menus/scrims so clicking floating SkillSplitTrigger menu items
// never unmounts the menu before `click` fires.
const { EDITOR_OVERLAY_SELECTOR, BUBBLE_INTERACTIVE_SELECTOR } = await import('../src/ui/selection-bubble');
for (const token of ['.mdstudio-menu', '.mdstudio-menu-scrim', '[role="menu"]', '[data-menu-material]']) {
  assert.ok(
    EDITOR_OVERLAY_SELECTOR.includes(token),
    `EDITOR_OVERLAY_SELECTOR must include portaled menu token ${token}`,
  );
  assert.ok(
    BUBBLE_INTERACTIVE_SELECTOR.includes(token),
    `BUBBLE_INTERACTIVE_SELECTOR must include portaled menu token ${token}`,
  );
}

// Unified body-portal layer: all 4 fixed fallback primitives (Tooltip, Toast, Modal, Menu)
// must route through `portalOverlay(` so none are trapped inside host stacking contexts.
const primitivesSrc = stripComments(fs.readFileSync(path.join(root, 'src/ui/dsh-primitives.ts'), 'utf8'));
const portalCallCount = (primitivesSrc.match(/\bportalOverlay\(/g) || []).length;
assert.ok(
  portalCallCount >= 5,
  `src/ui/dsh-primitives.ts must define portalOverlay and route all 4 fixed overlays through it (found ${portalCallCount} occurrences)`,
);

// Editor-scoped popovers (.mdstudio-outline / .mdstudio-slash) must bound max-height to their container
// so short viewports never overflow .mdstudio-editor-wrap or cover .mdstudio-editor-stats.
for (const cls of ['.mdstudio-outline', '.mdstudio-slash']) {
  const escaped = cls.replace('.', '\\.');
  const rule = CHROME_CSS.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  assert.ok(rule, `CHROME_CSS defines ${cls}`);
  assert.ok(
    /max-height\s*:\s*min\([^)]*calc\(100%\s*-/.test(rule[1]),
    `${cls} must cap max-height with min(..., calc(100% - ...)) so short viewports never clip`,
  );
}

// Stacked narrow Immersive Write banners must not double-pad dock clearance when FileBanner precedes SearchBar.
assert.ok(
  CHROME_CSS.includes(
    '.mdstudio-root[data-mdstudio-immersive="write"] .mdstudio-file-banner ~ .mdstudio-searchbar { padding-top: 6px; }',
  ),
  'CHROME_CSS collapses secondary top dock clearance when FileBanner precedes SearchBar in narrow Immersive Write',
);
assert.ok(
  CHROME_CSS.includes(
    '.mdstudio-root[data-mdstudio-immersive="write"][data-mdstudio-host-titlebar] .mdstudio-file-banner ~ .mdstudio-searchbar { padding-top: 6px; }',
  ),
  'CHROME_CSS collapses secondary top dock clearance in host-titlebar narrow Immersive Write',
);

// Host shortcut precedence & unified keyboard router:
// Mod+Shift+F and Escape routing must live in the single router (src/application/use-studio-keyboard.ts),
// with document bubble + host dialog guard, and zero scattered global keydown listeners in editor-pane or immersive-dock.
const keyboardRouterSrc = fs.readFileSync(path.join(root, 'src/application/use-studio-keyboard.ts'), 'utf8');
assert.ok(
  keyboardRouterSrc.includes('useDocumentEvent') && keyboardRouterSrc.includes('[role="dialog"]'),
  'src/application/use-studio-keyboard.ts handles Mod+Shift+F on document bubble with dialog guard',
);
const immersiveDockSrc = fs.readFileSync(path.join(root, 'src/ui/immersive-dock.ts'), 'utf8');
const editorPaneSrc = fs.readFileSync(path.join(root, 'src/ui/editor-pane.ts'), 'utf8');
assert.ok(
  !immersiveDockSrc.includes('useDocumentEvent') && !immersiveDockSrc.includes('useWindowEvent'),
  'src/ui/immersive-dock.ts stays purely presentational without scattered global keyboard listeners',
);
assert.ok(
  !/use(?:Document|Window)Event\([^,]+,\s*['"]keydown['"]/.test(editorPaneSrc),
  'src/ui/editor-pane.ts delegates Escape routing to useStudioKeyboard instead of registering global keydown listeners',
);

// Empty preview stage background reconciliation: usePreviewHtmlSurface must reconcile stageRef on unmount/empty.
const domSurfacesSrc = fs.readFileSync(path.join(root, 'src/runtime/dom-surfaces.ts'), 'utf8');
assert.ok(
  domSurfacesSrc.includes('stageRef') && domSurfacesSrc.includes('stage.style.backgroundColor'),
  'src/runtime/dom-surfaces.ts reconciles stage background when preview article unmounts/empties',
);

// Flex-1 editor, preview stage, and CSS workbench scroll surfaces must use min-height: 0
// so short viewports never clip bottom lines or scrollbars inside overflow:hidden wrappers.
for (const sel of [
  '.mdstudio-editor',
  '.mdstudio-codemirror',
  '.mdstudio-codemirror .cm-editor',
  '.mdstudio-codemirror .cm-scroller',
  '.mdstudio-stage',
  '.mdstudio-css',
  '.mdstudio-css-codemirror',
]) {
  const escaped = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rule = CHROME_CSS.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`));
  assert.ok(rule, `CHROME_CSS defines ${sel}`);
  assert.ok(
    !/min-height\s*:\s*[1-9]\d*px/.test(rule[1]),
    `${sel} must not declare a rigid positive pixel min-height (breaks short-viewport scroll reach)`,
  );
}

// Unified overlay reducer & Escape inEditor guard invariants:
// 1. StudioPage must drive overlays from the verified domain reducer + unified keyboard router (no shadow-only state machine).
// 2. Escape inEditor guard must target only the Markdown text wrap (never toolbar buttons or CSS workbench).
const appSrcForEsc = fs.readFileSync(path.join(root, 'src/app.ts'), 'utf8');
assert.ok(
  appSrcForEsc.includes('reduceStudioShellState') && appSrcForEsc.includes('useStudioKeyboard'),
  'src/app.ts drives overlay state via reduceStudioShellState and keyboard/Escape routing via useStudioKeyboard',
);
assert.ok(
  keyboardRouterSrc.includes("'.mdstudio-editor-pane:not(.mdstudio-css-workbench) .mdstudio-editor-wrap'"),
  'src/application/use-studio-keyboard.ts narrows Escape inEditor guard to Markdown editor wrap so Toolbar & CssWorkbench close SettingsDrawer',
);

// PreviewPane relayoutKey must track deferred CSS draft readiness so urgent workbench open
// never consumes pendingRelayoutRatioRef before deferredCssDraft updates preview HTML.
assert.ok(
  appSrcForEsc.includes('cssWorkbench.open && deferredCssDraft.trim()') &&
    appSrcForEsc.includes('onDraftCssChange: handleDraftCssChange'),
  'src/app.ts aligns PreviewPane relayoutKey with deferredCssDraft and captures scroll ratio on draft CSS changes',
);

// Mobile 44px touch-target overrides must target interactive `button.*` chips/tabs, never
// non-interactive `span.is-draft` status badges.
assert.ok(
  !/,\s*\.mdstudio-css-workbench\s+\.mdstudio-custom-chip\b/.test(CHROME_CSS),
  'CHROME_CSS must scope 44px touch-target override to button.mdstudio-custom-chip (not span.is-draft)',
);
assert.ok(
  !/,\s*\.mdstudio-skill-item\s*\{\s*min-height:\s*44px/.test(CHROME_CSS),
  'CHROME_CSS must scope coarse-pointer 44px override to button.mdstudio-skill-item (not span.is-draft)',
);

// CSS responsive cascade order invariant:
// 1. All `@container mdstudio (max-width: Npx)` blocks must appear in strictly descending width order.
// 2. `@media (pointer: coarse)` must appear AFTER all `@container` blocks so narrow container rules cannot shrink 44px touch targets.
// 3. `@media (prefers-reduced-motion: reduce)` must appear last.
{
  const containerWidths = [...CHROME_CSS.matchAll(/@container\s+mdstudio\s*\(\s*max-width:\s*(\d+)px\s*\)/g)].map(
    (m) => ({ px: Number(m[1]), index: m.index ?? -1 }),
  );
  assert.ok(containerWidths.length >= 5, 'CHROME_CSS defines descending container breakpoints');
  for (let i = 1; i < containerWidths.length; i++) {
    assert.ok(
      containerWidths[i].px < containerWidths[i - 1].px,
      `CHROME_CSS @container max-width breakpoints must be strictly descending (${containerWidths[i - 1].px}px -> ${containerWidths[i].px}px)`,
    );
  }
  const lastContainerAt = containerWidths[containerWidths.length - 1].index;
  const coarseAt = CHROME_CSS.indexOf('@media (pointer: coarse)');
  const reducedMotionAt = CHROME_CSS.indexOf('@media (prefers-reduced-motion: reduce)');
  assert.ok(
    coarseAt > lastContainerAt,
    '@media (pointer: coarse) must come after all @container breakpoints so narrow width rules cannot clobber 44px touch targets',
  );
  assert.ok(
    reducedMotionAt > coarseAt,
    '@media (prefers-reduced-motion: reduce) must appear after touch/responsive rules',
  );
}

// DocumentStore unified per-article intent invariant:
// Multi-tab sync must track a single exclusive intent map (`pendingIntents`), never overlapping deleted/purged/dirty Sets.
const docStoreSrc = stripComments(fs.readFileSync(path.join(root, 'src/application/document-store.ts'), 'utf8'));
assert.ok(
  docStoreSrc.includes('pendingIntents') &&
    !docStoreSrc.includes('pendingDeletedIds') &&
    !docStoreSrc.includes('pendingPurgedIds'),
  'src/application/document-store.ts uses unified pendingIntents map instead of overlapping tombstone Sets',
);

// Single canonical Host loopback/origin/auth security boundary (G2): all host HTTP route modules and local-server
// must delegate Host/Origin/Auth checks to canonical helpers in host/http/routes.ts (or static-bundle-route.ts).
for (const hostRouteFile of ['host/http/ai-route.ts', 'host/http/static-bundle-route.ts', 'host/local-server.ts']) {
  const src = stripComments(fs.readFileSync(path.join(root, hostRouteFile), 'utf8'));
  assert.ok(
    (src.includes('isLoopbackHostHeader') || src.includes('isAllowedOrigin') || src.includes('checkHostAuthJson')) &&
      !/\bfunction\s+(?:isLoopbackHost|isAllowedOrigin|isLoopback)\b/.test(src),
    `${hostRouteFile} must delegate Host/Origin/Auth validation to canonical helpers in host/http/routes.ts`,
  );
}
for (const bundleRouteFile of [
  'host/http/math-route.ts',
  'host/http/mermaid-route.ts',
  'host/http/darkmode-route.ts',
]) {
  const src = stripComments(fs.readFileSync(path.join(root, bundleRouteFile), 'utf8'));
  assert.ok(
    src.includes('createStaticBundleRoute'),
    `${bundleRouteFile} must delegate loopback/auth/ETag handling to createStaticBundleRoute`,
  );
}
// Lazy dark-mode bundle boundary: only src/darkmode-entry.ts may import `mp-darkmode` so CJS bundling never inlines it into client.studio.js.
for (const file of files('src')) {
  const normalized = file.replace(/\\/g, '/');
  if (normalized === 'src/darkmode-entry.ts') continue;
  const code = stripComments(fs.readFileSync(path.join(root, file), 'utf8'));
  assert.ok(
    !/\bmp-darkmode\b/.test(code),
    `${file} must not import mp-darkmode directly (lazy-load via /api/markdown-studio/darkmode.js)`,
  );
}
// Native DSH Tooltip must opt into `portal: true` so fixed tooltips escape immersive dock flex layout.
assert.ok(
  /function adaptTooltip[\s\S]{0,360}portal:\s*props\.portal\s*\?\?\s*true/.test(primitivesSrc),
  'src/ui/dsh-primitives.ts adaptTooltip must enable portal: props.portal ?? true',
);
// Host entry must enforce DSH host `connection.requestRejection` auth boundary across all registered HTTP routes.
{
  const indexCode = stripComments(fs.readFileSync(path.join(root, 'index.ts'), 'utf8'));
  assert.ok(
    indexCode.includes('requestRejection') && (indexCode.match(/\bcheckAuth\b/g) || []).length >= 6,
    'index.ts must wire DSH host connection.requestRejection auth checker into all 6 HTTP routes',
  );
}

// Dark-mode hot-disable & toast icon contrast invariants (G4).
const styleLifecycleSrc = stripComments(fs.readFileSync(path.join(root, 'src/ui/style-lifecycle.ts'), 'utf8'));
assert.ok(
  /classList\??\.remove\(['"]data_color_scheme_dark['"]\)/.test(styleLifecycleSrc),
  'src/ui/style-lifecycle.ts must remove data_color_scheme_dark from documentElement on unmount',
);
for (const token of ['--mdstudio-ui-toast-success', '--mdstudio-ui-toast-info', '--mdstudio-ui-toast-error']) {
  assert.ok(CHROME_CSS.includes(token), `CHROME_CSS defines high-contrast dark-toast icon token ${token}`);
}

// CodeMirror Markdown GFM language & dark .cm-selectionMatch contrast invariants (G6/G7):
// use markdownLanguage directly and explicitly theme .cm-selectionMatch so CodeMirror's light neon
// highlight never fails WCAG contrast on dark surfaces.
const cmCoreSrc = stripComments(fs.readFileSync(path.join(root, 'src/ui/codemirror-core.ts'), 'utf8'));
assert.ok(
  cmCoreSrc.includes('markdownLanguage') && !/\bmarkdown\(\s*\)/.test(cmCoreSrc),
  'src/ui/codemirror-core.ts must configure GFM-capable markdownLanguage instead of bare markdown()',
);
assert.ok(
  cmCoreSrc.includes("'.cm-selectionMatch'"),
  'src/ui/codemirror-core.ts must explicitly theme .cm-selectionMatch for dark/light contrast',
);

// Modal header row & keyboard-accessible library row actions invariants (G6).
assert.ok(
  CHROME_CSS.includes('.mdstudio-modal-content > div:last-child:not(.mdstudio-modal-head)'),
  'CHROME_CSS must exclude .mdstudio-modal-head from column flex-1 stacking rule',
);
assert.equal(
  /\.mdstudio-library-row:not\(\.is-trash-row\)\s+\.mdstudio-library-row-actions\s*\{[^}]*display\s*:\s*none/.test(
    CHROME_CSS,
  ),
  false,
  'LibraryDialog row actions must remain in keyboard Tab / A11y tree (use opacity, never display: none)',
);

// Mermaid SSRF directive stripping & host symlink O_NOFOLLOW security invariants (G2).
const mermaidEntrySrc = stripComments(fs.readFileSync(path.join(root, 'src/mermaid-entry.ts'), 'utf8'));
assert.ok(
  mermaidEntrySrc.includes('stripMermaidImageDirectives') && mermaidEntrySrc.includes('sanitizeMermaidSvg'),
  'src/mermaid-entry.ts must strip @{ img } SSRF directives and sanitize rendered SVGs',
);
const imageStoreSrc = stripComments(fs.readFileSync(path.join(root, 'host/application/image-store.ts'), 'utf8'));
assert.ok(
  imageStoreSrc.includes('O_NOFOLLOW') && imageStoreSrc.includes('lstat'),
  'host/application/image-store.ts must guard asset reads/writes with lstat and O_NOFOLLOW',
);

// CSS cascade ordering invariant (G8): base .mdstudio-input must precede specialized .mdstudio-search-input
// and .mdstudio-css-name overrides in CHROME_CSS.
const baseInputPos = CHROME_CSS.indexOf('\n.mdstudio-input {');
const searchInputPos = CHROME_CSS.indexOf('\n.mdstudio-search-input {');
const cssNamePos = CHROME_CSS.indexOf('\n.mdstudio-css-name');
assert.ok(
  baseInputPos > 0 && searchInputPos > baseInputPos && cssNamePos > baseInputPos,
  'CHROME_CSS must declare base .mdstudio-input before .mdstudio-search-input and .mdstudio-css-name overrides',
);

// FallbackModal scrim drag-out guard & FallbackMenuPanel Tab trap guard (G8).
assert.ok(
  primitivesSrc.includes('pointerDownInsideModalRef') && primitivesSrc.includes('onMouseDown'),
  'src/ui/dsh-primitives.ts must guard FallbackModal scrim clicks against drag-out text selection',
);
assert.ok(
  /key === 'Tab'[\s\S]{0,160}closeAndFocusTrigger/.test(primitivesSrc),
  'src/ui/dsh-primitives.ts must trap Tab inside FallbackMenuPanel and return focus to its trigger',
);

// Real DSH Cordis webServer prefix-route contract (no trailing slash on `kind: 'prefix'`),
// CodeMirror Escape hijack ban, destructive confirm safe focus, and SkillManager single-guard Mod+S.
{
  const indexSrc = fs.readFileSync(path.join(root, 'index.ts'), 'utf8');
  const indexSf = ts.createSourceFile('index.ts', indexSrc, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let prefixRouteCount = 0;
  function checkCordisRoutes(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'register'
    ) {
      const arg = node.arguments[0];
      if (arg && ts.isObjectLiteralExpression(arg)) {
        let kindText = '';
        let pathInit: ts.Expression | null = null;
        for (const prop of arg.properties) {
          if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) continue;
          if (prop.name.text === 'kind' && ts.isStringLiteral(prop.initializer)) kindText = prop.initializer.text;
          if (prop.name.text === 'path') pathInit = prop.initializer;
        }
        if (kindText === 'prefix' && pathInit) {
          prefixRouteCount++;
          if (ts.isStringLiteral(pathInit)) {
            assert.ok(
              !pathInit.text.endsWith('/'),
              `index.ts registers Cordis prefix route with forbidden trailing slash: ${pathInit.text}`,
            );
          } else {
            const exprText = pathInit.getText(indexSf);
            assert.ok(
              exprText.includes('.replace(/\\/+$/,') || !exprText.includes('ASSET_PREFIX'),
              `index.ts must strip trailing slashes when registering prefix route (${exprText})`,
            );
          }
        }
      }
    }
    ts.forEachChild(node, checkCordisRoutes);
  }
  checkCordisRoutes(indexSf);
  assert.ok(prefixRouteCount >= 1, 'index.ts registers at least one verified Cordis prefix route');
}
assert.ok(
  /defaultKeymap\.filter\([\s\S]{0,80}Escape/.test(cmCoreSrc) && !/\.\.\.defaultKeymap\s*[,\]\n]/.test(cmCoreSrc),
  'src/ui/codemirror-core.ts must exclude Escape from defaultKeymap so active selection never hijacks overlay LIFO Escape',
);
const dialogHostSrc = stripComments(fs.readFileSync(path.join(root, 'src/ui/dialog-host.ts'), 'utf8'));
assert.ok(
  /autoFocus:\s*active\.kind === 'confirm' && danger/.test(dialogHostSrc) &&
    /autoFocus:\s*active\.kind === 'confirm' && !danger/.test(dialogHostSrc),
  'src/ui/dialog-host.ts must focus Cancel (never red submit) on danger confirm dialogs',
);
const skillDialogSrc = stripComments(fs.readFileSync(path.join(root, 'src/ui/skill-manager-dialog.ts'), 'utf8'));
assert.ok(
  /function handleSave\(\)[\s\S]{0,120}!canSaveDraft/.test(skillDialogSrc),
  'src/ui/skill-manager-dialog.ts must enforce the same canSaveDraft guard inside handleSave (Mod+S parity)',
);

// i18n hygiene: zh / en dictionaries stay in exact key parity and every key is referenced by
// runtime source (dynamic `theme.<id>.name|desc` and `code.<id>.name` lookups are allowlisted).
const { UI_STRINGS_ZH, UI_STRINGS_EN } = await import('../src/locales/ui-strings');
assert.deepEqual(Object.keys(UI_STRINGS_EN).sort(), Object.keys(UI_STRINGS_ZH).sort(), 'zh / en locale keys match');
const runtimeText = files('src')
  .filter((file) => !file.replace(/\\/g, '/').endsWith('locales/ui-strings.ts'))
  .map((file) => fs.readFileSync(path.join(root, file), 'utf8'))
  .join('\n');
const DYNAMIC_KEY = /^(?:theme\.[\w-]+\.(?:name|desc)|code\.[\w-]+\.name)$/;
const unusedLocaleKeys = Object.keys(UI_STRINGS_ZH).filter(
  (key) => !DYNAMIC_KEY.test(key) && !runtimeText.includes(`'${key}'`) && !runtimeText.includes(`"${key}"`),
);
assert.deepEqual(unusedLocaleKeys, [], 'every locale key is referenced by runtime source');

console.log(
  'ok - architecture boundaries, business-layer useEffect ban, hook honesty, and unified mdstudio brand naming hold',
);

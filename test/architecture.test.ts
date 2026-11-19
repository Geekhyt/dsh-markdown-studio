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
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
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

// Verify workspace AI rules & Vercel React Best Practices skill stay present
assert.ok(fs.existsSync(path.join(root, 'AGENTS.md')), 'AGENTS.md exists at repository root');
assert.ok(
  fs.existsSync(path.join(root, '.agents/skills/vercel-react-best-practices/SKILL.md')),
  '.agents/skills/vercel-react-best-practices/SKILL.md exists in workspace',
);

// Brand Naming Purity Gate & Global Business-Layer useEffect / useLayoutEffect Ban
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

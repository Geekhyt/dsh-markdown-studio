import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { HostClient } from '../src/adapters/host-client';
import { zipStore } from '../src/adapters/zip';
import { createArticleExporter } from '../src/application/article-exporter';
import { createDocumentCommands } from '../src/application/document-commands';
import { DocumentStore } from '../src/application/document-store';
import { createFormattingCommands } from '../src/application/editor-formatting';
import { createEditorSearch, type SearchState } from '../src/application/editor-search';
import { createImageInserter } from '../src/application/image-inserter';
import { type CopyActionsApi, useCopyActions } from '../src/application/use-copy-actions';
import { createTrashCommands } from '../src/application/use-document-library';
import { type LibraryArchiveApi, useLibraryArchive } from '../src/application/use-library-archive';
import { createLibraryBackup } from '../src/domain/library-backup';
import { DEFAULT_SETTINGS, SAMPLE_MARKDOWN } from '../src/themes';

const dom = new JSDOM('<div id="app"></div><div id="copy" contenteditable></div><input id="file"><input id="search">', {
  url: 'http://localhost',
  pretendToBeVisual: true,
});
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'NodeFilter', 'FileReader', 'File']) {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    value: name === 'window' ? dom.window : (dom.window as unknown as Record<string, unknown>)[name],
  });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const notes: string[] = [];
const t = (key: string) => key;
const notify = (message: string) => {
  notes.push(message);
};
let confirm = true;
const doc = {
  id: 'a',
  title: '<&"\'>',
  markdown: '# Hello\n\n**World**',
  view: 'split' as const,
  settings: { ...DEFAULT_SETTINGS },
  updatedAt: 1,
};
let persist = true;
const store = new DocumentStore({ activeId: 'a', docs: [doc] }, () => persist);
const host = new HostClient(
  '/api/test',
  async () =>
    new Response(
      JSON.stringify({
        ok: true,
        filename: '0123456789abcdef01234567.png',
        assetPath: 'assets/0123456789abcdef01234567.png',
      }),
      { headers: { 'content-type': 'application/json' } },
    ),
);
const outputs = new Map<string, Blob | string>();
let plain = '';
let copies!: CopyActionsApi;
let archive!: LibraryArchiveApi;
function Probe() {
  const library = React.useSyncExternalStore(store.subscribe, store.getSnapshot);
  copies = useCopyActions({
    React,
    t,
    notify,
    doc,
    settings: doc.settings,
    localImageServerUrl: '',
    mermaidAssets: { ensure: async () => {}, cache: new Map() },
    mathAssets: { ensure: async () => {} },
    copyRef: { current: document.getElementById('copy') as HTMLDivElement },
    setMenuOpen: () => {},
    describeHostError: String,
  });
  archive = useLibraryArchive({
    React,
    t,
    notify,
    confirm: async () => confirm,
    store,
    library,
    hostClient: host,
    localImageServerUrl: '',
    download: (name, data) => {
      outputs.set(name, data);
      return true;
    },
    onReplace: () => {},
    onClose: () => {},
  });
  return null;
}
const root = createRoot(document.getElementById('app')!);
await React.act(async () => {
  root.render(React.createElement(Probe));
});
Object.defineProperty(navigator, 'clipboard', {
  configurable: true,
  value: {
    writeText: async (text: string) => {
      plain = text;
    },
  },
});
await React.act(async () => {
  await copies.copyPlainText();
});
assert.equal(plain.includes('World'), true);
assert.equal(plain.includes('**'), false);
let legacyCopied = false;
Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
Object.defineProperty(document, 'execCommand', {
  configurable: true,
  value: () => {
    legacyCopied = true;
    return true;
  },
});
await React.act(async () => {
  await copies.copyPlainText();
  await copies.copyArticle();
});
assert.equal(legacyCopied, true);
assert.ok(notes.includes('toast.copied'));
Object.defineProperty(document, 'execCommand', {
  configurable: true,
  value: () => {
    throw new Error('clipboard denied');
  },
});
await React.act(async () => {
  await copies.copyPlainText();
  await copies.copyArticle();
});
assert.ok(notes.includes('toast.copyFailed'));

const exported = createArticleExporter({
  React,
  t,
  notify,
  doc,
  settings: doc.settings,
  localImageServerUrl: '',
  mermaidAssets: { ensure: async () => {}, cache: new Map() },
  mathAssets: { ensure: async () => {} },
  download: (name, content) => {
    outputs.set(name, content);
    return true;
  },
  closeMenu: () => {},
  updateSettings: (patch) => {
    Object.assign(doc.settings, patch);
  },
});
exported.exportMarkdown();
exported.exportTheme();
await exported.exportHtml();
assert.ok([...outputs.values()].includes(doc.markdown));
assert.ok(
  [...outputs.values()].some((value) => typeof value === 'string' && value.includes('&lt;&amp;&quot;&#39;&gt;')),
);
const textFile = (text: string) =>
  ({
    name: 'backup.json',
    type: 'application/json',
    size: text.length,
    text: async () => text,
    arrayBuffer: async () => new TextEncoder().encode(text).buffer,
  }) as File;
await exported.importThemeFile(
  textFile(
    JSON.stringify({
      settings: { accent: '#ff9900', customThemes: [{ id: 'custom:demo', name: 'Demo', css: '#mdstudio{color:red}' }] },
    }),
  ),
);
assert.equal(doc.settings.accent, '#ff9900');
await exported.importThemeFile(textFile('{invalid'));
assert.ok(notes.includes('toast.themeInvalid'));
await exported.importThemeFile(null);

let markdown = 'Alpha beta ALPHA';
let range = { start: 0, end: 0 };
const panel: SearchState = { open: false, query: 'alpha', replacement: '$1' };
const search = createEditorSearch({
  t,
  notify,
  editorValue: () => markdown,
  selection: () => range,
  setMarkdown: (value) => {
    markdown = value;
  },
  focusRange: (start, end) => {
    range = { start, end };
  },
  searchPanel: panel,
  setSearchPanel: (update) => {
    Object.assign(panel, typeof update === 'function' ? update(panel) : update);
  },
  searchInputRef: { current: document.getElementById('search') as HTMLInputElement },
  setOutlineOpen: () => {},
});
search.openSearch();
assert.equal(panel.open, true);
search.findNext();
assert.deepEqual(range, { start: 0, end: 5 });
search.replaceOne();
assert.equal(markdown, '$1 beta ALPHA');
search.replaceAll();
assert.equal(markdown, '$1 beta $1', 'replacement is literal, not regex syntax');
search.findNext();
assert.ok(notes.includes('search.notFound'));
search.updateSearch({ query: '' });
search.replaceOne();
search.replaceAll();
search.findNext();
search.focusHeading({ start: 4, length: 3, level: 2, text: 'foo' });
assert.deepEqual(range, { start: 4, end: 7 });

let clicks = 0;
const fileInput = document.getElementById('file') as HTMLInputElement;
fileInput.click = () => {
  clicks++;
};
const documents = createDocumentCommands({
  React,
  t,
  notify,
  confirm: async () => confirm,
  doc,
  hostClient: host,
  fileRef: { current: fileInput },
  setMenuOpen: () => {},
  detachFileContext: () => {},
  setMarkdown: (text) => {
    markdown = text;
  },
  focusRange: () => {},
  deriveTitle: (text) => text,
  errorMessage: String,
});
confirm = false;
await documents.loadSample();
await documents.clearArticle();
assert.equal(markdown, '$1 beta $1');
confirm = true;
await documents.loadSample();
assert.equal(markdown, SAMPLE_MARKDOWN);
await documents.clearArticle();
assert.equal(markdown, '');
documents.handleImportClick();
assert.equal(clicks, 1);

// Verify extensionless ZIP bundle (e.g. OS/browser temp download or application/octet-stream) is detected via PK magic bytes
const zipBlob = zipStore([{ name: 'article.md', data: new TextEncoder().encode('# 压缩包还原标题\n\n无损正文') }]);
const zipBuf = await zipBlob.arrayBuffer();
const extensionlessZip = {
  name: 'downloaded-uuid-no-ext',
  type: 'application/octet-stream',
  size: zipBuf.byteLength,
  arrayBuffer: async () => zipBuf,
  text: async () => 'CORRUPT_FALLBACK',
} as unknown as File;
documents.handleFile({
  target: { files: [extensionlessZip], value: 'x' },
} as unknown as React.ChangeEvent<HTMLInputElement>);
await new Promise((resolve) => setTimeout(resolve, 60));
assert.equal(
  markdown,
  '# 压缩包还原标题\n\n无损正文',
  'extensionless ZIP bundle detected via PK magic header instead of corrupt raw text',
);

const backup = createLibraryBackup({
  activeId: 'restored',
  docs: [{ ...doc, id: 'restored', markdown: 'recover me' }],
});
const recoveryKey = 'dsh.markdown-studio.library.import-recovery.v1';
await React.act(async () => {
  await archive.recover();
});
assert.ok(notes.includes('library.noRecovery'));
window.localStorage.setItem(recoveryKey, '{bad');
await React.act(async () => {
  await archive.recover();
});
assert.ok(notes.includes('library.importInvalid'));
window.localStorage.setItem(recoveryKey, JSON.stringify(backup));
confirm = false;
await React.act(async () => {
  await archive.recover();
});
assert.equal(store.getActive().id, 'a');
confirm = true;
persist = false;
await React.act(async () => {
  await archive.recover();
});
assert.ok(notes.includes('storage.saveFailed'));
assert.ok(window.localStorage.getItem(recoveryKey));
persist = true;
await React.act(async () => {
  await archive.recover();
});
assert.equal(store.getActive().markdown, 'recover me');
assert.equal(window.localStorage.getItem(recoveryKey), null);
const actions = createTrashCommands({ store, t, notify, confirm: async () => confirm });
store.delete('restored', 'blank');
await actions.purgeArticle('restored');
assert.equal(store.getTrash().length, 0);
store.delete(store.getActive().id, 'blank');
await actions.emptyTrash();
assert.equal(store.getTrash().length, 0);
store.flush();

let inserted = '';
let insertedCollapsed = false;
const images = createImageInserter({
  t,
  notify,
  hostClient: host,
  describeHostError: String,
  insertBlock: (text, blockOptions) => {
    inserted = text;
    insertedCollapsed = Boolean(blockOptions?.collapseToEnd);
  },
});
const png = new window.File([new Uint8Array([137, 80, 78, 71])], 'photo.png', { type: 'image/png' });
const paste = (files: File[], items: unknown[] = []) =>
  ({ clipboardData: { files, items }, preventDefault: () => {} }) as unknown as React.ClipboardEvent<HTMLElement>;
images.handlePaste(
  paste(
    [],
    [
      { kind: 'string', type: 'text/plain' },
      { kind: 'file', type: 'image/png', getAsFile: () => null },
    ],
  ),
);
images.handlePaste(paste([], [{ kind: 'file', type: 'image/png', getAsFile: () => png }]));
await new Promise((resolve) => setTimeout(resolve, 50));
assert.ok(inserted.includes('assets/0123456789abcdef01234567.png'));
assert.equal(insertedCollapsed, true, 'image insertion collapses caret to end so consecutive pastes do not overwrite');

// Verify consecutive insertBlock({ collapseToEnd: true }) appends instead of overwriting
let fmtMd = '正文';
let fmtSel = { start: 2, end: 2 };
const fmt = createFormattingCommands({
  editorValue: () => fmtMd,
  selection: () => fmtSel,
  replaceRange: (val, s, e, txt, selS, selE) => {
    fmtMd = val.slice(0, s) + txt + val.slice(e);
    fmtSel = { start: selS ?? s + txt.length, end: selE ?? s + txt.length };
  },
  setMarkdown: () => {},
  focusRange: () => {},
  clearSlash: () => {},
  imageRef: { current: null },
  t,
  notify,
  settings: doc.settings,
  updateSettings: () => {},
});
fmt.insertBlock('![a](assets/a.png)', { collapseToEnd: true });
fmt.insertBlock('![b](assets/b.png)', { collapseToEnd: true });
assert.ok(
  fmtMd.includes('![a](assets/a.png)') && fmtMd.includes('![b](assets/b.png)'),
  'consecutive image block insertions append cleanly without overwriting',
);

// Verify editorial & block format commands (lead, tldr, pull, meta, sign, alert, taskList)
fmtMd = '';
fmtSel = { start: 0, end: 0 };
fmt.insertLead();
assert.ok(fmtMd.startsWith(':::lead\n'), 'insertLead inserts :::lead block');
fmtMd = '';
fmtSel = { start: 0, end: 0 };
fmt.insertTldr();
assert.ok(fmtMd.startsWith(':::tldr\n- '), 'insertTldr inserts :::tldr bullet block');
fmtMd = '';
fmtSel = { start: 0, end: 0 };
fmt.insertPull();
assert.ok(fmtMd.startsWith(':::pull\n'), 'insertPull inserts :::pull block');
fmtMd = '';
fmtSel = { start: 0, end: 0 };
fmt.insertMeta();
assert.ok(fmtMd.startsWith(':::meta\n'), 'insertMeta inserts :::meta block');
fmtMd = '';
fmtSel = { start: 0, end: 0 };
fmt.insertSign();
assert.ok(fmtMd.startsWith(':::sign\n'), 'insertSign inserts :::sign block');
fmtMd = '';
fmtSel = { start: 0, end: 0 };
fmt.insertAlert();
assert.ok(fmtMd.startsWith('> [!NOTE]\n> '), 'insertAlert inserts > [!NOTE] callout');
fmtMd = '第一行\n第二行';
fmtSel = { start: 0, end: fmtMd.length };
fmt.insertAlert();
assert.ok(fmtMd.includes('> [!NOTE]\n> 第一行\n> 第二行'), 'insertAlert prefixes multi-line selection');

// Verify insertCode wraps inline backticks when caret is empty or single-line, and fenced block when multi-line
fmtMd = '调用  接口';
fmtSel = { start: 3, end: 3 };
fmt.insertCode();
assert.equal(fmtMd, '调用 `toolbar.code` 接口', 'empty selection insertCode inserts inline backticks placeholder');
fmtMd = 'line1\nline2';
fmtSel = { start: 0, end: fmtMd.length };
fmt.insertCode();
assert.ok(fmtMd.includes('```js\nline1\nline2\n```'), 'multi-line selection insertCode wraps fenced block');
const fmtLine = createFormattingCommands({
  editorValue: () => fmtMd,
  selection: () => fmtSel,
  replaceRange: () => {},
  setMarkdown: (val) => {
    fmtMd = val;
  },
  focusRange: (s, e) => {
    fmtSel = { start: s, end: e };
  },
  clearSlash: () => {},
  imageRef: { current: null },
  t,
  notify,
  settings: doc.settings,
  updateSettings: () => {},
});
fmtMd = '- 已有项';
fmtSel = { start: 2, end: 2 };
fmtLine.insertTaskList();
assert.equal(fmtMd, '- [ ] 已有项', 'insertTaskList upgrades bullet line to task checkbox');

inserted = '';
images.handlePaste(paste([png]));
await new Promise((resolve) => setTimeout(resolve, 50));
assert.ok(inserted.includes('photo'));
await React.act(async () => {
  root.unmount();
});
dom.window.close();
console.log('ok - copy fallbacks, exports, search, sample actions, recovery, trash and image paste');

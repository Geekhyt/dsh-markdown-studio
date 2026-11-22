import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { unzipEntries } from '../src/adapters/zip';
import 'fake-indexeddb/auto';
import type * as ReactNamespace from 'react';
import type { Root } from 'react-dom/client';

const LEGACY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl9sAAAAASUVORK5CYII=';

let zipCrcTable: number[] | null = null;

function zipCrc32(bytes: Uint8Array): number {
  let table = zipCrcTable;
  if (!table) {
    table = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    zipCrcTable = table;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function zipU16(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff];
}

function zipU32(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}

function makeTestZip(entries: Array<{ name: string; data: Uint8Array | number[] }>): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Array<{ name: Uint8Array; data: Uint8Array; crc: number; offset: number }> = [];
  let offset = 0;
  const time = 0;
  const date = ((2026 - 1980) << 9) | (1 << 5) | 1;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const data = entry.data instanceof Uint8Array ? entry.data : new Uint8Array(entry.data);
    const crc = zipCrc32(data);
    const header = new Uint8Array([
      ...zipU32(0x04034b50),
      ...zipU16(20),
      ...zipU16(0x0800),
      ...zipU16(0),
      ...zipU16(time),
      ...zipU16(date),
      ...zipU32(crc),
      ...zipU32(data.length),
      ...zipU32(data.length),
      ...zipU16(name.length),
      ...zipU16(0),
    ]);
    chunks.push(header, name, data);
    central.push({ name, data, crc, offset });
    offset += header.length + name.length + data.length;
  }
  const centralStart = offset;
  let centralSize = 0;
  for (const entry of central) {
    const header = new Uint8Array([
      ...zipU32(0x02014b50),
      ...zipU16(20),
      ...zipU16(20),
      ...zipU16(0x0800),
      ...zipU16(0),
      ...zipU16(time),
      ...zipU16(date),
      ...zipU32(entry.crc),
      ...zipU32(entry.data.length),
      ...zipU32(entry.data.length),
      ...zipU16(entry.name.length),
      ...zipU16(0),
      ...zipU16(0),
      ...zipU16(0),
      ...zipU16(0),
      ...zipU32(0),
      ...zipU32(entry.offset),
    ]);
    chunks.push(header, entry.name);
    centralSize += header.length + entry.name.length;
  }
  chunks.push(
    new Uint8Array([
      ...zipU32(0x06054b50),
      ...zipU16(0),
      ...zipU16(0),
      ...zipU16(entries.length),
      ...zipU16(entries.length),
      ...zipU32(centralSize),
      ...zipU32(centralStart),
      ...zipU16(0),
    ]),
  );
  let total = 0;
  for (const chunk of chunks) total += chunk.length;
  const output = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    output.set(chunk, at);
    at += chunk.length;
  }
  return output;
}

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost:58345/',
  pretendToBeVisual: true,
  runScripts: 'dangerously',
});
const { window } = dom;
const { document } = window;
Object.defineProperty(window, 'indexedDB', { configurable: true, value: indexedDB });
window.__MDSTUDIO_MATH__ = {
  cssText: '',
  render: (_tex: unknown) => '<svg class="mock-math" viewBox="0 0 10 10"><path d="M0 0h10v10H0z"></path></svg>',
};

type MockResponse = {
  ok: boolean;
  status: number;
  headers: { get(name: string): string };
  json(): Promise<unknown>;
  text(): Promise<string>;
  arrayBuffer?(): Promise<ArrayBuffer>;
};

function setGlobal(name: string, value: unknown): void {
  try {
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  } catch {
    (globalThis as Record<string, unknown>)[name] = value;
  }
}

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
setGlobal('window', window);
setGlobal('document', document);
setGlobal('navigator', window.navigator);
setGlobal('Event', window.Event);
setGlobal('KeyboardEvent', window.KeyboardEvent);
setGlobal('HTMLElement', window.HTMLElement);
setGlobal('HTMLTextAreaElement', window.HTMLTextAreaElement);
setGlobal('Node', window.Node);
setGlobal('Blob', window.Blob);
setGlobal('localStorage', window.localStorage);
if (process.env.MDS_CM_SMOKE) {
  window.ResizeObserver = class ResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
  globalThis.ResizeObserver = window.ResizeObserver;
}

const React: typeof import('react') = (await import('react')).default;
const ReactDOM: typeof import('react-dom/client') = await import('react-dom/client');
const { act } = React;

let clipboard: Record<string, Blob> | string | null = null;
let lastDownloadBlob: Blob | null = null;
window.URL.createObjectURL = function (blob: Blob | MediaSource): string {
  lastDownloadBlob = blob as Blob;
  return 'blob:test';
};
window.URL.revokeObjectURL = function (): void {};
window.HTMLAnchorElement.prototype.click = function (): void {};
Object.defineProperty(window.navigator, 'clipboard', {
  configurable: true,
  value: {
    async write(items: Array<{ data: unknown }>): Promise<void> {
      clipboard = items[0]?.data as Record<string, Blob>;
    },
    async writeText(text: string): Promise<void> {
      clipboard = text;
    },
  },
});
window.ClipboardItem = class ClipboardItem {
  readonly data: unknown;
  constructor(data: unknown) {
    this.data = data;
  }
};

interface BridgeCall {
  url: string;
  body: Record<string, unknown>;
}

const bridgeCalls: BridgeCall[] = [];
let aiMockOutput: string | { code: string; message: string } =
  '我们测试了 `app.ts`。\n<<<REASON: 删去套话开头与冗余动词>>>';
function jsonResponse(data: unknown): MockResponse {
  return {
    ok: true,
    status: 200,
    headers: { get: () => 'application/json; charset=utf-8' },
    json: async () => data,
    text: async () => JSON.stringify(data),
  };
}
window.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<MockResponse> => {
  if ((!init || !init.method || init.method === 'GET') && String(input).includes('/uploads/')) {
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'image/png' },
      json: async () => ({}),
      text: async () => '',
      arrayBuffer: async () => new Uint8Array([137, 80, 78, 71]).buffer,
    };
  }
  const rawBody = init && typeof init.body === 'string' ? init.body : '{}';
  const body = JSON.parse(rawBody) as Record<string, unknown>;
  bridgeCalls.push({ url: String(input), body });
  if (body.action === 'health') {
    return jsonResponse({
      ok: true,
      service: 'markdown-studio-images',
      version: 5,
      assets: true,
      loopbackOnly: true,
      localServerUrl: 'http://127.0.0.1:4010',
      localServerPort: 4010,
    });
  }
  if (body.action === 'asset.store') {
    return jsonResponse({
      ok: true,
      url: 'http://127.0.0.1:4010/uploads/0123456789abcdef01234567.png',
      assetPath: 'assets/0123456789abcdef01234567.png',
      localUrl: 'http://127.0.0.1:4010/uploads/0123456789abcdef01234567.png',
      filename: '0123456789abcdef01234567.png',
      mime: 'image/png',
      bytes: 12,
    });
  }
  if (body.action === 'asset.list') {
    return jsonResponse({
      ok: true,
      assets: [
        {
          filename: '0123456789abcdef01234567.png',
          assetPath: 'assets/0123456789abcdef01234567.png',
          url: 'http://127.0.0.1:4010/uploads/0123456789abcdef01234567.png',
          bytes: 1234,
          mime: 'image/png',
        },
      ],
    });
  }
  if (body.action === 'asset.delete') {
    return jsonResponse({ ok: true, filename: body.filename, deleted: true });
  }
  if (body.action === 'ai.status') {
    return jsonResponse({
      ok: true,
      available: true,
      provider: 'deepseek',
      model: 'deepseek-chat',
      models: [{ provider: 'deepseek', id: 'deepseek-chat', name: 'DeepSeek Chat' }],
    });
  }
  if (body.action === 'ai.stream') {
    if (typeof aiMockOutput !== 'string') {
      return jsonResponse({ ok: false, error: aiMockOutput });
    }
    const ndjson =
      [
        JSON.stringify({ type: 'delta', text: aiMockOutput }),
        JSON.stringify({ type: 'done', provider: 'deepseek', model: 'deepseek-chat' }),
      ].join('\n') + '\n';
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'application/x-ndjson; charset=utf-8' },
      json: async () => ({}),
      text: async () => ndjson,
    };
  }
  return jsonResponse({ ok: false, error: { code: 'UNKNOWN_ACTION', message: 'unknown' } });
}) as unknown as typeof fetch;

// Exercise the actual TypeScript implementation so coverage maps to every UI/use-case module.
// The packaged loader contract remains covered by client/OSS and Chromium tests.
for (const name of [
  'NodeFilter',
  'DOMParser',
  'XMLSerializer',
  'FileReader',
  'File',
  'Image',
  'MutationObserver',
  'URL',
]) {
  setGlobal(name, (window as unknown as Record<string, unknown>)[name]);
}
setGlobal('fetch', window.fetch);
setGlobal('getComputedStyle', window.getComputedStyle.bind(window));
setGlobal('requestAnimationFrame', window.requestAnimationFrame.bind(window));
setGlobal('cancelAnimationFrame', window.cancelAnimationFrame.bind(window));
const plugin = (await import('../src/plugin-entry')).create(React);

interface Registration {
  options: { name: string; id?: string; key?: string; order?: number; label?: () => string };
  component: ReactNamespace.ComponentType;
}

const registrations: Registration[] = [];
const fakeLocale: import('../src/types/dsh').LocaleService = {
  getSnapshot() {
    return { revision: 1, locales: [{ id: 'en' }, { id: 'zh' }] };
  },
  getLocale() {
    return { active: 'zh' };
  },
  subscribe() {
    return () => {};
  },
  register() {
    return () => {};
  },
  bind() {
    return (key: string) => key;
  },
};
const fakeCtx: import('../src/types/dsh').ClientContext = {
  get<T>(name: string): T | undefined {
    return name === 'locale' ? (fakeLocale as T) : undefined;
  },
  effect(fn) {
    fn();
  },
  slots: {
    inject(_key, callback) {
      callback();
    },
    register(options, component) {
      registrations.push({ options, component });
      return () => {};
    },
  },
};
plugin.apply(fakeCtx);

const mainRegistration = registrations.find((entry) => entry.options.name === 'main');
assert.ok(mainRegistration, 'main slot is registered');
const Main = mainRegistration.component;
const container = document.createElement('div');
document.body.appendChild(container);
let reactRoot: Root | null = null;

await act(async () => {
  reactRoot = ReactDOM.createRoot(container);
  reactRoot.render(React.createElement(Main, {}));
});

function query<T extends HTMLElement = HTMLElement>(selector: string): T {
  const node = container.querySelector(selector);
  if (!node) throw new Error(`missing selector: ${selector}`);
  return node as T;
}

function queryAll<T extends Element = HTMLElement>(selector: string): T[] {
  return Array.from(container.querySelectorAll<T>(selector));
}

function byText(selector: string, text: string): HTMLElement {
  const node = Array.from(container.querySelectorAll<HTMLElement>(selector)).find((item) =>
    (item.textContent || '').includes(text),
  );
  if (!node) throw new Error(`missing text: ${text}`);
  return node;
}

async function copiedText(type: 'text/html' | 'text/plain'): Promise<string> {
  if (!clipboard || typeof clipboard === 'string') throw new Error('clipboard is empty');
  const blob = clipboard[type];
  if (!blob) throw new Error(`clipboard has no ${type}`);
  return blob.text();
}

async function settle(ms = 30): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

async function confirmDialog(): Promise<void> {
  await act(async () => {
    const submit = document.querySelector<HTMLButtonElement>('.mdstudio-dialog-submit');
    if (!submit) throw new Error('missing .mdstudio-dialog-submit');
    submit.click();
    await new Promise((resolve) => setTimeout(resolve, 120));
  });
}

async function promptDialog(value: string): Promise<void> {
  const input = document.querySelector<HTMLInputElement>('.mdstudio-dialog-input');
  if (!input) throw new Error('missing .mdstudio-dialog-input');
  const inputSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  if (!inputSetter) throw new Error('input value setter is unavailable');
  await act(async () => {
    inputSetter.call(input, value);
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  await confirmDialog();
}

if (process.env.MDS_CM_SMOKE) {
  await settle(120);
  assert.ok(query('.cm-editor'), 'CodeMirror mounts');
  console.log('ok - CodeMirror mounts in jsdom');
  process.exit(0);
}

assert.ok(query('.mdstudio-root'), 'editor page renders');
const initialTextarea = query<HTMLTextAreaElement>('textarea.mdstudio-editor');
assert.ok(initialTextarea, 'editor textarea renders');
assert.ok(initialTextarea.value.includes('常用 Markdown 语法速查'), 'sample article is loaded on first run');
assert.ok(query('.mdstudio-preview-article h1'), 'preview renders the sample heading');
assert.equal(query('.mdstudio-preview-article h1').textContent, '常用 Markdown 语法速查');
assert.ok(query('#mdstudio'), 'preview keeps the #mdstudio compatibility root');
assert.ok(query('#mdstudio').getAttribute('style')?.includes('font-size'), 'preview root is inline-styled');
assert.ok(query('.mdstudio-preview-article .mdstudio-math svg'), 'default sample includes math SVG');
assert.ok(query('.mdstudio-preview-article .mdstudio-footnotes'), 'default sample includes footnotes');
assert.ok(query('.mdstudio-preview-article .mdstudio-references'), 'default sample includes external references');
assert.ok(
  container.querySelector('.mdstudio-preview-article code.mdstudio-lang-mermaid') ||
    query('.mdstudio-preview-article img[alt="Mermaid diagram"]'),
  'default sample includes a Mermaid block or rendered diagram',
);
assert.ok(
  query('.mdstudio-preview-article img[src="http://127.0.0.1:4010/uploads/f59d29cfbd29d8d1a9d7284f.jpg"]'),
  'default sample includes a local image',
);
assert.ok(query('.mdstudio-preview-article h4'), 'default sample includes h4');
assert.ok(query('.mdstudio-preview-article h6'), 'default sample includes h6');
assert.ok(
  query('.mdstudio-preview-article .mdstudio-scroll-body'),
  'default sample includes vertical scroll container',
);
assert.ok(
  query('.mdstudio-preview-article .mdstudio-scroll-track'),
  'default sample includes horizontal scroll container',
);
const syncToggle = byText('.mdstudio-sync-btn', '同步');
assert.equal(syncToggle.getAttribute('aria-pressed'), 'true', 'scroll sync is on by default');
await act(async () => {
  syncToggle.click();
});
assert.equal(byText('.mdstudio-sync-btn', '同步').getAttribute('aria-pressed'), 'false', 'scroll sync can be disabled');
await act(async () => {
  byText('.mdstudio-sync-btn', '同步').click();
});
await act(async () => {
  byText('.mdstudio-device-btn', 'PC').click();
});
assert.ok(query('.mdstudio-device').className.includes('is-desktop'), 'PC preview fills the preview area');
await act(async () => {
  byText('.mdstudio-device-btn', '手机').click();
});
assert.ok(!query('.mdstudio-device').className.includes('is-desktop'), 'mobile preview restores the phone frame');
assert.ok(!container.querySelector('.mdstudio-preview-article style'), 'preview has no style tag');
assert.equal(container.querySelector('.mdstudio-theme-card') === null, true, 'drawer starts closed');
console.log('ok - page mounts and renders the sample article with inline styles');

const settingsButton = query<HTMLButtonElement>('button[aria-label="设置"]');
assert.ok(settingsButton.querySelector('.mdstudio-icon'), 'style entry is icon-only');
assert.equal((settingsButton.textContent || '').trim(), '', 'style entry has no visible text');
assert.equal(settingsButton.getAttribute('aria-label'), '设置', 'icon-only style entry keeps an accessible name');
assert.equal(container.querySelectorAll('.mdstudio-seg-label').length, 0, 'view switch labels are icon-only');
assert.ok(settingsButton, 'styles button exists');
const focusButton = query<HTMLButtonElement>('.mdstudio-focus-btn');
assert.ok(focusButton, 'immersive entry exists');
await act(async () => {
  focusButton.click();
});
assert.equal(
  query('.mdstudio-root').getAttribute('data-mdstudio-immersive'),
  'write',
  'immersive entry starts writing mode',
);
assert.ok(query('.mdstudio-immersive-dock'), 'immersive dock appears');
await act(async () => {
  byText('.mdstudio-immersive-mode', '预览').click();
});
assert.equal(query('.mdstudio-root').getAttribute('data-mdstudio-immersive'), 'preview', 'dock switches to preview');
await act(async () => {
  query<HTMLButtonElement>('.mdstudio-immersive-exit').click();
});
assert.equal(query('.mdstudio-root').getAttribute('data-mdstudio-immersive'), null, 'immersion exits');
console.log('ok - immersive writing and preview modes can be entered and exited');
await act(async () => {
  settingsButton.click();
});
assert.ok(query('.mdstudio-drawer'), 'settings drawer opens');
const themeCards = queryAll('.mdstudio-theme-card');
assert.equal(themeCards.length, 8, 'eight theme cards');
assert.deepEqual(
  themeCards.map((card) => card.querySelector('.mdstudio-theme-name')?.textContent?.trim()),
  ['经典', '画廊', '新知', '森系', '黑金', '文集', '简报', '海报'],
  'theme cards use clear, color-aligned Chinese names',
);
for (const card of themeCards) {
  const name = card.querySelector('.mdstudio-theme-name')?.textContent?.trim() || '';
  const swatchText = card.querySelector('.mdstudio-theme-swatch')?.textContent?.trim() || '';
  assert.equal(swatchText, '', `swatch for ${name} is purely visual without repeating the theme name`);
  assert.equal(card.querySelector('.mdstudio-theme-tag'), null, `theme card ${name} omits inline small annotations`);
  assert.equal((card.textContent || '').trim(), name, `theme card ${name} renders only its clean single name`);
}
const beforeBackground = query('#mdstudio').style.backgroundColor;
const nightCard = byText('.mdstudio-theme-card', '黑金');
assert.ok(nightCard, 'midnight theme card exists');
await act(async () => {
  nightCard.click();
});
await settle();
assert.notEqual(query('#mdstudio').style.backgroundColor, beforeBackground, 'theme switch changes the preview palette');
console.log('ok - drawer opens and theme switching updates the preview');

const draculaCard = byText('.mdstudio-code-card', 'Dracula');
await act(async () => {
  draculaCard.click();
  await new Promise((resolve) => setTimeout(resolve, 80));
});
const codeBackground = query('.mdstudio-preview-article pre').style.backgroundColor;
assert.ok(
  codeBackground === 'rgb(40, 42, 54)' || codeBackground === '#282a36',
  'code theme updates the fenced-code surface',
);
await act(async () => {
  byText('.mdstudio-code-card', '跟随主题').click();
  await new Promise((resolve) => setTimeout(resolve, 80));
});
console.log('ok - code block themes can be switched independently');

assert.equal(
  container.querySelectorAll('.mdstudio-drawer input[type="range"]').length,
  0,
  'settings replace browser range inputs with DSH capsule controls',
);
const fontCapsule18 = byText('.mdstudio-capsule-seg', '18');
await act(async () => {
  fontCapsule18.click();
  await new Promise((resolve) => setTimeout(resolve, 40));
});
assert.ok(
  query('#mdstudio').getAttribute('style')?.includes('font-size: 18px'),
  'capsule font-size segment updates preview',
);
await act(async () => {
  byText('.mdstudio-capsule-seg', '16').click();
  await new Promise((resolve) => setTimeout(resolve, 40));
});
console.log('ok - DSH capsule typography controls update font size');

const textarea: HTMLTextAreaElement = query<HTMLTextAreaElement>('textarea.mdstudio-editor');
function editorValue(): string {
  return textarea.value;
}
const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
if (!valueSetter) throw new Error('textarea value setter is unavailable');
const setter = valueSetter;
const screenForScroll = query('.mdstudio-device-screen');
Object.defineProperty(textarea, 'scrollHeight', { value: 1000, configurable: true });
Object.defineProperty(textarea, 'clientHeight', { value: 100, configurable: true });
Object.defineProperty(screenForScroll, 'scrollHeight', { value: 2000, configurable: true });
Object.defineProperty(screenForScroll, 'clientHeight', { value: 200, configurable: true });
await act(async () => {
  textarea.scrollTop = 450;
  textarea.dispatchEvent(new window.Event('scroll'));
  await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
});
assert.ok(Math.abs(screenForScroll.scrollTop - 900) < 2, 'editor scroll drives preview scroll');
await act(async () => {
  screenForScroll.scrollTop = 900;
  screenForScroll.dispatchEvent(new window.Event('scroll'));
  await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
});
assert.ok(Math.abs(textarea.scrollTop - 450) < 2, 'preview scroll drives editor scroll');
console.log('ok - editor and preview scroll stay in sync');
await act(async () => {
  setter.call(textarea, '# 新标题\n\n正文段落，带一个[外链](https://example.com/a)。\n\n![配图](missing.png)');
  textarea.dispatchEvent(new window.Event('input', { bubbles: true }));
});
await settle(80);
assert.equal(query('.mdstudio-preview-article h1').textContent, '新标题', 'typing updates the preview');
assert.ok(query('.mdstudio-preview-article .mdstudio-ref'), 'external link marker appears');
assert.ok(query('.mdstudio-preview-article .mdstudio-img-placeholder'), 'local image becomes a placeholder');
assert.ok(!container.querySelector('.mdstudio-preview-article img'), 'local image is removed from the export');
console.log('ok - typing updates the preview, links become footnotes, local images become placeholders');

const copyButton = query('.mdstudio-copy-btn');
assert.ok(copyButton, 'copy button exists');
const editorStats = query('.mdstudio-editor-stats');
assert.ok(editorStats, 'editor footer exists');
assert.ok((editorStats.textContent || '').includes('字数'), 'editor footer shows word count');
assert.ok((editorStats.textContent || '').includes('字符数'), 'editor footer shows character count');
await act(async () => {
  copyButton.click();
  await new Promise((resolve) => setTimeout(resolve, 30));
});
assert.ok(clipboard, 'clipboard received data');
const copiedHtml = await copiedText('text/html');
assert.ok(copiedHtml.includes('<section id="mdstudio"'), 'copied html uses a section root');
assert.ok(copiedHtml.includes('data-tool="dsh-markdown-studio"'), 'copied html marks the editor');
assert.ok(!copiedHtml.includes('data-mdstudio-guard'), 'copied html has no zero-height guard paragraphs');
assert.ok(
  !/line-height:\s*0(?:\.0+)?(?:px|em|rem|%)?(?=\s*[;"'])/i.test(copiedHtml),
  'copied html has no zero line-height',
);
assert.ok(!/height:\s*0(?:\.0+)?(?:px|em|rem|%)?(?=\s*[;"'])/i.test(copiedHtml), 'copied html has no zero height');
assert.ok(
  !/<span class="(?:prefix|suffix)"[^>]*style="[^"]*display: inline-block[^"]*"[^>]*><\/span>/.test(copiedHtml),
  'copied html drops empty heading decorations',
);
assert.ok(copiedHtml.includes('style="'), 'copied html carries inline styles');
assert.ok(!copiedHtml.includes('<style'), 'copied html carries no style tag');
assert.ok(copiedHtml.includes('mdstudio-references'), 'copied html includes the reference section');
assert.ok(copiedHtml.includes('mdstudio-img-placeholder'), 'copied html includes the image placeholder');
assert.ok(!copiedHtml.includes('missing.png'), 'copied html drops the local image source');
const copiedPlain = await copiedText('text/plain');
assert.ok(copiedPlain.includes('新标题'), 'plain text fallback is meaningful');
assert.ok(query('.mdstudio-toast'), 'a success toast is shown');
console.log('ok - copy produces WeChat-ready inline HTML without a style tag');

await act(async () => {
  textarea.dispatchEvent(new window.KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true }));
});
const saved = window.localStorage.getItem('dsh.markdown-studio.library.v2');
assert.ok(saved, 'shortcut saves the single library store');
const savedState = JSON.parse(saved) as { activeId: string; docs: Array<{ id: string; markdown: string }> };
assert.ok(
  savedState.docs.find((entry) => entry.id === savedState.activeId)?.markdown.includes('新标题'),
  'saved markdown is current',
);
assert.ok(window.localStorage.getItem('dsh.markdown-studio.library.backup.v2'), 'last-good library backup is written');
console.log('ok - Cmd+S persists the draft');

const previewTab = Array.from(container.querySelectorAll<HTMLElement>('.mdstudio-segmented button')).find(
  (button) => button.getAttribute('aria-label') === '预览',
);
assert.ok(previewTab, 'preview view button exists');
await act(async () => {
  previewTab.click();
});
assert.ok(query('.mdstudio-editor-pane').className.includes('is-hidden'), 'preview mode hides the editor');
const splitTab = Array.from(container.querySelectorAll<HTMLElement>('.mdstudio-segmented button')).find(
  (button) => button.getAttribute('aria-label') === '分栏',
);
assert.ok(splitTab, 'split view button exists');
await act(async () => {
  splitTab.click();
});
assert.ok(!query('.mdstudio-editor-pane').className.includes('is-hidden'), 'split mode restores the editor');
console.log('ok - view switching works');

async function setEditorValue(value: string): Promise<void> {
  await act(async () => {
    setter.call(textarea, value);
    textarea.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
  await settle(30);
}

await setEditorValue('/');
assert.ok(query('.mdstudio-slash'), 'slash palette opens at the start of a line');
assert.equal(queryAll('.mdstudio-slash-item').length, 23, 'all block commands are listed');
assert.ok(byText('.mdstudio-slash-item', '代码块'), 'code command is offered');
assert.ok(byText('.mdstudio-slash-item', '上下滑动框'), 'vertical scroll slash command is offered');
assert.ok(byText('.mdstudio-slash-item', '左右滑动框'), 'horizontal scroll slash command is offered');
assert.ok(byText('.mdstudio-slash-item', '眉题'), 'eyebrow meta slash command is offered');
assert.ok(byText('.mdstudio-slash-item', '开篇导语'), 'opening lead slash command is offered');
assert.ok(byText('.mdstudio-slash-item', '速览卡'), 'tldr slash command is offered');
assert.ok(byText('.mdstudio-slash-item', '金句'), 'pull-quote slash command is offered');
assert.ok(byText('.mdstudio-slash-item', '文末落款'), 'sign-off slash command is offered');

await setEditorValue('/lead');
assert.equal(queryAll('.mdstudio-slash-item').length, 1, 'lead query filters to opening lead block');
await act(async () => {
  textarea.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
});
await settle(40);
assert.ok(editorValue().startsWith(':::lead\n'), 'Enter on /lead inserts opening lead container');

await setEditorValue('/tldr');
assert.equal(queryAll('.mdstudio-slash-item').length, 1, 'tldr query filters to TL;DR summary card');
await act(async () => {
  textarea.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
});
await settle(40);
assert.ok(editorValue().startsWith(':::tldr\n'), 'Enter on /tldr inserts TL;DR container');

await setEditorValue('/scroll-x');
assert.equal(queryAll('.mdstudio-slash-item').length, 1, 'scroll-x query filters to horizontal scroll');
await act(async () => {
  textarea.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
});
await settle(40);
assert.ok(editorValue().startsWith(':::scroll-x\n'), 'Enter on /scroll-x inserts horizontal scroll container');

await setEditorValue('/code');
assert.equal(queryAll('.mdstudio-slash-item').length, 1, 'commands filter by typed query');
await act(async () => {
  textarea.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
});
await settle(40);
assert.equal(container.querySelector('.mdstudio-slash'), null, 'Enter closes the palette');
assert.ok(editorValue().includes('```js'), 'code block snippet was inserted');
assert.ok(editorValue().includes('\n\n'), 'code block keeps an editing line');

await setEditorValue('/table');
await act(async () => {
  const row = byText('.mdstudio-slash-item', '表格');
  assert.ok(row, 'table row exists');
  row.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
});
await settle(40);
assert.ok(editorValue().includes('| 列一 | 列二 |'), 'clicking a command inserts the table');

await setEditorValue('/h2');
assert.ok(query('.mdstudio-slash'), 'palette reopens');
await act(async () => {
  textarea.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
});
assert.equal(container.querySelector('.mdstudio-slash'), null, 'Escape closes the palette');
assert.equal(editorValue(), '/h2', 'Escape keeps the typed slash text');

await setEditorValue('hello /code');
assert.equal(container.querySelector('.mdstudio-slash'), null, 'slash does not open mid-line');
console.log('ok - slash palette opens, filters, inserts and closes');

await setEditorValue('# 图片测试\n\n');
const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
const imageFile = new window.File([pngBytes], 'shot.png', { type: 'image/png' });
const dropEvent = new window.Event('drop', { bubbles: true, cancelable: true });
Object.defineProperty(dropEvent, 'dataTransfer', { value: { files: [imageFile] } });
await act(async () => {
  textarea.dispatchEvent(dropEvent);
});
await settle(160);
assert.ok(
  editorValue().includes('assets/0123456789abcdef01234567.png'),
  'dropping an image stores a portable assets/ reference',
);
assert.ok(!editorValue().includes('data:image/png;base64,'), 'the Markdown never contains base64 image bytes');
assert.ok(
  query('.mdstudio-preview-article img[src="http://127.0.0.1:4010/uploads/0123456789abcdef01234567.png"]'),
  'preview resolves the portable asset through the local server',
);
assert.equal(
  queryAll('.mdstudio-preview-head .mdstudio-preview-meta').length,
  0,
  'preview header no longer repeats local-image metadata',
);
const storeCall = bridgeCalls.find((call) => call.body.action === 'asset.store');
assert.ok(storeCall, 'the client called the local asset store');
assert.ok(
  typeof storeCall.body.dataUrl === 'string' && storeCall.body.dataUrl.startsWith('data:image/png;base64,'),
  'the Host received the image bytes',
);

const uploadsBeforeCopy = bridgeCalls.filter((call) => call.body.action === 'asset.upload').length;
await act(async () => {
  query('.mdstudio-copy-btn').click();
  await new Promise((resolve) => setTimeout(resolve, 150));
});
await settle(80);
const imageCopy = await copiedText('text/html');
assert.ok(
  imageCopy.includes('http://127.0.0.1:4010/uploads/0123456789abcdef01234567.png'),
  'copy resolves the asset to the local showcase URL',
);
assert.ok(!imageCopy.includes('mdstudio-img-placeholder'), 'local copy needs no image placeholder');
assert.equal(
  bridgeCalls.filter((call) => call.body.action === 'asset.upload').length,
  uploadsBeforeCopy,
  'local copy does not upload anything',
);
assert.ok(
  editorValue().includes('assets/0123456789abcdef01234567.png'),
  'the Markdown keeps the portable assets/ path',
);
console.log('ok - portable assets/ paths resolve to the local showcase server in preview and copy');

await setEditorValue('# 公式\n\n$a^2+b^2=c^2$\n');
await settle(160);
assert.ok(query('.mdstudio-preview-article .mdstudio-math svg'), 'inline math renders as SVG');
await act(async () => {
  query('.mdstudio-copy-btn').click();
  await new Promise((resolve) => setTimeout(resolve, 600));
});
const mathCopy = await copiedText('text/html');
assert.ok(mathCopy.includes('<svg class="mock-math"'), 'copy includes the rendered math SVG');
assert.ok(!mathCopy.includes('<style'), 'math copy is still inline-only');

await setEditorValue('# 列表\n\n- 一级\n  - 二级\n');
await settle(120);
await act(async () => {
  query('.mdstudio-copy-btn').click();
  await new Promise((resolve) => setTimeout(resolve, 300));
});
const listCopy = await copiedText('text/html');
assert.ok(
  !/<li\b[^>]*>(?:(?!<\/li>)[\s\S])*?<(?:ul|ol)\b/i.test(listCopy),
  'copied html flattens nested lists for WeChat',
);
assert.ok(listCopy.includes('二级'), 'copied html keeps nested list content');

await setEditorValue('# 图\n\n```mermaid\ngraph TD; A-->B\n```\n');
await settle(500);
assert.ok(query('.mdstudio-preview-article'), 'mermaid block does not crash the preview');

await setEditorValue('图片测试二\n\n');
const largeFile = new window.File([new Uint8Array(9000000)], 'huge.png', { type: 'image/png' });
const largeDrop = new window.Event('drop', { bubbles: true, cancelable: true });
Object.defineProperty(largeDrop, 'dataTransfer', { value: { files: [largeFile] } });
await act(async () => {
  textarea.dispatchEvent(largeDrop);
});
await settle(40);
assert.equal(editorValue(), '图片测试二\n\n', 'oversized images are ignored');
assert.ok(query('.mdstudio-toast.is-error'), 'oversized images produce an error toast');
console.log('ok - oversized images are rejected with feedback');

textarea.focus();
await settle(10);
const focusedStyle = window.getComputedStyle(textarea);
assert.equal(focusedStyle.outlineStyle, 'none', 'the editor shows no focus ring');
assert.ok(byText('.mdstudio-section', '快捷键'), 'shortcut help section is present');
assert.ok(byText('.mdstudio-shortcut', 'Ctrl+Z'), 'undo shortcut is documented');
assert.ok(byText('.mdstudio-shortcut', 'Ctrl+Shift+B'), 'bold shortcut is documented');
console.log('ok - no editor focus ring and shortcuts are documented');

await setEditorValue('第一版');
await settle(760);
await setEditorValue('第二版');
await act(async () => {
  textarea.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true }));
});
await settle(40);
assert.equal(editorValue(), '第一版', 'Cmd+Z restores the previous revision');
await act(async () => {
  textarea.dispatchEvent(
    new window.KeyboardEvent('keydown', { key: 'z', metaKey: true, shiftKey: true, bubbles: true }),
  );
});
await settle(40);
assert.equal(editorValue(), '第二版', 'Cmd+Shift+Z redoes the revision');
const undoButton = container.querySelector('[aria-label^="撤销"]');
const redoButton = container.querySelector('[aria-label^="重做"]');
assert.ok(undoButton && redoButton, 'undo and redo toolbar buttons exist');
console.log('ok - undo and redo work from the keyboard');

await setEditorValue('hello');
await settle(760);
textarea.setSelectionRange(0, 5);
await act(async () => {
  textarea.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'b', metaKey: true, bubbles: true }));
});
await settle(40);
assert.equal(editorValue(), 'hello', 'Cmd+B is left to the Harness shell');
await act(async () => {
  textarea.dispatchEvent(
    new window.KeyboardEvent('keydown', { key: 'b', metaKey: true, shiftKey: true, bubbles: true }),
  );
});
await settle(40);
assert.equal(editorValue(), '**hello**', 'Cmd+Shift+B wraps the selection in bold');
await act(async () => {
  textarea.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true }));
});
await settle(40);
assert.equal(editorValue(), 'hello', 'formatting shortcuts are undoable');

await setEditorValue('标题行');
await settle(760);
textarea.setSelectionRange(0, 0);
await act(async () => {
  textarea.dispatchEvent(
    new window.KeyboardEvent('keydown', { key: '2', code: 'Digit2', metaKey: true, bubbles: true }),
  );
});
await settle(40);
assert.equal(editorValue(), '## 标题行', 'Cmd+2 applies a level-2 heading');
await act(async () => {
  textarea.dispatchEvent(
    new window.KeyboardEvent('keydown', { key: '*', code: 'Digit8', metaKey: true, shiftKey: true, bubbles: true }),
  );
});
await settle(40);
assert.equal(editorValue(), '- 标题行', 'Cmd+Shift+8 replaces the block with a bullet list');
await act(async () => {
  textarea.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true }));
});
await settle(40);
assert.equal(editorValue(), '## 标题行', 'block shortcuts are undoable');
const freshRedo = query<HTMLElement>('[aria-label^="重做"]');
const freshUndo = query<HTMLElement>('[aria-label^="撤销"]');
await act(async () => {
  freshRedo.click();
});
await settle(40);
assert.equal(editorValue(), '- 标题行', 'the redo button replays the last edit');
await act(async () => {
  freshUndo.click();
});
await settle(40);
assert.equal(editorValue(), '## 标题行', 'the undo button reverts the last edit');
console.log('ok - Markdown shortcuts and formatting undo work');
await setEditorValue('标题行');
await settle(760);
textarea.setSelectionRange(0, 0);
await act(async () => {
  textarea.dispatchEvent(
    new window.KeyboardEvent('keydown', { key: '6', code: 'Digit6', metaKey: true, bubbles: true }),
  );
});
await settle(40);
assert.equal(editorValue(), '###### 标题行', 'Cmd+6 applies a level-6 heading');
await act(async () => {
  query('.mdstudio-format-trigger').click();
  await new Promise((resolve) => setTimeout(resolve, 40));
});
assert.equal(
  queryAll('.mdstudio-format-menu [role="menuitem"]').length,
  33,
  'format menu lists headings, blocks, and all WeChat editorial commands',
);
assert.ok(byText('.mdstudio-format-menu [role="menuitem"]', '开篇导语'), 'format menu includes opening lead');
assert.ok(byText('.mdstudio-format-menu [role="menuitem"]', '速览卡'), 'format menu includes TL;DR card');
assert.ok(byText('.mdstudio-format-menu [role="menuitem"]', '金句'), 'format menu includes pull quote');
assert.ok(byText('.mdstudio-format-menu [role="menuitem"]', '眉题'), 'format menu includes eyebrow meta');
assert.ok(byText('.mdstudio-format-menu [role="menuitem"]', '文末落款'), 'format menu includes sign-off');
assert.ok(byText('.mdstudio-format-menu [role="menuitem"]', '提示块'), 'format menu includes callout');
assert.ok(byText('.mdstudio-format-menu [role="menuitem"]', '任务清单'), 'format menu includes task list');
await act(async () => {
  byText('.mdstudio-format-menu [role="menuitem"]', '五级标题').click();
  await new Promise((resolve) => setTimeout(resolve, 40));
});
assert.equal(editorValue(), '##### 标题行', 'heading menu applies a chosen level');
await act(async () => {
  query('.mdstudio-format-trigger').click();
  await new Promise((resolve) => setTimeout(resolve, 40));
});
await act(async () => {
  byText('.mdstudio-format-menu [role="menuitem"]', '正文').click();
  await new Promise((resolve) => setTimeout(resolve, 40));
});
assert.equal(editorValue(), '标题行', 'paragraph option removes the heading prefix');
await setEditorValue('核心导语内容');
textarea.setSelectionRange(0, 6);
await act(async () => {
  query('.mdstudio-format-trigger').click();
  await new Promise((resolve) => setTimeout(resolve, 40));
});
await act(async () => {
  byText('.mdstudio-format-menu [role="menuitem"]', '开篇导语').click();
  await new Promise((resolve) => setTimeout(resolve, 40));
});
assert.ok(editorValue().includes(':::lead\n核心导语内容\n:::'), 'format menu wraps selection into :::lead');
console.log('ok - heading menu covers H1-H6 and paragraph');
await setEditorValue('格式文本');
textarea.setSelectionRange(0, 4);
await act(async () => {
  textarea.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'u', metaKey: true, bubbles: true }));
});
await settle(40);
assert.equal(editorValue(), '++格式文本++', 'Cmd+U applies underline');
await act(async () => {
  textarea.dispatchEvent(
    new window.KeyboardEvent('keydown', { key: 'e', metaKey: true, shiftKey: true, bubbles: true }),
  );
});
await settle(40);
assert.ok(editorValue().includes('$格式文本$'), 'Cmd+Shift+E applies inline math (Notion-aligned)');
await setEditorValue('块级文本');
textarea.setSelectionRange(0, 0);
await act(async () => {
  textarea.dispatchEvent(
    new window.KeyboardEvent('keydown', {
      key: 'e',
      code: 'KeyE',
      metaKey: true,
      altKey: true,
      shiftKey: true,
      bubbles: true,
    }),
  );
});
await settle(40);
assert.ok(editorValue().includes('$$') && editorValue().includes('块级文本'), 'Cmd+Alt+Shift+E inserts a math block');
await setEditorValue('任务文本');
textarea.setSelectionRange(0, 0);
await act(async () => {
  textarea.dispatchEvent(
    new window.KeyboardEvent('keydown', { key: '4', code: 'Digit4', metaKey: true, altKey: true, bubbles: true }),
  );
});
await settle(40);
assert.equal(editorValue(), '- [ ] 任务文本', 'Cmd+Alt+4 inserts a task list item (Notion-aligned)');
await setEditorValue('代码文本');
textarea.setSelectionRange(0, 0);
await act(async () => {
  textarea.dispatchEvent(
    new window.KeyboardEvent('keydown', { key: 'c', code: 'KeyC', metaKey: true, altKey: true, bubbles: true }),
  );
});
await settle(40);
assert.ok(editorValue().includes('```') && editorValue().includes('代码文本'), 'Cmd+Alt+C inserts a code block');
await setEditorValue('列表文本');
textarea.setSelectionRange(0, 0);
await act(async () => {
  textarea.dispatchEvent(
    new window.KeyboardEvent('keydown', { key: '7', code: 'Digit7', metaKey: true, shiftKey: true, bubbles: true }),
  );
});
await settle(40);
assert.equal(editorValue(), '1. 列表文本', 'Cmd+Shift+7 applies an ordered list');
await setEditorValue('表格文本');
textarea.setSelectionRange(0, 0);
await act(async () => {
  textarea.dispatchEvent(
    new window.KeyboardEvent('keydown', { key: 't', code: 'KeyT', metaKey: true, altKey: true, bubbles: true }),
  );
});
await settle(40);
assert.ok(editorValue().includes('| 列一 |'), 'Cmd+Alt+T inserts a table');
await setEditorValue('分割线');
textarea.setSelectionRange(0, 0);
await act(async () => {
  textarea.dispatchEvent(
    new window.KeyboardEvent('keydown', { key: '-', code: 'Minus', metaKey: true, altKey: true, bubbles: true }),
  );
});
await settle(40);
assert.ok(editorValue().includes('---'), 'Cmd+Alt+- inserts a divider without conflicting with macOS Hide Others');
await act(async () => {
  textarea.dispatchEvent(
    new window.KeyboardEvent('keydown', { key: 'l', code: 'KeyL', metaKey: true, altKey: true, bubbles: true }),
  );
});
await settle(60);
const currentLibrary = JSON.parse(window.localStorage.getItem('dsh.markdown-studio.library.v2') || '{}') as {
  activeId: string;
  docs: Array<{ id: string; settings?: { linkFootnotes?: boolean } }>;
};
const activeDoc = currentLibrary.docs.find((entry) => entry.id === currentLibrary.activeId);
assert.equal(activeDoc?.settings?.linkFootnotes, true, 'Cmd+Alt+L toggles WeChat link footnotes');
await act(async () => {
  query('.mdstudio-format-trigger').click();
  await new Promise((resolve) => setTimeout(resolve, 40));
});
assert.ok(
  byText('.mdstudio-format-menu [role="menuitem"]', '微信外链转角注'),
  'format menu exposes WeChat link footnotes',
);
assert.ok(byText('.mdstudio-format-menu [role="menuitem"]', '上下滑动框'), 'format menu exposes vertical scroll box');
assert.ok(byText('.mdstudio-format-menu [role="menuitem"]', '左右滑动框'), 'format menu exposes horizontal scroll box');
assert.ok(byText('.mdstudio-format-menu [role="menuitem"]', '公式块'), 'format menu exposes math blocks');
assert.ok(byText('.mdstudio-format-menu [role="menuitem"]', '行内公式'), 'format menu exposes inline math');
assert.ok(byText('.mdstudio-format-menu [role="menuitem"]', '有序列表'), 'format menu exposes ordered lists');
await act(async () => {
  byText('.mdstudio-format-menu [role="menuitem"]', '行内公式').click();
  await new Promise((resolve) => setTimeout(resolve, 40));
});
assert.ok(editorValue().includes('$分割线$') || editorValue().includes('$'), 'inline math menu command runs');
await setEditorValue('需要收纳的长文内容');
textarea.setSelectionRange(0, 9);
await act(async () => {
  query('.mdstudio-format-trigger').click();
  await new Promise((resolve) => setTimeout(resolve, 40));
});
await act(async () => {
  byText('.mdstudio-format-menu [role="menuitem"]', '上下滑动框').click();
  await new Promise((resolve) => setTimeout(resolve, 40));
});
assert.equal(editorValue().trim(), ':::scroll\n需要收纳的长文内容\n:::', 'vertical scroll menu wraps selected text');
await act(async () => {
  query('.mdstudio-format-trigger').click();
  await new Promise((resolve) => setTimeout(resolve, 40));
});
textarea.setSelectionRange(editorValue().length, editorValue().length);
await act(async () => {
  byText('.mdstudio-format-menu [role="menuitem"]', '左右滑动框').click();
  await new Promise((resolve) => setTimeout(resolve, 60));
});
assert.ok(editorValue().includes(':::scroll-x\n'), 'horizontal scroll menu inserts template block');
await settle(60);
assert.ok(query('.mdstudio-preview-article .mdstudio-scroll-body'), 'preview renders vertical scroll container');
assert.ok(query('.mdstudio-preview-article .mdstudio-scroll-track'), 'preview renders horizontal scroll track');
console.log('ok - format shortcuts and menu entries are wired');

await setEditorValue('批量基线');
await settle(760);
await setEditorValue('批量基线 a');
await setEditorValue('批量基线 ab');
await act(async () => {
  textarea.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true }));
});
await settle(40);
assert.equal(editorValue(), '批量基线', 'rapid typing is coalesced into one undo step');
await setEditorValue('撤销后的新内容');
await act(async () => {
  textarea.dispatchEvent(
    new window.KeyboardEvent('keydown', { key: 'z', metaKey: true, shiftKey: true, bubbles: true }),
  );
});
await settle(40);
assert.equal(editorValue(), '撤销后的新内容', 'a new edit clears the redo stack');
console.log('ok - typing coalescing and redo invalidation work');

await setEditorValue('# 带图文章自动回收测试\n\n![a](assets/0123456789abcdef01234567.png)\n');
await settle(60);
const deletesBeforeTrash = bridgeCalls.filter((call) => call.body.action === 'asset.delete').length;
await act(async () => {
  query<HTMLButtonElement>('button[aria-label="文章库"]').click();
  await new Promise((resolve) => setTimeout(resolve, 60));
});
const activeDeleteBtn = query<HTMLElement>('.mdstudio-library-row button[aria-label="删除"]');
await act(async () => {
  activeDeleteBtn.click();
  await new Promise((resolve) => setTimeout(resolve, 40));
});
await confirmDialog();
await settle(80);
assert.equal(
  bridgeCalls.filter((call) => call.body.action === 'asset.delete').length,
  deletesBeforeTrash,
  'moving article to recycle bin preserves its image for potential restore',
);
await act(async () => {
  byText('.mdstudio-library-tab', '回收站').click();
  await new Promise((resolve) => setTimeout(resolve, 60));
});
const purgeBtn = query<HTMLElement>('.mdstudio-library-row button[aria-label="彻底删除"]');
await act(async () => {
  purgeBtn.click();
  await new Promise((resolve) => setTimeout(resolve, 40));
});
await confirmDialog();
await settle(100);
assert.ok(
  bridgeCalls
    .slice(deletesBeforeTrash)
    .some((call) => call.body.action === 'asset.delete' && call.body.filename === '0123456789abcdef01234567.png'),
  'permanently deleting article from recycle bin automatically deletes its unreferenced images',
);
await act(async () => {
  byText('.mdstudio-library-tab', '文章').click();
  await new Promise((resolve) => setTimeout(resolve, 40));
});
await act(async () => {
  query('.mdstudio-modal .mdstudio-search-close').click();
  await new Promise((resolve) => setTimeout(resolve, 60));
});
await setEditorValue('# Markdown 检索验证草稿\n\n正文内容\n');
await settle(40);
console.log('ok - permanently deleting an article automatically garbage-collects its unreferenced images');

const libraryButton = query<HTMLButtonElement>('button[aria-label="文章库"]');
assert.ok(libraryButton, 'library button exists');
await act(async () => {
  libraryButton.click();
  await new Promise((resolve) => setTimeout(resolve, 80));
});
assert.ok(query('.mdstudio-modal'), 'library modal opens');
const beforeNew = editorValue();
await act(async () => {
  query('.mdstudio-modal .mdstudio-btn.is-primary').click();
  await new Promise((resolve) => setTimeout(resolve, 80));
});
await settle(40);
assert.equal(editorValue(), '', 'new article starts empty');
await act(async () => {
  libraryButton.click();
  await new Promise((resolve) => setTimeout(resolve, 80));
});
const libraryRows = queryAll('.mdstudio-library-main');
assert.ok(libraryRows.length >= 2, 'library keeps the previous article');
await act(async () => {
  libraryRows[1].click();
  await new Promise((resolve) => setTimeout(resolve, 80));
});
await settle(40);
assert.equal(editorValue(), beforeNew, 'switching documents restores the previous article');
console.log('ok - multi-document library creates and switches articles');
await act(async () => {
  libraryButton.click();
  await new Promise((resolve) => setTimeout(resolve, 80));
});
const searchInput = query<HTMLInputElement>('.mdstudio-library-search');
const searchSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
if (!searchSetter) throw new Error('search value setter is unavailable');
await act(async () => {
  searchSetter.call(searchInput, 'Markdown');
  searchInput.dispatchEvent(new window.Event('input', { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 80));
});
assert.ok(queryAll('.mdstudio-library-row').length >= 1, 'library search finds matching articles');
assert.ok(query('.mdstudio-search-hit'), 'search result highlights the match');
await act(async () => {
  searchSetter.call(searchInput, '');
  searchInput.dispatchEvent(new window.Event('input', { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 80));
});
const firstRow = query('.mdstudio-library-row');
const firstTitle = firstRow.querySelector('.mdstudio-library-title')?.textContent || '';
const firstDelete = firstRow.querySelector<HTMLElement>('button[aria-label="删除"]');
assert.ok(firstDelete, 'library row has a delete icon action');
await act(async () => {
  firstDelete.click();
  await new Promise((resolve) => setTimeout(resolve, 40));
});
await confirmDialog();
const trashTab = byText('.mdstudio-library-tab', '回收站');
await act(async () => {
  trashTab.click();
  await new Promise((resolve) => setTimeout(resolve, 60));
});
assert.ok(query('.mdstudio-library-trash-bar'), 'trash tab displays contextual trash header bar');
assert.ok(byText('.mdstudio-library-title', firstTitle), 'deleted article appears in trash');
const restoreButton = container.querySelector<HTMLElement>('.mdstudio-library-restore-btn');
assert.ok(restoreButton, 'trash row has a restore button');
await act(async () => {
  restoreButton.click();
  await new Promise((resolve) => setTimeout(resolve, 80));
});
await act(async () => {
  byText('.mdstudio-library-tab', '文章').click();
  await new Promise((resolve) => setTimeout(resolve, 60));
});
assert.ok(byText('.mdstudio-library-title', firstTitle), 'restored article returns to the library');
await act(async () => {
  query('.mdstudio-modal .mdstudio-search-close').click();
  await new Promise((resolve) => setTimeout(resolve, 60));
});
console.log('ok - library search, trash and restore');
await act(async () => {
  setEditorValue('# Snapshot content\n');
  await new Promise((resolve) => setTimeout(resolve, 60));
});
if (!container.querySelector('.mdstudio-drawer')) {
  await act(async () => {
    query('button[aria-label="设置"]').click();
    await new Promise((resolve) => setTimeout(resolve, 80));
  });
}
const tablist = query('.mdstudio-drawer-tabs');
assert.equal(
  tablist.querySelectorAll('.mdstudio-drawer-tab .mdstudio-icon').length,
  2,
  'settings tabs expose two clean tabs (theme, help)',
);
assert.equal(tablist.getAttribute('role'), 'tablist');
assert.ok(query('[role="tab"][aria-selected="true"]'), 'drawer exposes the selected tab');
await act(async () => {
  tablist.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 60));
});
assert.equal(
  container.querySelector('.mdstudio-drawer')?.getAttribute('data-mdstudio-tab'),
  'help',
  'arrow key moves to the help tab',
);
assert.equal(query('.mdstudio-drawer-body').getAttribute('role'), 'tabpanel', 'drawer body is a tabpanel');
await act(async () => {
  byText('.mdstudio-drawer-tab', '主题').click();
  await new Promise((resolve) => setTimeout(resolve, 60));
});
assert.equal(
  container.querySelector('.mdstudio-drawer')?.getAttribute('data-mdstudio-tab'),
  'theme',
  'theme tab is selected',
);
await act(async () => {
  query<HTMLButtonElement>('.mdstudio-section-action').click();
  await new Promise((resolve) => setTimeout(resolve, 60));
});
assert.equal(
  container.querySelector('.mdstudio-drawer'),
  null,
  'entering CSS workbench closes settings drawer to free full 50/50 split',
);
assert.ok(container.querySelector('.mdstudio-css-workbench'), 'left-pane CSS workbench opens');
const cssArea = query<HTMLTextAreaElement>('.mdstudio-css');
const nameInput = query<HTMLInputElement>('.mdstudio-css-name');
const inputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
assert.equal(nameInput.value, '自定义主题 1', 'new custom theme starts with an auto-numbered name');
assert.ok(cssArea.value.includes('--mdstudio-accent'), 'default example starts from the first theme tokens');
assert.ok(cssArea.value.includes('.mdstudio-content h2'), 'default example includes the full first-theme rules');
assert.ok(cssArea.value.includes('/* ---- 主题变量 ---- */'), 'default example includes section comments');
assert.ok(cssArea.value.includes('\n\n'), 'default example has readable spacing');
assert.equal(container.querySelector('.mdstudio-css-status'), null, 'compatibility status block is removed');
assert.equal((container.textContent || '').includes('允许外部 CSS 资源'), false, 'external CSS toggle is removed');
assert.equal((container.textContent || '').includes('默认载入 Classic'), false, 'custom CSS footer help is removed');
await act(async () => {
  inputValueSetter.call(nameInput, '朱砂红');
  nameInput.dispatchEvent(new window.Event('input', { bubbles: true }));
  setter.call(cssArea, '#mdstudio { --mdstudio-accent: #dc2626; --mdstudio-text: #ff0000; }');
  cssArea.dispatchEvent(new window.Event('input', { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 60));
});
assert.equal(
  query<HTMLElement>('.mdstudio-preview-article #mdstudio').style.color,
  'rgb(255, 0, 0)',
  'CSS draft live-previews immediately before saving',
);
await act(async () => {
  byText('.mdstudio-css-toolbar button', '保存并启用').click();
  await new Promise((resolve) => setTimeout(resolve, 100));
});
assert.equal(byText('.mdstudio-css-state', '已应用')?.textContent, '已应用', 'saved custom theme becomes active');
assert.equal(
  query<HTMLElement>('.mdstudio-preview-article #mdstudio').style.color,
  'rgb(255, 0, 0)',
  'first custom theme updates live preview',
);

await act(async () => {
  query<HTMLButtonElement>('.mdstudio-custom-add-btn').click();
  await new Promise((resolve) => setTimeout(resolve, 60));
});
await act(async () => {
  inputValueSetter.call(nameInput, '极光青');
  nameInput.dispatchEvent(new window.Event('input', { bubbles: true }));
  setter.call(cssArea, '#mdstudio { --mdstudio-bg: #111827; --mdstudio-accent: #14b8a6; --mdstudio-text: #00aa88; }');
  cssArea.dispatchEvent(new window.Event('input', { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 60));
});
await act(async () => {
  byText('.mdstudio-css-toolbar button', '保存并启用').click();
  await new Promise((resolve) => setTimeout(resolve, 100));
});
assert.equal(
  query<HTMLElement>('.mdstudio-preview-article #mdstudio').style.color,
  'rgb(0, 170, 136)',
  'second custom theme updates live preview',
);

await act(async () => {
  query<HTMLButtonElement>('.mdstudio-css-back-btn').click();
  await new Promise((resolve) => setTimeout(resolve, 60));
});
assert.equal(container.querySelector('.mdstudio-css-workbench'), null, 'back button returns to Markdown editor');
await act(async () => {
  query('button[aria-label="设置"]').click();
  await new Promise((resolve) => setTimeout(resolve, 60));
});
assert.equal(
  container.querySelectorAll('.mdstudio-theme-grid .mdstudio-theme-card').length,
  10,
  '8 built-in + 2 custom themes appear in Theme Presets',
);
await act(async () => {
  byText('.mdstudio-theme-grid .mdstudio-theme-card', '朱砂红').click();
  await new Promise((resolve) => setTimeout(resolve, 80));
});
assert.equal(
  query<HTMLElement>('.mdstudio-preview-article #mdstudio').style.color,
  'rgb(255, 0, 0)',
  'picking first custom theme card in Theme Presets applies its CSS',
);

const editCustomBtn = query<HTMLButtonElement>('button[aria-label="编辑主题 极光青"]');
await act(async () => {
  editCustomBtn.click();
  await new Promise((resolve) => setTimeout(resolve, 60));
});
assert.ok(
  container.querySelector('.mdstudio-css-workbench'),
  'edit icon on custom theme card opens left-pane CSS workbench',
);
assert.equal(
  query<HTMLInputElement>('.mdstudio-css-name').value,
  '极光青',
  'CSS editor loads the clicked custom theme',
);
await act(async () => {
  byText('.mdstudio-css-toolbar button', '删除').click();
  await new Promise((resolve) => setTimeout(resolve, 60));
});
assert.equal(
  query<HTMLInputElement>('.mdstudio-css-name').value,
  '朱砂红',
  'deleting one custom theme selects the remaining custom theme',
);
await act(async () => {
  byText('.mdstudio-css-toolbar button', '删除').click();
  await new Promise((resolve) => setTimeout(resolve, 60));
});
await act(async () => {
  query<HTMLButtonElement>('.mdstudio-css-back-btn').click();
  await new Promise((resolve) => setTimeout(resolve, 60));
});
await act(async () => {
  query('button[aria-label="设置"]').click();
  await new Promise((resolve) => setTimeout(resolve, 60));
});
assert.equal(
  container.querySelectorAll('.mdstudio-theme-grid .mdstudio-theme-card').length,
  8,
  'deleting all custom themes restores 8 preset cards',
);
if (container.querySelector('.mdstudio-drawer')) {
  await act(async () => {
    query('button[aria-label="设置"]').click();
    await new Promise((resolve) => setTimeout(resolve, 60));
  });
}

await act(async () => {
  libraryButton.focus();
  libraryButton.click();
  await new Promise((resolve) => setTimeout(resolve, 80));
});
await act(async () => {
  query('.mdstudio-modal .mdstudio-search-close').click();
  await new Promise((resolve) => setTimeout(resolve, 80));
});
await settle(30);
assert.equal(document.activeElement, libraryButton, 'closing the library restores focus to the opener');
await act(async () => {
  libraryButton.click();
  await new Promise((resolve) => setTimeout(resolve, 80));
});
assert.ok(query('.mdstudio-library-modal.is-headless'), 'library modal renders in headless single-header mode');
const importBackup = {
  format: 'markdown-studio-library',
  version: 1,
  exportedAt: new Date().toISOString(),
  activeId: 'backup',
  docs: [
    { id: 'backup', title: '备份文章', markdown: '# 备份内容\n', settings: {}, view: 'split', updatedAt: Date.now() },
  ],
};
const importFile = new window.File([JSON.stringify(importBackup)], 'backup.json', { type: 'application/json' });
const importInput = query<HTMLInputElement>('.mdstudio-modal input[type="file"]');
Object.defineProperty(importInput, 'files', { value: [importFile], configurable: true });
await act(async () => {
  importInput.dispatchEvent(new window.Event('change', { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 80));
});
assert.ok(query('.mdstudio-import-mode-dialog'), 'picking a backup file opens post-pick ImportModeDialog');
await act(async () => {
  query<HTMLButtonElement>('.mdstudio-import-replace-btn').click();
  await new Promise((resolve) => setTimeout(resolve, 80));
});
await settle(60);
assert.ok(editorValue().includes('# 备份内容'), 'library backup replace import restores the active article');
assert.ok(
  window.localStorage.getItem('dsh.markdown-studio.library.import-recovery.v1'),
  'import writes a pre-import recovery point',
);

// Test merge import with same-id conflict resolution via segmented toggle
const conflictBackup = {
  format: 'markdown-studio-library',
  version: 1,
  exportedAt: new Date().toISOString(),
  activeId: 'backup',
  docs: [
    {
      id: 'backup',
      title: '冲突文章',
      markdown: '# 导入的新版本\n',
      settings: {},
      view: 'split',
      updatedAt: Date.now() + 1000,
    },
    {
      id: 'extra',
      title: '新增文章',
      markdown: '# 额外合并内容\n',
      settings: {},
      view: 'split',
      updatedAt: Date.now(),
    },
  ],
};
await act(async () => {
  libraryButton.click();
  await new Promise((resolve) => setTimeout(resolve, 80));
});
const conflictFile = new window.File([JSON.stringify(conflictBackup)], 'conflict.json', { type: 'application/json' });
const conflictInput = query<HTMLInputElement>('.mdstudio-modal input[type="file"]');
Object.defineProperty(conflictInput, 'files', { value: [conflictFile], configurable: true });
await act(async () => {
  conflictInput.dispatchEvent(new window.Event('change', { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 80));
});
await act(async () => {
  query<HTMLButtonElement>('.mdstudio-import-merge-btn').click();
  await new Promise((resolve) => setTimeout(resolve, 80));
});
assert.ok(query('.mdstudio-conflict-dialog'), 'merge import with matching article id opens MergeConflictDialog');
await act(async () => {
  byText('.mdstudio-conflict-seg button', '保留当前').click();
  await new Promise((resolve) => setTimeout(resolve, 40));
});
await act(async () => {
  byText('.mdstudio-conflict-dialog button', '应用合并').click();
  await new Promise((resolve) => setTimeout(resolve, 80));
});
await settle(60);
assert.ok(
  editorValue().includes('# 备份内容'),
  'keeping current version in conflict dialog preserves current markdown',
);

await setEditorValue('# 完整备份\n\n![x](assets/0123456789abcdef01234567.png)\n');
await act(async () => {
  libraryButton.click();
  await new Promise((resolve) => setTimeout(resolve, 80));
});
await act(async () => {
  query<HTMLButtonElement>('.mdstudio-library-more-btn').click();
  await new Promise((resolve) => setTimeout(resolve, 60));
});
assert.ok(
  byText('.mdstudio-library-menu [role="menuitem"]', '恢复导入前'),
  'library more menu exposes the pre-import recovery action',
);
await act(async () => {
  byText('.mdstudio-library-menu [role="menuitem"]', '导出文章库备份').click();
  await new Promise((resolve) => setTimeout(resolve, 200));
});
assert.ok(lastDownloadBlob, 'full library archive creates a zip download');
const archiveEntries = await unzipEntries(await (lastDownloadBlob as Blob).arrayBuffer());
const names = archiveEntries.map((entry) => entry.name);
assert.ok(names.includes('library.json'), 'archive contains library.json');
const backupText = new TextDecoder().decode(archiveEntries.find((entry) => entry.name === 'library.json')?.data);
const backupJson = JSON.parse(backupText) as { format: string; docs: unknown[] };
assert.equal(backupJson.format, 'markdown-studio-library', 'library backup inside zip has a versioned format');
assert.ok(backupJson.docs.length >= 2, 'library backup inside zip contains all articles');
assert.ok(names.includes('manifest.json'), 'archive contains manifest.json');
assert.ok(names.includes('assets/0123456789abcdef01234567.png'), 'archive contains referenced images');
const archiveManifest = JSON.parse(
  new TextDecoder().decode(archiveEntries.find((entry) => entry.name === 'manifest.json')?.data),
) as { format: string; assets: string[]; schemaVersion: number };
assert.equal(archiveManifest.format, 'markdown-studio-archive');
assert.equal(archiveManifest.schemaVersion, 2, 'archive manifest records the schema version');
assert.ok(archiveManifest.assets.includes('0123456789abcdef01234567.png'));
const zipBackup = new window.File([await (lastDownloadBlob as Blob).arrayBuffer()], 'library.zip', {
  type: 'application/zip',
});
const archiveInput = query<HTMLInputElement>('.mdstudio-modal input[type="file"]');
Object.defineProperty(archiveInput, 'files', { value: [zipBackup], configurable: true });
await act(async () => {
  archiveInput.dispatchEvent(new window.Event('change', { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 160));
});
await act(async () => {
  query<HTMLButtonElement>('.mdstudio-import-replace-btn').click();
  await new Promise((resolve) => setTimeout(resolve, 160));
});
await settle(160);
assert.ok(editorValue().includes('# 完整备份'), 'full archive import restores the article');
assert.ok(
  query('.mdstudio-preview-article img[src="http://127.0.0.1:4010/uploads/0123456789abcdef01234567.png"]'),
  'full archive restores image assets',
);
console.log('ok - full library archive export and import');

let folderContent = '# Folder note\n\nFrom the folder.\n';
let folderModified = 1000;
let folderMissing = false;
let folderPermission: 'granted' | 'denied' = 'granted';
interface FakeFile {
  kind: 'file';
  name: string;
  getFile: () => Promise<File>;
  createWritable: () => Promise<{ write: (data: unknown) => Promise<void>; close: () => Promise<void> }>;
}
function fakeFile(name: string, initial = ''): FakeFile {
  let content = initial;
  return {
    kind: 'file',
    name: name,
    getFile: async () => new window.File([content], name, { type: 'text/markdown' }),
    createWritable: async () => ({
      write: async (data: unknown) => {
        content = String(data);
      },
      close: async () => {},
    }),
  };
}
const noteFile: FakeFile = {
  kind: 'file',
  name: 'note.md',
  getFile: async () => {
    if (folderMissing) throw new window.Error('missing');
    return new window.File([folderContent], 'note.md', { type: 'text/markdown', lastModified: folderModified });
  },
  createWritable: async () => ({
    write: async (data: unknown) => {
      folderContent = String(data);
      folderModified += 1;
    },
    close: async () => {},
  }),
};
const nestedFile = fakeFile('nested.md', '# Nested\n');
const files = new Map<string, FakeFile>([
  ['note.md', noteFile],
  ['nested.md', nestedFile],
]);
const archiveFiles = new Map<string, FakeFile>();
let draftsVisible = true;
let archiveCreated = false;
const archiveDirectory = {
  kind: 'directory',
  name: 'archive',
  values: async function* () {
    for (const file of archiveFiles.values()) yield file;
  },
  getFileHandle: async (name: string, options?: { create?: boolean }) => {
    const existing = archiveFiles.get(name);
    if (existing) return existing;
    if (options?.create) {
      const file = fakeFile(name);
      archiveFiles.set(name, file);
      return file;
    }
    throw new window.Error('missing archive file');
  },
  getDirectoryHandle: async () => {
    throw new window.Error('no archive directory');
  },
  removeEntry: async (name: string) => {
    archiveFiles.delete(name);
  },
  queryPermission: async () => 'granted',
};
const nestedDirectoryHandle = {
  kind: 'directory',
  name: 'drafts',
  values: async function* () {
    yield nestedFile;
  },
  getFileHandle: async (name: string, options?: { create?: boolean }) => {
    if (name === 'nested.md') return nestedFile;
    if (options?.create) {
      const file = fakeFile(name);
      files.set('drafts/' + name, file);
      return file;
    }
    throw new window.Error('missing nested file');
  },
  removeEntry: async (name: string) => {
    files.delete('drafts/' + name);
  },
  queryPermission: async () => 'granted',
};
const folderHandle = {
  kind: 'directory',
  name: 'notes',
  values: async function* () {
    for (const file of files.values()) yield file;
    if (draftsVisible) yield nestedDirectoryHandle;
    if (archiveCreated) yield archiveDirectory;
  },
  getFileHandle: async (name: string, options?: { create?: boolean }) => {
    const existing = files.get(name);
    if (existing) return existing;
    if (options?.create) {
      const file = fakeFile(name);
      files.set(name, file);
      return file;
    }
    throw new window.Error('missing file');
  },
  getDirectoryHandle: async (name: string, options?: { create?: boolean }) => {
    if (name === 'drafts') return nestedDirectoryHandle;
    if (name === 'archive') {
      if (!archiveCreated && !options?.create) throw new window.Error('missing archive');
      archiveCreated = true;
      return archiveDirectory;
    }
    throw new window.Error('no assets');
  },
  removeEntry: async (name: string) => {
    if (name === 'drafts') draftsVisible = false;
    else files.delete(name);
  },
  queryPermission: async () => folderPermission,
  requestPermission: async () => {
    folderPermission = 'granted';
    return 'granted';
  },
} as unknown as FileSystemDirectoryHandle;
window.showDirectoryPicker = async () => folderHandle;
await act(async () => {
  query('button[aria-label="更多"]').click();
  await new Promise((resolve) => setTimeout(resolve, 40));
});
const folderItem = byText('.mdstudio-menu-item', '打开文件夹');
assert.ok(folderItem, 'folder workspace menu item exists');
await act(async () => {
  folderItem.click();
  await new Promise((resolve) => setTimeout(resolve, 120));
});
assert.ok(query('.mdstudio-modal'), 'folder workspace modal opens');
assert.ok(byText('.mdstudio-library-title', 'note.md'), 'folder workspace lists Markdown files');
assert.ok(byText('.mdstudio-workspace-dir', 'drafts'), 'folder workspace renders nested directories');
assert.ok(query('.mdstudio-workspace-caret svg'), 'folder workspace directory renders SVG chevron caret');
assert.ok(byText('.mdstudio-library-title', 'nested.md'), 'folder workspace renders nested Markdown files');
const workspaceSearch = query<HTMLInputElement>('.mdstudio-workspace-search');
await act(async () => {
  searchSetter?.call(workspaceSearch, 'nested');
  workspaceSearch.dispatchEvent(new window.Event('input', { bubbles: true }));
});
await settle(60);
assert.ok(byText('.mdstudio-library-title', 'nested.md'), 'workspace search keeps matching files');
assert.equal(
  Array.from(container.querySelectorAll('.mdstudio-library-title')).some((node) => node.textContent === 'note.md'),
  false,
  'workspace search hides non-matching files',
);
await act(async () => {
  searchSetter?.call(workspaceSearch, '');
  workspaceSearch.dispatchEvent(new window.Event('input', { bubbles: true }));
});
await settle(60);
const draftsBtn = byText('.mdstudio-workspace-dir', 'drafts');
assert.equal(
  draftsBtn.getAttribute('aria-expanded'),
  'true',
  'workspace directory starts expanded with downward caret',
);
const draftsCaret = draftsBtn.querySelector<HTMLElement>('.mdstudio-workspace-caret');
assert.ok(draftsCaret, 'workspace directory caret exists');
await act(async () => {
  draftsCaret.click();
});
assert.equal(draftsBtn.getAttribute('aria-expanded'), 'false', 'clicking caret collapses workspace directory');
assert.equal(
  container.querySelector('button[title="drafts/nested.md"]'),
  null,
  'collapsed directory hides nested child files',
);
await act(async () => {
  draftsCaret.click();
});
assert.equal(draftsBtn.getAttribute('aria-expanded'), 'true', 'clicking caret again re-expands workspace directory');
assert.ok(container.querySelector('button[title="drafts/nested.md"]'), 're-expanded directory shows nested child file');
const draftsRow = draftsBtn.closest('.mdstudio-workspace-row');
assert.ok(draftsRow, 'directory row exists');
const renameDirectoryButton = draftsRow.querySelector<HTMLElement>('button[aria-label="重命名"]');
assert.ok(renameDirectoryButton, 'directory row has a rename icon action');
await act(async () => {
  renameDirectoryButton.click();
  await new Promise((resolve) => setTimeout(resolve, 40));
});
await promptDialog('archive');
assert.ok(byText('.mdstudio-workspace-dir', 'archive'), 'directory rename creates the new directory');
assert.equal(
  container.querySelector('.mdstudio-workspace-dir')?.textContent?.includes('drafts'),
  false,
  'old directory is removed',
);
await act(async () => {
  byText('.mdstudio-workspace-toolbar button', '新建文件').click();
  await new Promise((resolve) => setTimeout(resolve, 40));
});
await promptDialog('new-note.md');
assert.ok(byText('.mdstudio-library-title', 'new-note.md'), 'folder workspace creates a Markdown file');
const newRow = byText('.mdstudio-library-title', 'new-note.md').closest('.mdstudio-workspace-row');
assert.ok(newRow, 'new file row exists');
const renameButton = newRow.querySelector<HTMLElement>('button[aria-label="重命名"]');
assert.ok(renameButton, 'new file row has a rename icon action');
await act(async () => {
  renameButton.click();
  await new Promise((resolve) => setTimeout(resolve, 40));
});
await promptDialog('renamed.md');
assert.ok(byText('.mdstudio-library-title', 'renamed.md'), 'folder workspace renames a Markdown file');
const renamedRow = byText('.mdstudio-library-title', 'renamed.md').closest('.mdstudio-workspace-row');
assert.ok(renamedRow, 'renamed file row exists');
const moveButton = renamedRow.querySelector<HTMLElement>('button[aria-label="移动"]');
assert.ok(moveButton, 'file row has a move icon action');
await act(async () => {
  moveButton.click();
  await new Promise((resolve) => setTimeout(resolve, 40));
});
await promptDialog('archive');
assert.ok(byText('.mdstudio-library-title', 'renamed.md'), 'moved file remains in the tree');
assert.ok(query('.mdstudio-workspace-dir')?.textContent?.includes('archive'), 'archive directory exists after move');
const movedRow = byText('.mdstudio-library-title', 'renamed.md').closest('.mdstudio-workspace-row');
assert.ok(movedRow, 'moved file row exists');
const deleteButton = movedRow.querySelector<HTMLElement>('button[aria-label="删除"]');
assert.ok(deleteButton, 'renamed file row has a delete icon action');
await act(async () => {
  deleteButton.click();
  await new Promise((resolve) => setTimeout(resolve, 40));
});
await confirmDialog();
assert.equal(
  Array.from(container.querySelectorAll('.mdstudio-library-title')).some((node) => node.textContent === 'renamed.md'),
  false,
  'deleted file is removed',
);
folderPermission = 'denied';
await act(async () => {
  byText('.mdstudio-library-main', 'note.md').click();
  await new Promise((resolve) => setTimeout(resolve, 120));
});
await settle(40);
assert.ok(editorValue().includes('# Folder note'), 'folder workspace opens a Markdown file');
await settle(60);
assert.ok(byText('.mdstudio-conflict', '重新授权'), 'denied write permission shows a re-authorize action');
await act(async () => {
  byText('.mdstudio-conflict', '重新授权').click();
  await new Promise((resolve) => setTimeout(resolve, 80));
});
assert.equal(
  Array.from(container.querySelectorAll('.mdstudio-conflict')).some((node) => node.textContent === '重新授权'),
  false,
  're-authorize clears the permission warning',
);
folderContent = '# Changed externally\n';
folderModified = 2000;
await act(async () => {
  window.dispatchEvent(new window.Event('focus'));
  await new Promise((resolve) => setTimeout(resolve, 80));
});
await settle(80);
assert.ok(
  query('.mdstudio-file-banner .mdstudio-conflict'),
  'external file changes surface in dedicated .mdstudio-file-banner',
);
assert.equal(
  Boolean(container.querySelector('.mdstudio-toolbar .mdstudio-conflict')),
  false,
  'conflict alert is never placed inside horizontally scrolling .mdstudio-toolbar',
);
assert.ok(editorValue().includes('# Folder note'), 'conflict does not overwrite the editor silently');
await act(async () => {
  query('.mdstudio-conflict').click();
  await new Promise((resolve) => setTimeout(resolve, 100));
});
assert.ok(editorValue().includes('# Changed externally'), 'reload applies the external file content');
assert.ok(!container.querySelector('.mdstudio-conflict'), 'reload clears the conflict');
folderMissing = true;
await act(async () => {
  setter.call(textarea, '# Trigger missing file\n');
  textarea.dispatchEvent(new window.Event('input', { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 1350));
});
await settle(80);
assert.ok(query('.mdstudio-conflict'), 'missing linked file surfaces a conflict');
assert.ok(
  (query('.mdstudio-toast').textContent || '').includes('文件已被移动或删除'),
  'missing file has an explicit message',
);
folderMissing = false;
console.log('ok - folder workspace lists, opens and detects external changes');

const zipBytes = makeTestZip([
  { name: 'article.md', data: new TextEncoder().encode('# Imported\n\n![x](assets/0123456789abcdef01234567.png)\n') },
  { name: 'assets/0123456789abcdef01234567.png', data: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]) },
]);
const zipFile = new window.File([zipBytes as unknown as BlobPart], 'bundle.zip', { type: 'application/zip' });
const zipInput = queryAll<HTMLInputElement>('input[type="file"]').find((input) =>
  String(input.accept || '').includes('.zip'),
);
assert.ok(zipInput, 'zip file input exists');
Object.defineProperty(zipInput, 'files', { value: [zipFile], configurable: true });
await act(async () => {
  zipInput.dispatchEvent(new window.Event('change', { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 400));
});
await settle(80);
assert.ok(editorValue().includes('# Imported'), 'article bundle restores the Markdown');
assert.ok(
  editorValue().includes('assets/0123456789abcdef01234567.png'),
  'article bundle restores portable image references',
);
assert.ok(
  query('.mdstudio-preview-article img[src="http://127.0.0.1:4010/uploads/0123456789abcdef01234567.png"]'),
  'imported asset resolves through the local server',
);
console.log('ok - article bundle import restores Markdown and assets');

await setEditorValue('# Export me\n\n![x](assets/0123456789abcdef01234567.png)\n');
await act(async () => {
  query('button[aria-label="更多"]').click();
  await new Promise((resolve) => setTimeout(resolve, 40));
});
const exportItem = byText('.mdstudio-menu-item', '导出文章包 (.zip)');
assert.ok(exportItem, 'article bundle export menu item exists');
await act(async () => {
  exportItem.click();
  await new Promise((resolve) => setTimeout(resolve, 500));
});
assert.ok(lastDownloadBlob, 'article bundle export creates a zip blob');
const exportBlob = lastDownloadBlob as Blob;
const exportBytes = new Uint8Array(await exportBlob.arrayBuffer());
const exportLatin = Buffer.from(exportBytes).toString('latin1');
assert.equal(exportBytes[0], 0x50, 'export starts with a ZIP local header');
assert.ok(exportLatin.includes('article.md'), 'export contains article.md');
assert.ok(exportLatin.includes('assets/0123456789abcdef01234567.png'), 'export contains the asset path');
console.log('ok - article bundle export writes Markdown and assets');

// AI Writing Skills: selection-only floating pill, live preview, Tab accept + Undo, and header More-menu Skill Manager
{
  const sourceDoc = '# AI 审阅\n\n在当今时代背景下，我们对 `app.ts` 进行了测试。\n\n总而言之，让我们拭目以待！\n';
  await setEditorValue(sourceDoc);
  assert.equal(
    container.querySelector('.mdstudio-toolbar .mdstudio-skill-split'),
    null,
    'formatting toolbar contains no AI skill button',
  );

  const selectTextareaRange = async (start: number, end: number): Promise<void> => {
    await act(async () => {
      textarea.focus();
      textarea.setSelectionRange(start, end);
      textarea.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true }));
    });
    await settle(30);
  };

  // Collapsed cursor: no floating pill and Mod+J is a safe no-op (never rewrites whole document)
  await selectTextareaRange(0, 0);
  await act(async () => {
    textarea.dispatchEvent(
      new window.KeyboardEvent('keydown', { key: 'j', ctrlKey: true, bubbles: true, cancelable: true }),
    );
  });
  await settle(40);
  assert.equal(
    container.querySelector('.mdstudio-skill-split.is-floating'),
    null,
    'no floating pill without selection',
  );
  assert.equal(
    container.querySelector('.mdstudio-ai-inline-card'),
    null,
    'Mod+J without selection never triggers whole-document rewrite',
  );

  const p1Text = '在当今时代背景下，我们对 `app.ts` 进行了测试。';
  const p1Start = sourceDoc.indexOf(p1Text);
  const p1End = p1Start + p1Text.length;

  await selectTextareaRange(p1Start, p1End);
  const floatRunBtn = query<HTMLButtonElement>('.mdstudio-skill-split.is-floating .mdstudio-skill-run-btn');
  assert.ok(floatRunBtn.textContent?.includes('去 AI 味'), 'floating selection pill displays active skill');

  aiMockOutput = '我们测试了 `app.ts`。\n<<<REASON: 删去套话与进行测试冗余动词>>>';
  await act(async () => {
    floatRunBtn.click();
  });
  await settle(80);
  assert.ok(query('.mdstudio-ai-inline-card'), 'selection rewrite opens inline review card');
  assert.ok(
    query('.mdstudio-preview-article').textContent?.includes('我们测试了'),
    'WeChat preview live-updates before accepting',
  );
  assert.ok(editorValue().includes(p1Text), 'raw Markdown stays untouched until accepted');

  // Accept via Tab and verify single-step Undo
  await act(async () => {
    textarea.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
  });
  await settle(40);
  assert.equal(container.querySelector('.mdstudio-ai-inline-card'), null, 'Tab accepts and closes inline card');
  assert.ok(editorValue().includes('我们测试了 `app.ts`。'), 'Tab applies rewritten paragraph');

  await act(async () => {
    textarea.dispatchEvent(
      new window.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }),
    );
  });
  await settle(40);
  assert.ok(editorValue().includes(p1Text), 'single Undo restores pre-AI paragraph');

  // Error + Retry + Escape cancel via floating selection pill
  await selectTextareaRange(p1Start, p1End);
  aiMockOutput = { code: 'MODEL_UNCONFIGURED', message: '未检测到可用模型' };
  await act(async () => {
    query<HTMLButtonElement>('.mdstudio-skill-split.is-floating .mdstudio-skill-run-btn').click();
  });
  await settle(60);
  assert.ok(query('.mdstudio-ai-banner').textContent?.includes('未检测到可用模型'), 'AI error surfaces cleanly');
  aiMockOutput = '我们测试了 app.ts（丢失反引号）。\n<<<REASON: 测试保护告警>>>';
  await act(async () => {
    byText('.mdstudio-ai-banner button', '重试').click();
  });
  await settle(80);
  assert.ok(query('.mdstudio-ai-inline-reason.is-warn'), 'warns when inline code token was altered');
  await act(async () => {
    textarea.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  });
  await settle(30);
  assert.equal(container.querySelector('.mdstudio-ai-inline-card'), null, 'Escape discards active AI session');

  // Open Skill Manager via floating selection pill caret menu, fork built-in, and save
  await selectTextareaRange(p1Start, p1End);
  await act(async () => {
    query<HTMLButtonElement>('.mdstudio-skill-split.is-floating .mdstudio-skill-caret-btn').click();
  });
  await settle(40);
  const manageMenuItem = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find((el) =>
    (el.textContent || '').includes('新建 / 管理自定义 Skill'),
  );
  assert.ok(manageMenuItem, 'floating split caret menu contains Manage Skills item');
  await act(async () => {
    manageMenuItem.click();
  });
  await settle(60);
  const skillModal = document.querySelector<HTMLElement>('.mdstudio-skill-modal');
  assert.ok(skillModal, 'SkillManagerDialog opens');

  // Fork built-in skill
  const forkBtn = Array.from(skillModal.querySelectorAll<HTMLButtonElement>('button')).find((b) =>
    (b.textContent || '').includes('复制为自定义副本'),
  );
  assert.ok(forkBtn, 'built-in skill offers Duplicate as custom');
  await act(async () => {
    forkBtn.click();
  });
  await settle(40);

  const nameInput = skillModal.querySelector<HTMLInputElement>('input[placeholder*="技术专栏"]');
  assert.ok(nameInput, 'custom skill name input renders');
  const inputValSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  await act(async () => {
    inputValSetter?.call(nameInput, '一线工程师专栏');
    nameInput.dispatchEvent(new window.Event('input', { bubbles: true }));
    nameInput.dispatchEvent(new window.Event('change', { bubbles: true }));
  });
  await settle(30);

  const saveSkillBtn = Array.from(skillModal.querySelectorAll<HTMLButtonElement>('button')).find((b) =>
    (b.textContent || '').includes('保存 Skill'),
  );
  assert.ok(saveSkillBtn, 'Save skill button exists');
  await act(async () => {
    saveSkillBtn.click();
  });
  await settle(60);
  await act(async () => {
    skillModal.querySelector<HTMLButtonElement>('.mdstudio-modal-close')?.click();
  });
  await settle(40);

  const persistedSkills = JSON.parse(window.localStorage.getItem('dsh.markdown-studio.skills.v1') || '{}') as {
    activeSkillId?: string;
    customSkills?: Array<{ name: string }>;
  };
  assert.equal(persistedSkills.customSkills?.length, 1, 'custom skill is stored locally in Markdown Studio');
  assert.equal(persistedSkills.customSkills?.[0].name, '一线工程师专栏');
  assert.ok(
    query('.mdstudio-skill-split.is-floating .mdstudio-skill-run-label').textContent?.includes('一线工程师专栏'),
    'floating split trigger switches to saved default custom skill',
  );

  // Reopen Skill Manager via HeaderBar More (⋯) menu when nothing is selected!
  await selectTextareaRange(0, 0);
  assert.equal(
    container.querySelector('.mdstudio-skill-split.is-floating'),
    null,
    'floating pill hides when selection collapses',
  );
  await act(async () => {
    query<HTMLButtonElement>('.mdstudio-header button[aria-label="更多"]').click();
  });
  await settle(40);
  await act(async () => {
    Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'))
      .find((el) => (el.textContent || '').includes('写作 Skill 管理'))
      ?.click();
  });
  await settle(60);
  const reopenedModal = document.querySelector<HTMLElement>('.mdstudio-skill-modal')!;
  assert.ok(reopenedModal, 'SkillManagerDialog opens from header More menu without selection');

  lastDownloadBlob = null;
  await act(async () => {
    Array.from(reopenedModal.querySelectorAll<HTMLButtonElement>('button'))
      .find((b) => (b.textContent || '').includes('导出 SKILL.md'))
      ?.click();
  });
  await settle(40);
  assert.ok(lastDownloadBlob, 'Export SKILL.md downloads a markdown file');
  assert.ok((await (lastDownloadBlob as Blob).text()).includes('---'), 'exported SKILL.md includes YAML frontmatter');

  const skillFileInput = reopenedModal.querySelector<HTMLInputElement>('input[type="file"]');
  assert.ok(skillFileInput, 'hidden SKILL.md file input exists');
  const importedMd = new window.File(
    ['---\ntitle: 导入极简风\ndescription: 短句优先\n---\n\n删掉连接词。'],
    ' imported-skill.md ',
    { type: 'text/markdown' },
  );
  Object.defineProperty(skillFileInput, 'files', { configurable: true, value: [importedMd] });
  await act(async () => {
    skillFileInput.dispatchEvent(new window.Event('change', { bubbles: true }));
  });
  await settle(60);
  const bodyEditor = document.querySelector<HTMLElement>('.mdstudio-skill-modal .mdstudio-skill-textarea');
  if (bodyEditor) {
    await act(async () => {
      bodyEditor.dispatchEvent(
        new window.KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true }),
      );
    });
    await settle(60);
  } else {
    await act(async () => {
      Array.from(document.querySelectorAll<HTMLButtonElement>('.mdstudio-skill-modal button'))
        .find((b) => (b.textContent || '').includes('保存 Skill'))
        ?.click();
    });
    await settle(60);
  }
  await act(async () => {
    reopenedModal.querySelector<HTMLButtonElement>('.mdstudio-modal-close')?.click();
  });
  await settle(40);
  await selectTextareaRange(p1Start, p1End);
  assert.ok(
    query('.mdstudio-skill-split.is-floating .mdstudio-skill-run-label').textContent?.includes('导入极简风'),
    'imported SKILL.md becomes active skill on selection pill',
  );
}
console.log('ok - AI writing skills selection-only rewrite and local custom Skill Manager work');

assert.ok(reactRoot, 'react root exists');
await act(async () => {
  reactRoot?.unmount();
});
assert.equal(container.querySelector('.mdstudio-root'), null, 'unmount removes the page');

window.localStorage.clear();
window.localStorage.setItem(
  'dsh.markdown-studio.library.v2',
  JSON.stringify({
    version: 2,
    schemaVersion: 2,
    activeId: 'img-migrate',
    docs: [
      {
        id: 'img-migrate',
        title: '迁移测试',
        markdown: '# 旧文章\n\n![旧图](data:image/png;base64,' + LEGACY_PNG + ')',
        settings: {},
        view: 'split',
        updatedAt: 1,
      },
    ],
  }),
);
const legacyContainer = document.createElement('div');
document.body.appendChild(legacyContainer);
let legacyRoot: Root | null = null;
await act(async () => {
  legacyRoot = ReactDOM.createRoot(legacyContainer);
  legacyRoot.render(React.createElement(Main, {}));
});
await settle(1300);
const legacyTextarea = legacyContainer.querySelector<HTMLTextAreaElement>('textarea.mdstudio-editor');
assert.ok(legacyTextarea, 'legacy editor renders');
assert.ok(
  legacyTextarea.value.includes('assets/0123456789abcdef01234567.png'),
  'existing base64 images migrate to portable assets/ paths on load',
);
assert.ok(!legacyTextarea.value.includes('data:image/png;base64,'), 'the migrated source contains no base64');
assert.ok(
  legacyContainer.querySelector(
    '.mdstudio-preview-article img[src="http://127.0.0.1:4010/uploads/0123456789abcdef01234567.png"]',
  ),
  'the migrated image previews through the local server',
);
if (!legacyRoot) throw new Error('legacy root missing');
await act(async () => {
  legacyRoot?.unmount();
});
legacyContainer.remove();
console.log('ok - existing base64 images migrate to the local image host on load');

window.localStorage.clear();
window.localStorage.setItem(
  'dsh.markdown-studio.library.v2',
  JSON.stringify({
    version: 2,
    schemaVersion: 2,
    activeId: 'showcase-doc',
    docs: [
      {
        id: 'showcase-doc',
        title: '本地橱窗',
        markdown: '# 本地图\n\n![旧图](/api/markdown-studio/assets/0123456789abcdef01234567.png)',
        settings: {},
        view: 'split',
        updatedAt: 1,
      },
    ],
  }),
);
const showcaseContainer = document.createElement('div');
document.body.appendChild(showcaseContainer);
let showcaseRoot: Root | null = null;
await act(async () => {
  showcaseRoot = ReactDOM.createRoot(showcaseContainer);
  showcaseRoot.render(React.createElement(Main, {}));
});
await settle(260);
const showcaseTextarea = showcaseContainer.querySelector<HTMLTextAreaElement>('textarea.mdstudio-editor');
assert.ok(showcaseTextarea, 'showcase editor renders');
assert.ok(
  showcaseTextarea.value.includes('assets/0123456789abcdef01234567.png'),
  'old asset URLs migrate to portable assets/ paths',
);
assert.ok(
  !showcaseTextarea.value.includes('/api/markdown-studio/assets/'),
  'the auth-protected asset URL is no longer used',
);
assert.ok(
  showcaseContainer.querySelector(
    '.mdstudio-preview-article img[src="http://127.0.0.1:4010/uploads/0123456789abcdef01234567.png"]',
  ),
  'the preview uses the local showcase server',
);
await act(async () => {
  const showcaseCopyButton = showcaseContainer.querySelector<HTMLElement>('.mdstudio-copy-btn');
  if (!showcaseCopyButton) throw new Error('showcase copy button is missing');
  showcaseCopyButton.click();
  await new Promise((resolve) => setTimeout(resolve, 120));
});
const showcaseCopy = await copiedText('text/html');
assert.ok(
  showcaseCopy.includes('http://127.0.0.1:4010/uploads/0123456789abcdef01234567.png'),
  'copy carries the local showcase URL',
);
if (!showcaseRoot) throw new Error('showcase root missing');
await act(async () => {
  showcaseRoot?.unmount();
});
showcaseContainer.remove();
console.log('ok - existing local asset URLs migrate to portable assets/ paths');

window.localStorage.setItem('dsh.markdown-studio.library.v2', '{broken-json');
window.localStorage.setItem(
  'dsh.markdown-studio.library.backup.v2',
  JSON.stringify({
    version: 2,
    activeId: 'recover',
    docs: [
      {
        id: 'recover',
        title: '恢复文章',
        markdown: '# 恢复内容\n',
        settings: {},
        view: 'split',
        updatedAt: Date.now(),
      },
    ],
  }),
);
const recoveryContainer = document.createElement('div');
document.body.appendChild(recoveryContainer);
let recoveryRoot: Root | null = null;
await act(async () => {
  recoveryRoot = ReactDOM.createRoot(recoveryContainer);
  recoveryRoot.render(React.createElement(Main, {}));
});
await settle(200);
const recoveryTextarea = recoveryContainer.querySelector<HTMLTextAreaElement>('textarea.mdstudio-editor');
assert.ok(recoveryTextarea, 'recovery editor renders');
assert.ok(recoveryTextarea.value.includes('# 恢复内容'), 'corrupt primary storage falls back to the last-good backup');
if (!recoveryRoot) throw new Error('recovery root missing');
await act(async () => {
  recoveryRoot?.unmount();
});
recoveryContainer.remove();
console.log('ok - corrupt library storage recovers from the last-good backup');

for (const withBackup of [false, true]) {
  window.localStorage.clear();
  const future = JSON.stringify({
    schemaVersion: 3,
    activeId: 'future',
    docs: [{ id: 'future', markdown: '# Keep my future data' }],
  });
  window.localStorage.setItem('dsh.markdown-studio.library.v2', future);
  if (withBackup) window.localStorage.setItem('dsh.markdown-studio.library.backup.v2', backupText);
  const blockedContainer = document.createElement('div');
  document.body.appendChild(blockedContainer);
  const blockedRoot = ReactDOM.createRoot(blockedContainer);
  await act(async () => {
    blockedRoot.render(React.createElement(Main, {}));
  });
  await settle(300);
  assert.ok(blockedContainer.textContent?.includes('请升级插件'), 'future schema has a clear recovery screen');
  assert.equal(blockedContainer.querySelector('textarea'), null, 'future schema never mounts the writable editor');
  assert.equal(
    window.localStorage.getItem('dsh.markdown-studio.library.v2'),
    future,
    'mount does not overwrite future data',
  );
  const exportButton = Array.from(blockedContainer.querySelectorAll('button')).find(
    (button) => button.textContent === '导出原始数据',
  );
  assert.ok(exportButton);
  await act(async () => {
    exportButton.click();
  });
  assert.equal(JSON.parse(await (lastDownloadBlob as Blob).text())['dsh.markdown-studio.library.v2'], future);
  await act(async () => {
    blockedRoot.unmount();
  });
  blockedContainer.remove();
}
console.log('ok - future schema mount is read-only and original data can be exported');

window.localStorage.clear();
const enRegistrations: Registration[] = [];
const enLocale: import('../src/types/dsh').LocaleService = {
  getSnapshot() {
    return { revision: 1, locales: [{ id: 'en' }, { id: 'zh' }] };
  },
  getLocale() {
    return { active: 'en' };
  },
  subscribe() {
    return () => {};
  },
  register() {
    return () => {};
  },
  bind() {
    return (key: string) => key;
  },
};
const enPlugin = (await import('../src/plugin-entry')).create(React);
enPlugin.apply({
  get<T>(name: string): T | undefined {
    return name === 'locale' ? (enLocale as T) : undefined;
  },
  effect(fn) {
    fn();
  },
  slots: {
    inject(_key, callback) {
      callback();
    },
    register(options, component) {
      enRegistrations.push({ options, component });
      return () => {};
    },
  },
});
const EnMain = enRegistrations.find((entry) => entry.options.name === 'main')!.component;
const enContainer = document.createElement('div');
document.body.appendChild(enContainer);
const enRoot = ReactDOM.createRoot(enContainer);
await act(async () => {
  enRoot.render(React.createElement(EnMain, {}));
});
await settle(120);
const enTextarea = enContainer.querySelector<HTMLTextAreaElement>('textarea.mdstudio-editor')!;
assert.ok(enTextarea.value.includes('# Markdown Quick Reference'), 'English locale boots with English sample article');
assert.equal(
  enContainer.querySelector('.mdstudio-preview-article .mdstudio-tldr-title')?.textContent,
  'Key Takeaways',
  'English locale localizes default TL;DR title',
);
assert.equal(
  enContainer.querySelector('.mdstudio-preview-article .mdstudio-refs-title')?.textContent,
  'References',
  'English locale localizes References heading',
);
assert.ok(!/[\u4e00-\u9fff]/.test(enContainer.textContent || ''), 'English studio view contains zero Chinese text');

await act(async () => {
  enContainer.querySelector<HTMLButtonElement>('button[aria-label="Settings"]')?.click();
});
await settle(40);
await act(async () => {
  Array.from(enContainer.querySelectorAll<HTMLElement>('.mdstudio-drawer [role="tab"]'))
    .find((el) => el.textContent === 'Help')
    ?.click();
});
await settle(40);
const enDrawerText = enContainer.querySelector('.mdstudio-drawer')?.textContent || '';
assert.ok(enDrawerText.includes('/ at line start'), 'English Help tab localizes slash key');
assert.ok(enDrawerText.includes('Slash commands'), 'English Help tab renders Slash commands section');
assert.ok(!/[\u4e00-\u9fff]/.test(enDrawerText), 'English Help tab contains zero Chinese text');

await act(async () => {
  enTextarea.focus();
  enTextarea.setSelectionRange(19, 43);
  enTextarea.dispatchEvent(new window.Event('select', { bubbles: true }));
});
await settle(60);
assert.equal(
  enContainer.querySelector('.mdstudio-skill-split.is-floating .mdstudio-skill-run-label')?.textContent,
  'Humanize',
  'English locale localizes built-in AI skill button label',
);
await act(async () => {
  setter.call(enTextarea, '/table');
  enTextarea.setSelectionRange(6, 6);
  enTextarea.dispatchEvent(new window.Event('input', { bubbles: true }));
});
await settle(40);
await act(async () => {
  enTextarea.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
});
await settle(40);
assert.ok(enTextarea.value.includes('| Column 1 | Column 2 |'), 'English /table inserts English table headers');
await act(async () => {
  enRoot.unmount();
});
enContainer.remove();
console.log('ok - English locale boots with English sample article and zero Chinese leaks');

// Verify macOS shortcut label detection with lowercase Chromium userAgentData.platform ("macOS")
{
  const prevUad = (navigator as unknown as { userAgentData?: unknown }).userAgentData;
  Object.defineProperty(navigator, 'userAgentData', {
    value: { platform: 'macOS' },
    configurable: true,
  });
  const macContainer = document.createElement('div');
  document.body.appendChild(macContainer);
  const macRoot = ReactDOM.createRoot(macContainer);
  try {
    await act(async () => {
      macRoot.render(React.createElement(Main, {}));
    });
    await settle(40);
    await act(async () => {
      macContainer.querySelector<HTMLButtonElement>('button[aria-label="设置"]')?.click();
    });
    await settle(30);
    await act(async () => {
      Array.from(macContainer.querySelectorAll<HTMLElement>('.mdstudio-drawer [role="tab"]'))
        .find((el) => el.textContent === '帮助')
        ?.click();
    });
    await settle(30);
    const macShortcuts = Array.from(macContainer.querySelectorAll('.mdstudio-shortcut kbd')).map(
      (el) => el.textContent?.trim() || '',
    );
    assert.ok(
      macShortcuts.includes('⌘Z'),
      `lowercase "macOS" userAgentData renders ⌘Z, got: ${macShortcuts.join(', ')}`,
    );
    assert.ok(macShortcuts.includes('⌘⇧B'), 'lowercase "macOS" userAgentData renders ⌘⇧B');
    const deviceEl = macContainer.querySelector<HTMLElement>('.mdstudio-device');
    assert.ok(deviceEl && deviceEl.style.backgroundColor, '.mdstudio-device syncs outer background color');
  } finally {
    Object.defineProperty(navigator, 'userAgentData', { value: prevUad, configurable: true });
    await act(async () => {
      macRoot.unmount();
    });
    macContainer.remove();
  }
  console.log('ok - lowercase Chromium macOS userAgentData renders ⌘/⇧/⌥ shortcuts');
}

// Multi-tab storage sync updates markdown & resets undo/fileContext cleanly without dirty bounce (C-01)
{
  const syncContainer = document.createElement('div');
  document.body.appendChild(syncContainer);
  const syncRoot = ReactDOM.createRoot(syncContainer);
  try {
    window.localStorage.clear();
    const syncKey = 'dsh.markdown-studio.library.v2';
    const baseSettings = {
      theme: 'classic',
      codeTheme: 'theme',
      accent: '#3d57e6',
      fontSize: 16,
      lineHeight: 1.75,
      allowExternalCssResources: false,
      linkFootnotes: true,
      imagePlaceholders: true,
      codeNbsp: true,
    };
    const initPayload = {
      version: 2,
      schemaVersion: 2,
      activeId: 'sync-doc-1',
      docs: [
        {
          id: 'sync-doc-1',
          title: 'Sync Doc',
          markdown: '# Before Sync',
          settings: baseSettings,
          view: 'split',
          updatedAt: 100,
        },
        {
          id: 'sync-doc-2',
          title: 'Fallback Doc',
          markdown: '# Fallback',
          settings: baseSettings,
          view: 'split',
          updatedAt: 90,
        },
      ],
      trash: [],
    };
    window.localStorage.setItem(syncKey, JSON.stringify(initPayload));
    await act(async () => {
      syncRoot.render(React.createElement(Main, {}));
    });
    await settle(40);
    // Simulate another tab updating the active document
    const updatedPayload = {
      ...initPayload,
      docs: [{ ...initPayload.docs[0], markdown: '# Synced From Tab 2', updatedAt: 200 }, initPayload.docs[1]],
    };
    window.localStorage.setItem(syncKey, JSON.stringify(updatedPayload));
    await act(async () => {
      window.dispatchEvent(new window.StorageEvent('storage', { key: syncKey }));
    });
    await settle(30);
    const syncTa = syncContainer.querySelector<HTMLTextAreaElement>('textarea.mdstudio-editor')!;
    assert.equal(syncTa.value, '# Synced From Tab 2', 'storage sync updates editor content');
    // Pressing Cmd+Z right after external sync must NOT revert synced text back to pre-sync content
    await act(async () => {
      syncTa.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true }));
    });
    await settle(20);
    assert.equal(syncTa.value, '# Synced From Tab 2', 'undo after external sync does not revert Tab 2 text');

    // Simulate another tab deleting the active document -> activeId switches cleanly to fallback doc
    const deletedActivePayload = {
      ...initPayload,
      activeId: 'sync-doc-2',
      docs: [initPayload.docs[1]],
      trash: [{ ...initPayload.docs[0], deletedAt: 300 }],
    };
    window.localStorage.setItem(syncKey, JSON.stringify(deletedActivePayload));
    await act(async () => {
      window.dispatchEvent(new window.StorageEvent('storage', { key: syncKey }));
    });
    await settle(30);
    assert.equal(syncTa.value, '# Fallback', 'deleting active doc in another tab switches cleanly');
  } finally {
    await act(async () => {
      syncRoot.unmount();
    });
    syncContainer.remove();
  }
  console.log('ok - multi-tab storage sync updates editor without undo pollution or stale active doc');
}

// Component composition regressions: format menu dismissal, immersive search Escape, LIFO outline Escape, custom theme pick vs CSS workbench
{
  const comboContainer = document.createElement('div');
  document.body.appendChild(comboContainer);
  const comboRoot = ReactDOM.createRoot(comboContainer);
  try {
    window.localStorage.clear();
    await act(async () => {
      comboRoot.render(React.createElement(Main, {}));
    });
    await settle(40);

    // 1. Format menu closes cleanly when entering immersive mode via shortcut (S03)
    const fmtTrigger = comboContainer.querySelector<HTMLButtonElement>('.mdstudio-format-trigger')!;
    await act(async () => {
      fmtTrigger.click();
    });
    await settle(20);
    assert.ok(comboContainer.querySelector('.mdstudio-format-menu'), 'format menu opens');
    await act(async () => {
      window.dispatchEvent(
        new window.KeyboardEvent('keydown', { key: 'f', metaKey: true, shiftKey: true, bubbles: true }),
      );
    });
    await settle(20);
    assert.equal(
      comboContainer.querySelector('.mdstudio-root')?.getAttribute('data-mdstudio-immersive'),
      'write',
      'enters immersive write via shortcut',
    );
    assert.equal(
      comboContainer.querySelector('.mdstudio-format-menu'),
      null,
      'format menu closes deterministically on entering immersive write',
    );

    // 2. Opening search in immersive write then switching to immersive preview dismisses search so Escape exits cleanly (S04)
    const ta = comboContainer.querySelector<HTMLTextAreaElement>('textarea.mdstudio-editor')!;
    await act(async () => {
      ta.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'f', metaKey: true, bubbles: true }));
    });
    await settle(20);
    assert.ok(comboContainer.querySelector('.mdstudio-searchbar'), 'search bar opens in immersive write');
    const previewDockBtn = Array.from(
      comboContainer.querySelectorAll<HTMLButtonElement>('.mdstudio-immersive-mode'),
    ).find((b) => (b.textContent || '').includes('预览'))!;
    await act(async () => {
      previewDockBtn.click();
    });
    await settle(20);
    assert.equal(
      comboContainer.querySelector('.mdstudio-searchbar'),
      null,
      'switching to immersive preview closes search bar',
    );
    await act(async () => {
      window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    await settle(20);
    assert.equal(
      comboContainer.querySelector('.mdstudio-root')?.getAttribute('data-mdstudio-immersive'),
      null,
      'Escape exits immersive preview cleanly without being trapped by hidden search state',
    );

    // 3. LIFO Escape: when both search bar and outline popover are open, Escape closes outline first while keeping search bar open (S05)
    await act(async () => {
      comboContainer.querySelector<HTMLButtonElement>('.mdstudio-toolbar .mdstudio-tool[aria-label^="搜索"]')?.click();
    });
    await settle(20);
    await act(async () => {
      comboContainer.querySelector<HTMLButtonElement>('.mdstudio-outline-anchor button')?.click();
    });
    await settle(20);
    assert.ok(comboContainer.querySelector('.mdstudio-searchbar'), 'search bar is open');
    assert.ok(comboContainer.querySelector('.mdstudio-outline'), 'outline popover is open');
    const searchInput = comboContainer.querySelector<HTMLInputElement>('.mdstudio-search-input')!;
    await act(async () => {
      searchInput.focus();
      searchInput.dispatchEvent(
        new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );
    });
    await settle(20);
    assert.equal(
      comboContainer.querySelector('.mdstudio-outline'),
      null,
      'first Escape closes topmost outline popover',
    );
    assert.ok(comboContainer.querySelector('.mdstudio-searchbar'), 'search bar remains open after outline closes');
    await act(async () => {
      searchInput.dispatchEvent(
        new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );
    });
    await settle(20);
    assert.equal(comboContainer.querySelector('.mdstudio-searchbar'), null, 'second Escape closes search bar');

    // 4. Picking another custom theme or resetting styles exits open CSS workbench draft cleanly (S02)
    await act(async () => {
      comboContainer.querySelector<HTMLButtonElement>('.mdstudio-style-btn')?.click();
    });
    await settle(20);
    const newThemeBtn = Array.from(comboContainer.querySelectorAll<HTMLButtonElement>('.mdstudio-drawer button')).find(
      (b) => (b.textContent || '').includes('新建主题'),
    )!;
    await act(async () => {
      newThemeBtn.click();
    });
    await settle(30);
    const cssNameInput = comboContainer.querySelector<HTMLInputElement>('.mdstudio-css-name')!;
    const cssEditorTa = comboContainer.querySelector<HTMLTextAreaElement>('.mdstudio-css')!;
    const setVal = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    const setTaVal = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
    await act(async () => {
      setVal?.call(cssNameInput, '翡翠主题');
      cssNameInput.dispatchEvent(new window.Event('input', { bubbles: true }));
      cssNameInput.dispatchEvent(new window.Event('change', { bubbles: true }));
      setTaVal?.call(cssEditorTa, '.mdstudio-content { background-color: #eefcf3; color: #14532d; }');
      cssEditorTa.dispatchEvent(new window.Event('input', { bubbles: true }));
      cssEditorTa.dispatchEvent(new window.Event('change', { bubbles: true }));
    });
    await settle(20);
    const saveThemeBtn = Array.from(
      comboContainer.querySelectorAll<HTMLButtonElement>('.mdstudio-css-workbench button'),
    ).find((b) => (b.textContent || '').includes('保存并启用'))!;
    await act(async () => {
      saveThemeBtn.click();
    });
    await settle(30);
    // Start a second unsaved purple draft, open drawer, then click saved custom theme "翡翠主题"
    await act(async () => {
      comboContainer.querySelector<HTMLButtonElement>('.mdstudio-custom-add-btn')?.click();
    });
    await settle(20);
    await act(async () => {
      setTaVal?.call(cssEditorTa, '.mdstudio-content { background-color: #f5ecff; color: #4c1d95; }');
      cssEditorTa.dispatchEvent(new window.Event('input', { bubbles: true }));
      cssEditorTa.dispatchEvent(new window.Event('change', { bubbles: true }));
    });
    await settle(20);
    await act(async () => {
      comboContainer.querySelector<HTMLButtonElement>('.mdstudio-style-btn')?.click();
    });
    await settle(20);
    const greenCard = Array.from(comboContainer.querySelectorAll<HTMLButtonElement>('.mdstudio-theme-card')).find((b) =>
      (b.textContent || '').includes('翡翠主题'),
    )!;
    await act(async () => {
      greenCard.click();
    });
    await settle(30);
    assert.equal(
      comboContainer.querySelector('.mdstudio-css-workbench'),
      null,
      'picking custom theme exits open CSS workbench draft',
    );
    const articleBg = comboContainer.querySelector<HTMLElement>('.mdstudio-preview-article #mdstudio')?.style
      .backgroundColor;
    assert.equal(articleBg, 'rgb(238, 252, 243)', 'preview renders picked custom theme instead of unsaved draft');

    // 5. Floating AI pill stays hidden while a modal is open and clears on Cmd+F (S06 & S08)
    const ta2 = comboContainer.querySelector<HTMLTextAreaElement>('textarea.mdstudio-editor')!;
    await act(async () => {
      ta2.focus();
      ta2.setSelectionRange(0, 12);
      ta2.dispatchEvent(new window.Event('select', { bubbles: true }));
    });
    await settle(20);
    assert.ok(
      comboContainer.querySelector('.mdstudio-skill-split.is-floating'),
      'floating pill appears on user selection',
    );
    await act(async () => {
      comboContainer.querySelector<HTMLButtonElement>('button[aria-label="文章库"]')?.click();
    });
    await settle(20);
    assert.equal(
      comboContainer.querySelector('.mdstudio-skill-split.is-floating'),
      null,
      'floating pill hides behind open modal',
    );
    await act(async () => {
      document.querySelector<HTMLButtonElement>('.mdstudio-modal-close')?.click();
    });
    await settle(20);
    await act(async () => {
      ta2.focus();
      ta2.setSelectionRange(0, 12);
      ta2.dispatchEvent(new window.Event('select', { bubbles: true }));
      ta2.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'f', metaKey: true, bubbles: true }));
    });
    await settle(20);
    assert.equal(
      comboContainer.querySelector('.mdstudio-skill-split.is-floating'),
      null,
      'Cmd+F clears floating AI pill',
    );

    // 6. Immersive Write + SearchBar + focus inside editor: Escape #1 closes SearchBar, Escape #2 exits immersive
    await act(async () => {
      comboContainer.querySelector<HTMLButtonElement>('.mdstudio-focus-btn')?.click();
    });
    await settle(20);
    await act(async () => {
      ta2.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'f', metaKey: true, bubbles: true }));
    });
    await settle(20);
    assert.ok(comboContainer.querySelector('.mdstudio-searchbar'), 'search bar opens in immersive write');
    await act(async () => {
      ta2.focus();
      ta2.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    await settle(20);
    assert.equal(comboContainer.querySelector('.mdstudio-searchbar'), null, 'Escape #1 in editor closes SearchBar');
    assert.equal(
      comboContainer.querySelector('.mdstudio-root')?.getAttribute('data-mdstudio-immersive'),
      'write',
      'Escape #1 keeps immersive write active after closing SearchBar',
    );
    await act(async () => {
      ta2.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    await settle(20);
    assert.equal(
      comboContainer.querySelector('.mdstudio-root')?.getAttribute('data-mdstudio-immersive'),
      null,
      'Escape #2 exits immersive write cleanly',
    );

    // 7. Floating AI pill dismisses on mousedown outside editor (e.g. clicking PreviewPane)
    await act(async () => {
      ta2.focus();
      ta2.setSelectionRange(0, 12);
      ta2.dispatchEvent(new window.Event('select', { bubbles: true }));
    });
    await settle(20);
    assert.ok(
      comboContainer.querySelector('.mdstudio-skill-split.is-floating'),
      'floating pill visible before preview click',
    );
    await act(async () => {
      comboContainer
        .querySelector<HTMLElement>('.mdstudio-preview-article')
        ?.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }));
    });
    await settle(20);
    assert.equal(
      comboContainer.querySelector('.mdstudio-skill-split.is-floating'),
      null,
      'mousedown in PreviewPane dismisses floating AI selection pill',
    );

    // 8. Slash menu closes immediately on editor scroll (after initial layout-scroll rAF completes)
    await act(async () => {
      setTaVal?.call(ta2, '/');
      ta2.setSelectionRange(1, 1);
      ta2.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    await settle(50);
    assert.ok(comboContainer.querySelector('.mdstudio-slash'), 'slash menu opens on /');
    await act(async () => {
      ta2.dispatchEvent(new window.Event('scroll'));
    });
    await settle(20);
    assert.equal(comboContainer.querySelector('.mdstudio-slash'), null, 'editor scroll closes slash menu');

    // 9. SettingsDrawer -> edit existing custom theme hands focus to CssWorkbench (never steals focus to style button)
    await act(async () => {
      comboContainer.querySelector<HTMLButtonElement>('.mdstudio-style-btn')?.click();
    });
    await settle(20);
    await act(async () => {
      comboContainer.querySelector<HTMLButtonElement>('.mdstudio-theme-card-edit')?.click();
    });
    await settle(40);
    assert.ok(comboContainer.querySelector('.mdstudio-css-workbench'), 'edit custom theme opens CssWorkbench');
    assert.equal(
      document.activeElement?.classList.contains('mdstudio-style-btn'),
      false,
      'SettingsDrawer unmount does not steal focus back to style button',
    );
    assert.ok(
      document.activeElement?.closest('.mdstudio-css-workbench'),
      'focus lands inside CssWorkbench when editing an existing custom theme',
    );

    // 10. Narrow CssWorkbench -> mobile Preview -> widen window > 720px restores split so draft stays visible
    const comboRootEl = comboContainer.querySelector<HTMLElement>('.mdstudio-root')!;
    let narrowW = 640;
    Object.defineProperty(comboRootEl, 'clientWidth', { get: () => narrowW, configurable: true });
    await act(async () => {
      comboContainer.querySelector<HTMLButtonElement>('.mdstudio-mobile-view')?.click();
    });
    await settle(20);
    assert.equal(
      comboContainer.querySelector('.mdstudio-body')?.getAttribute('data-mdstudio-view'),
      'preview',
      'narrow CssWorkbench switches to preview',
    );
    narrowW = 1200;
    await act(async () => {
      window.dispatchEvent(new window.Event('resize'));
    });
    await settle(20);
    assert.equal(
      comboContainer.querySelector('.mdstudio-body')?.getAttribute('data-mdstudio-view'),
      'split',
      'widening beyond 720px restores split view while CssWorkbench is open',
    );
    await act(async () => {
      comboContainer.querySelector<HTMLButtonElement>('.mdstudio-css-back-btn')?.click();
    });
    await settle(20);

    // 11. SearchBar + SettingsDrawer: pressing Escape while focused inside drawer closes drawer first without closing SearchBar
    await act(async () => {
      ta2.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'f', metaKey: true, bubbles: true }));
    });
    await settle(20);
    assert.ok(comboContainer.querySelector('.mdstudio-searchbar'), 'search bar open before opening drawer');
    const styleBtnForSearch = comboContainer.querySelector<HTMLButtonElement>('.mdstudio-style-btn')!;
    await act(async () => {
      styleBtnForSearch.focus();
      styleBtnForSearch.click();
    });
    await settle(20);
    const drawerTabEl = comboContainer.querySelector<HTMLElement>('.mdstudio-drawer [role="tab"]')!;
    await act(async () => {
      drawerTabEl.focus();
      drawerTabEl.dispatchEvent(
        new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );
    });
    await settle(20);
    assert.equal(comboContainer.querySelector('.mdstudio-drawer'), null, 'Escape inside drawer closes drawer first');
    assert.ok(
      comboContainer.querySelector('.mdstudio-searchbar'),
      'SearchBar remains open when Escape closes focused SettingsDrawer',
    );
    await act(async () => {
      ta2.focus();
      ta2.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    await settle(20);
    assert.equal(
      comboContainer.querySelector('.mdstudio-searchbar'),
      null,
      'subsequent Escape in editor closes SearchBar',
    );

    // 12. Opening SettingsDrawer while already inside CssWorkbench and closing it restores focus to style button
    await act(async () => {
      styleBtnForSearch.focus();
      styleBtnForSearch.click();
    });
    await settle(20);
    await act(async () => {
      comboContainer.querySelector<HTMLButtonElement>('.mdstudio-section-action')?.click();
    });
    await settle(30);
    assert.ok(comboContainer.querySelector('.mdstudio-css-workbench'), 'CssWorkbench open');
    await act(async () => {
      styleBtnForSearch.focus();
      styleBtnForSearch.click();
    });
    await settle(20);
    assert.ok(comboContainer.querySelector('.mdstudio-drawer'), 'SettingsDrawer opens on top of CssWorkbench');
    const drawerTabOnWb = comboContainer.querySelector<HTMLElement>('.mdstudio-drawer [role="tab"]')!;
    await act(async () => {
      drawerTabOnWb.focus();
      drawerTabOnWb.dispatchEvent(
        new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );
    });
    await settle(20);
    assert.equal(comboContainer.querySelector('.mdstudio-drawer'), null, 'Escape closes drawer over CssWorkbench');
    assert.equal(
      document.activeElement,
      styleBtnForSearch,
      'closing SettingsDrawer opened from CssWorkbench restores focus to style button instead of dropping to body',
    );
    await act(async () => {
      comboContainer.querySelector<HTMLButtonElement>('.mdstudio-css-back-btn')?.click();
    });
    await settle(20);

    // 13. AI Inline Diff + Outline LIFO Escape & CssWorkbench session cleanup
    await act(async () => {
      setTaVal?.call(ta2, '# 标题\n\n第一段用于测试 AI 润色与大纲叠放。');
      ta2.dispatchEvent(new window.Event('input', { bubbles: true }));
      ta2.focus();
      ta2.setSelectionRange(6, 26);
      ta2.dispatchEvent(new window.Event('select', { bubbles: true }));
      ta2.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'j', metaKey: true, bubbles: true }));
    });
    await settle(80);
    if (comboContainer.querySelector('.mdstudio-ai-inline-card')) {
      await act(async () => {
        comboContainer.querySelector<HTMLButtonElement>('.mdstudio-outline-anchor button')?.click();
      });
      await settle(20);
      assert.ok(comboContainer.querySelector('.mdstudio-outline'), 'outline opens alongside AI diff');
      await act(async () => {
        ta2.focus();
        ta2.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      });
      await settle(20);
      assert.equal(comboContainer.querySelector('.mdstudio-outline'), null, 'Escape #1 closes Outline first');
      assert.ok(comboContainer.querySelector('.mdstudio-ai-inline-card'), 'Escape #1 preserves AI inline diff');
      await act(async () => {
        comboContainer.querySelector<HTMLButtonElement>('.mdstudio-style-btn')?.click();
      });
      await settle(20);
      await act(async () => {
        comboContainer.querySelector<HTMLButtonElement>('.mdstudio-section-action')?.click();
      });
      await settle(20);
      assert.equal(
        comboContainer.querySelector('.mdstudio-ai-inline-card'),
        null,
        'opening CssWorkbench cleanly resets active AI diff session',
      );
      await act(async () => {
        comboContainer.querySelector<HTMLButtonElement>('.mdstudio-css-back-btn')?.click();
      });
      await settle(20);
    }

    // 14. Deleting active article inside LibraryDialog must NOT steal focus into background editor
    await act(async () => {
      comboContainer.querySelector<HTMLButtonElement>('.mdstudio-library-btn')?.click();
    });
    await settle(30);
    await act(async () => {
      comboContainer.querySelector<HTMLButtonElement>('.mdstudio-library-new-btn')?.click();
    });
    await settle(40);
    await act(async () => {
      comboContainer.querySelector<HTMLButtonElement>('.mdstudio-library-btn')?.click();
    });
    await settle(30);
    const activeDelBtn = comboContainer.querySelector<HTMLButtonElement>(
      '.mdstudio-library-row.is-active .mdstudio-library-icon-action.is-danger',
    );
    assert.ok(activeDelBtn, 'active article row exposes delete action');
    await act(async () => {
      activeDelBtn.click();
    });
    await settle(30);
    await act(async () => {
      comboContainer.querySelector<HTMLButtonElement>('.mdstudio-dialog-submit')?.click();
    });
    await settle(80);
    const libraryModalAfterDel = comboContainer.querySelector<HTMLElement>('.mdstudio-library-modal');
    assert.ok(libraryModalAfterDel, 'LibraryDialog stays open after deleting active article');
    const activeAfterDel = document.activeElement as Element | null;
    assert.ok(
      activeAfterDel !== ta2 && libraryModalAfterDel.contains(activeAfterDel),
      'background resetEditorTo focusRange does not steal focus out of open LibraryDialog',
    );
    await act(async () => {
      comboContainer.querySelector<HTMLButtonElement>('.mdstudio-library-head .mdstudio-modal-close')?.click();
    });
    await settle(20);

    // 15. SlashMenu same-frame layout-scroll guard keeps SlashMenu alive on edit-triggered scroll, closes next frame
    await act(async () => {
      setTaVal?.call(ta2, 'Line 1\n/');
      ta2.focus();
      ta2.setSelectionRange(8, 8);
      ta2.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    // Re-trigger same-frame layout scroll immediately on input before rAF fires
    await act(async () => {
      setTaVal?.call(ta2, 'Line 1\n/h');
      ta2.setSelectionRange(9, 9);
      ta2.dispatchEvent(new window.Event('input', { bubbles: true }));
      ta2.dispatchEvent(new window.Event('scroll', { bubbles: false }));
    });
    assert.ok(
      comboContainer.querySelector('.mdstudio-slash'),
      'same-frame post-edit layout scroll refreshes SlashMenu instead of killing it',
    );
    await settle(50);
    await act(async () => {
      ta2.dispatchEvent(new window.Event('scroll', { bubbles: false }));
    });
    await settle(15);
    assert.equal(
      Boolean(comboContainer.querySelector('.mdstudio-slash')),
      false,
      'manual scroll after animation frame dismisses SlashMenu',
    );

    // 16. SettingsDrawer opened from More Menu -> Shortcuts restores focus to visible More trigger on Escape
    await act(async () => {
      comboContainer.querySelector<HTMLButtonElement>('[data-mdstudio-menu-trigger="more"]')?.click();
    });
    await settle(20);
    const shortcutsItem = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find((el) =>
      (el.textContent || '').includes('快捷键与使用说明'),
    );
    assert.ok(shortcutsItem, 'More menu contains Shortcuts entry');
    await act(async () => {
      shortcutsItem!.click();
    });
    await settle(30);
    assert.ok(comboContainer.querySelector('.mdstudio-drawer'), 'Shortcuts menu entry opens SettingsDrawer');
    await act(async () => {
      window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    await settle(30);
    assert.equal(Boolean(comboContainer.querySelector('.mdstudio-drawer')), false, 'Escape closes SettingsDrawer');
    assert.equal(
      document.activeElement,
      comboContainer.querySelector('[data-mdstudio-menu-trigger="more"]'),
      'closing SettingsDrawer opened from More Menu restores focus to More trigger (not document.body)',
    );

    // 17. Active Split click inside CssWorkbench retains workbench & draft
    await act(async () => {
      comboContainer.querySelector<HTMLButtonElement>('.mdstudio-style-btn')?.click();
    });
    await settle(20);
    await act(async () => {
      comboContainer.querySelector<HTMLButtonElement>('.mdstudio-section-action')?.click();
    });
    await settle(20);
    assert.ok(comboContainer.querySelector('.mdstudio-css-workbench'), 'CssWorkbench opens from SettingsDrawer');
    await act(async () => {
      comboContainer.querySelectorAll<HTMLButtonElement>('.mdstudio-segmented button')[0]?.click();
    });
    await settle(20);
    assert.ok(
      comboContainer.querySelector('.mdstudio-css-workbench'),
      'clicking already-active Split button retains CssWorkbench',
    );
    await act(async () => {
      comboContainer.querySelector<HTMLButtonElement>('.mdstudio-css-back-btn')?.click();
    });
    await settle(20);

    // 18. Open Outline suppresses floating SelectionBubble even on keyboard text selection
    await act(async () => {
      setTaVal?.call(ta2, '# Heading One\n\nSelectable prose paragraph here.');
      ta2.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    await settle(20);
    await act(async () => {
      comboContainer.querySelector<HTMLButtonElement>('.mdstudio-outline-anchor button')?.click();
    });
    await settle(20);
    assert.ok(comboContainer.querySelector('.mdstudio-outline'), 'Outline popover opens');
    await act(async () => {
      ta2.focus();
      ta2.setSelectionRange(15, 38);
      ta2.dispatchEvent(new window.Event('select', { bubbles: true }));
    });
    await settle(20);
    assert.equal(
      Boolean(comboContainer.querySelector('.mdstudio-skill-split.is-floating')),
      false,
      'open Outline suppresses floating SelectionBubble during keyboard selection',
    );
    await act(async () => {
      document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    await settle(20);

    // 19. PreviewPane Mobile -> PC switch preserves scroll ratio without yanking editor
    const screen = comboContainer.querySelector<HTMLDivElement>('.mdstudio-device-screen');
    assert.ok(screen, 'preview screen exists in split view');
    Object.defineProperty(screen, 'clientHeight', { configurable: true, get: () => 400 });
    Object.defineProperty(screen, 'scrollHeight', {
      configurable: true,
      get: () => (screen.closest('.mdstudio-device')?.classList.contains('is-desktop') ? 1200 : 2000),
    });
    const deviceBtns = comboContainer.querySelectorAll<HTMLButtonElement>('.mdstudio-device-btn');
    await act(async () => {
      deviceBtns[0]?.click(); // Mobile (scrollHeight = 2000, max = 1600)
    });
    await settle(20);
    screen.scrollTop = 800; // ratio = 800 / 1600 = 0.5
    await act(async () => {
      deviceBtns[1]?.click(); // Desktop (scrollHeight = 1200, max = 800)
    });
    await settle(40);
    assert.ok(
      Math.abs(screen.scrollTop - 400) <= 2,
      `Mobile->PC relayout preserves 50% scroll ratio (expected ~400, got ${screen.scrollTop})`,
    );
  } finally {
    await act(async () => {
      comboRoot.unmount();
    });
    comboContainer.remove();
  }
  console.log(
    'ok - component composition regressions (overlay lifecycle, LIFO Escape, CSS workbench custom pick, modal/search AI pill)',
  );
}

console.log('\nAll UI render checks passed.');

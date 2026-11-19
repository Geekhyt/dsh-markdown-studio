import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { type FileContextApi, useFileContext } from '../src/application/use-file-context';
import { installMemoryIndexedDb } from './memory-indexeddb';

const dom = new JSDOM('<div id="test"></div>', { url: 'http://localhost' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
const idb = installMemoryIndexedDb();
let disk = 'external new content';
let modified = 20;
let pending: Promise<string> | null = null;
let current = { id: 'A', markdown: 'old draft' };
let api!: FileContextApi;
let root: Root;
const notices: string[] = [];
const handle = {
  kind: 'file',
  name: 'note.md',
  getFile: async () =>
    ({
      name: 'note.md',
      lastModified: modified,
      size: disk.length,
      text: () => pending || Promise.resolve(disk),
    }) as File,
  queryPermission: async () => 'granted',
  createWritable: async () => ({
    write: async (text: string) => {
      disk = text;
    },
    close: async () => {
      modified++;
    },
    abort: async () => {},
  }),
} as unknown as FileSystemFileHandle;
function Probe() {
  api = useFileContext({
    getDocument: () => current,
    React,
    t: (s) => s,
    notify: (s) => {
      notices.push(s);
    },
    onReload: (text) => {
      current.markdown = text;
    },
  });
  return null;
}
async function mount() {
  root = createRoot(document.getElementById('test')!);
  await React.act(async () => {
    root.render(React.createElement(Probe));
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}
async function unmount() {
  await React.act(async () => {
    root.unmount();
  });
}
idb.set('document-ref', { ref: { kind: 'file', handle } });
await mount();
await React.act(async () => {
  assert.equal(
    await api.writeFile(handle, current.markdown),
    'conflict',
    'restored legacy handle must not overwrite divergent external content',
  );
});
assert.equal(disk, 'external new content');
let release!: (text: string) => void;
pending = new Promise((resolve) => {
  release = resolve;
});
await React.act(async () => {
  const reloading = api.reload();
  await Promise.resolve();
  await Promise.resolve();
  current = { id: 'B', markdown: 'keep B' };
  api.reset('B');
  release('A file content');
  await reloading;
});
assert.equal(current.markdown, 'keep B', 'late reload cannot write into another article');
await unmount();
// A normal legacy association upgrades without prompting, then detects changes across restarts.
pending = null;
current = { id: 'A', markdown: 'same text' };
disk = current.markdown;
idb.set('document-ref', { ref: { kind: 'file', handle } });
await mount();
assert.equal(api.conflict, false);
await React.act(async () => {
  assert.equal(await api.writeFile(handle, 'saved content'), 'saved');
});
await new Promise((resolve) => setTimeout(resolve, 10));
const saved = idb.get('document-ref') as { ref: { articleId: string; version: { fingerprint: string } } };
assert.equal(saved.ref.articleId, 'A');
assert.match(saved.ref.version.fingerprint, /^[a-f0-9]{64}$/);
await unmount();
current.markdown = 'saved content';
disk = 'external overwrite'; // deliberately leave mtime unchanged
await mount();
assert.equal(api.conflict, true);
await React.act(async () => {
  assert.equal(await api.writeFile(handle, current.markdown), 'conflict');
});
assert.equal(disk, 'external overwrite');
await unmount();
current = { id: 'B', markdown: 'unrelated article' };
await mount();
assert.equal(api.linkedFile(), null, 'association belongs to a different article');
await unmount();

// Reload remains functional; repeated requests, typing and failures cannot clobber newer state.
current = { id: 'A', markdown: 'draft' };
disk = 'disk content';
idb.clear();
await mount();
await React.act(async () => {
  api.linkFile(handle);
  await api.stampFile(handle, await handle.getFile());
  await api.reload();
});
assert.equal(current.markdown, 'disk content');
let first!: (text: string) => void;
let second!: (text: string) => void;
await React.act(async () => {
  pending = new Promise((resolve) => {
    first = resolve;
  });
  const r1 = api.reload();
  await Promise.resolve();
  await Promise.resolve();
  pending = new Promise((resolve) => {
    second = resolve;
  });
  const r2 = api.reload();
  await Promise.resolve();
  await Promise.resolve();
  second('newer reload');
  await r2;
  first('older reload');
  await r1;
});
assert.equal(current.markdown, 'newer reload');
await React.act(async () => {
  pending = new Promise((resolve) => {
    release = resolve;
  });
  const reading = api.reload();
  await Promise.resolve();
  await Promise.resolve();
  current.markdown = 'typed while loading';
  release('stale disk');
  await reading;
});
assert.equal(current.markdown, 'typed while loading');
await React.act(async () => {
  pending = Promise.reject(new Error('read failed'));
  await api.reload();
});
assert.equal(current.markdown, 'typed while loading');
assert.ok(notices.includes('file.openFailed'));
await unmount();
dom.window.close();
console.log('ok - restored file conflict and stale reload protection');

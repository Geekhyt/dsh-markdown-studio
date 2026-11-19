import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import type { HostClient } from '../src/adapters/host-client';
import {
  LIBRARY_BACKUP_KEY,
  LIBRARY_KEY_V2,
  LIBRARY_UNREADABLE_KEY,
  LibraryStorageError,
  loadInitialLibrary,
  rawLibrarySnapshot,
  savePersistedLibrary,
} from '../src/adapters/storage';
import { createAssetGarbageCollector } from '../src/application/asset-gc';
import { DocumentStore } from '../src/application/document-store';
import { createFileCommands } from '../src/application/file-commands';
import { importFolderAssets, writeFolderAssets } from '../src/application/folder-assets';
import { type FileContextApi, useFileContext } from '../src/application/use-file-context';
import { createLibraryBackup, mergeLibraryBackup, parseLibraryBackup } from '../src/domain/library-backup';
import { DEFAULT_SETTINGS } from '../src/themes';

const dom = new JSDOM('<div id="test"></div>', { url: 'http://localhost/' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
const article = (id: string, markdown = id) => ({
  id,
  title: id,
  markdown,
  settings: { ...DEFAULT_SETTINGS },
  view: 'split' as const,
  updatedAt: 1,
});
const library = {
  activeId: 'd0',
  docs: Array.from({ length: 80 }, (_, i) => article('d' + i)),
  trash: [article('deleted')],
};
const store = new DocumentStore(library, savePersistedLibrary);
store.create({ title: '81', settings: { ...DEFAULT_SETTINGS }, view: 'split' });
assert.equal(store.getSnapshot().docs.length, 81);
assert.ok(store.getSnapshot().docs.some((d) => d.id === 'd79'));
store.restore('deleted');
store.replaceAll(mergeLibraryBackup(store.getSnapshot(), { activeId: 'incoming', docs: [article('incoming')] }));
assert.equal(store.flush(), true);
assert.equal(loadInitialLibrary().docs.length, 83, 'create, restore and merge survive a full reload');
const backup = parseLibraryBackup(createLibraryBackup(store.getSnapshot()));
assert.equal(backup?.docs.length, 83, 'JSON backup does not truncate the library');
for (const doc of [...store.getSnapshot().docs]) store.delete(doc.id, 'Blank');
assert.equal(store.flush(), true);
assert.equal(loadInitialLibrary().trash?.length, 83, 'trash survives reload beyond 80 entries');
const failed = new DocumentStore(library, () => false);
assert.throws(() => failed.replaceAll({ activeId: 'new', docs: [article('new')] }, true), /LIBRARY_SAVE_FAILED/);
assert.equal(failed.getSnapshot().docs.length, 80, 'failed replacement keeps the original library');
failed.updateActive({ markdown: 'unsaved edits' });
assert.equal(failed.flush(), false);
assert.equal(failed.getStatus(), 'error');
assert.equal(failed.getActive().markdown, 'unsaved edits', 'quota failure retains edits for export');

for (const withBackup of [false, true]) {
  window.localStorage.clear();
  const future = JSON.stringify({ schemaVersion: 3, ...library });
  window.localStorage.setItem(LIBRARY_KEY_V2, future);
  if (withBackup) window.localStorage.setItem(LIBRARY_BACKUP_KEY, JSON.stringify({ schemaVersion: 2, ...library }));
  assert.throws(
    loadInitialLibrary,
    (error: unknown) => error instanceof LibraryStorageError && error.reason === 'unsupported',
  );
  assert.equal(savePersistedLibrary(library), false, 'even a stale writer cannot overwrite a newer schema');
  assert.equal(window.localStorage.getItem(LIBRARY_KEY_V2), future);
  assert.equal(JSON.parse(rawLibrarySnapshot())[LIBRARY_KEY_V2], future, 'raw export preserves original bytes');
}
window.localStorage.clear();
window.localStorage.setItem(LIBRARY_KEY_V2, '{broken');
assert.throws(loadInitialLibrary, /corrupt/);
window.localStorage.setItem(LIBRARY_BACKUP_KEY, JSON.stringify({ schemaVersion: 2, ...library }));
assert.equal(savePersistedLibrary(loadInitialLibrary()), true);
assert.equal(window.localStorage.getItem(LIBRARY_UNREADABLE_KEY), '{broken', 'recovery preserves unreadable source');
window.localStorage.clear();
console.log('ok - library capacity, quota, backup and incompatible-schema integrity');

const notifications: string[] = [];
const notify = (message: string) => {
  notifications.push(message);
};
const filename = '0123456789abcdef01234567.png';
const mermaidFile = 'fedcba9876543210fedcba98.png';
const other = article('other', `![shared](assets/${filename})`);
let snapshot = { activeId: 'active', docs: [article('active', ''), other], trash: [] as ReturnType<typeof article>[] };
const deleted: string[] = [];
const mermaidActive = new Set<string>([mermaidFile]);
const assetGc = createAssetGarbageCollector({
  hostClient: {
    listAssets: async () =>
      [
        { filename, assetPath: `assets/${filename}`, url: '', bytes: 120, mime: 'image/png' },
        { filename: mermaidFile, assetPath: `assets/${mermaidFile}`, url: '', bytes: 120, mime: 'image/png' },
      ].filter((item) => !deleted.includes(item.filename)),
    deleteAsset: async (name: string) => {
      deleted.push(name);
    },
  } as unknown as HostClient,
  getSnapshot: () => snapshot,
  mermaidFilenames: () => mermaidActive,
});
let files!: FileContextApi;
function Probe() {
  files = useFileContext({
    getDocument: () => store.getActive(),
    React,
    t: (s) => s,
    notify,
    onReload: (text) => {
      reloaded = text;
    },
  });
  return null;
}
let reloaded = '';
const root = createRoot(document.getElementById('test')!);
await React.act(async () => {
  root.render(React.createElement(Probe));
});
await assetGc.prune();
assert.deepEqual(deleted, [], 'another article and active mermaid cache protect assets');
snapshot = { activeId: 'active', docs: [article('active', '')], trash: [other] };
await assetGc.prune();
assert.deepEqual(deleted, [], 'trash protects the shared asset until permanently purged');
snapshot.trash = [];
await assetGc.prune();
assert.deepEqual(deleted, [filename], 'purging article from trash automatically deletes unreferenced assets');
mermaidActive.clear();
await assetGc.prune();
assert.deepEqual(deleted, [filename, mermaidFile], 'stale mermaid asset is pruned once unreferenced');

let disk = 'original';
let modified = 1;
let allowed: PermissionState = 'granted';
let requested: PermissionState = 'granted';
let writeFails = false;
let aborted = false;
let pauseWrite: (() => Promise<void>) | null = null;
const handle = {
  name: 'note.md',
  kind: 'file',
  getFile: async () => ({ name: 'note.md', lastModified: modified, size: disk.length, text: async () => disk }) as File,
  queryPermission: async () => allowed,
  requestPermission: async () => {
    allowed = requested;
    return allowed;
  },
  createWritable: async () => {
    let pending = '';
    if (pauseWrite) await pauseWrite();
    return {
      write: async (value: string) => {
        if (writeFails) throw new Error('disk full');
        pending = value;
      },
      close: async () => {
        disk = pending;
        modified++;
      },
      abort: async () => {
        aborted = true;
      },
    } as unknown as FileSystemWritableFileStream;
  },
} as unknown as FileSystemFileHandle;
await React.act(async () => {
  files.linkFile(handle);
  await files.stampFile(handle, await handle.getFile());
});
let confirmOverwrite = false;
let confirmCalls = 0;
const markdownRef = { current: 'editor' };
const actions = () =>
  createFileCommands({
    t: (s) => s,
    notify,
    confirm: async () => {
      confirmCalls++;
      return confirmOverwrite;
    },
    fileContext: files,
    store,
    doc: store.getActive(),
    settings: DEFAULT_SETTINGS,
    view: 'split',
    markdownRef,
    fileName: 'note.md',
    localImageServerUrl: '',
    setMenuOpen: () => {},
    setFileName: () => {},
    resetEditorTo: () => {},
    setDocumentRef: (ref) => {
      if (ref.kind === 'file') files.linkFile(ref.handle);
    },
    stampFile: files.stampFile,
    download: () => true,
    isAbortError: () => false,
    errorMessage: String,
    deriveTitle: (text) => text,
  });
disk = 'external';
modified++;
await React.act(async () => {
  await actions().saveLocalFile();
});
assert.equal(disk, 'external', 'Cmd+S does not overwrite an unobserved external change');
assert.equal(confirmCalls, 1);
confirmOverwrite = true;
await React.act(async () => {
  await actions().saveLocalFile();
});
assert.equal(disk, 'editor', 'explicit overwrite is supported');
assert.equal(files.conflict, false);
await React.act(async () => {
  await actions().saveLocalFile();
});
assert.equal(confirmCalls, 2, 'normal save has no dialog');
await React.act(async () => {
  const results = await Promise.all([files.writeFile(handle, 'first'), files.writeFile(handle, 'second')]);
  assert.deepEqual(results, ['saved', 'saved']);
});
assert.equal(disk, 'second', 'writes execute in order without self-conflicts');
allowed = 'denied';
requested = 'denied';
await React.act(async () => {
  assert.equal(await files.writeFile(handle, 'blocked', false, true), 'denied');
});
assert.equal(disk, 'second');
requested = 'granted';
await React.act(async () => {
  assert.equal(await files.requestPermission(), true);
});
writeFails = true;
await React.act(async () => {
  await actions().saveLocalFile();
});
assert.equal(disk, 'second', 'failed write leaves the existing file intact');
assert.equal(aborted, true);
assert.ok(notifications.some((message) => message.startsWith('file.saveFailed')));
writeFails = false;
disk = 'reload me';
modified++;
await React.act(async () => {
  await files.reload();
});
assert.equal(reloaded, 'reload me');
let release!: () => void;
let started!: () => void;
const atWrite = new Promise<void>((resolve) => {
  started = resolve;
});
pauseWrite = () =>
  new Promise<void>((resolve) => {
    release = resolve;
    started();
  });
await React.act(async () => {
  const writing = files.writeFile(handle, 'stale');
  await atWrite;
  files.reset('another');
  release();
  assert.equal(await writing, 'stale');
});
assert.equal(disk, 'reload me', 'switching documents invalidates a pending write');
pauseWrite = null;
// Save As and browser-download fallback remain usable after a conflict.
await React.act(async () => {
  await actions().saveLocalFile(true);
});
window.showSaveFilePicker = async () => handle;
await React.act(async () => {
  await actions().saveLocalFile(true);
});
assert.equal(disk, markdownRef.current);
allowed = 'denied';
requested = 'denied';
await React.act(async () => {
  await actions().saveLocalFile();
});
assert.ok(notifications.includes('file.permission'));
allowed = 'granted';
window.showOpenFilePicker = async () => [handle];
await React.act(async () => {
  await actions().openLocalFile();
  await actions().reloadLinkedFile();
});
assert.equal(reloaded, disk);

// Folder images retain portable paths and survive regular file saves.
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const writtenAssets = new Map<string, unknown>();
const assetDirectory = {
  getFileHandle: async (name: string) => ({
    getFile: async () => ({ arrayBuffer: async () => png.buffer }),
    createWritable: async () => ({
      write: async (bytes: unknown) => {
        writtenAssets.set(name, bytes);
      },
      close: async () => {},
    }),
  }),
} as unknown as FileSystemDirectoryHandle;
const folder = {
  getDirectoryHandle: async () => assetDirectory,
  queryPermission: async () => 'granted',
} as unknown as FileSystemDirectoryHandle;
const host = {
  storeAsset: async () => ({
    filename,
    assetPath: 'assets/' + filename,
    mime: 'image/png',
    bytes: png.length,
    url: '',
    localUrl: '',
  }),
};
const imported = await importFolderAssets(folder, other.markdown, host);
assert.equal(imported.imported, 1);
assert.equal(imported.text, other.markdown);
const renamed = await importFolderAssets(folder, other.markdown, {
  storeAsset: async () => ({ ...(await host.storeAsset()), assetPath: 'assets/' + 'a'.repeat(24) + '.png' }),
});
assert.ok(renamed.text.includes('a'.repeat(24)));
assert.equal((await importFolderAssets(folder, 'plain', host)).imported, 0);
const missingFolder = {
  getDirectoryHandle: async () => {
    throw new Error('missing');
  },
} as unknown as FileSystemDirectoryHandle;
assert.equal((await importFolderAssets(missingFolder, other.markdown, host)).imported, 0);
assert.equal(
  (
    await importFolderAssets(folder, other.markdown, {
      storeAsset: async () => {
        throw new Error('offline');
      },
    })
  ).imported,
  0,
);
const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = async () => new Response(png);
  assert.equal(await writeFolderAssets(folder, other.markdown, 'http://localhost:4010'), 1);
  assert.deepEqual(writtenAssets.get(filename), png);
  assert.equal(await writeFolderAssets(folder, 'plain', ''), 0);
  const denied = { ...folder, queryPermission: async () => 'denied' } as unknown as FileSystemDirectoryHandle;
  assert.equal(await writeFolderAssets(denied, other.markdown, ''), 0);
  globalThis.fetch = async () => new Response(null, { status: 404 });
  assert.equal(await writeFolderAssets(folder, other.markdown, ''), 0);
  globalThis.fetch = async () => {
    throw new Error('offline');
  };
  assert.equal(await writeFolderAssets(folder, other.markdown, ''), 0);
  await React.act(async () => {
    files.linkFolder(folder, handle);
    await files.stampFile(handle, await handle.getFile());
    await actions().saveLocalFile();
  });
} finally {
  globalThis.fetch = originalFetch;
}
await React.act(async () => {
  root.unmount();
});
dom.window.close();
console.log('ok - shared asset protection and serialized, conflict-aware file saves');

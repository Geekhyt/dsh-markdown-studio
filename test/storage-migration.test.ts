import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  LIBRARY_BACKUP_KEY,
  LIBRARY_KEY_V2,
  LIBRARY_UNREADABLE_KEY,
  LibraryStorageError,
  loadDocumentRef,
  loadInitialLibrary,
  loadPersistedLibrary,
  loadWorkspaceHandle,
  rawLibrarySnapshot,
  savePersistedLibrary,
  storeDocumentRef,
  storeWorkspaceHandle,
} from '../src/adapters/storage';
import { DocumentStore } from '../src/application/document-store';
import { DEFAULT_SETTINGS, SAMPLE_MARKDOWN, SAMPLE_MARKDOWN_EN, SAMPLE_TITLE, SAMPLE_TITLE_EN } from '../src/themes';
import { installMemoryIndexedDb } from './memory-indexeddb';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window });

let checks = 0;
function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve(fn()).then(() => {
    checks++;
    console.log('ok - ' + name);
  });
}

await check('initializes a fresh v2 library with the sample article and preserves saved custom themes', () => {
  window.localStorage.clear();
  const freshEn = loadInitialLibrary('en-US');
  assert.equal(freshEn.docs[0].title, SAMPLE_TITLE_EN);
  assert.equal(freshEn.docs[0].markdown, SAMPLE_MARKDOWN_EN);

  window.localStorage.clear();
  const fresh = loadInitialLibrary();
  assert.equal(fresh.docs.length, 1);
  assert.equal(fresh.docs[0].title, SAMPLE_TITLE);
  assert.equal(fresh.docs[0].markdown, SAMPLE_MARKDOWN);
  assert.equal(fresh.activeId, fresh.docs[0].id);

  const customArticle = {
    id: 'user',
    title: '专栏手记',
    markdown: '这是我自己的文章。',
    settings: {
      theme: 'custom:sky',
      customThemes: [{ id: 'custom:sky', name: '晴空', css: '#mdstudio { --mdstudio-accent: #0ea5e9; }' }],
    },
    view: 'split',
    updatedAt: 2,
  };
  window.localStorage.setItem(
    LIBRARY_KEY_V2,
    JSON.stringify({
      version: 2,
      schemaVersion: 2,
      activeId: 'user',
      docs: [customArticle],
      trash: [],
    }),
  );

  const loaded = loadInitialLibrary();
  assert.equal(loaded.activeId, 'user');
  assert.equal(loaded.docs[0].markdown, customArticle.markdown);
  assert.equal(loaded.docs[0].settings.theme, 'custom:sky');
  assert.equal(loaded.docs[0].settings.accent, '#0ea5e9');
  assert.equal(loaded.docs[0].settings.customThemes?.[0]?.name, '晴空');
});

await check('parses persisted library edge cases, trash entries, activeId fallback and backup recovery', () => {
  window.localStorage.clear();
  assert.equal(loadPersistedLibrary(), null);

  window.localStorage.setItem(LIBRARY_KEY_V2, '{not-json');
  assert.equal(loadPersistedLibrary(), null);
  assert.throws(
    () => loadInitialLibrary(),
    (err: unknown) => err instanceof LibraryStorageError && err.reason === 'corrupt',
  );

  window.localStorage.setItem(LIBRARY_KEY_V2, JSON.stringify({ docs: 'bad' }));
  assert.equal(loadPersistedLibrary(), null);

  window.localStorage.setItem(
    LIBRARY_KEY_V2,
    JSON.stringify({ schemaVersion: 999, docs: [{ id: 'a', markdown: '# hi' }] }),
  );
  assert.equal(loadPersistedLibrary(), null);
  assert.throws(
    () => loadInitialLibrary(),
    (err: unknown) => err instanceof LibraryStorageError && err.reason === 'unsupported',
  );

  window.localStorage.setItem(
    LIBRARY_KEY_V2,
    JSON.stringify({
      version: 2,
      schemaVersion: 2,
      docs: [null, [], { id: 123, markdown: 'x' }, { id: 'no-md' }],
    }),
  );
  assert.equal(loadPersistedLibrary(), null);

  const valid = {
    activeId: 'missing-id',
    docs: [
      { id: 'doc-1', title: '', markdown: '# One', settings: {}, view: 'preview', updatedAt: 0 },
      null,
      { id: 'doc-2', title: 'Two', markdown: '# Two', settings: {}, view: 'edit', updatedAt: 42 },
    ],
    trash: [
      null,
      { id: 'trash-1', title: 'Trash', markdown: 'old', deletedAt: 100 },
      { id: 'trash-2', title: '', markdown: 'older' },
    ],
  };
  window.localStorage.setItem(LIBRARY_KEY_V2, JSON.stringify({ version: 2, schemaVersion: 2, ...valid }));
  const parsed = loadPersistedLibrary();
  assert.ok(parsed);
  assert.equal(parsed.activeId, 'doc-1');
  assert.equal(parsed.docs.length, 2);
  assert.equal(parsed.docs[0].title, SAMPLE_TITLE);
  assert.equal(parsed.trash?.length, 2);
  assert.equal(parsed.trash?.[0].deletedAt, 100);

  assert.equal(savePersistedLibrary(parsed), true);
  assert.ok(window.localStorage.getItem(LIBRARY_BACKUP_KEY));

  // Corrupt primary and verify fallback to backup + preservation in LIBRARY_UNREADABLE_KEY on writeback.
  window.localStorage.setItem(LIBRARY_KEY_V2, '{broken');
  const recovered = loadInitialLibrary();
  assert.equal(recovered.docs.length, 2);
  assert.equal(savePersistedLibrary(recovered), true);
  assert.equal(window.localStorage.getItem(LIBRARY_UNREADABLE_KEY), '{broken');
  const snapshot = JSON.parse(rawLibrarySnapshot()) as Record<string, string | null>;
  assert.equal(snapshot[LIBRARY_UNREADABLE_KEY], '{broken');
});

await check('persists shared custom themes once instead of copying them into every article', () => {
  window.localStorage.clear();
  const themes = [
    { id: 'custom:sky', name: '晴空', css: '#mdstudio { --mdstudio-accent: #0ea5e9; }' },
    { id: 'custom:rose', name: '玫瑰', css: '#mdstudio { --mdstudio-accent: #e11d48; }' },
  ];
  const doc = (id: string, theme: string) => ({
    id,
    title: id,
    markdown: id,
    settings: { ...DEFAULT_SETTINGS, theme, customThemes: themes },
    view: 'split' as const,
    updatedAt: 1,
  });
  const library = {
    activeId: 'c',
    docs: [doc('a', 'classic'), doc('b', 'custom:rose'), doc('c', 'classic')],
    trash: [{ ...doc('t', 'custom:sky'), deletedAt: 1 }],
  };
  assert.equal(savePersistedLibrary(library), true);
  const stored = JSON.parse(window.localStorage.getItem(LIBRARY_KEY_V2) || '{}');
  assert.deepEqual(
    stored.docs.map((entry: { settings: { customThemes: unknown[] } }) => entry.settings.customThemes.length),
    [2, 1, 0],
    'only the first article stores the full list; others keep just the theme they use',
  );
  assert.equal(stored.trash[0].settings.customThemes.length, 1, 'trash keeps only its own theme');

  const store = new DocumentStore(loadPersistedLibrary()!, () => true);
  const snap = store.getSnapshot();
  for (const entry of snap.docs) {
    assert.deepEqual(
      (entry.settings.customThemes || []).map((theme) => theme.id),
      ['custom:sky', 'custom:rose'],
      'all articles see every shared theme after reload',
    );
  }
  assert.equal(snap.docs.find((entry) => entry.id === 'b')?.settings.theme, 'custom:rose', 'theme choice survives');
  assert.equal(store.getActive().id, 'c', 'active article is preserved');
});

await check('stores and loads DocumentRef and WorkspaceHandle across IndexedDB states', async () => {
  Object.defineProperty(window, 'indexedDB', { configurable: true, value: undefined });
  assert.equal(await loadDocumentRef(), null);
  assert.equal(await loadWorkspaceHandle(), null);

  installMemoryIndexedDb();
  assert.equal(await loadDocumentRef(), null);
  assert.equal(await loadWorkspaceHandle(), null);

  const fileHandle = { kind: 'file', name: 'draft.md' } as unknown as FileSystemFileHandle;
  await storeDocumentRef({ kind: 'file', handle: fileHandle });
  assert.deepEqual(await loadDocumentRef(), { kind: 'file', handle: fileHandle });

  const folderHandle = { kind: 'directory', name: 'notes' } as unknown as FileSystemDirectoryHandle;
  const folderRef = { kind: 'folder' as const, directory: folderHandle, file: fileHandle };
  await storeDocumentRef(folderRef);
  assert.deepEqual(await loadDocumentRef(), folderRef);

  await storeWorkspaceHandle(folderHandle);
  assert.equal(await loadWorkspaceHandle(), folderHandle);

  await storeDocumentRef({ kind: 'library', articleId: 'detached' });
  assert.deepEqual(await loadDocumentRef(), { kind: 'library', articleId: 'detached' });
});

console.log(`${checks} storage checks passed.`);

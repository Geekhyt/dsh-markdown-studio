import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { loadPersistedLibrary, savePersistedLibrary } from '../src/adapters/storage';
import { DocumentStore } from '../src/application/document-store';
import type { Article, LibraryState } from '../src/domain/article';
import { mergeLibraryBackup } from '../src/domain/library-backup';
import { DEFAULT_SETTINGS } from '../src/themes';

function article(id: string, markdown = ''): Article {
  return {
    id,
    title: id,
    markdown,
    settings: { ...DEFAULT_SETTINGS },
    view: 'split',
    updatedAt: 1,
  };
}

const initial: LibraryState = { activeId: 'a', docs: [article('a', 'A'), article('b', 'B')] };
let saved: LibraryState | null = null;
const store = new DocumentStore(initial, (state) => {
  saved = state;
  return true;
});

store.updateActive({ markdown: 'A2' });
assert.equal(store.getActive().markdown, 'A2', 'active article is patched');
assert.equal(store.getSnapshot().docs.find((entry) => entry.id === 'b')?.markdown, 'B', 'other articles are untouched');
assert.ok(store.getActive().updatedAt > 1, 'update timestamp advances');

const target = store.switchTo('b');
assert.equal(target?.id, 'b', 'switch returns target');
assert.equal(store.getActive().id, 'b', 'switch changes active article');

const created = store.create({ title: 'new', markdown: 'N', settings: { ...DEFAULT_SETTINGS }, view: 'split' });
assert.equal(store.getActive().id, created.id, 'new article becomes active');
assert.equal(store.getSnapshot().docs.length, 3, 'new article is added');

const afterDelete = store.delete('a', 'untitled');
assert.equal(store.getSnapshot().docs.length, 2, 'non-active delete removes one article');
assert.equal(afterDelete.id, created.id, 'non-active delete keeps active article');
assert.equal(store.getTrash()[0].id, 'a', 'deleted article is moved to trash');
assert.ok(store.getTrash()[0].deletedAt, 'trash entry has a deletion timestamp');
const restored = store.restore('a');
assert.equal(restored?.id, 'a', 'restore returns the article');
assert.ok(
  store.getSnapshot().docs.some((entry) => entry.id === 'a'),
  'restored article returns to the library',
);
assert.equal(store.getTrash().length, 0, 'restore removes the trash entry');
store.delete('a', 'untitled');
store.purge('a');
assert.equal(store.getTrash().length, 0, 'purge removes the trash entry');

store.delete('b', 'untitled');
store.delete(created.id, 'untitled');
assert.equal(store.getSnapshot().docs.length, 1, 'deleting the last article creates one blank');
assert.equal(store.getTrash().length, 2, 'deleted articles remain in trash');
store.emptyTrash();
assert.equal(store.getTrash().length, 0, 'emptyTrash clears the trash');

const replacement = store.replaceAll({ activeId: 'z', docs: [article('z', 'Z')] });
assert.equal(replacement.id, 'z', 'replaceAll activates the backup article');
assert.equal(store.getSnapshot().docs.length, 1, 'replaceAll replaces the library');

store.flush();
const persisted = saved as LibraryState | null;
assert.ok(persisted, 'flush persists the current state');
assert.equal(persisted.activeId, store.getActive().id, 'persisted state matches active article');

const customA = article('ca', 'A');
const customB = article('cb', 'B');
const customStore = new DocumentStore({ activeId: 'ca', docs: [customA, customB] }, () => true);
const customList = [{ id: 'custom:mint', name: '薄荷青', css: '#mdstudio { --mdstudio-accent: #0d9488; }' }];
customStore.updateActive({
  settings: { ...DEFAULT_SETTINGS, theme: 'custom:mint', accent: '#0d9488', customThemes: customList },
});
customStore.switchTo('cb');
assert.equal(customStore.getActive().settings.customThemes?.length, 1, 'custom themes sync across all articles');
customStore.updateActive({ settings: { ...customStore.getActive().settings, customThemes: [] } });
customStore.switchTo('ca');
assert.equal(customStore.getActive().settings.theme, 'classic', 'deleting custom theme resets articles that used it');

{
  // Duplicate ids (merge-importing a backup that still holds a trashed article, or a crafted
  // archive) must never let two library entries share an id.
  const dupStore = new DocumentStore(
    {
      activeId: 'x',
      docs: [article('x', 'X1'), article('x', 'X2'), article('y', 'Y')],
      trash: [{ ...article('y', 'Y-old'), deletedAt: 1 }],
    },
    () => true,
  );
  const snap = dupStore.getSnapshot();
  const allIds = [...snap.docs, ...(snap.trash || [])].map((entry) => entry.id);
  assert.equal(new Set(allIds).size, allIds.length, 'constructor re-ids duplicated docs/trash entries');
  assert.equal(snap.docs[0].id, 'x', 'first occurrence keeps its id');
  dupStore.updateActive({ markdown: 'X1-edited' });
  assert.equal(
    dupStore.getSnapshot().docs.find((entry) => entry.markdown === 'X2')?.markdown,
    'X2',
    'editing one article never overwrites its former duplicate',
  );

  const trashedY = (dupStore.getSnapshot().trash || [])[0];
  const restored = dupStore.restore(trashedY.id);
  const docIds = dupStore.getSnapshot().docs.map((entry) => entry.id);
  assert.ok(restored, 'trashed article restores');
  assert.equal(new Set(docIds).size, docIds.length, 'restore never collides with a live article id');

  dupStore.replaceAll({ activeId: 'z', docs: [article('z', 'Z1'), article('z', 'Z2')], trash: [] });
  const replacedIds = dupStore.getSnapshot().docs.map((entry) => entry.id);
  assert.equal(new Set(replacedIds).size, 2, 'replaceAll (import) re-ids duplicated entries');
}

{
  // Restoring an article whose id is already live (backup merged after deletion) gets a fresh id.
  const liveStore = new DocumentStore(
    { activeId: 'm', docs: [article('m', 'M-live')], trash: [{ ...article('m', 'M-trash'), deletedAt: 1 }] },
    () => true,
  );
  const trashId = (liveStore.getSnapshot().trash || [])[0].id;
  const back = liveStore.restore(trashId);
  assert.ok(back && back.id !== 'm', 'restored copy receives a fresh id when the original id is live');
  assert.equal(liveStore.getSnapshot().docs.length, 2, 'both copies remain in the library');
}

{
  // Clean store skips unsolicited flush() writes and syncExternal() merges cross-tab updates without writing back.
  let writes = 0;
  const tabStore = new DocumentStore({ activeId: 'a', docs: [article('a', 'Initial')], trash: [] }, () => {
    writes += 1;
    return true;
  });
  assert.equal(tabStore.flush(), true, 'clean flush returns true');
  assert.equal(writes, 0, 'clean flush does not overwrite storage');
  let notified = 0;
  tabStore.subscribe(() => {
    notified += 1;
  });
  tabStore.syncExternal({ activeId: 'a', docs: [article('a', 'From Tab B')], trash: [] });
  assert.equal(tabStore.getActive().markdown, 'From Tab B', 'syncExternal adopts external tab snapshot');
  assert.equal(notified, 1, 'syncExternal notifies subscribers');
  assert.equal(writes, 0, 'syncExternal does not echo write back to storage');
  tabStore.updateActive({ markdown: 'Local edit' });
  assert.equal(tabStore.flush(), true);
  assert.equal(writes, 1, 'dirty flush persists local edits');
}

{
  // Document-level concurrent cross-tab merge preserves dirty local article + absorbs remote article edits.
  let disk: LibraryState = {
    activeId: 'a',
    docs: [
      { ...article('a', 'A0'), updatedAt: 100 },
      { ...article('b', 'B0'), updatedAt: 100 },
    ],
    trash: [],
  };
  const tabA = new DocumentStore(
    structuredClone(disk),
    (next) => {
      disk = structuredClone(next);
      return true;
    },
    () => structuredClone(disk),
  );
  const tabB = new DocumentStore(
    structuredClone(disk),
    (next) => {
      disk = structuredClone(next);
      return true;
    },
    () => structuredClone(disk),
  );
  // Tab A edits doc 'a' (unsaved dirty); Tab B switches to doc 'b', edits it, and flushes to disk.
  tabA.updateActive({ markdown: 'A-from-TabA' });
  tabB.switchTo('b');
  tabB.updateActive({ markdown: 'B-from-TabB' });
  assert.equal(tabB.flush(), true);

  // Sync event hits Tab A while Tab A still has unsaved edits in 'a': keeps Tab A's 'a' & activeId, absorbs 'b'.
  tabA.syncExternal(structuredClone(disk));
  assert.equal(tabA.getActive().id, 'a', 'syncExternal does not hijack active tab');
  assert.equal(tabA.getActive().markdown, 'A-from-TabA', 'syncExternal preserves unsaved local dirty doc');
  assert.equal(
    tabA.getSnapshot().docs.find((d) => d.id === 'b')?.markdown,
    'B-from-TabB',
    'syncExternal absorbs remote edit to another doc',
  );

  // Even without a prior storage event, flushing Tab A merges newer disk changes from Tab B on other docs!
  tabB.updateActive({ markdown: 'B-from-TabB-v2' });
  tabB.flush();
  tabA.updateActive({ markdown: 'A-from-TabA-v2' });
  assert.equal(tabA.flush(), true);
  assert.equal(disk.docs.find((d) => d.id === 'a')?.markdown, 'A-from-TabA-v2', 'disk retains Tab A edit');
  assert.equal(disk.docs.find((d) => d.id === 'b')?.markdown, 'B-from-TabB-v2', 'disk retains Tab B edit');

  // Explicit delete is authoritative and is not resurrected from disk on flush.
  tabA.delete('b', 'Untitled');
  assert.equal(tabA.flush(), true);
  assert.equal(
    disk.docs.some((d) => d.id === 'b'),
    false,
    'deleted doc is not resurrected by pre-write disk merge',
  );
}

// G6 multi-tab persistence regressions:
// 1) Custom themes survive real storage round-trip across tabs (unified across docs).
// 2) Purging a trashed doc never clobbers a sibling tab's newly created doc.
// 3) Clean tab accepts backup recovery (replaceAll) even with older timestamps.
// 4) mergeLibraryBackup dedupes incoming doc IDs against trash IDs as well as active docs.
{
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: dom.window.localStorage });

  const seed: LibraryState = {
    activeId: 'd0',
    docs: [
      { ...article('d0', '# 0'), updatedAt: 1000 },
      { ...article('d1', '# 1'), updatedAt: 1000 },
    ],
    trash: [{ ...article('t0', '# trash'), updatedAt: 900, deletedAt: 950 }],
  };
  savePersistedLibrary(seed);

  const tabA = new DocumentStore(
    loadPersistedLibrary()!,
    (s) => savePersistedLibrary(s),
    () => loadPersistedLibrary(),
  );
  const tabB = new DocumentStore(
    loadPersistedLibrary()!,
    (s) => savePersistedLibrary(s),
    () => loadPersistedLibrary(),
  );

  // 1) Custom theme created in tabA survives tabB editing doc d1
  tabA.updateActive({
    settings: {
      ...DEFAULT_SETTINGS,
      theme: 'custom:mint',
      customThemes: [{ id: 'custom:mint', name: 'Mint', css: '#mdstudio { color: #059669; }' }],
    },
  });
  assert.equal(tabA.flush(), true);
  tabB.switchTo('d1');
  tabB.updateActive({ markdown: '# 1 edited in B' });
  assert.equal(tabB.flush(), true);
  const loadedAfterTheme = loadPersistedLibrary()!;
  assert.ok(
    loadedAfterTheme.docs.every((d) => d.settings.customThemes?.some((c) => c.id === 'custom:mint')),
    'custom theme from tab A survives tab B flush and stays unified across docs',
  );

  // 2) tabB purging t0 does not erase tabA's newly created doc
  const createdInA = tabA.create({
    title: 'From A',
    markdown: '# A',
    settings: { ...DEFAULT_SETTINGS },
    view: 'split',
  });
  assert.equal(tabA.flush(), true);
  tabB.purge('t0');
  assert.equal(tabB.flush(), true);
  const loadedAfterPurge = loadPersistedLibrary()!;
  assert.ok(
    loadedAfterPurge.docs.some((d) => d.id === createdInA.id),
    'purge tombstone does not drop sibling tab newly created article',
  );
  assert.equal(
    loadedAfterPurge.trash?.some((t) => t.id === 't0'),
    false,
    'purged trash item remains purged',
  );

  // 3) Clean tab accepts older-timestamp backup recovery via replaceAll
  tabA.replaceAll({
    activeId: 'd0',
    docs: [{ ...article('d0', 'recovered-backup'), updatedAt: 500 }],
    trash: [],
  });
  assert.equal(tabA.flush(), true);
  tabB.syncExternal(loadPersistedLibrary()!);
  assert.equal(
    tabB.getSnapshot().docs.find((d) => d.id === 'd0')?.markdown,
    'recovered-backup',
    'clean tab accepts replaceAll backup recovery even with older updatedAt',
  );

  // 4) mergeLibraryBackup avoids trash ID collisions when deduping incoming docs
  const merged = mergeLibraryBackup(
    {
      activeId: 'keep',
      docs: [{ ...article('keep', 'K'), title: 'Keep', updatedAt: 100 }],
      trash: [{ ...article('dup-1', 'T'), title: 'Trashed', updatedAt: 90, deletedAt: 95 }],
    },
    {
      activeId: 'dup-1',
      docs: [
        { ...article('dup-1', 'A1'), title: 'In A1', updatedAt: 200 },
        { ...article('dup-1', 'A2'), title: 'In A2', updatedAt: 201 },
      ],
      trash: [],
    },
  );
  assert.equal(merged.docs.length, 3, 'incoming duplicate IDs colliding with trash are preserved with unique IDs');
  assert.equal(new Set(merged.docs.map((d) => d.id)).size, 3);
  assert.equal(
    merged.docs.some((d) => d.id === 'dup-1' && merged.trash?.some((t) => t.id === 'dup-1')),
    false,
    'no active doc shares an ID with a trashed doc',
  );

  dom.window.close();
}

console.log('49 document-store checks passed.');

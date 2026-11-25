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

  // 5) Re-delete after restore, emptyTrash followed by delete, custom theme deletion & subscribeExternalMerge
  {
    const t1 = { id: 'custom:t1', name: 'T1', css: 'p { color: #123456; }' };
    let disk: LibraryState = {
      activeId: 'a',
      docs: [
        { ...article('a', '# A'), settings: { ...DEFAULT_SETTINGS, customThemes: [t1] } },
        { ...article('b', '# B'), settings: { ...DEFAULT_SETTINGS, customThemes: [t1] } },
      ],
      trash: [{ ...article('old-t', '# Old'), deletedAt: 100 }],
    };
    const s = new DocumentStore(
      structuredClone(disk),
      (next) => {
        disk = structuredClone(next);
        return true;
      },
      () => structuredClone(disk),
    );
    let externalMerges = 0;
    const unsub = s.subscribeExternalMerge(() => {
      externalMerges++;
    });
    s.delete('a', 'Untitled');
    s.restore('a');
    s.delete('a', 'Untitled');
    assert.equal(s.flush(), true);
    assert.equal(
      s.getSnapshot().trash?.some((x) => x.id === 'a'),
      true,
      'delete -> restore -> re-delete keeps doc in trash',
    );
    s.create({ title: 'C', markdown: '# C', settings: { ...DEFAULT_SETTINGS }, view: 'split' });
    s.flush();
    s.emptyTrash();
    s.delete('b', 'Untitled');
    s.flush();
    assert.equal(
      s.getSnapshot().trash?.some((x) => x.id === 'b'),
      true,
      'emptyTrash tombstone only purges previously trashed ids',
    );
    // Sibling tab deletes custom theme t1 while this tab has dirty markdown
    disk = {
      ...disk,
      docs: disk.docs.map((d) => ({ ...d, settings: { ...d.settings, customThemes: [] } })),
    };
    s.updateActive({ markdown: '# edited locally' });
    s.syncExternal(structuredClone(disk));
    assert.equal(
      (s.getActive().settings.customThemes || []).length,
      0,
      'dirty doc without local theme mutation does not resurrect deleted custom themes',
    );
    // Clean active doc receiving external markdown update notifies subscribeExternalMerge
    s.flush();
    const extUpdated = {
      ...disk,
      docs: disk.docs.map((d) =>
        d.id === s.getActive().id ? { ...d, markdown: '# edited remotely', updatedAt: d.updatedAt + 1000 } : d,
      ),
    };
    s.syncExternal(extUpdated);
    assert.ok(
      externalMerges >= 1,
      'subscribeExternalMerge notifies listeners when external merge updates active markdown',
    );
    // Restore with custom theme propagates pendingCustomThemes AND keeps restored doc alive on flush!
    const restoredWithTheme = {
      ...article('tr1', '# Tr1'),
      settings: { ...DEFAULT_SETTINGS, customThemes: [t1] },
      deletedAt: 50,
    };
    s.replaceAll({ activeId: 'd0', docs: [article('d0', '# D0')], trash: [restoredWithTheme] });
    s.flush();
    const restoredTr1 = s.restore('tr1');
    assert.equal(restoredTr1?.id, 'tr1');
    assert.ok((restoredTr1?.rev ?? 0) >= 1, 'restore bumps monotonic rev');
    assert.equal(s.flush(), true);
    assert.equal(
      s.getSnapshot().docs.some((d) => d.id === 'tr1' && d.markdown === '# Tr1'),
      true,
      'restored article survives pre-write disk merge on flush (never dropped by purged tombstone)',
    );
    assert.equal(
      s.getSnapshot().trash?.some((d) => d.id === 'tr1'),
      false,
      'restored article does not remain duplicated in trash after flush',
    );
    assert.equal(s.getActive().settings.customThemes?.[0]?.id, 'custom:t1');

    // Monotonic rev round-trips through storage and advances above remote rev on concurrent same-doc merge
    const revBefore = s.getActive().rev ?? 0;
    s.updateActive({ markdown: '# D0 local rev' });
    assert.equal(s.getActive().rev, revBefore + 1, 'updateActive increments rev monotonically');
    disk = {
      ...disk,
      docs: disk.docs.map((d) => (d.id === 'd0' ? { ...d, markdown: '# D0 remote higher', rev: revBefore + 5 } : d)),
    };
    s.syncExternal(structuredClone(disk));
    assert.equal(s.getActive().markdown, '# D0 local rev', 'dirty local doc wins concurrent merge');
    assert.equal(s.getActive().rev, revBefore + 6, 'merged dirty doc advances rev strictly above remote rev');
    s.flush();
    savePersistedLibrary(s.getSnapshot());
    const reloaded = loadPersistedLibrary()!;
    assert.equal(
      reloaded.docs.find((d) => d.id === 'd0')?.rev,
      revBefore + 6,
      'monotonic rev persists cleanly across v2 storage round-trip',
    );

    // Immediate delete -> purge / emptyTrash before debounce write must NOT resurrect doc from disk
    s.replaceAll({ activeId: 'keep', docs: [article('keep', '# Keep'), article('goner', '# Goner')], trash: [] });
    s.flush();
    s.delete('goner', 'Untitled');
    s.purge('goner');
    s.flush();
    assert.equal(
      s.getSnapshot().docs.some((d) => d.id === 'goner'),
      false,
      'delete followed immediately by purge does not resurrect doc into live docs',
    );
    s.replaceAll({ activeId: 'keep', docs: [article('keep', '# Keep'), article('goner2', '# Goner2')], trash: [] });
    s.flush();
    s.delete('goner2', 'Untitled');
    s.emptyTrash();
    s.flush();
    assert.equal(
      s.getSnapshot().docs.some((d) => d.id === 'goner2'),
      false,
      'delete followed immediately by emptyTrash does not resurrect doc into live docs',
    );

    // 6) Functional review regressions:
    // (a) restore(id) when id collides with an existing live doc must NEVER purge the live doc on flush!
    const t2 = { id: 'custom:t2', name: 'T2', css: 'p { color: #654321; }' };
    const t1Updated = { id: 'custom:t1', name: 'T1', css: 'p { color: #abcdef; }' };
    disk = {
      activeId: 'base',
      docs: [{ ...article('base', '# Base'), settings: { ...DEFAULT_SETTINGS, customThemes: [t1Updated] } }],
      trash: [
        { ...article('dup', '# Trashed Dup'), settings: { ...DEFAULT_SETTINGS, customThemes: [t1] }, deletedAt: 5 },
      ],
    };
    const collisionIds = ['dup', 'dup-restored'];
    const collisionStore = new DocumentStore(
      structuredClone(disk),
      (next) => {
        disk = structuredClone(next);
        return true;
      },
      () => structuredClone(disk),
      { nextId: () => collisionIds.shift() || 'fallback-id' },
    );
    collisionStore.create({
      title: 'Live Dup',
      markdown: '# Live Dup',
      settings: { ...DEFAULT_SETTINGS, customThemes: [t1Updated] },
      view: 'split',
    });
    const restoredDup = collisionStore.restore('dup');
    assert.equal(restoredDup?.id, 'dup-restored', 'colliding trash restore gets fresh id');
    assert.equal(collisionStore.flush(), true);
    assert.equal(
      collisionStore.getSnapshot().docs.some((d) => d.id === 'dup' && d.markdown === '# Live Dup'),
      true,
      'restore on ID collision preserves existing live doc across pre-write disk merge',
    );
    assert.equal(
      collisionStore.getSnapshot().docs.some((d) => d.id === 'dup-restored' && d.markdown === '# Trashed Dup'),
      true,
      'restored copy also persists cleanly alongside existing live doc',
    );
    assert.equal(
      collisionStore.getActive().settings.customThemes?.find((c) => c.id === 'custom:t1')?.css,
      t1Updated.css,
      'restoring stale trashed doc does not overwrite newer live edits to the same custom theme',
    );

    // (b) Cloned identical customThemes array (as produced by sanitizeSettings / resetEditorTo) must NOT wipe sibling tab themes
    disk = {
      ...disk,
      docs: disk.docs.map((d) => ({ ...d, settings: { ...d.settings, customThemes: [t1Updated, t2] } })),
    };
    collisionStore.updateActive({
      markdown: '# Local file opened',
      settings: { ...collisionStore.getActive().settings, customThemes: [{ ...t1Updated }] },
    });
    assert.equal(collisionStore.flush(), true);
    assert.equal(
      collisionStore.getActive().settings.customThemes?.some((c) => c.id === 'custom:t2'),
      true,
      'updateActive with structurally identical cloned customThemes does not overwrite sibling tab new custom theme',
    );

    // (c) syncExternal when remote tab deletes switched-to doc clears pendingActiveSwitch (no redundant writeback)
    const switchWritesBefore = { count: 0 };
    let switchDisk: LibraryState = { activeId: 'x', docs: [article('x', '# X'), article('y', '# Y')], trash: [] };
    const switchStore = new DocumentStore(
      structuredClone(switchDisk),
      (next) => {
        switchWritesBefore.count++;
        switchDisk = structuredClone(next);
        return true;
      },
      () => structuredClone(switchDisk),
    );
    switchStore.switchTo('y');
    assert.equal(switchStore.getStatus(), 'pending');
    switchStore.syncExternal({ activeId: 'x', docs: [article('x', '# X')], trash: [] });
    assert.equal(
      switchStore.getStatus(),
      'saved',
      'syncExternal clears pendingActiveSwitch when remote deletes target',
    );
    assert.equal(switchStore.flush(), true);
    assert.equal(switchWritesBefore.count, 0, 'no redundant writeback after remote deleted switched-to doc');

    // (d) G3 field-level dirty merge (view vs markdown) & concurrent customThemes intent merge
    const themeA = { id: 'custom:a', name: 'A', css: '#mdstudio{color:#111}' };
    const themeB = { id: 'custom:b', name: 'B', css: '#mdstudio{color:#222}' };
    let fieldDisk: LibraryState = {
      activeId: 'doc1',
      docs: [{ ...article('doc1', '# v1'), rev: 1 }],
      trash: [],
    };
    const fieldStore = new DocumentStore(
      structuredClone(fieldDisk),
      (next) => {
        fieldDisk = structuredClone(next);
        return true;
      },
      () => structuredClone(fieldDisk),
    );
    fieldStore.updateActive({ view: 'preview' });
    fieldStore.updateActive({ settings: { ...fieldStore.getActive().settings, customThemes: [themeA] } });
    fieldDisk = {
      activeId: 'doc1',
      docs: [
        {
          ...fieldDisk.docs[0],
          markdown: '# v2 from tab B',
          rev: 2,
          settings: { ...fieldDisk.docs[0].settings, customThemes: [themeB] },
        },
      ],
      trash: [],
    };
    assert.equal(fieldStore.flush(), true);
    assert.equal(
      fieldStore.getActive().markdown,
      '# v2 from tab B',
      'view-only dirty edit preserves concurrent cross-tab markdown',
    );
    assert.equal(fieldStore.getActive().view, 'preview', 'local view change survives field-level merge');
    const mergedIds = (fieldStore.getActive().settings.customThemes || []).map((t) => t.id).sort();
    assert.deepEqual(mergedIds, ['custom:a', 'custom:b'], 'concurrent custom theme additions merge without loss');

    // (e) Concurrent restore-vs-purge: Tab B restores & bumps rev past Tab A's purged trash rev -> restored live doc wins
    let rvpDisk: LibraryState = {
      activeId: 'keep',
      docs: [{ ...article('keep', '# Keep'), rev: 1 }],
      trash: [{ ...article('target', '# Important'), rev: 2, deletedAt: 100 }],
    };
    const tabA = new DocumentStore(
      structuredClone(rvpDisk),
      (next) => {
        rvpDisk = structuredClone(next);
        return true;
      },
      () => structuredClone(rvpDisk),
    );
    const tabB = new DocumentStore(
      structuredClone(rvpDisk),
      (next) => {
        rvpDisk = structuredClone(next);
        return true;
      },
      () => structuredClone(rvpDisk),
    );
    tabB.restore('target');
    assert.equal(tabB.flush(), true);
    tabA.purge('target');
    assert.equal(tabA.flush(), true);
    assert.equal(
      tabA.getSnapshot().docs.some((d) => d.id === 'target' && d.markdown === '# Important'),
      true,
      'stale Tab A purge does not delete article concurrently restored by Tab B',
    );
    unsub();
  }

  dom.window.close();
}

console.log('56 document-store checks passed.');

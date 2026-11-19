import assert from 'node:assert/strict';
import { DocumentStore } from '../src/application/document-store';
import type { Article, LibraryState } from '../src/domain/article';
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

console.log('29 document-store checks passed.');

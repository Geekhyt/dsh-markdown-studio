import assert from 'node:assert/strict';
import type { LibraryState } from '../src/domain/article';
import {
  createLibraryBackup,
  mergeConflicts,
  mergeLibraryBackup,
  parseLibraryBackup,
} from '../src/domain/library-backup';
import { DEFAULT_SETTINGS } from '../src/themes';

const library: LibraryState = {
  activeId: 'a',
  trash: [
    {
      id: 'trash',
      title: 'Trash',
      markdown: 'Deleted',
      settings: { ...DEFAULT_SETTINGS },
      view: 'split',
      updatedAt: 1,
      deletedAt: 2,
    },
  ],
  docs: [
    {
      id: 'a',
      title: 'Title',
      markdown: '# Hello',
      settings: { ...DEFAULT_SETTINGS, theme: 'ink' },
      view: 'preview',
      updatedAt: 123,
    },
  ],
};
const backup = createLibraryBackup(library);
assert.equal(backup.format, 'markdown-studio-library');
assert.equal(backup.version, 1);
const parsed = parseLibraryBackup(JSON.parse(JSON.stringify(backup)));
assert.ok(parsed);
assert.equal(parsed.activeId, 'a');
assert.equal(parsed.docs[0].markdown, '# Hello');
assert.equal(parsed.docs[0].settings.theme, 'ink');
assert.equal(parsed.docs[0].view, 'preview');
assert.equal(parsed.trash?.length, 1);
assert.equal(parsed.trash?.[0].deletedAt, 2);
assert.equal(parseLibraryBackup({ format: 'x', version: 1, docs: [] }), null);
assert.equal(parseLibraryBackup({ format: 'markdown-studio-library', version: 1, docs: [] }), null);
assert.equal(parseLibraryBackup(null), null);
const partial = parseLibraryBackup({
  format: 'markdown-studio-library',
  version: 1,
  activeId: 'missing',
  docs: [{ id: 'b', markdown: 'B' }],
});
assert.equal(partial?.activeId, 'b');
assert.equal(partial?.docs[0].view, 'split');

const merged = mergeLibraryBackup(library, {
  activeId: 'new',
  docs: [
    {
      id: 'a',
      title: 'Incoming A',
      markdown: '# Incoming',
      settings: { ...DEFAULT_SETTINGS },
      view: 'edit',
      updatedAt: 9,
    },
    { id: 'new', title: 'New', markdown: '# New', settings: { ...DEFAULT_SETTINGS }, view: 'split', updatedAt: 8 },
  ],
  trash: [
    {
      id: 'trash2',
      title: 'Trash2',
      markdown: 'x',
      settings: { ...DEFAULT_SETTINGS },
      view: 'split',
      updatedAt: 1,
      deletedAt: 1,
    },
  ],
});
assert.equal(merged.activeId, 'a', 'merge keeps the current active article');
assert.equal(merged.docs[0].title, 'Incoming A', 'merge replaces the same id');
assert.equal(merged.docs[1].id, 'new', 'merge appends new articles');
assert.equal(
  merged.trash?.some((entry) => entry.id === 'trash2'),
  true,
  'merge keeps incoming trash',
);
const keepCurrent = mergeLibraryBackup(
  library,
  {
    activeId: 'a',
    docs: [
      {
        id: 'a',
        title: 'Should Not Win',
        markdown: '# x',
        settings: { ...DEFAULT_SETTINGS },
        view: 'split',
        updatedAt: 9,
      },
    ],
  },
  'current',
);
assert.equal(keepCurrent.docs[0].title, 'Title', 'current-wins merge keeps the existing article');
const conflicts = mergeConflicts(library, {
  activeId: 'a',
  docs: [
    {
      id: 'a',
      title: 'Incoming title',
      markdown: '# x',
      settings: { ...DEFAULT_SETTINGS },
      view: 'split',
      updatedAt: 2,
    },
  ],
});
assert.equal(conflicts.length, 1);
assert.equal(conflicts[0].id, 'a');
assert.equal(conflicts[0].currentTitle, 'Title');
assert.equal(conflicts[0].incomingTitle, 'Incoming title');
const mixed = mergeLibraryBackup(
  library,
  {
    activeId: 'a',
    docs: [
      { id: 'a', title: 'Incoming A', markdown: '# x', settings: { ...DEFAULT_SETTINGS }, view: 'split', updatedAt: 2 },
      { id: 'b', title: 'New B', markdown: '# b', settings: { ...DEFAULT_SETTINGS }, view: 'split', updatedAt: 2 },
    ],
  },
  'incoming',
  { a: 'current' },
);
assert.equal(mixed.docs.find((entry) => entry.id === 'a')?.title, 'Title', 'per-id current decision wins');
assert.equal(
  mixed.docs.some((entry) => entry.id === 'b'),
  true,
  'non-conflicting incoming article is appended',
);
console.log('23 library-backup checks passed.');

const repaired = parseLibraryBackup({
  format: 'markdown-studio-library',
  version: 1,
  docs: [null, {}, { markdown: '', title: '', updatedAt: 0 }],
  trash: [null, {}, { markdown: 'deleted', title: '', updatedAt: 0, deletedAt: 0 }],
});
assert.ok(repaired?.docs[0].id.startsWith('doc-'));
assert.ok(repaired?.trash?.[0].id.startsWith('trash-'));
assert.equal(repaired?.docs[0].title, '未命名');
assert.equal(repaired?.trash?.[0].title, '未命名');
assert.equal(parseLibraryBackup({ format: 'markdown-studio-library', version: 1, docs: [], schemaVersion: 999 }), null);

const protoMerged = mergeLibraryBackup(
  {
    activeId: 'toString',
    docs: [
      {
        id: 'toString',
        title: 'Old',
        markdown: '# old',
        settings: { ...DEFAULT_SETTINGS },
        view: 'split',
        updatedAt: 1,
      },
    ],
  },
  {
    activeId: 'toString',
    docs: [
      {
        id: 'toString',
        title: 'New',
        markdown: '# new',
        settings: { ...DEFAULT_SETTINGS },
        view: 'split',
        updatedAt: 2,
      },
    ],
  },
  'incoming',
);
assert.equal(protoMerged.docs[0].title, 'New', 'prototype-named article id obeys incoming merge preference');

const nonEmptyMerged = mergeLibraryBackup(
  {
    activeId: 'a',
    docs: [{ id: 'a', title: 'A', markdown: '# A', settings: { ...DEFAULT_SETTINGS }, view: 'split', updatedAt: 1 }],
    trash: [
      {
        id: 'b',
        title: 'B',
        markdown: '# B',
        settings: { ...DEFAULT_SETTINGS },
        view: 'split',
        updatedAt: 1,
        deletedAt: 2,
      },
    ],
  },
  {
    activeId: 'b',
    docs: [{ id: 'b', title: 'B', markdown: '# B', settings: { ...DEFAULT_SETTINGS }, view: 'split', updatedAt: 2 }],
    trash: [
      {
        id: 'a',
        title: 'A',
        markdown: '# A',
        settings: { ...DEFAULT_SETTINGS },
        view: 'split',
        updatedAt: 2,
        deletedAt: 3,
      },
    ],
  },
  'incoming',
  { b: 'current', a: 'incoming' },
);
assert.ok(nonEmptyMerged.docs.length >= 1, 'mergeLibraryBackup never yields an empty docs array');

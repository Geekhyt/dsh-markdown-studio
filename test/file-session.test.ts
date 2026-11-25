import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { type FileContextApi, useFileContext } from '../src/application/use-file-context';
import { useWorkspace, type WorkspaceApi } from '../src/application/use-workspace';
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
async function waitFor(predicate: () => boolean, timeoutMs = 1500): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) break;
    await React.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
}

async function mount() {
  root = createRoot(document.getElementById('test')!);
  await React.act(async () => {
    root.render(React.createElement(Probe));
    await new Promise((resolve) => setTimeout(resolve, 40));
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
await waitFor(() =>
  Boolean(
    (idb.get('document-ref') as { ref?: { version?: { fingerprint?: string } } } | undefined)?.ref?.version
      ?.fingerprint,
  ),
);
const saved = idb.get('document-ref') as { ref: { articleId: string; version: { fingerprint: string } } };
assert.equal(saved.ref.articleId, 'A');
assert.match(saved.ref.version.fingerprint, /^[a-f0-9]{64}$/);
await unmount();
current.markdown = 'saved content';
disk = 'external overwrite'; // deliberately leave mtime unchanged
await mount();
await waitFor(() => api.conflict);
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

// G1 workspace regressions: APFS case-only renameDirectory/renameFile, case-variant self-move guard,
// ext4 sibling collision guard, and createDirectory.
{
  type MockNode =
    | { kind: 'file'; name: string; content: string; id: number }
    | { kind: 'directory'; name: string; children: Map<string, MockNode>; id: number };
  let nextId = 1;
  const makeFs = (caseInsensitive: boolean) => {
    const kOf = (n: string) => (caseInsensitive ? n.toLowerCase() : n);
    const rootNode: Extract<MockNode, { kind: 'directory' }> = {
      kind: 'directory',
      name: 'ws',
      children: new Map(),
      id: nextId++,
    };
    const mkFile = (node: Extract<MockNode, { kind: 'file' }>): FileSystemFileHandle =>
      ({
        kind: 'file',
        get name() {
          return node.name;
        },
        async getFile() {
          return {
            name: node.name,
            size: node.content.length,
            lastModified: 1000,
            text: async () => node.content,
            arrayBuffer: async () => new TextEncoder().encode(node.content).buffer,
          } as unknown as File;
        },
        async createWritable() {
          let buf = '';
          return {
            async write(chunk: unknown) {
              buf += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk as ArrayBuffer);
            },
            async close() {
              node.content = buf;
            },
            async abort() {},
          };
        },
        async isSameEntry(other: FileSystemHandle) {
          return (other as unknown as { __id?: number }).__id === node.id;
        },
        async queryPermission() {
          return 'granted';
        },
        async requestPermission() {
          return 'granted';
        },
        __id: node.id,
      }) as unknown as FileSystemFileHandle;
    const mkDir = (node: Extract<MockNode, { kind: 'directory' }>): FileSystemDirectoryHandle =>
      ({
        kind: 'directory',
        get name() {
          return node.name;
        },
        async getFileHandle(name: string, opts?: { create?: boolean }) {
          const existing = node.children.get(kOf(name));
          if (existing) {
            if (existing.kind !== 'file') throw new Error('TypeMismatchError');
            return mkFile(existing);
          }
          if (!opts?.create) throw Object.assign(new Error('NotFoundError'), { name: 'NotFoundError' });
          const created: Extract<MockNode, { kind: 'file' }> = { kind: 'file', name, content: '', id: nextId++ };
          node.children.set(kOf(name), created);
          return mkFile(created);
        },
        async getDirectoryHandle(name: string, opts?: { create?: boolean }) {
          const existing = node.children.get(kOf(name));
          if (existing) {
            if (existing.kind !== 'directory') throw new Error('TypeMismatchError');
            return mkDir(existing);
          }
          if (!opts?.create) throw Object.assign(new Error('NotFoundError'), { name: 'NotFoundError' });
          const created: Extract<MockNode, { kind: 'directory' }> = {
            kind: 'directory',
            name,
            children: new Map(),
            id: nextId++,
          };
          node.children.set(kOf(name), created);
          return mkDir(created);
        },
        async removeEntry(name: string) {
          if (!node.children.has(kOf(name))) throw Object.assign(new Error('NotFoundError'), { name: 'NotFoundError' });
          node.children.delete(kOf(name));
        },
        async *values() {
          for (const c of node.children.values()) yield c.kind === 'file' ? mkFile(c) : mkDir(c);
        },
        async *entries() {
          for (const c of node.children.values()) yield [c.name, c.kind === 'file' ? mkFile(c) : mkDir(c)] as const;
        },
        async isSameEntry(other: FileSystemHandle) {
          return (other as unknown as { __id?: number }).__id === node.id;
        },
        async resolve(desc: FileSystemHandle): Promise<string[] | null> {
          const targetId = (desc as unknown as { __id?: number }).__id;
          if (targetId === node.id) return [];
          const walk = (cur: Extract<MockNode, { kind: 'directory' }>, trail: string[]): string[] | null => {
            for (const c of cur.children.values()) {
              if (c.id === targetId) return [...trail, c.name];
              if (c.kind === 'directory') {
                const hit = walk(c, [...trail, c.name]);
                if (hit) return hit;
              }
            }
            return null;
          };
          return walk(node, []);
        },
        async queryPermission() {
          return 'granted';
        },
        async requestPermission() {
          return 'granted';
        },
        __id: node.id,
      }) as unknown as FileSystemDirectoryHandle;
    return { rootNode, rootHandle: mkDir(rootNode) };
  };

  let wsApi!: WorkspaceApi;
  const wsNotices: string[] = [];
  function WsHarness() {
    wsApi = useWorkspace({
      React,
      t: (k) => k,
      notify: (msg) => wsNotices.push(msg),
      fileContext: {
        fileName: '',
        conflict: false,
        conflictRef: { current: false },
        permission: 'granted',
        requestPermission: async () => true,
        workspacePickRef: { current: null },
        linkedFile: () => null,
        linkedFolder: () => null,
        setFileName: () => {},
        linkFile: () => {},
        linkFolder: () => {},
        applyDocumentRef: () => {},
        reset: () => {},
        stampFile: async () => {},
        clearConflict: () => {},
        dismissConflict: () => {},
        isExternallyChanged: async () => false,
        writeFile: async () => 'saved',
        reload: async () => {},
      } satisfies FileContextApi,
      onMenuClose: () => {},
      onOpenFile: async () => {},
    });
    return null;
  }
  const wsRoot = createRoot(dom.window.document.getElementById('test')!);
  await React.act(async () => {
    wsRoot.render(React.createElement(WsHarness));
  });

  // APFS case-only renameDirectory, case-only renameFile, createDirectory, and case-variant self-move guard
  const apfs = makeFs(true);
  apfs.rootNode.children.set('draft.md', { kind: 'file', name: 'draft.md', content: '# Keep', id: nextId++ });
  apfs.rootNode.children.set('notes', {
    kind: 'directory',
    name: 'notes',
    children: new Map([['inner.md', { kind: 'file', name: 'inner.md', content: '# Inner', id: nextId++ }]]),
    id: nextId++,
  });
  (dom.window as unknown as { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker =
    async () => apfs.rootHandle;
  await React.act(async () => {
    await wsApi.pickFolder();
  });
  await React.act(async () => {
    await wsApi.createDirectory('', 'sub');
  });
  assert.ok(apfs.rootNode.children.has('sub'), 'createDirectory creates folder');
  const notesEntry = wsApi.state.entries.find((e) => e.kind === 'directory' && e.name === 'notes')!;
  await React.act(async () => {
    if (notesEntry.kind === 'directory') await wsApi.renameDirectory(notesEntry, 'Notes');
  });
  const renamedDir = apfs.rootNode.children.get('notes');
  assert.ok(
    renamedDir?.kind === 'directory' && renamedDir.name === 'Notes' && renamedDir.children.has('inner.md'),
    'APFS case-only renameDirectory preserves directory contents via two-hop temp rename',
  );
  const draftEntry = wsApi.state.entries.find((e) => e.kind === 'file' && e.name === 'draft.md')!;
  await React.act(async () => {
    if (draftEntry.kind === 'file') await wsApi.renameFile(draftEntry, 'Draft.md');
  });
  const renamedFile = apfs.rootNode.children.get('draft.md');
  assert.ok(
    renamedFile?.kind === 'file' && renamedFile.name === 'Draft.md' && renamedFile.content === '# Keep',
    'APFS case-only renameFile preserves file content via two-hop temp rename',
  );
  wsNotices.length = 0;
  const upperNotesEntry = wsApi.state.entries.find((e) => e.kind === 'directory' && e.name === 'Notes')!;
  await React.act(async () => {
    await wsApi.moveEntry(upperNotesEntry, 'notes');
  });
  assert.ok(wsNotices.includes('workspace.moveInvalid'), 'case-variant self-move is rejected by handle identity');

  // ext4 case-sensitive sibling collision protection
  const ext4 = makeFs(false);
  ext4.rootNode.children.set('a.md', { kind: 'file', name: 'a.md', content: 'lower', id: nextId++ });
  ext4.rootNode.children.set('A.md', { kind: 'file', name: 'A.md', content: 'UPPER_KEEP', id: nextId++ });
  (dom.window as unknown as { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker =
    async () => ext4.rootHandle;
  await React.act(async () => {
    await wsApi.pickFolder();
  });
  wsNotices.length = 0;
  const lowerFile = wsApi.state.entries.find((e) => e.kind === 'file' && e.name === 'a.md')!;
  await React.act(async () => {
    if (lowerFile.kind === 'file') await wsApi.renameFile(lowerFile, 'A.md');
  });
  assert.equal(
    (ext4.rootNode.children.get('A.md') as Extract<MockNode, { kind: 'file' }>).content,
    'UPPER_KEEP',
    'ext4 sibling A.md is never overwritten when renaming a.md -> A.md',
  );
  assert.ok(wsNotices.includes('workspace.exists'));

  // Protected subtree (.git / node_modules) refuses copy+delete directory rename/move instead of wiping .git
  ext4.rootNode.children.set('repo', {
    kind: 'directory',
    name: 'repo',
    children: new Map([
      ['doc.md', { kind: 'file', name: 'doc.md', content: '# Repo', id: nextId++ }],
      [
        '.git',
        {
          kind: 'directory',
          name: '.git',
          children: new Map([['HEAD', { kind: 'file', name: 'HEAD', content: 'ref: refs/heads/main', id: nextId++ }]]),
          id: nextId++,
        },
      ],
    ]),
    id: nextId++,
  });
  await React.act(async () => {
    await wsApi.refresh();
  });
  const repoEntry = wsApi.state.entries.find((e) => e.kind === 'directory' && e.name === 'repo')!;
  wsNotices.length = 0;
  await React.act(async () => {
    if (repoEntry.kind === 'directory') await wsApi.renameDirectory(repoEntry, 'repo-renamed');
  });
  assert.ok(ext4.rootNode.children.has('repo'), 'source directory containing .git is preserved on blocked rename');
  assert.equal(ext4.rootNode.children.has('repo-renamed'), false, 'partial target is never left behind');
  assert.ok(
    wsNotices.some((n) => n.includes('workspace.renameFailed')),
    'blocking rename of directory with .git notifies user cleanly',
  );

  await React.act(async () => {
    wsRoot.unmount();
  });
}

dom.window.close();
console.log('ok - restored file conflict, stale reload protection, and workspace FS identity safety');

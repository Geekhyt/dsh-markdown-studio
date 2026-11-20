import type * as ReactNamespace from 'react';
import { loadWorkspaceHandle, storeWorkspaceHandle } from '../adapters/storage';
import type { WorkspaceEntry, WorkspaceFile, WorkspaceState } from '../domain/workspace';
import { useWindowEvent } from '../runtime/react-lifecycle';
import type { FileContextApi } from './use-file-context';

type Notify = (text: string, tone?: 'success' | 'error' | 'info') => void;
const MAX_ENTRIES = 2000;
const MAX_DEPTH = 8;
const SKIP_DIRECTORIES = new Set(['assets', '.git', 'node_modules']);

export interface WorkspaceOptions {
  React: typeof ReactNamespace;
  t: (key: string) => string;
  notify: Notify;
  fileContext: FileContextApi;
  onMenuClose: () => void;
  onOpenFile: (directory: FileSystemDirectoryHandle, entry: WorkspaceFile, text: string) => Promise<void>;
}

export interface WorkspaceApi {
  state: WorkspaceState;
  openFolder: () => Promise<void>;
  pickFolder: () => Promise<void>;
  openEntry: (entry: WorkspaceFile) => Promise<void>;
  refresh: () => Promise<void>;
  createFile: (directoryPath: string, name: string) => Promise<void>;
  createDirectory: (directoryPath: string, name: string) => Promise<void>;
  renameFile: (entry: WorkspaceFile, name: string) => Promise<void>;
  renameDirectory: (entry: import('../domain/workspace').WorkspaceDirectory, name: string) => Promise<void>;
  moveEntry: (entry: WorkspaceEntry, targetPath: string) => Promise<void>;
  deleteEntry: (entry: WorkspaceEntry) => Promise<void>;
  selectDirectory: (path: string) => void;
  close: () => void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAbort(error: unknown): boolean {
  return !!error && typeof error === 'object' && (error as { name?: unknown }).name === 'AbortError';
}

function joinPath(parent: string, name: string): string {
  return parent ? parent + '/' + name : name;
}

function parentPath(path: string): string {
  const at = path.lastIndexOf('/');
  return at < 0 ? '' : path.slice(0, at);
}

function validateName(name: string, markdown: boolean): string | null {
  let value = name.trim();
  if (!value || value === '.' || value === '..') return null;
  if (value.includes('/') || value.includes('\\') || value.includes('\0')) return null;
  if (markdown && !/\.(md|markdown)$/i.test(value)) value += '.md';
  return value;
}

async function ensurePermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  if (!handle.queryPermission) return true;
  let permission = await handle.queryPermission({ mode: 'readwrite' });
  if (permission !== 'granted') permission = await handle.requestPermission({ mode: 'readwrite' });
  return permission === 'granted';
}

async function resolveDirectory(root: FileSystemDirectoryHandle, path: string): Promise<FileSystemDirectoryHandle> {
  if (!path) return root;
  let current = root;
  for (const part of path.split('/')) {
    if (!part) continue;
    current = await current.getDirectoryHandle(part);
  }
  return current;
}

async function listTree(
  directory: FileSystemDirectoryHandle,
  parent: string,
  depth: number,
  counter: { value: number },
): Promise<WorkspaceEntry[]> {
  if (depth > MAX_DEPTH) return [];
  const entries: WorkspaceEntry[] = [];
  for await (const entry of directory.values()) {
    if (counter.value >= MAX_ENTRIES) break;
    counter.value++;
    const path = joinPath(parent, entry.name);
    if (entry.kind === 'directory') {
      if (SKIP_DIRECTORIES.has(entry.name) || entry.name.startsWith('.')) continue;
      const handle = entry as FileSystemDirectoryHandle;
      const children = await listTree(handle, path, depth + 1, counter);
      entries.push({ kind: 'directory', name: entry.name, path, handle, children });
    } else if (/\.(md|markdown)$/i.test(entry.name)) {
      entries.push({ kind: 'file', name: entry.name, path, handle: entry as FileSystemFileHandle });
    }
  }
  entries.sort(function (a, b) {
    if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return entries;
}

async function fileExists(directory: FileSystemDirectoryHandle, name: string): Promise<boolean> {
  try {
    await directory.getFileHandle(name);
    return true;
  } catch (error) {
    return false;
  }
}

async function writeNewMarkdown(directory: FileSystemDirectoryHandle, name: string): Promise<void> {
  const handle = await directory.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  const title = name.replace(/\.(md|markdown)$/i, '');
  await writable.write('# ' + title + '\n\n');
  await writable.close();
}

async function directoryExists(directory: FileSystemDirectoryHandle, name: string): Promise<boolean> {
  try {
    await directory.getDirectoryHandle(name);
    return true;
  } catch (error) {
    return false;
  }
}

async function isSameFileHandle(a: FileSystemFileHandle, b: FileSystemFileHandle): Promise<boolean> {
  if (a === b) return true;
  if (typeof a.isSameEntry === 'function') {
    try {
      return await a.isSameEntry(b);
    } catch {
      return false;
    }
  }
  return false;
}

async function entryMatchesOpenFile(entry: WorkspaceEntry, openFile: FileSystemFileHandle | null): Promise<boolean> {
  if (!openFile) return false;
  if (entry.kind === 'file') return await isSameFileHandle(entry.handle, openFile);
  for (const child of entry.children) {
    if (await entryMatchesOpenFile(child, openFile)) return true;
  }
  return false;
}

async function copyFileSafe(
  targetDir: FileSystemDirectoryHandle,
  filename: string,
  data: string | ArrayBuffer,
): Promise<void> {
  const destination = await targetDir.getFileHandle(filename, { create: true });
  const writable = await destination.createWritable();
  try {
    await writable.write(data);
    await writable.close();
  } catch (error) {
    await writable.abort().catch(() => undefined);
    await targetDir.removeEntry(filename).catch(() => undefined);
    throw error;
  }
}

async function copyDirectory(source: FileSystemDirectoryHandle, target: FileSystemDirectoryHandle): Promise<void> {
  for await (const entry of source.values()) {
    if (entry.kind === 'directory') {
      const child = await target.getDirectoryHandle(entry.name, { create: true });
      await copyDirectory(entry as FileSystemDirectoryHandle, child);
    } else {
      const file = await (entry as FileSystemFileHandle).getFile();
      const handle = await target.getFileHandle(entry.name, { create: true });
      const writable = await handle.createWritable();
      await writable.write(await file.arrayBuffer());
      await writable.close();
    }
  }
}

export function useWorkspace(options: WorkspaceOptions): WorkspaceApi {
  const React = options.React;
  const [state, setState] = React.useState<WorkspaceState>({
    open: false,
    loading: false,
    entries: [],
    error: '',
    name: '',
    selectedDir: '',
  });
  const rootRef = React.useRef<FileSystemDirectoryHandle | null>(null);

  async function loadRoot(directory: FileSystemDirectoryHandle): Promise<void> {
    rootRef.current = directory;
    options.fileContext.workspacePickRef.current = directory;
    setState({ open: true, loading: true, entries: [], error: '', name: directory.name || '', selectedDir: '' });
    try {
      const entries = await listTree(directory, '', 0, { value: 0 });
      setState({ open: true, loading: false, entries, error: '', name: directory.name || '', selectedDir: '' });
    } catch (error) {
      setState({
        open: true,
        loading: false,
        entries: [],
        error: errorMessage(error),
        name: directory.name || '',
        selectedDir: '',
      });
    }
  }

  async function restoreLast(): Promise<boolean> {
    const directory = await loadWorkspaceHandle();
    if (!directory) return false;
    try {
      if (!(await ensurePermission(directory))) return false;
      await loadRoot(directory);
      await storeWorkspaceHandle(directory);
      options.onMenuClose();
      return true;
    } catch (error) {
      return false;
    }
  }

  async function pickFolder(): Promise<void> {
    if (!window.showDirectoryPicker) {
      options.notify(options.t('file.unsupported'), 'error');
      return;
    }
    try {
      const directory = await window.showDirectoryPicker({ mode: 'readwrite' });
      if (!(await ensurePermission(directory))) {
        options.notify(options.t('workspace.permission'), 'error');
        return;
      }
      await storeWorkspaceHandle(directory);
      await loadRoot(directory);
      options.onMenuClose();
    } catch (error) {
      if (!isAbort(error)) {
        options.notify(options.t('workspace.openFailed') + ' · ' + errorMessage(error), 'error');
      }
    }
  }

  async function openFolder(): Promise<void> {
    if (await restoreLast()) return;
    await pickFolder();
  }

  async function refresh(): Promise<void> {
    const directory = rootRef.current;
    if (!directory) return;
    setState(function (prev) {
      return Object.assign({}, prev, { loading: true, error: '' });
    });
    try {
      const entries = await listTree(directory, '', 0, { value: 0 });
      setState(function (prev) {
        return Object.assign({}, prev, { loading: false, entries, error: '' });
      });
    } catch (error) {
      setState(function (prev) {
        return Object.assign({}, prev, { loading: false, error: errorMessage(error) });
      });
    }
  }

  async function openEntry(entry: WorkspaceFile): Promise<void> {
    try {
      const root = rootRef.current;
      if (!root) throw new Error('workspace directory is unavailable');
      const directory = await resolveDirectory(root, parentPath(entry.path));
      const file = await entry.handle.getFile();
      const text = await file.text();
      await options.onOpenFile(directory, entry, text);
      setState(function (prev) {
        return Object.assign({}, prev, { open: false });
      });
      options.notify(options.t('file.opened'));
    } catch (error) {
      options.notify(options.t('file.openFailed') + ' · ' + errorMessage(error), 'error');
    }
  }

  async function createFile(directoryPath: string, name: string): Promise<void> {
    const filename = validateName(name, true);
    if (!filename) {
      options.notify(options.t('workspace.invalidName'), 'error');
      return;
    }
    try {
      const root = rootRef.current;
      if (!root) throw new Error('workspace directory is unavailable');
      const directory = await resolveDirectory(root, directoryPath);
      if (!(await ensurePermission(directory))) {
        options.notify(options.t('workspace.permission'), 'error');
        return;
      }
      if (await fileExists(directory, filename)) {
        options.notify(options.t('workspace.exists'), 'error');
        return;
      }
      await writeNewMarkdown(directory, filename);
      await refresh();
      options.notify(options.t('workspace.created'));
    } catch (error) {
      options.notify(options.t('workspace.createFailed') + ' · ' + errorMessage(error), 'error');
    }
  }

  async function createDirectory(directoryPath: string, name: string): Promise<void> {
    const dirname = validateName(name, false);
    if (!dirname) {
      options.notify(options.t('workspace.invalidName'), 'error');
      return;
    }
    try {
      const root = rootRef.current;
      if (!root) throw new Error('workspace directory is unavailable');
      const directory = await resolveDirectory(root, directoryPath);
      if (!(await ensurePermission(directory))) {
        options.notify(options.t('workspace.permission'), 'error');
        return;
      }
      await directory.getDirectoryHandle(dirname, { create: true });
      await refresh();
      options.notify(options.t('workspace.created'));
    } catch (error) {
      options.notify(options.t('workspace.createFailed') + ' · ' + errorMessage(error), 'error');
    }
  }

  async function renameFile(entry: WorkspaceFile, name: string): Promise<void> {
    const filename = validateName(name, true);
    if (!filename || filename === entry.name) {
      if (!filename) options.notify(options.t('workspace.invalidName'), 'error');
      return;
    }
    if (await entryMatchesOpenFile(entry, options.fileContext.linkedFile())) {
      options.notify(options.t('workspace.moveOpenBlocked'), 'error');
      return;
    }
    try {
      const root = rootRef.current;
      if (!root) throw new Error('workspace directory is unavailable');
      const directory = await resolveDirectory(root, parentPath(entry.path));
      if (!(await ensurePermission(directory))) {
        options.notify(options.t('workspace.permission'), 'error');
        return;
      }
      if (await fileExists(directory, filename)) {
        options.notify(options.t('workspace.exists'), 'error');
        return;
      }
      const file = await entry.handle.getFile();
      await copyFileSafe(directory, filename, await file.text());
      await directory.removeEntry(entry.name);
      await refresh();
      options.notify(options.t('workspace.renamed'));
    } catch (error) {
      options.notify(options.t('workspace.renameFailed') + ' · ' + errorMessage(error), 'error');
    }
  }

  async function renameDirectory(entry: import('../domain/workspace').WorkspaceDirectory, name: string): Promise<void> {
    const dirname = validateName(name, false);
    if (!dirname || dirname === entry.name) {
      if (!dirname) options.notify(options.t('workspace.invalidName'), 'error');
      return;
    }
    if (await entryMatchesOpenFile(entry, options.fileContext.linkedFile())) {
      options.notify(options.t('workspace.moveOpenBlocked'), 'error');
      return;
    }
    try {
      const root = rootRef.current;
      if (!root) throw new Error('workspace directory is unavailable');
      const parent = await resolveDirectory(root, parentPath(entry.path));
      if (!(await ensurePermission(parent))) {
        options.notify(options.t('workspace.permission'), 'error');
        return;
      }
      if (await directoryExists(parent, dirname)) {
        options.notify(options.t('workspace.exists'), 'error');
        return;
      }
      const target = await parent.getDirectoryHandle(dirname, { create: true });
      try {
        await copyDirectory(entry.handle, target);
      } catch (error) {
        await parent.removeEntry(dirname, { recursive: true }).catch(function () {
          /* best effort */
        });
        throw error;
      }
      await parent.removeEntry(entry.name, { recursive: true });
      await refresh();
      options.notify(options.t('workspace.renamed'));
    } catch (error) {
      options.notify(options.t('workspace.renameFailed') + ' · ' + errorMessage(error), 'error');
    }
  }

  async function moveEntry(entry: WorkspaceEntry, targetPath: string): Promise<void> {
    if (targetPath === parentPath(entry.path)) return;
    if (await entryMatchesOpenFile(entry, options.fileContext.linkedFile())) {
      options.notify(options.t('workspace.moveOpenBlocked'), 'error');
      return;
    }
    if (entry.kind === 'directory' && (targetPath === entry.path || targetPath.indexOf(entry.path + '/') === 0)) {
      options.notify(options.t('workspace.moveInvalid'), 'error');
      return;
    }
    try {
      const root = rootRef.current;
      if (!root) throw new Error('workspace directory is unavailable');
      const source = await resolveDirectory(root, parentPath(entry.path));
      const target = await resolveDirectory(root, targetPath);
      if (!(await ensurePermission(source)) || !(await ensurePermission(target))) {
        options.notify(options.t('workspace.permission'), 'error');
        return;
      }
      if (entry.kind === 'directory') {
        if (await directoryExists(target, entry.name)) {
          options.notify(options.t('workspace.exists'), 'error');
          return;
        }
        const destination = await target.getDirectoryHandle(entry.name, { create: true });
        try {
          await copyDirectory(entry.handle, destination);
        } catch (error) {
          await target.removeEntry(entry.name, { recursive: true }).catch(function () {
            /* best effort */
          });
          throw error;
        }
        await source.removeEntry(entry.name, { recursive: true });
      } else {
        if (await fileExists(target, entry.name)) {
          options.notify(options.t('workspace.exists'), 'error');
          return;
        }
        const file = await entry.handle.getFile();
        await copyFileSafe(target, entry.name, await file.arrayBuffer());
        await source.removeEntry(entry.name);
      }
      await refresh();
      options.notify(options.t('workspace.moved'));
    } catch (error) {
      options.notify(options.t('workspace.moveFailed') + ' · ' + errorMessage(error), 'error');
    }
  }

  async function deleteEntry(entry: WorkspaceEntry): Promise<void> {
    if (await entryMatchesOpenFile(entry, options.fileContext.linkedFile())) {
      options.notify(options.t('workspace.moveOpenBlocked'), 'error');
      return;
    }
    try {
      const root = rootRef.current;
      if (!root) throw new Error('workspace directory is unavailable');
      const directory = await resolveDirectory(root, parentPath(entry.path));
      if (!(await ensurePermission(directory))) {
        options.notify(options.t('workspace.permission'), 'error');
        return;
      }
      await directory.removeEntry(entry.name, { recursive: entry.kind === 'directory' });
      await refresh();
      options.notify(options.t('workspace.deleted'));
    } catch (error) {
      options.notify(options.t('workspace.deleteFailed') + ' · ' + errorMessage(error), 'error');
    }
  }

  useWindowEvent(
    React,
    'focus',
    function () {
      void refresh();
    },
    state.open,
  );

  function selectDirectory(path: string): void {
    setState(function (prev) {
      return Object.assign({}, prev, { selectedDir: path });
    });
  }

  function close(): void {
    setState(function (prev) {
      return Object.assign({}, prev, { open: false });
    });
  }

  return {
    state,
    openFolder,
    pickFolder,
    openEntry,
    refresh,
    createFile,
    createDirectory,
    renameFile,
    renameDirectory,
    moveEntry,
    deleteEntry,
    selectDirectory,
    close,
  };
}

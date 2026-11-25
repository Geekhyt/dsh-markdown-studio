import type * as ReactNamespace from 'react';
import { loadWorkspaceHandle, storeWorkspaceHandle } from '../adapters/storage';
import { assetFilesInMarkdown } from '../domain/images';
import type { WorkspaceEntry, WorkspaceFile, WorkspaceState } from '../domain/workspace';
import { useWindowEvent } from '../runtime/react-lifecycle';
import type { FileContextApi } from './use-file-context';

type Notify = (text: string, tone?: 'success' | 'error' | 'info') => void;
const MAX_ENTRIES = 2000;
const MAX_DEPTH = 8;
const SKIP_DIRECTORIES = new Set(['assets', '.git', 'node_modules']);
const COPY_SKIP_DIRECTORIES = new Set(['.git', 'node_modules']);
const INVALID_FILENAME_CHARS = /[<>:"|?*\u0000-\u001f]/;

export interface WorkspaceOptions {
  React: typeof ReactNamespace;
  t: (key: string) => string;
  notify: Notify;
  fileContext: FileContextApi;
  onMenuClose: () => void;
  flushBeforeOpen?: () => Promise<boolean>;
  onOpenFile: (
    directory: FileSystemDirectoryHandle,
    entry: WorkspaceFile,
    text: string,
    file?: File,
  ) => Promise<boolean | void>;
}

export interface WorkspaceApi {
  state: WorkspaceState;
  openFolder: () => Promise<void>;
  pickFolder: () => Promise<void>;
  openEntry: (entry: WorkspaceFile) => Promise<boolean>;
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

function normalizeRelPath(raw: string): string {
  return String(raw || '')
    .split('/')
    .filter(Boolean)
    .join('/');
}

function makeTempEntryName(prefix: string): string {
  return `.mdstudio-tmp-${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function isSameHandle(a: FileSystemHandle, b: FileSystemHandle): Promise<boolean> {
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

async function isDescendantHandle(ancestor: FileSystemDirectoryHandle, candidate: FileSystemHandle): Promise<boolean> {
  if (typeof ancestor.resolve === 'function') {
    try {
      const resolved = await ancestor.resolve(candidate);
      return Boolean(resolved);
    } catch {
      return false;
    }
  }
  return false;
}

async function lookupFileHandle(
  directory: FileSystemDirectoryHandle,
  name: string,
): Promise<FileSystemFileHandle | null> {
  try {
    return await directory.getFileHandle(name);
  } catch {
    return null;
  }
}

async function lookupDirectoryHandle(
  directory: FileSystemDirectoryHandle,
  name: string,
): Promise<FileSystemDirectoryHandle | null> {
  try {
    return await directory.getDirectoryHandle(name);
  } catch {
    return null;
  }
}

function joinPath(parent: string, name: string): string {
  return parent ? parent + '/' + name : name;
}

function parentPath(path: string): string {
  const at = path.lastIndexOf('/');
  return at < 0 ? '' : path.slice(0, at);
}

const BAD_ENTRY_NAME_RE = /(?:^\.|[/\\]|[.\s]$)/;

function isValidEntryName(value: string, markdown: boolean): boolean {
  if (!value || BAD_ENTRY_NAME_RE.test(value) || INVALID_FILENAME_CHARS.test(value)) return false;
  return markdown || !SKIP_DIRECTORIES.has(value.toLowerCase());
}

function validateName(name: string, markdown: boolean): string | null {
  const value = name.trim();
  if (!isValidEntryName(value, markdown)) return null;
  return markdown && !/\.(md|markdown)$/i.test(value) ? value + '.md' : value;
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
    const path = joinPath(parent, entry.name);
    if (entry.kind === 'directory') {
      if (SKIP_DIRECTORIES.has(entry.name) || entry.name.startsWith('.')) continue;
      counter.value++;
      const handle = entry as FileSystemDirectoryHandle;
      const children = await listTree(handle, path, depth + 1, counter);
      entries.push({ kind: 'directory', name: entry.name, path, handle, children });
    } else if (/\.(md|markdown)$/i.test(entry.name)) {
      counter.value++;
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
  } catch {
    return false;
  }
}

async function writeNewMarkdown(directory: FileSystemDirectoryHandle, name: string): Promise<void> {
  const title = name.replace(/\.(md|markdown)$/i, '');
  await copyFileSafe(directory, name, '# ' + title + '\n\n');
}

async function directoryExists(directory: FileSystemDirectoryHandle, name: string): Promise<boolean> {
  return (await lookupDirectoryHandle(directory, name)) !== null;
}

async function isSameFileHandle(a: FileSystemFileHandle, b: FileSystemFileHandle): Promise<boolean> {
  return isSameHandle(a, b);
}

async function entryMatchesOpenFile(entry: WorkspaceEntry, openFile: FileSystemFileHandle | null): Promise<boolean> {
  if (!openFile) return false;
  if (entry.kind === 'file') return await isSameFileHandle(entry.handle, openFile);
  if (typeof entry.handle.resolve === 'function') {
    try {
      const resolved = await entry.handle.resolve(openFile);
      if (resolved && resolved.length > 0) return true;
    } catch {
      /* fall back to tree walk */
    }
  }
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

async function copyDirectory(
  source: FileSystemDirectoryHandle,
  target: FileSystemDirectoryHandle,
  depth = 0,
): Promise<void> {
  if (depth > MAX_DEPTH) throw new Error('directory depth limit exceeded');
  for await (const entry of source.values()) {
    if (entry.kind === 'directory') {
      if (COPY_SKIP_DIRECTORIES.has(entry.name)) continue;
      const child = await target.getDirectoryHandle(entry.name, { create: true });
      await copyDirectory(entry as FileSystemDirectoryHandle, child, depth + 1);
    } else {
      const file = await (entry as FileSystemFileHandle).getFile();
      await copyFileSafe(target, entry.name, await file.arrayBuffer());
    }
  }
}

async function copyReferencedAssets(
  sourceDir: FileSystemDirectoryHandle,
  targetDir: FileSystemDirectoryHandle,
  markdown: string,
): Promise<void> {
  const files = assetFilesInMarkdown(markdown);
  if (!files.length) return;
  const srcAssets = await lookupDirectoryHandle(sourceDir, 'assets');
  if (!srcAssets) return;
  const dstAssets = await targetDir.getDirectoryHandle('assets', { create: true });
  await Promise.all(
    files.map(async (filename) => {
      try {
        if (await fileExists(dstAssets, filename)) return;
        const srcFileHandle = await lookupFileHandle(srcAssets, filename);
        if (!srcFileHandle) return;
        const srcFile = await srcFileHandle.getFile();
        await copyFileSafe(dstAssets, filename, await srcFile.arrayBuffer());
      } catch {
        /* best-effort sidecar asset copy */
      }
    }),
  );
}

async function assertSafeDirectoryCopy(source: FileSystemDirectoryHandle, depth = 0): Promise<void> {
  if (depth > MAX_DEPTH) throw new Error('directory depth limit exceeded');
  for await (const entry of source.values()) {
    if (entry.kind === 'directory') {
      if (COPY_SKIP_DIRECTORIES.has(entry.name)) {
        throw new Error('protected directory "' + entry.name + '" cannot be copied safely');
      }
      await assertSafeDirectoryCopy(entry as FileSystemDirectoryHandle, depth + 1);
    }
  }
}

async function copyDirectoryToName(
  parent: FileSystemDirectoryHandle,
  source: FileSystemDirectoryHandle,
  targetName: string,
): Promise<FileSystemDirectoryHandle> {
  await assertSafeDirectoryCopy(source);
  const target = await parent.getDirectoryHandle(targetName, { create: true });
  try {
    await copyDirectory(source, target);
    return target;
  } catch (error) {
    await parent.removeEntry(targetName, { recursive: true }).catch(() => undefined);
    throw error;
  }
}

async function renameFileTwoHop(
  directory: FileSystemDirectoryHandle,
  oldName: string,
  nextName: string,
  data: ArrayBuffer,
): Promise<void> {
  const tmpName = makeTempEntryName('file');
  await copyFileSafe(directory, tmpName, data);
  let safeToCleanTmp = false;
  try {
    await directory.removeEntry(oldName);
    await copyFileSafe(directory, nextName, data);
    safeToCleanTmp = true;
  } catch (error) {
    try {
      await copyFileSafe(directory, oldName, data);
      safeToCleanTmp = true;
    } catch {
      /* keep tmpName on disk as last intact recovery copy */
    }
    throw error;
  } finally {
    if (safeToCleanTmp) await directory.removeEntry(tmpName).catch(() => undefined);
  }
}

async function renameDirectoryTwoHop(
  parent: FileSystemDirectoryHandle,
  entry: import('../domain/workspace').WorkspaceDirectory,
  nextName: string,
): Promise<void> {
  const tmpName = makeTempEntryName('dir');
  const tmpHandle = await copyDirectoryToName(parent, entry.handle, tmpName);
  let safeToCleanTmp = false;
  try {
    await parent.removeEntry(entry.name, { recursive: true });
    await copyDirectoryToName(parent, tmpHandle, nextName);
    safeToCleanTmp = true;
  } catch (error) {
    try {
      await copyDirectoryToName(parent, tmpHandle, entry.name);
      safeToCleanTmp = true;
    } catch {
      /* keep tmpName on disk as last intact recovery copy */
    }
    throw error;
  } finally {
    if (safeToCleanTmp) await parent.removeEntry(tmpName, { recursive: true }).catch(() => undefined);
  }
}

function remapSelectedDir(current: string, oldPath: string, nextPath: string | null): string {
  if (!current) return '';
  if (current === oldPath) return nextPath ?? '';
  if (current.startsWith(oldPath + '/')) {
    return nextPath === null ? '' : nextPath + current.slice(oldPath.length);
  }
  return current;
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
  const scanGenRef = React.useRef(0);
  const openGenRef = React.useRef(0);
  const dialogOpenRef = React.useRef(false);

  function isStaleScan(gen: number): boolean {
    return gen !== scanGenRef.current || !dialogOpenRef.current;
  }

  async function loadRoot(directory: FileSystemDirectoryHandle): Promise<void> {
    const gen = ++scanGenRef.current;
    openGenRef.current++;
    const name = directory.name || '';
    rootRef.current = directory;
    dialogOpenRef.current = true;
    options.fileContext.workspacePickRef.current = directory;
    setState({ open: true, loading: true, entries: [], error: '', name, selectedDir: '' });
    try {
      const entries = await listTree(directory, '', 0, { value: 0 });
      if (isStaleScan(gen)) return;
      setState({ open: true, loading: false, entries, error: '', name, selectedDir: '' });
    } catch (error) {
      if (isStaleScan(gen)) return;
      setState({ open: true, loading: false, entries: [], error: errorMessage(error), name, selectedDir: '' });
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
    } catch {
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
    const gen = ++scanGenRef.current;
    setState(function (prev) {
      return Object.assign({}, prev, { loading: true, error: '' });
    });
    try {
      const entries = await listTree(directory, '', 0, { value: 0 });
      if (gen !== scanGenRef.current) return;
      setState(function (prev) {
        return Object.assign({}, prev, { loading: false, entries, error: '' });
      });
    } catch (error) {
      if (gen !== scanGenRef.current) return;
      setState(function (prev) {
        return Object.assign({}, prev, { loading: false, error: errorMessage(error) });
      });
    }
  }

  async function openEntry(entry: WorkspaceFile): Promise<boolean> {
    const req = ++openGenRef.current;
    try {
      const root = rootRef.current;
      if (!root) throw new Error('workspace directory is unavailable');
      // Flush any unsaved edits on the currently linked file BEFORE reading disk so re-opening the same file reads fresh bytes.
      if (options.flushBeforeOpen && !(await options.flushBeforeOpen())) return false;
      if (req !== openGenRef.current) return false;
      const directory = await resolveDirectory(root, parentPath(entry.path));
      const file = await entry.handle.getFile();
      const text = await file.text();
      if (req !== openGenRef.current) return false;
      const opened = await options.onOpenFile(directory, entry, text, file);
      if (req !== openGenRef.current || opened === false) return false;
      dialogOpenRef.current = false;
      setState(function (prev) {
        return Object.assign({}, prev, { open: false });
      });
      options.notify(options.t('file.opened'));
      return true;
    } catch (error) {
      if (req === openGenRef.current) {
        options.notify(options.t('file.openFailed') + ' · ' + errorMessage(error), 'error');
      }
      return false;
    }
  }

  async function resolveWritableDirectory(directoryPath: string): Promise<FileSystemDirectoryHandle | null> {
    const root = rootRef.current;
    if (!root) throw new Error('workspace directory is unavailable');
    const directory = await resolveDirectory(root, directoryPath);
    if (!(await ensurePermission(directory))) {
      options.notify(options.t('workspace.permission'), 'error');
      return null;
    }
    return directory;
  }

  async function createFile(directoryPath: string, name: string): Promise<void> {
    const filename = validateName(name, true);
    if (!filename) {
      options.notify(options.t('workspace.invalidName'), 'error');
      return;
    }
    try {
      const directory = await resolveWritableDirectory(directoryPath);
      if (!directory) return;
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
      const directory = await resolveWritableDirectory(directoryPath);
      if (!directory) return;
      if (await directoryExists(directory, dirname)) {
        options.notify(options.t('workspace.exists'), 'error');
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
      options.notify(options.t('workspace.renameOpenBlocked'), 'error');
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
      const existing = await lookupFileHandle(directory, filename);
      const sameEntry = existing ? await isSameHandle(existing, entry.handle) : false;
      if (existing && !sameEntry) {
        options.notify(options.t('workspace.exists'), 'error');
        return;
      }
      const file = await entry.handle.getFile();
      const data = await file.arrayBuffer();
      if (sameEntry) {
        await renameFileTwoHop(directory, entry.name, filename, data);
      } else {
        await copyFileSafe(directory, filename, data);
        await directory.removeEntry(entry.name);
      }
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
      options.notify(options.t('workspace.renameOpenBlocked'), 'error');
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
      const existing = await lookupDirectoryHandle(parent, dirname);
      const sameEntry = existing ? await isSameHandle(existing, entry.handle) : false;
      if (existing && !sameEntry) {
        options.notify(options.t('workspace.exists'), 'error');
        return;
      }
      if (sameEntry) {
        await renameDirectoryTwoHop(parent, entry, dirname);
      } else {
        await copyDirectoryToName(parent, entry.handle, dirname);
        await parent.removeEntry(entry.name, { recursive: true });
      }
      const renamedPath = joinPath(parentPath(entry.path), dirname);
      setState((prev) => ({ ...prev, selectedDir: remapSelectedDir(prev.selectedDir, entry.path, renamedPath) }));
      await refresh();
      options.notify(options.t('workspace.renamed'));
    } catch (error) {
      options.notify(options.t('workspace.renameFailed') + ' · ' + errorMessage(error), 'error');
    }
  }

  async function moveEntry(entry: WorkspaceEntry, rawTargetPath: string): Promise<void> {
    const targetPath = normalizeRelPath(rawTargetPath);
    const sourcePath = normalizeRelPath(entry.path);
    if (targetPath === parentPath(sourcePath)) return;
    if (await entryMatchesOpenFile(entry, options.fileContext.linkedFile())) {
      options.notify(options.t('workspace.moveOpenBlocked'), 'error');
      return;
    }
    if (entry.kind === 'directory' && (targetPath === sourcePath || targetPath.indexOf(sourcePath + '/') === 0)) {
      options.notify(options.t('workspace.moveInvalid'), 'error');
      return;
    }
    try {
      const root = rootRef.current;
      if (!root) throw new Error('workspace directory is unavailable');
      const source = await resolveDirectory(root, parentPath(entry.path));
      const target = await resolveDirectory(root, targetPath);
      if (await isSameHandle(source, target)) return;
      if (
        entry.kind === 'directory' &&
        ((await isSameHandle(entry.handle, target)) || (await isDescendantHandle(entry.handle, target)))
      ) {
        options.notify(options.t('workspace.moveInvalid'), 'error');
        return;
      }
      if (!(await ensurePermission(source)) || !(await ensurePermission(target))) {
        options.notify(options.t('workspace.permission'), 'error');
        return;
      }
      if (entry.kind === 'directory') {
        if (await directoryExists(target, entry.name)) {
          options.notify(options.t('workspace.exists'), 'error');
          return;
        }
        await copyDirectoryToName(target, entry.handle, entry.name);
        await source.removeEntry(entry.name, { recursive: true });
        const movedPath = joinPath(targetPath, entry.name);
        setState((prev) => ({ ...prev, selectedDir: remapSelectedDir(prev.selectedDir, entry.path, movedPath) }));
      } else {
        if (await fileExists(target, entry.name)) {
          options.notify(options.t('workspace.exists'), 'error');
          return;
        }
        const file = await entry.handle.getFile();
        const bytes = await file.arrayBuffer();
        const text = new TextDecoder().decode(bytes);
        await copyFileSafe(target, entry.name, bytes);
        await copyReferencedAssets(source, target, text);
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
      options.notify(options.t('workspace.deleteOpenBlocked'), 'error');
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
      if (entry.kind === 'directory') {
        setState((prev) => ({ ...prev, selectedDir: remapSelectedDir(prev.selectedDir, entry.path, null) }));
      }
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
    openGenRef.current++;
    dialogOpenRef.current = false;
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

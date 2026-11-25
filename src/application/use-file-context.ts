import type * as ReactNamespace from 'react';
import { fileFingerprint } from '../adapters/file-version';
import { loadDocumentRef, storeDocumentRef } from '../adapters/storage';
import { normalizeLineEndings } from './use-document-history';
import type { DocumentRef, FileVersion } from '../domain/document-ref';
import { isGenerationCurrent, isReloadRequestValid, normalizePermissionState } from '../domain/file-session.machine';
import { useDocumentEvent, useLatest, useMountDisposable, useWindowEvent } from '../runtime/react-lifecycle';

type Notify = (text: string, tone?: 'success' | 'error' | 'info') => void;

export interface FileContextOptions {
  React: typeof ReactNamespace;
  t: (key: string) => string;
  notify: Notify;
  onReload: (text: string, file: File) => void;
  getDocument: () => { id: string; markdown: string };
}

export interface FileContextApi {
  fileName: string;
  conflict: boolean;
  conflictRef: { current: boolean };
  permission: 'granted' | 'prompt' | 'denied';
  requestPermission: () => Promise<boolean>;
  workspacePickRef: { current: FileSystemDirectoryHandle | null };
  linkedFile: () => FileSystemFileHandle | null;
  linkedFolder: () => FileSystemDirectoryHandle | null;
  setFileName: (name: string) => void;
  linkFile: (handle: FileSystemFileHandle) => void;
  linkFolder: (directory: FileSystemDirectoryHandle, file: FileSystemFileHandle) => void;
  applyDocumentRef: (ref: DocumentRef) => void;
  reset: (articleId: string) => void;
  stampFile: (handle: FileSystemFileHandle, file: File, text?: string) => Promise<void>;
  clearConflict: () => void;
  dismissConflict: () => void;
  isExternallyChanged: () => Promise<boolean>;
  writeFile: (
    handle: FileSystemFileHandle,
    content: string,
    overwrite?: boolean,
    requestPermission?: boolean,
  ) => Promise<'saved' | 'conflict' | 'denied' | 'stale'>;
  reload: () => Promise<void>;
}

export function useFileContext(options: FileContextOptions): FileContextApi {
  const React = options.React;
  const optionsRef = useLatest(React, options);
  const [fileName, setFileName] = React.useState<string>('');
  const [conflict, setConflict] = React.useState(false);
  const [permission, setPermission] = React.useState<'granted' | 'prompt' | 'denied'>('granted');
  const conflictRef = React.useRef(false);
  const stampRef = React.useRef<({ handle: FileSystemFileHandle } & FileVersion) | null>(null);
  const documentRef = React.useRef<DocumentRef>({ kind: 'library', articleId: '' });
  const workspacePickRef = React.useRef<FileSystemDirectoryHandle | null>(null);
  const generationRef = React.useRef(0);
  const reloadRef = React.useRef(0);
  const restoringRef = React.useRef<Promise<void>>(Promise.resolve());
  const writesRef = React.useRef<Promise<unknown>>(Promise.resolve());

  function linkedFile(): FileSystemFileHandle | null {
    const ref = documentRef.current;
    if (ref.kind === 'file') return ref.handle;
    if (ref.kind === 'folder') return ref.file;
    return null;
  }

  function linkedFolder(): FileSystemDirectoryHandle | null {
    const ref = documentRef.current;
    return ref.kind === 'folder' ? ref.directory : null;
  }

  function permissionHandle(): FileSystemFileHandle | FileSystemDirectoryHandle | null {
    return linkedFolder() || linkedFile();
  }

  async function refreshPermission(): Promise<'granted' | 'prompt' | 'denied'> {
    const generation = generationRef.current;
    const handle = permissionHandle();
    if (!handle || typeof handle.queryPermission !== 'function') {
      setPermission('granted');
      return 'granted';
    }
    try {
      const result = await handle.queryPermission({ mode: 'readwrite' });
      const next = normalizePermissionState(result);
      if (isGenerationCurrent(generation, generationRef.current)) setPermission(next);
      return next;
    } catch {
      if (isGenerationCurrent(generation, generationRef.current)) setPermission('prompt');
      return 'prompt';
    }
  }

  async function requestPermission(): Promise<boolean> {
    const generation = generationRef.current;
    const handle = permissionHandle();
    if (!handle) return true;
    if (typeof handle.requestPermission !== 'function') {
      if (isGenerationCurrent(generation, generationRef.current)) setPermission('granted');
      return true;
    }
    try {
      const result = await handle.requestPermission({ mode: 'readwrite' });
      if (!isGenerationCurrent(generation, generationRef.current)) return false;
      setPermission(normalizePermissionState(result));
      if (result === 'granted') checkExternalOnFocus();
      return result === 'granted';
    } catch {
      if (isGenerationCurrent(generation, generationRef.current)) setPermission('prompt');
      return false;
    }
  }

  function rememberFile(handle: FileSystemFileHandle, file: File, fingerprint: string): void {
    const version = { fingerprint, lastModified: file.lastModified, size: file.size };
    stampRef.current = { handle, ...version };
    const ref = documentRef.current;
    if (ref.kind === 'library' || linkedFile() !== handle) return;
    documentRef.current = { ...ref, articleId: optionsRef.current.getDocument().id, version };
    void storeDocumentRef(documentRef.current);
  }

  async function stampFile(handle: FileSystemFileHandle, file: File, text?: string): Promise<void> {
    const generation = generationRef.current;
    const fingerprint = await fileFingerprint(text === undefined ? await file.text() : text);
    if (generation !== generationRef.current) return;
    rememberFile(handle, file, fingerprint);
  }

  function markConflict(key = 'file.conflict'): void {
    conflictRef.current = true;
    setConflict(true);
    optionsRef.current.notify(optionsRef.current.t(key), 'error');
  }

  function clearConflict(): void {
    stampRef.current = null;
    conflictRef.current = false;
    setConflict(false);
  }

  function dismissConflict(): void {
    conflictRef.current = false;
    setConflict(false);
  }

  function enqueueFileOp<T>(task: () => Promise<T>): Promise<T> {
    const pending = writesRef.current.then(task, task);
    writesRef.current = pending.catch(function () {
      /* subsequent ops keep flowing */
    });
    return pending;
  }

  async function isExternallyChanged(): Promise<boolean> {
    const handle = linkedFile();
    if (!handle) return false;
    const generation = generationRef.current;
    try {
      const file = await handle.getFile();
      const diskText = await file.text();
      const fingerprint = await fileFingerprint(diskText);
      if (generation !== generationRef.current) return true;
      const stamp = stampRef.current;
      if (stamp && stamp.handle === handle && fingerprint === stamp.fingerprint) return false;
      if (!stamp) {
        const normalizedDisk = await fileFingerprint(normalizeLineEndings(diskText));
        const expected = await fileFingerprint(normalizeLineEndings(optionsRef.current.getDocument().markdown));
        if (generation !== generationRef.current) return true;
        if (normalizedDisk === expected) {
          rememberFile(handle, file, fingerprint);
          return false;
        }
      }
      markConflict();
    } catch {
      if (generation === generationRef.current) markConflict('file.missing');
    }
    return true;
  }

  // All file writes, reloads, and conflict checks share one queue; a switched document invalidates queued work.
  function writeFile(
    handle: FileSystemFileHandle,
    content: string,
    overwrite = false,
    requestWritePermission = false,
  ): Promise<'saved' | 'conflict' | 'denied' | 'stale'> {
    const generation = generationRef.current;
    return enqueueFileOp(async (): Promise<'saved' | 'conflict' | 'denied' | 'stale'> => {
      await restoringRef.current;
      if (generation !== generationRef.current) return 'stale';
      const current = linkedFile();
      const sameFile = Boolean(
        current && (current === handle || (handle.isSameEntry && (await handle.isSameEntry(current)))),
      );
      if (generation !== generationRef.current) return 'stale';
      const permTarget = sameFile ? permissionHandle() || handle : handle;
      if (permTarget.queryPermission) {
        let allowed = await permTarget.queryPermission({ mode: 'readwrite' });
        if (allowed !== 'granted' && requestWritePermission && typeof permTarget.requestPermission === 'function') {
          allowed = await permTarget.requestPermission({ mode: 'readwrite' });
        }
        if (sameFile && generation === generationRef.current) {
          setPermission(normalizePermissionState(allowed));
        }
        if (allowed !== 'granted') return 'denied';
      }
      if (generation !== generationRef.current) return 'stale';
      if (sameFile && !overwrite && (conflictRef.current || (await isExternallyChanged()))) return 'conflict';
      if (generation !== generationRef.current) return 'stale';
      const writable = await handle.createWritable();
      try {
        if (generation !== generationRef.current) {
          await writable.abort();
          return 'stale';
        }
        await writable.write(content);
        await writable.close();
      } catch (error) {
        await writable.abort().catch(function () {
          /* preserve the original error */
        });
        throw error;
      }
      if (generation !== generationRef.current) return 'stale';
      await stampFile(sameFile && current ? current : handle, await handle.getFile(), content);
      if (generation !== generationRef.current) return 'stale';
      dismissConflict();
      return 'saved';
    });
  }

  function persist(ref: DocumentRef): void {
    generationRef.current++;
    reloadRef.current++;
    documentRef.current = ref;
    void storeDocumentRef(ref);
  }

  function linkFile(handle: FileSystemFileHandle): void {
    workspacePickRef.current = null;
    dismissConflict();
    if (stampRef.current?.handle !== handle) stampRef.current = null;
    const version = stampRef.current?.handle === handle ? stampRef.current : undefined;
    persist({
      kind: 'file',
      handle,
      articleId: optionsRef.current.getDocument().id,
      version: version && { fingerprint: version.fingerprint, lastModified: version.lastModified, size: version.size },
    });
    void refreshPermission();
  }

  function linkFolder(directory: FileSystemDirectoryHandle, file: FileSystemFileHandle): void {
    workspacePickRef.current = directory;
    dismissConflict();
    if (stampRef.current?.handle !== file) stampRef.current = null;
    const version = stampRef.current?.handle === file ? stampRef.current : undefined;
    persist({
      kind: 'folder',
      directory,
      file,
      articleId: optionsRef.current.getDocument().id,
      version: version && { fingerprint: version.fingerprint, lastModified: version.lastModified, size: version.size },
    });
    void refreshPermission();
  }

  function reset(articleId: string): void {
    clearConflict();
    workspacePickRef.current = null;
    persist({ kind: 'library', articleId });
    setPermission('granted');
  }

  function currentRequest(generation: number, articleId: string): boolean {
    return generation === generationRef.current && optionsRef.current.getDocument().id === articleId;
  }

  async function reload(): Promise<void> {
    const handle = linkedFile();
    if (!handle) return;
    const generation = generationRef.current;
    const request = ++reloadRef.current;
    const article = optionsRef.current.getDocument();
    const originalText = article.markdown;
    const valid = () =>
      isReloadRequestValid({
        capturedGeneration: generation,
        currentGeneration: generationRef.current,
        capturedRequest: request,
        currentRequest: reloadRef.current,
        capturedArticleId: article.id,
        currentArticleId: optionsRef.current.getDocument().id,
        originalText,
        currentText: optionsRef.current.getDocument().markdown,
      });
    await enqueueFileOp(async () => {
      try {
        if (!valid()) return;
        if (handle.queryPermission) {
          const perm = await handle.queryPermission({ mode: 'read' });
          if (perm !== 'granted' && typeof handle.requestPermission === 'function') {
            const granted = await handle.requestPermission({ mode: 'read' });
            if (granted !== 'granted') {
              if (valid()) optionsRef.current.notify(optionsRef.current.t('file.permission'), 'error');
              return;
            }
          }
        }
        if (!valid()) return;
        const file = await handle.getFile();
        const text = await file.text();
        const fingerprint = await fileFingerprint(text);
        if (!valid()) return;
        rememberFile(handle, file, fingerprint);
        dismissConflict();
        optionsRef.current.onReload(text, file);
        optionsRef.current.notify(optionsRef.current.t('file.reloaded'));
      } catch {
        if (valid()) optionsRef.current.notify(optionsRef.current.t('file.openFailed'), 'error');
      }
    });
  }

  async function restoreAssociation(generation: number): Promise<void> {
    const ref = await loadDocumentRef();
    if (!ref || ref.kind === 'library' || generation !== generationRef.current) return;
    const article = optionsRef.current.getDocument();
    if (ref.articleId && ref.articleId !== article.id) return;
    documentRef.current = ref;
    const handle = ref.kind === 'file' ? ref.handle : ref.file;
    if (ref.kind === 'folder') workspacePickRef.current = ref.directory;
    if (ref.version) stampRef.current = { handle, ...ref.version };
    setFileName(handle.name || '');
    const perm = await refreshPermission();
    if (!currentRequest(generation, article.id) || perm !== 'granted') return;
    try {
      const file = await handle.getFile();
      const diskText = await file.text();
      const fingerprint = await fileFingerprint(diskText);
      const matchesVersion = ref.version ? fingerprint === ref.version.fingerprint : false;
      const matchesNormalizedDraft =
        !ref.version &&
        (await fileFingerprint(normalizeLineEndings(diskText))) ===
          (await fileFingerprint(normalizeLineEndings(article.markdown)));
      if (!currentRequest(generation, article.id)) return;
      if (!matchesVersion && !matchesNormalizedDraft) markConflict();
      else rememberFile(handle, file, fingerprint);
    } catch {
      if (currentRequest(generation, article.id)) markConflict('file.missing');
    }
  }

  useMountDisposable(React, function () {
    restoringRef.current = restoreAssociation(generationRef.current);
    return function () {
      generationRef.current++;
      reloadRef.current++;
    };
  });

  function checkExternalOnFocus(): void {
    if (!linkedFile() || conflictRef.current) return;
    const generation = generationRef.current;
    void enqueueFileOp(async function () {
      await restoringRef.current;
      if (generation !== generationRef.current || !linkedFile() || conflictRef.current) return false;
      const perm = await refreshPermission();
      if (generation !== generationRef.current || perm !== 'granted' || !linkedFile() || conflictRef.current) {
        return false;
      }
      return isExternallyChanged();
    });
  }

  useWindowEvent(React, 'focus', checkExternalOnFocus);
  useDocumentEvent(React, 'visibilitychange', function () {
    if (document.visibilityState === 'visible') checkExternalOnFocus();
  });

  function applyDocumentRef(ref: DocumentRef): void {
    if (ref.kind === 'file') linkFile(ref.handle);
    else if (ref.kind === 'folder') linkFolder(ref.directory, ref.file);
    else reset(ref.articleId);
  }

  return {
    fileName,
    conflict,
    conflictRef,
    permission,
    requestPermission,
    workspacePickRef,
    linkedFile,
    linkedFolder,
    setFileName,
    linkFile,
    linkFolder,
    applyDocumentRef,
    reset,
    stampFile,
    clearConflict,
    dismissConflict,
    isExternallyChanged,
    writeFile,
    reload,
  };
}

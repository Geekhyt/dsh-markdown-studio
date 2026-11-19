import type * as ReactNamespace from 'react';
import { fileFingerprint } from '../adapters/file-version';
import { loadDocumentRef, storeDocumentRef } from '../adapters/storage';
import type { DocumentRef, FileVersion } from '../domain/document-ref';
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

  async function refreshPermission(): Promise<void> {
    const handle = permissionHandle();
    if (!handle || typeof handle.queryPermission !== 'function') {
      setPermission('granted');
      return;
    }
    try {
      const result = await handle.queryPermission({ mode: 'readwrite' });
      setPermission(result === 'granted' ? 'granted' : result === 'denied' ? 'denied' : 'prompt');
    } catch (error) {
      setPermission('prompt');
    }
  }

  async function requestPermission(): Promise<boolean> {
    const handle = permissionHandle();
    if (!handle) return true;
    if (typeof handle.requestPermission !== 'function') {
      setPermission('granted');
      return true;
    }
    try {
      const result = await handle.requestPermission({ mode: 'readwrite' });
      setPermission(result === 'granted' ? 'granted' : result === 'denied' ? 'denied' : 'prompt');
      return result === 'granted';
    } catch (error) {
      setPermission('prompt');
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

  async function isExternallyChanged(): Promise<boolean> {
    const handle = linkedFile();
    if (!handle) return false;
    const generation = generationRef.current;
    const stamp = stampRef.current;
    try {
      const file = await handle.getFile();
      const fingerprint = await fileFingerprint(await file.text());
      if (generation !== generationRef.current) return true;
      if (stamp && stamp.handle === handle && fingerprint === stamp.fingerprint) return false;
      markConflict();
    } catch (error) {
      if (generation === generationRef.current) markConflict('file.missing');
    }
    return true;
  }

  // All file writes share one queue; a switched document invalidates queued work.
  function writeFile(
    handle: FileSystemFileHandle,
    content: string,
    overwrite = false,
    requestWritePermission = false,
  ): Promise<'saved' | 'conflict' | 'denied' | 'stale'> {
    const generation = generationRef.current;
    const run = async (): Promise<'saved' | 'conflict' | 'denied' | 'stale'> => {
      await restoringRef.current;
      if (generation !== generationRef.current) return 'stale';
      if (handle.queryPermission) {
        let allowed = await handle.queryPermission({ mode: 'readwrite' });
        if (allowed !== 'granted' && requestWritePermission)
          allowed = await handle.requestPermission({ mode: 'readwrite' });
        if (allowed !== 'granted') return 'denied';
      }
      const current = linkedFile();
      const sameFile = current && (current === handle || (handle.isSameEntry && (await handle.isSameEntry(current))));
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
      await stampFile(handle, await handle.getFile(), content);
      if (generation !== generationRef.current) return 'stale';
      dismissConflict();
      return 'saved';
    };
    const pending = writesRef.current.then(run, run);
    writesRef.current = pending.catch(function () {
      /* the next save may retry */
    });
    return pending;
  }

  function persist(ref: DocumentRef): void {
    generationRef.current++;
    reloadRef.current++;
    documentRef.current = ref;
    void storeDocumentRef(ref);
  }

  function linkFile(handle: FileSystemFileHandle): void {
    workspacePickRef.current = null;
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
    persist({ kind: 'folder', directory, file, articleId: optionsRef.current.getDocument().id });
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
      currentRequest(generation, article.id) &&
      request === reloadRef.current &&
      originalText === optionsRef.current.getDocument().markdown;
    try {
      const file = await handle.getFile();
      const text = await file.text();
      const fingerprint = await fileFingerprint(text);
      if (!valid()) return;
      rememberFile(handle, file, fingerprint);
      optionsRef.current.onReload(text, file);
      dismissConflict();
      optionsRef.current.notify(optionsRef.current.t('file.reloaded'));
    } catch (error) {
      if (valid()) optionsRef.current.notify(optionsRef.current.t('file.openFailed'), 'error');
    }
  }

  async function restoreAssociation(generation: number): Promise<void> {
    const ref = await loadDocumentRef();
    if (!ref || ref.kind === 'library' || generation !== generationRef.current) return;
    const article = optionsRef.current.getDocument();
    if (ref.articleId && ref.articleId !== article.id) return;
    documentRef.current = ref;
    const handle = ref.kind === 'file' ? ref.handle : ref.file;
    if (ref.kind === 'folder') workspacePickRef.current = ref.directory;
    setFileName(handle.name || '');
    try {
      const file = await handle.getFile();
      const fingerprint = await fileFingerprint(await file.text());
      const expected = ref.version?.fingerprint || (await fileFingerprint(article.markdown));
      if (!currentRequest(generation, article.id)) return;
      if (fingerprint !== expected) markConflict();
      else rememberFile(handle, file, fingerprint);
    } catch (error) {
      if (currentRequest(generation, article.id)) markConflict('file.missing');
    }
    if (currentRequest(generation, article.id)) await refreshPermission();
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
    void restoringRef.current.then(function () {
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

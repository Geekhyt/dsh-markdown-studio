import type { Article, LibraryState } from '../domain/article';
import { compactLibraryForStorage, parseView } from '../domain/article';
import { type CustomTheme, mergeCustomThemes } from '../domain/custom-themes';
import type { DocumentRef } from '../domain/document-ref';
import { isFutureSchema, LIBRARY_SCHEMA_VERSION, supportedSchemaVersion } from '../domain/schema';
import { sanitizeSettings } from '../domain/settings';
import type { WritingSkillState } from '../domain/writing-skills';
import { defaultWritingSkillState, sanitizeWritingSkillState } from '../domain/writing-skills';
import { DEFAULT_SETTINGS, SAMPLE_TITLE, sampleArticleFor } from '../themes';

export const LIBRARY_KEY_V2 = 'dsh.markdown-studio.library.v2';
export const LIBRARY_BACKUP_KEY = 'dsh.markdown-studio.library.backup.v2';
export const LIBRARY_UNREADABLE_KEY = 'dsh.markdown-studio.library.unreadable.v2';
export const WRITING_SKILLS_KEY = 'dsh.markdown-studio.skills.v1';
const IMPORT_RECOVERY_STORAGE_KEY = 'dsh.markdown-studio.import-recovery.v1';

export class LibraryStorageError extends Error {
  constructor(readonly reason: 'unsupported' | 'corrupt') {
    super(reason);
  }
}

function safeStorageGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function rawLibrarySnapshot(): string {
  return JSON.stringify(
    Object.fromEntries(
      [LIBRARY_KEY_V2, LIBRARY_BACKUP_KEY, LIBRARY_UNREADABLE_KEY, WRITING_SKILLS_KEY].map((key) => [
        key,
        safeStorageGet(key),
      ]),
    ),
    null,
    2,
  );
}

export function loadWritingSkills(storage?: Pick<Storage, 'getItem'>): WritingSkillState {
  try {
    const store = storage || window.localStorage;
    const raw = store.getItem(WRITING_SKILLS_KEY);
    return raw ? sanitizeWritingSkillState(JSON.parse(raw)) : defaultWritingSkillState();
  } catch {
    return defaultWritingSkillState();
  }
}

export function saveWritingSkills(state: WritingSkillState, storage?: Pick<Storage, 'setItem'>): boolean {
  try {
    const store = storage || window.localStorage;
    store.setItem(WRITING_SKILLS_KEY, JSON.stringify(sanitizeWritingSkillState(state)));
    return true;
  } catch {
    return false;
  }
}

function rejectFutureLibrary(raw: string | null): void {
  if (!raw) return;
  let data: { schemaVersion?: unknown } | null;
  try {
    data = JSON.parse(raw);
  } catch {
    return;
  }
  if (data && isFutureSchema(data.schemaVersion, LIBRARY_SCHEMA_VERSION)) {
    throw new LibraryStorageError('unsupported');
  }
}

function parseArticleRecord(entry: unknown): Article | null {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
  const record = entry as Record<string, unknown>;
  if (typeof record.id !== 'string' || !record.id.trim() || typeof record.markdown !== 'string') return null;
  const rawUpdated = Number(record.updatedAt);
  const rawRev = Number(record.rev);
  return {
    id: record.id,
    title: typeof record.title === 'string' && record.title ? record.title : SAMPLE_TITLE,
    markdown: record.markdown,
    settings: sanitizeSettings(record.settings),
    view: parseView(record.view),
    updatedAt: Number.isFinite(rawUpdated) && rawUpdated > 0 ? rawUpdated : Date.now(),
    ...(Number.isInteger(rawRev) && rawRev > 0 ? { rev: rawRev } : {}),
  };
}

function parsePersistedLibrary(raw: string | null): LibraryState | null {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as {
      activeId?: unknown;
      docs?: unknown;
      trash?: unknown;
      schemaVersion?: unknown;
      version?: unknown;
    };
    if (!data || !Array.isArray(data.docs)) return null;
    if (supportedSchemaVersion(data.schemaVersion, Number(data.version) === 2 ? 2 : 1, LIBRARY_SCHEMA_VERSION) === null)
      return null;
    const docs: Article[] = [];
    for (const entry of data.docs) {
      const article = parseArticleRecord(entry);
      if (article) docs.push(article);
    }
    if (!docs.length) return null;
    let sharedCustom: CustomTheme[] = [];
    for (const doc of docs) {
      sharedCustom = mergeCustomThemes(sharedCustom, doc.settings.customThemes);
    }
    const hydratedDocs = sharedCustom.length
      ? docs.map((doc) => ({ ...doc, settings: { ...doc.settings, customThemes: sharedCustom } }))
      : docs;
    const trash: Article[] = [];
    if (Array.isArray(data.trash)) {
      for (const entry of data.trash) {
        const article = parseArticleRecord(entry);
        if (article)
          trash.push({ ...article, deletedAt: Number((entry as { deletedAt?: unknown }).deletedAt) || Date.now() });
      }
    }
    const activeId =
      typeof data.activeId === 'string' && hydratedDocs.some((entry) => entry.id === data.activeId)
        ? data.activeId
        : hydratedDocs[0].id;
    return { activeId, docs: hydratedDocs, trash };
  } catch {
    return null;
  }
}

function isRawFutureLibrary(raw: string | null): boolean {
  if (!raw) return false;
  try {
    const data = JSON.parse(raw) as { schemaVersion?: unknown } | null;
    return Boolean(data && isFutureSchema(data.schemaVersion, LIBRARY_SCHEMA_VERSION));
  } catch {
    return false;
  }
}

export function hasFuturePersistedLibrary(): boolean {
  const primary = safeStorageGet(LIBRARY_KEY_V2);
  if (isRawFutureLibrary(primary)) return true;
  if (!parsePersistedLibrary(primary)) return isRawFutureLibrary(safeStorageGet(LIBRARY_BACKUP_KEY));
  return false;
}

export function loadPersistedLibrary(): LibraryState | null {
  const primaryRaw = safeStorageGet(LIBRARY_KEY_V2);
  if (isRawFutureLibrary(primaryRaw)) return null;
  const primary = parsePersistedLibrary(primaryRaw);
  if (primary) return primary;
  return parsePersistedLibrary(safeStorageGet(LIBRARY_BACKUP_KEY));
}

function restoreStorageKey(key: string, previous: string | null): void {
  if (previous === null) return;
  try {
    window.localStorage.setItem(key, previous);
  } catch {
    /* best-effort rollback */
  }
}

function writePrimaryWithQuotaRetry(payload: string): void {
  try {
    window.localStorage.setItem(LIBRARY_KEY_V2, payload);
  } catch {
    // Snapshot backup/unreadable/import-recovery keys before eviction so a still-failing retry does not destroy recovery data.
    const prevBackup = safeStorageGet(LIBRARY_BACKUP_KEY);
    const prevUnreadable = safeStorageGet(LIBRARY_UNREADABLE_KEY);
    const prevRecovery = safeStorageGet(IMPORT_RECOVERY_STORAGE_KEY);
    try {
      window.localStorage.removeItem(LIBRARY_BACKUP_KEY);
      window.localStorage.removeItem(LIBRARY_UNREADABLE_KEY);
    } catch {
      /* ignore */
    }
    try {
      window.localStorage.setItem(LIBRARY_KEY_V2, payload);
      return;
    } catch {
      try {
        window.localStorage.removeItem(IMPORT_RECOVERY_STORAGE_KEY);
        window.localStorage.setItem(LIBRARY_KEY_V2, payload);
        return;
      } catch (retryError) {
        restoreStorageKey(LIBRARY_BACKUP_KEY, prevBackup);
        restoreStorageKey(LIBRARY_UNREADABLE_KEY, prevUnreadable);
        restoreStorageKey(IMPORT_RECOVERY_STORAGE_KEY, prevRecovery);
        throw retryError;
      }
    }
  }
}

export function savePersistedLibrary(value: LibraryState): boolean {
  try {
    const previous = safeStorageGet(LIBRARY_KEY_V2);
    rejectFutureLibrary(previous);
    const parsedPrevious = parsePersistedLibrary(previous);
    if (!parsedPrevious) rejectFutureLibrary(safeStorageGet(LIBRARY_BACKUP_KEY));
    // Preserve unreadable bytes before a last-good recovery writes the primary.
    if (previous && !parsedPrevious) {
      try {
        window.localStorage.setItem(LIBRARY_UNREADABLE_KEY, previous);
      } catch {
        /* best-effort preservation */
      }
    }
    if (previous && previous.length <= 1_500_000 && parsedPrevious) {
      try {
        window.localStorage.setItem(LIBRARY_BACKUP_KEY, previous);
      } catch {
        /* backup quota failure must not block primary library persistence */
      }
    }
    const serialized = JSON.stringify({
      version: 2,
      schemaVersion: LIBRARY_SCHEMA_VERSION,
      ...compactLibraryForStorage(value),
    });
    writePrimaryWithQuotaRetry(serialized);
    if (!previous && serialized.length <= 1_500_000 && !safeStorageGet(LIBRARY_BACKUP_KEY)) {
      try {
        window.localStorage.setItem(LIBRARY_BACKUP_KEY, serialized);
      } catch {
        /* backup quota failure must not block primary library persistence */
      }
    }
    if (parsedPrevious) {
      try {
        window.localStorage.removeItem(LIBRARY_UNREADABLE_KEY);
      } catch {
        /* ignore */
      }
    }
    return true;
  } catch {
    return false;
  }
}

export function loadInitialLibrary(locale?: string): LibraryState {
  const primary = safeStorageGet(LIBRARY_KEY_V2);
  rejectFutureLibrary(primary);
  if (!parsePersistedLibrary(primary)) rejectFutureLibrary(safeStorageGet(LIBRARY_BACKUP_KEY));
  const persisted = loadPersistedLibrary();
  if (persisted) return persisted;
  if (primary || safeStorageGet(LIBRARY_BACKUP_KEY)) throw new LibraryStorageError('corrupt');
  const sample = sampleArticleFor(locale);
  const id = 'doc-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  return {
    activeId: id,
    docs: [
      {
        id,
        title: sample.title,
        markdown: sample.markdown,
        settings: { ...DEFAULT_SETTINGS },
        view: 'split',
        updatedAt: Date.now(),
      },
    ],
  };
}

let fileHandleQueue: Promise<void> = Promise.resolve();

function enqueueFileHandleOp<T>(task: () => Promise<T>): Promise<T> {
  const run = fileHandleQueue.then(task, task);
  fileHandleQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function isFileHandleLike(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const h = value as Partial<FileSystemFileHandle>;
  return typeof h.getFile === 'function' || (h.kind === 'file' && typeof h.name === 'string');
}

function isDirHandleLike(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const d = value as Partial<FileSystemDirectoryHandle>;
  return typeof d.getFileHandle === 'function' || (d.kind === 'directory' && typeof d.name === 'string');
}

function isValidDocumentRef(ref: unknown): ref is DocumentRef {
  if (!ref || typeof ref !== 'object') return false;
  const candidate = ref as Partial<DocumentRef>;
  if (candidate.kind === 'library') return true;
  if (candidate.kind === 'file') return isFileHandleLike((candidate as { handle?: unknown }).handle);
  if (candidate.kind === 'folder') {
    const folder = candidate as { directory?: unknown; file?: unknown };
    return isDirHandleLike(folder.directory) && isFileHandleLike(folder.file);
  }
  return false;
}

export function storeDocumentRef(ref: DocumentRef): Promise<void> {
  return enqueueFileHandleOp(() => writeDocumentRef(ref));
}

async function writeDocumentRef(ref: DocumentRef): Promise<void> {
  try {
    const db = await openFileHandleDb();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('handles', 'readwrite');
        tx.objectStore('handles').put({ ref }, 'document-ref');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
      });
    } finally {
      db.close();
    }
  } catch {
    /* handles may not be cloneable or IDB unavailable */
  }
}

export function loadDocumentRef(): Promise<DocumentRef | null> {
  return enqueueFileHandleOp(async function () {
    try {
      const db = await openFileHandleDb();
      let value: unknown;
      try {
        value = await new Promise<unknown>((resolve, reject) => {
          const tx = db.transaction('handles', 'readonly');
          const request = tx.objectStore('handles').get('document-ref');
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
          tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
        });
      } finally {
        db.close();
      }
      const record = value && typeof value === 'object' ? (value as { ref?: unknown }) : null;
      return record && isValidDocumentRef(record.ref) ? record.ref : null;
    } catch {
      return null;
    }
  });
}

export function storeWorkspaceHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  return enqueueFileHandleOp(async function () {
    try {
      const db = await openFileHandleDb();
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction('handles', 'readwrite');
          tx.objectStore('handles').put({ handle }, 'workspace');
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
        });
      } finally {
        db.close();
      }
    } catch {
      /* IDB may be unavailable */
    }
  });
}

export function loadWorkspaceHandle(): Promise<FileSystemDirectoryHandle | null> {
  return enqueueFileHandleOp(async function () {
    try {
      const db = await openFileHandleDb();
      let value: unknown;
      try {
        value = await new Promise<unknown>((resolve, reject) => {
          const tx = db.transaction('handles', 'readonly');
          const request = tx.objectStore('handles').get('workspace');
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
          tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
        });
      } finally {
        db.close();
      }
      const record = value && typeof value === 'object' ? (value as { handle?: unknown }) : null;
      return record && isDirHandleLike(record.handle) ? (record.handle as FileSystemDirectoryHandle) : null;
    } catch {
      return null;
    }
  });
}

function openFileHandleDb(): Promise<IDBDatabase> {
  return new Promise(function (resolve, reject) {
    if (!window.indexedDB) {
      reject(new Error('indexedDB unavailable'));
      return;
    }
    let settled = false;
    const request = window.indexedDB.open('mdstudio-files', 1);
    request.onupgradeneeded = function () {
      if (!request.result.objectStoreNames.contains('handles')) request.result.createObjectStore('handles');
    };
    request.onsuccess = function () {
      if (settled) {
        request.result.close();
        return;
      }
      settled = true;
      resolve(request.result);
    };
    request.onerror = function () {
      if (settled) return;
      settled = true;
      reject(request.error);
    };
    request.onblocked = function () {
      if (settled) return;
      settled = true;
      reject(new Error('indexedDB blocked'));
    };
  });
}

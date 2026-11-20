import type { Article, LibraryState } from '../domain/article';
import { compactLibraryForStorage, parseView } from '../domain/article';
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

export class LibraryStorageError extends Error {
  constructor(readonly reason: 'unsupported' | 'corrupt') {
    super(reason);
  }
}

export function rawLibrarySnapshot(): string {
  return JSON.stringify(
    Object.fromEntries(
      [LIBRARY_KEY_V2, LIBRARY_BACKUP_KEY, LIBRARY_UNREADABLE_KEY, WRITING_SKILLS_KEY].map((key) => [
        key,
        window.localStorage.getItem(key),
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
  } catch (error) {
    return defaultWritingSkillState();
  }
}

export function saveWritingSkills(state: WritingSkillState, storage?: Pick<Storage, 'setItem'>): boolean {
  try {
    const store = storage || window.localStorage;
    store.setItem(WRITING_SKILLS_KEY, JSON.stringify(sanitizeWritingSkillState(state)));
    return true;
  } catch (error) {
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
  if (typeof record.id !== 'string' || typeof record.markdown !== 'string') return null;
  return {
    id: record.id,
    title: typeof record.title === 'string' && record.title ? record.title : SAMPLE_TITLE,
    markdown: record.markdown,
    settings: sanitizeSettings(record.settings),
    view: parseView(record.view),
    updatedAt: Number(record.updatedAt) || Date.now(),
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
    const trash: Article[] = [];
    if (Array.isArray(data.trash)) {
      for (const entry of data.trash) {
        const article = parseArticleRecord(entry);
        if (article)
          trash.push({ ...article, deletedAt: Number((entry as { deletedAt?: unknown }).deletedAt) || Date.now() });
      }
    }
    const activeId =
      typeof data.activeId === 'string' && docs.some((entry) => entry.id === data.activeId)
        ? data.activeId
        : docs[0].id;
    return { activeId, docs, trash };
  } catch (error) {
    return null;
  }
}

export function loadPersistedLibrary(): LibraryState | null {
  const primary = parsePersistedLibrary(window.localStorage.getItem(LIBRARY_KEY_V2));
  if (primary) return primary;
  return parsePersistedLibrary(window.localStorage.getItem(LIBRARY_BACKUP_KEY));
}

export function savePersistedLibrary(value: LibraryState): boolean {
  try {
    const previous = window.localStorage.getItem(LIBRARY_KEY_V2);
    rejectFutureLibrary(previous);
    const parsedPrevious = parsePersistedLibrary(previous);
    if (!parsedPrevious) rejectFutureLibrary(window.localStorage.getItem(LIBRARY_BACKUP_KEY));
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
    window.localStorage.setItem(
      LIBRARY_KEY_V2,
      JSON.stringify({ version: 2, schemaVersion: LIBRARY_SCHEMA_VERSION, ...compactLibraryForStorage(value) }),
    );
    return true;
  } catch (error) {
    return false;
  }
}

export function loadInitialLibrary(locale?: string): LibraryState {
  const primary = window.localStorage.getItem(LIBRARY_KEY_V2);
  rejectFutureLibrary(primary);
  if (!parsePersistedLibrary(primary)) rejectFutureLibrary(window.localStorage.getItem(LIBRARY_BACKUP_KEY));
  const persisted = loadPersistedLibrary();
  if (persisted) return persisted;
  if (primary || window.localStorage.getItem(LIBRARY_BACKUP_KEY)) throw new LibraryStorageError('corrupt');
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

let documentRefWrites: Promise<void> = Promise.resolve();

export function storeDocumentRef(ref: DocumentRef): Promise<void> {
  documentRefWrites = documentRefWrites.then(() => writeDocumentRef(ref));
  return documentRefWrites;
}

async function writeDocumentRef(ref: DocumentRef): Promise<void> {
  try {
    const db = await openFileHandleDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('handles', 'readwrite');
      tx.objectStore('handles').put({ ref }, 'document-ref');
      tx.oncomplete = () => {
        resolve();
        db.close();
      };
      tx.onerror = () => {
        reject(tx.error);
        db.close();
      };
      tx.onabort = () => {
        reject(tx.error || new Error('transaction aborted'));
        db.close();
      };
    });
  } catch (error) {
    /* handles may not be cloneable or IDB unavailable */
  }
}

export async function loadDocumentRef(): Promise<DocumentRef | null> {
  try {
    const db = await openFileHandleDb();
    const value = await new Promise<unknown>((resolve, reject) => {
      const tx = db.transaction('handles', 'readonly');
      const request = tx.objectStore('handles').get('document-ref');
      request.onsuccess = () => {
        resolve(request.result);
        db.close();
      };
      request.onerror = () => {
        reject(request.error);
        db.close();
      };
      tx.onabort = () => {
        reject(tx.error || new Error('transaction aborted'));
        db.close();
      };
    });
    const record = value && typeof value === 'object' ? (value as { ref?: DocumentRef }) : null;
    if (
      record &&
      record.ref &&
      (record.ref.kind === 'file' || record.ref.kind === 'folder' || record.ref.kind === 'library')
    )
      return record.ref;
    return null;
  } catch (error) {
    return null;
  }
}

export async function storeWorkspaceHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  try {
    const db = await openFileHandleDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('handles', 'readwrite');
      tx.objectStore('handles').put({ handle }, 'workspace');
      tx.oncomplete = () => {
        resolve();
        db.close();
      };
      tx.onerror = () => {
        reject(tx.error);
        db.close();
      };
      tx.onabort = () => {
        reject(tx.error || new Error('transaction aborted'));
        db.close();
      };
    });
  } catch (error) {
    /* IDB may be unavailable */
  }
}

export async function loadWorkspaceHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const db = await openFileHandleDb();
    const value = await new Promise<unknown>((resolve, reject) => {
      const tx = db.transaction('handles', 'readonly');
      const request = tx.objectStore('handles').get('workspace');
      request.onsuccess = () => {
        resolve(request.result);
        db.close();
      };
      request.onerror = () => {
        reject(request.error);
        db.close();
      };
      tx.onabort = () => {
        reject(tx.error || new Error('transaction aborted'));
        db.close();
      };
    });
    const record = value && typeof value === 'object' ? (value as { handle?: unknown }) : null;
    return record && record.handle && typeof record.handle === 'object'
      ? (record.handle as FileSystemDirectoryHandle)
      : null;
  } catch (error) {
    return null;
  }
}

function openFileHandleDb(): Promise<IDBDatabase> {
  return new Promise(function (resolve, reject) {
    if (!window.indexedDB) {
      reject(new Error('indexedDB unavailable'));
      return;
    }
    const request = window.indexedDB.open('mdstudio-files', 1);
    request.onupgradeneeded = function () {
      if (!request.result.objectStoreNames.contains('handles')) request.result.createObjectStore('handles');
    };
    request.onsuccess = function () {
      resolve(request.result);
    };
    request.onerror = function () {
      reject(request.error);
    };
  });
}

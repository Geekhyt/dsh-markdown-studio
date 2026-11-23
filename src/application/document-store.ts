import type { Article, LibraryState, ViewMode } from '../domain/article';
import { type CustomTheme, findCustomTheme, isCustomThemeId, mergeCustomThemes } from '../domain/custom-themes';
import type { ThemeSettings } from '../themes';
import { DEFAULT_SETTINGS } from '../themes';

/**
 * Custom themes are persisted inside `article.settings.customThemes` so single-article
 * theme exports remain self-contained, while `DocumentStore` synchronizes the list across
 * all library articles at runtime so saved custom themes behave as shared studio presets.
 */
function applySharedCustomThemes(article: Article, customThemes: CustomTheme[]): Article {
  const staleCustom = isCustomThemeId(article.settings.theme) && !findCustomTheme(customThemes, article.settings.theme);
  return {
    ...article,
    settings: {
      ...article.settings,
      customThemes,
      ...(staleCustom ? { theme: DEFAULT_SETTINGS.theme, accent: DEFAULT_SETTINGS.accent } : {}),
    },
  };
}

function unifyLibraryCustomThemes(state: LibraryState): LibraryState {
  let shared: CustomTheme[] = [];
  for (const doc of state.docs) {
    shared = mergeCustomThemes(shared, doc.settings.customThemes);
  }
  if (!shared.length) return state;
  return {
    ...state,
    docs: state.docs.map((doc) => applySharedCustomThemes(doc, shared)),
  };
}

function newArticleId(): string {
  return 'doc-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
}

/**
 * Article ids must be unique across `docs` and `trash`: duplicated ids (e.g. from merging a
 * backup that still contains a trashed article, or a hand-edited archive) would otherwise let
 * edits to one article silently overwrite another. The first occurrence keeps its id.
 */
export function ensureUniqueArticleIds(state: LibraryState): LibraryState {
  const seen = new Set<string>();
  let changed = false;
  const claim = (entry: Article): Article => {
    if (!seen.has(entry.id)) {
      seen.add(entry.id);
      return entry;
    }
    changed = true;
    let id = newArticleId();
    while (seen.has(id)) id = newArticleId();
    seen.add(id);
    return { ...entry, id };
  };
  const docs = state.docs.map(claim);
  const trash = (state.trash || []).map(claim);
  return changed ? { ...state, docs, trash } : state;
}

export interface MergeTombstones {
  deletedDocIds?: ReadonlySet<string>;
  purgedTrashIds?: ReadonlySet<string>;
  emptyTrash?: boolean;
  localCustomThemes?: CustomTheme[] | null;
}

function mergeDocLists(
  localDocs: readonly Article[],
  externalDocs: readonly Article[],
  dirtyIds: ReadonlySet<string>,
  deletedDocIds?: ReadonlySet<string>,
): Article[] {
  const localById = new Map<string, Article>();
  for (const doc of localDocs) localById.set(doc.id, doc);
  const seen = new Set<string>();
  const merged: Article[] = [];
  for (const ext of externalDocs) {
    seen.add(ext.id);
    if (deletedDocIds?.has(ext.id)) continue;
    const local = localById.get(ext.id);
    if (local && dirtyIds.has(ext.id)) {
      merged.push(local);
    } else {
      merged.push(ext);
    }
  }
  for (const local of localDocs) {
    if (!seen.has(local.id) && dirtyIds.has(local.id) && !deletedDocIds?.has(local.id)) merged.unshift(local);
  }
  return merged.length ? merged : [...localDocs];
}

function mergeTrashLists(
  externalTrash: readonly Article[],
  localTrash: readonly Article[],
  liveIds: ReadonlySet<string>,
  tombstones?: MergeTombstones,
): Article[] {
  if (tombstones?.emptyTrash) return [];
  const seen = new Set<string>();
  const merged: Article[] = [];
  const append = (item: Article): void => {
    if (liveIds.has(item.id) || seen.has(item.id) || tombstones?.purgedTrashIds?.has(item.id)) return;
    seen.add(item.id);
    merged.push(item);
  };
  for (const item of localTrash) {
    if (tombstones?.deletedDocIds?.has(item.id)) append(item);
  }
  for (const item of externalTrash) append(item);
  return merged;
}

function collectSharedCustomThemes(docs: readonly Article[]): CustomTheme[] {
  let shared: CustomTheme[] = [];
  for (const doc of docs) shared = mergeCustomThemes(shared, doc.settings.customThemes);
  return shared;
}

export function mergeExternalLibrary(
  local: LibraryState,
  external: LibraryState,
  dirtyIds: ReadonlySet<string>,
  tombstones?: MergeTombstones,
): LibraryState {
  const docs = mergeDocLists(local.docs, external.docs, dirtyIds, tombstones?.deletedDocIds);
  const liveIds = new Set(docs.map((entry) => entry.id));
  const activeId = liveIds.has(local.activeId)
    ? local.activeId
    : liveIds.has(external.activeId)
      ? external.activeId
      : docs[0].id;
  const trash = mergeTrashLists(external.trash || [], local.trash || [], liveIds, tombstones);
  const base = ensureUniqueArticleIds({ activeId, docs, trash });
  if (tombstones?.localCustomThemes != null) {
    return {
      ...base,
      docs: base.docs.map((doc) => applySharedCustomThemes(doc, tombstones.localCustomThemes!)),
    };
  }
  const externalShared = collectSharedCustomThemes(external.docs);
  const mergedShared = mergeCustomThemes(externalShared, collectSharedCustomThemes(base.docs));
  if (!mergedShared.length) return base;
  return {
    ...base,
    docs: base.docs.map((doc) => applySharedCustomThemes(doc, mergedShared)),
  };
}

export type ArticlePatch = Partial<Pick<Article, 'title' | 'markdown' | 'settings' | 'view'>>;

export interface NewArticleSeed {
  title: string;
  markdown?: string;
  settings: ThemeSettings;
  view: ViewMode;
}

export interface DocumentStoreOptions {
  now?: () => number;
  nextId?: () => string;
}

/**
 * The single writer for the article library and its active article. UI code
 * reads snapshots and submits patches; only this store persists them.
 */
export class DocumentStore {
  private state: LibraryState;
  private readonly persist: (state: LibraryState) => boolean;
  private readonly loadLatest?: () => LibraryState | null;
  private readonly now: () => number;
  private readonly nextId: () => string;
  private status: 'saved' | 'pending' | 'error' = 'saved';
  private dirty = false;
  private pendingReplace = false;
  private pendingEmptyTrash = false;
  private pendingCustomThemes = false;
  private readonly dirtyDocIds = new Set<string>();
  private readonly pendingDeletedIds = new Set<string>();
  private readonly pendingPurgedIds = new Set<string>();
  private readonly statusListeners = new Set<() => void>();
  private readonly listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    initial: LibraryState,
    persist: (state: LibraryState) => boolean,
    loadLatest?: () => LibraryState | null,
    options?: DocumentStoreOptions,
  ) {
    if (!initial.docs.length) throw new Error('DocumentStore needs at least one article');
    this.now = options?.now || Date.now;
    this.nextId = options?.nextId || newArticleId;
    this.state = unifyLibraryCustomThemes(ensureUniqueArticleIds(initial));
    this.persist = persist;
    this.loadLatest = loadLatest;
  }

  getSnapshot = (): LibraryState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getStatus = (): 'saved' | 'pending' | 'error' => this.status;

  subscribeStatus = (listener: () => void): (() => void) => {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  };

  getActive(): Article {
    return this.state.docs.find((entry) => entry.id === this.state.activeId) || this.state.docs[0];
  }

  updateActive(patch: ArticlePatch): Article {
    const active = this.getActive();
    const next: Article = {
      ...active,
      ...patch,
      settings: patch.settings ? { ...patch.settings } : active.settings,
      updatedAt: this.now(),
    };
    const syncCustom = patch.settings !== undefined && next.settings.customThemes !== active.settings.customThemes;
    const sharedCustom = next.settings.customThemes || [];
    const docs = this.state.docs.map((entry) => {
      if (entry.id === active.id) return next;
      return syncCustom ? applySharedCustomThemes(entry, sharedCustom) : entry;
    });
    this.dirtyDocIds.add(active.id);
    if (syncCustom) this.pendingCustomThemes = true;
    this.commit({ activeId: active.id, docs });
    return next;
  }

  switchTo(id: string): Article | null {
    const target = this.state.docs.find((entry) => entry.id === id);
    if (!target) return null;
    if (id !== this.state.activeId) this.commit({ activeId: id, docs: this.state.docs });
    return target;
  }

  create(seed: NewArticleSeed): Article {
    const id = this.nextId();
    const sharedCustom = seed.settings.customThemes || this.getActive().settings.customThemes || [];
    const entry: Article = {
      id,
      title: seed.title,
      markdown: seed.markdown || '',
      settings: { ...seed.settings, customThemes: sharedCustom },
      view: seed.view,
      updatedAt: this.now(),
    };
    this.dirtyDocIds.add(id);
    this.commit({ activeId: id, docs: [entry, ...this.state.docs] });
    return entry;
  }

  delete(id: string, fallbackTitle: string): Article {
    const target = this.state.docs.find((entry) => entry.id === id);
    if (!target) return this.getActive();
    this.pendingDeletedIds.add(id);
    this.dirtyDocIds.delete(id);
    const trash = [{ ...target, deletedAt: this.now() }, ...(this.state.trash || [])];
    const remaining = this.state.docs.filter((entry) => entry.id !== id);
    if (!remaining.length) {
      const newId = this.nextId();
      const blank: Article = {
        id: newId,
        title: fallbackTitle,
        markdown: '',
        settings: { ...DEFAULT_SETTINGS, customThemes: target.settings.customThemes || [] },
        view: 'split',
        updatedAt: this.now(),
      };
      this.dirtyDocIds.add(newId);
      this.commit({ activeId: newId, docs: [blank], trash });
      return blank;
    }
    const activeId = this.state.activeId === id ? remaining[0].id : this.state.activeId;
    this.commit({ activeId, docs: remaining, trash });
    return this.getActive();
  }

  getTrash(): Article[] {
    return this.state.trash || [];
  }

  restore(id: string): Article | null {
    const item = (this.state.trash || []).find((entry) => entry.id === id);
    if (!item) return null;
    this.pendingDeletedIds.delete(id);
    this.pendingPurgedIds.add(id);
    const { deletedAt: _deletedAt, ...trashed } = item;
    const idTaken = this.state.docs.some((doc) => doc.id === trashed.id);
    const restoredRaw: Article = idTaken ? { ...trashed, id: this.nextId() } : trashed;
    const sharedCustom = mergeCustomThemes(this.getActive().settings.customThemes, restoredRaw.settings.customThemes);
    const restored = applySharedCustomThemes(restoredRaw, sharedCustom);
    this.dirtyDocIds.add(restored.id);
    const trash = (this.state.trash || []).filter((entry) => entry !== item);
    const docs = [restored, ...this.state.docs.map((doc) => applySharedCustomThemes(doc, sharedCustom))];
    this.commit({ activeId: this.state.activeId, docs, trash });
    return restored;
  }

  purge(id: string): void {
    this.pendingPurgedIds.add(id);
    const trash = (this.state.trash || []).filter((entry) => entry.id !== id);
    this.commit({ activeId: this.state.activeId, docs: this.state.docs, trash });
  }

  emptyTrash(): void {
    this.pendingEmptyTrash = true;
    this.commit({ activeId: this.state.activeId, docs: this.state.docs, trash: [] });
  }

  private clearPendingChanges(): void {
    this.dirty = false;
    this.pendingReplace = false;
    this.pendingEmptyTrash = false;
    this.pendingCustomThemes = false;
    this.dirtyDocIds.clear();
    this.pendingDeletedIds.clear();
    this.pendingPurgedIds.clear();
  }

  private hasPendingMutations(): boolean {
    return (
      this.dirtyDocIds.size > 0 ||
      this.pendingDeletedIds.size > 0 ||
      this.pendingPurgedIds.size > 0 ||
      this.pendingEmptyTrash ||
      this.pendingCustomThemes ||
      this.pendingReplace
    );
  }

  private buildTombstones(): MergeTombstones {
    return {
      deletedDocIds: this.pendingDeletedIds,
      purgedTrashIds: this.pendingPurgedIds,
      emptyTrash: this.pendingEmptyTrash,
      localCustomThemes: this.pendingCustomThemes ? this.getActive().settings.customThemes || [] : null,
    };
  }

  isDocDirty(id: string): boolean {
    return this.dirtyDocIds.has(id);
  }

  replaceAll(next: LibraryState, persistFirst = false): Article {
    if (!next.docs.length) throw new Error('DocumentStore needs at least one article');
    const activeId = next.docs.some(function (entry) {
      return entry.id === next.activeId;
    })
      ? next.activeId
      : next.docs[0].id;
    const state = unifyLibraryCustomThemes(
      ensureUniqueArticleIds({ activeId, docs: next.docs, trash: next.trash || [] }),
    );
    if (persistFirst) {
      if (!this.persist(state)) throw new Error('LIBRARY_SAVE_FAILED');
      if (this.timer !== null) clearTimeout(this.timer);
      this.timer = null;
      this.state = state;
      this.clearPendingChanges();
      this.setStatus('saved');
      this.listeners.forEach((listener) => {
        listener();
      });
    } else {
      this.clearPendingChanges();
      this.pendingReplace = true;
      this.commit(state);
    }
    return this.getActive();
  }

  /** Merge a newer library snapshot persisted by another browser tab while preserving unsaved local dirty articles. */
  syncExternal(next: LibraryState): void {
    if (!next.docs.length || this.pendingReplace) return;
    this.state = mergeExternalLibrary(this.state, next, this.dirtyDocIds, this.buildTombstones());
    if (!this.hasPendingMutations()) {
      if (this.timer !== null) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      this.dirty = false;
      this.setStatus('saved');
    }
    this.listeners.forEach((listener) => {
      listener();
    });
  }

  flush(): boolean {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.dirty && this.status === 'saved') return true;
    return this.write();
  }

  private write(): boolean {
    let mergedFromDisk = false;
    if (this.loadLatest && !this.pendingReplace) {
      const disk = this.loadLatest();
      if (disk && disk.docs.length > 0) {
        this.state = mergeExternalLibrary(this.state, disk, this.dirtyDocIds, this.buildTombstones());
        mergedFromDisk = true;
      }
    }
    const ok = this.persist(this.state);
    if (ok) {
      this.clearPendingChanges();
    }
    this.setStatus(ok ? 'saved' : 'error');
    if (mergedFromDisk) {
      this.listeners.forEach((listener) => {
        listener();
      });
    }
    return ok;
  }

  private setStatus(status: 'saved' | 'pending' | 'error'): void {
    if (this.status === status) return;
    this.status = status;
    this.statusListeners.forEach((listener) => {
      listener();
    });
  }

  private commit(next: LibraryState): void {
    this.dirty = true;
    this.state = {
      activeId: next.activeId,
      docs: next.docs,
      trash: next.trash === undefined ? this.state.trash : next.trash,
    };
    this.setStatus('pending');
    this.listeners.forEach((listener) => {
      listener();
    });
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.write();
    }, 250);
  }
}

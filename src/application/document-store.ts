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

export type DocIntent = 'live' | 'trashed' | 'purged';

export interface MergeIntents {
  docIntents: ReadonlyMap<string, DocIntent>;
  localCustomThemes?: CustomTheme[] | null;
}

function readRev(doc?: { rev?: number }): number {
  const value = doc?.rev;
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : 0;
}

function bumpRev(doc?: { rev?: number }): number {
  return readRev(doc) + 1;
}

function sameCustomTheme(a: CustomTheme, b: CustomTheme): boolean {
  return a.id === b.id && a.name === b.name && a.css === b.css;
}

function sameCustomThemes(a?: readonly CustomTheme[], b?: readonly CustomTheme[]): boolean {
  const left = a || [];
  const right = b || [];
  if (left === right) return true;
  if (left.length !== right.length) return false;
  return left.every((item, index) => sameCustomTheme(item, right[index]));
}

function buildRestoredArticle(
  item: Article,
  docs: readonly Article[],
  activeCustom: CustomTheme[],
  nextId: () => string,
): { restored: Article; sharedCustom: CustomTheme[]; customChanged: boolean } {
  const { deletedAt: _deletedAt, ...trashed } = item;
  const id = docs.some((doc) => doc.id === trashed.id) ? nextId() : trashed.id;
  // Live custom themes take precedence over stale trashed snapshots while still reviving deleted themes.
  const sharedCustom = mergeCustomThemes(trashed.settings.customThemes, activeCustom);
  return {
    restored: applySharedCustomThemes({ ...trashed, id, rev: bumpRev(trashed) }, sharedCustom),
    sharedCustom,
    customChanged: !sameCustomThemes(activeCustom, sharedCustom),
  };
}

function mergeDocLists(
  localDocs: readonly Article[],
  externalDocs: readonly Article[],
  intents: ReadonlyMap<string, DocIntent>,
): Article[] {
  const localById = new Map<string, Article>();
  for (const doc of localDocs) localById.set(doc.id, doc);
  const seen = new Set<string>();
  const merged: Article[] = [];
  for (const ext of externalDocs) {
    seen.add(ext.id);
    const intent = intents.get(ext.id);
    if (intent === 'trashed' || intent === 'purged') continue;
    const local = localById.get(ext.id);
    if (local && intent === 'live') {
      const localRev = readRev(local);
      const extRev = readRev(ext);
      merged.push(extRev >= localRev && extRev > 0 ? { ...local, rev: extRev + 1 } : local);
    } else {
      merged.push(ext);
    }
  }
  for (const local of localDocs) {
    if (!seen.has(local.id) && intents.get(local.id) === 'live') {
      merged.unshift(local);
    }
  }
  return merged.length ? merged : [...localDocs];
}

function mergeTrashLists(
  externalTrash: readonly Article[],
  localTrash: readonly Article[],
  liveIds: ReadonlySet<string>,
  intents: ReadonlyMap<string, DocIntent>,
): Article[] {
  const seen = new Set<string>();
  const merged: Article[] = [];
  const append = (item: Article): void => {
    if (liveIds.has(item.id) || seen.has(item.id) || intents.get(item.id) === 'purged') return;
    seen.add(item.id);
    merged.push(item);
  };
  for (const item of localTrash) {
    if (intents.get(item.id) === 'trashed') append(item);
  }
  for (const item of externalTrash) append(item);
  return merged;
}

function collectSharedCustomThemes(docs: readonly Article[]): CustomTheme[] {
  let shared: CustomTheme[] = [];
  for (const doc of docs) shared = mergeCustomThemes(shared, doc.settings.customThemes);
  return shared;
}

export function mergeExternalLibrary(local: LibraryState, external: LibraryState, merge: MergeIntents): LibraryState {
  const docs = mergeDocLists(local.docs, external.docs, merge.docIntents);
  const liveIds = new Set(docs.map((entry) => entry.id));
  const activeId = liveIds.has(local.activeId)
    ? local.activeId
    : liveIds.has(external.activeId)
      ? external.activeId
      : docs[0].id;
  const trash = mergeTrashLists(external.trash || [], local.trash || [], liveIds, merge.docIntents);
  const base = ensureUniqueArticleIds({ activeId, docs, trash });
  const sharedThemes =
    merge.localCustomThemes != null ? merge.localCustomThemes : collectSharedCustomThemes(external.docs);
  return {
    ...base,
    docs: base.docs.map((doc) => applySharedCustomThemes(doc, sharedThemes)),
  };
}

export type ArticlePatch = Partial<Pick<Article, 'title' | 'markdown' | 'settings' | 'view'>>;

export interface NewArticleSeed {
  title: string;
  markdown?: string;
  settings: ThemeSettings;
  view: ViewMode;
}

export type ExternalMergeListener = (prevActive: Article, nextActive: Article, activeWasDirty: boolean) => void;

export interface DocumentStoreOptions {
  now?: () => number;
  nextId?: () => string;
  onExternalMerge?: ExternalMergeListener;
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
  private pendingActiveSwitch = false;
  private pendingCustomThemes = false;
  /** Single authoritative per-article local intent: an id can never be both live and purged. */
  private readonly pendingIntents = new Map<string, DocIntent>();
  private readonly statusListeners = new Set<() => void>();
  private readonly listeners = new Set<() => void>();
  private readonly externalMergeListeners = new Set<ExternalMergeListener>();
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
    if (options?.onExternalMerge) this.externalMergeListeners.add(options.onExternalMerge);
    this.state = unifyLibraryCustomThemes(ensureUniqueArticleIds(initial));
    this.persist = persist;
    this.loadLatest = loadLatest;
  }

  subscribeExternalMerge = (listener: ExternalMergeListener): (() => void) => {
    this.externalMergeListeners.add(listener);
    return () => {
      this.externalMergeListeners.delete(listener);
    };
  };

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
      rev: bumpRev(active),
    };
    const syncCustom =
      patch.settings !== undefined && !sameCustomThemes(active.settings.customThemes, next.settings.customThemes);
    const sharedCustom = next.settings.customThemes || [];
    const docs = this.state.docs.map((entry) => {
      if (entry.id === active.id) return next;
      return syncCustom ? applySharedCustomThemes(entry, sharedCustom) : entry;
    });
    this.pendingIntents.set(active.id, 'live');
    if (syncCustom) this.pendingCustomThemes = true;
    this.commit({ activeId: active.id, docs });
    return next;
  }

  switchTo(id: string): Article | null {
    const target = this.state.docs.find((entry) => entry.id === id);
    if (!target) return null;
    if (id !== this.state.activeId) {
      this.pendingActiveSwitch = true;
      this.commit({ activeId: id, docs: this.state.docs });
    }
    return target;
  }

  create(seed: NewArticleSeed): Article {
    const id = this.nextId();
    const activeCustom = this.getActive().settings.customThemes || [];
    const sharedCustom = seed.settings.customThemes || activeCustom;
    if (seed.settings.customThemes && !sameCustomThemes(activeCustom, seed.settings.customThemes)) {
      this.pendingCustomThemes = true;
    }
    const entry: Article = {
      id,
      title: seed.title,
      markdown: seed.markdown || '',
      settings: { ...seed.settings, customThemes: sharedCustom },
      view: seed.view,
      updatedAt: this.now(),
      rev: 1,
    };
    this.pendingIntents.set(id, 'live');
    this.commit({ activeId: id, docs: [entry, ...this.state.docs] });
    return entry;
  }

  delete(id: string, fallbackTitle: string): Article {
    const target = this.state.docs.find((entry) => entry.id === id);
    if (!target) return this.getActive();
    this.pendingIntents.set(id, 'trashed');
    const trash = [{ ...target, rev: bumpRev(target), deletedAt: this.now() }, ...(this.state.trash || [])];
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
        rev: 1,
      };
      this.pendingIntents.set(newId, 'live');
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
    const currentTrash = this.state.trash || [];
    const item = currentTrash.find((entry) => entry.id === id);
    if (!item) return null;
    const { restored, sharedCustom, customChanged } = buildRestoredArticle(
      item,
      this.state.docs,
      this.getActive().settings.customThemes || [],
      this.nextId,
    );
    if (customChanged) this.pendingCustomThemes = true;
    this.pendingIntents.set(restored.id, 'live');
    const trash = currentTrash.filter((entry) => entry !== item);
    const docs = [restored, ...this.state.docs.map((doc) => applySharedCustomThemes(doc, sharedCustom))];
    this.commit({ activeId: this.state.activeId, docs, trash });
    return restored;
  }

  purge(id: string): void {
    this.pendingIntents.set(id, 'purged');
    const trash = (this.state.trash || []).filter((entry) => entry.id !== id);
    this.commit({ activeId: this.state.activeId, docs: this.state.docs, trash });
  }

  emptyTrash(): void {
    for (const item of this.state.trash || []) {
      this.pendingIntents.set(item.id, 'purged');
    }
    this.commit({ activeId: this.state.activeId, docs: this.state.docs, trash: [] });
  }

  private clearPendingChanges(): void {
    this.dirty = false;
    this.pendingReplace = false;
    this.pendingActiveSwitch = false;
    this.pendingCustomThemes = false;
    this.pendingIntents.clear();
  }

  private hasPendingMutations(): boolean {
    return this.pendingIntents.size > 0 || this.pendingActiveSwitch || this.pendingCustomThemes || this.pendingReplace;
  }

  private buildMergeIntents(): MergeIntents {
    return {
      docIntents: this.pendingIntents,
      localCustomThemes: this.pendingCustomThemes ? this.getActive().settings.customThemes || [] : null,
    };
  }

  isDocDirty(id: string): boolean {
    return this.pendingIntents.get(id) === 'live';
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

  private notifyExternalMerge(prevActive: Article, nextActive: Article, activeWasDirty: boolean): void {
    if (prevActive.id === nextActive.id && prevActive.markdown === nextActive.markdown) return;
    this.externalMergeListeners.forEach((listener) => {
      listener(prevActive, nextActive, activeWasDirty);
    });
  }

  /** Merge a newer library snapshot persisted by another browser tab while preserving unsaved local dirty articles. */
  syncExternal(next: LibraryState): void {
    if (!next.docs.length || this.pendingReplace) return;
    const prevActive = this.getActive();
    const activeWasDirty = this.isDocDirty(prevActive.id);
    this.state = mergeExternalLibrary(this.state, next, this.buildMergeIntents());
    const nextActive = this.getActive();
    if (this.pendingActiveSwitch && (nextActive.id === next.activeId || nextActive.id !== prevActive.id)) {
      this.pendingActiveSwitch = false;
    }
    if (!this.hasPendingMutations()) {
      if (this.timer !== null) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      this.dirty = false;
      this.setStatus('saved');
    }
    this.notifyExternalMerge(prevActive, nextActive, activeWasDirty);
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
    let prevActive: Article | null = null;
    let activeWasDirty = false;
    if (this.loadLatest && !this.pendingReplace) {
      const disk = this.loadLatest();
      if (disk && disk.docs.length > 0) {
        prevActive = this.getActive();
        activeWasDirty = this.isDocDirty(prevActive.id);
        this.state = mergeExternalLibrary(this.state, disk, this.buildMergeIntents());
        mergedFromDisk = true;
      }
    }
    const ok = this.persist(this.state);
    if (ok) {
      this.clearPendingChanges();
    }
    this.setStatus(ok ? 'saved' : 'error');
    if (mergedFromDisk) {
      if (prevActive) this.notifyExternalMerge(prevActive, this.getActive(), activeWasDirty);
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

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

export type ArticlePatch = Partial<Pick<Article, 'title' | 'markdown' | 'settings' | 'view'>>;

export interface NewArticleSeed {
  title: string;
  markdown?: string;
  settings: ThemeSettings;
  view: ViewMode;
}

/**
 * The single writer for the article library and its active article. UI code
 * reads snapshots and submits patches; only this store persists them.
 */
export class DocumentStore {
  private state: LibraryState;
  private readonly persist: (state: LibraryState) => boolean;
  private status: 'saved' | 'pending' | 'error' = 'saved';
  private readonly statusListeners = new Set<() => void>();
  private readonly listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(initial: LibraryState, persist: (state: LibraryState) => boolean) {
    if (!initial.docs.length) throw new Error('DocumentStore needs at least one article');
    this.state = unifyLibraryCustomThemes(ensureUniqueArticleIds(initial));
    this.persist = persist;
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
      updatedAt: Date.now(),
    };
    const syncCustom = patch.settings !== undefined && next.settings.customThemes !== active.settings.customThemes;
    const sharedCustom = next.settings.customThemes || [];
    const docs = this.state.docs.map((entry) => {
      if (entry.id === active.id) return next;
      return syncCustom ? applySharedCustomThemes(entry, sharedCustom) : entry;
    });
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
    const id = newArticleId();
    const sharedCustom = seed.settings.customThemes || this.getActive().settings.customThemes || [];
    const entry: Article = {
      id,
      title: seed.title,
      markdown: seed.markdown || '',
      settings: { ...seed.settings, customThemes: sharedCustom },
      view: seed.view,
      updatedAt: Date.now(),
    };
    this.commit({ activeId: id, docs: [entry, ...this.state.docs] });
    return entry;
  }

  delete(id: string, fallbackTitle: string): Article {
    const target = this.state.docs.find((entry) => entry.id === id);
    if (!target) return this.getActive();
    const trash = [{ ...target, deletedAt: Date.now() }, ...(this.state.trash || [])];
    const remaining = this.state.docs.filter((entry) => entry.id !== id);
    if (!remaining.length) {
      const newId = newArticleId();
      const blank: Article = {
        id: newId,
        title: fallbackTitle,
        markdown: '',
        settings: { ...DEFAULT_SETTINGS, customThemes: target.settings.customThemes || [] },
        view: 'split',
        updatedAt: Date.now(),
      };
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
    const { deletedAt: _deletedAt, ...trashed } = item;
    const idTaken = this.state.docs.some((doc) => doc.id === trashed.id);
    const restoredRaw: Article = idTaken ? { ...trashed, id: newArticleId() } : trashed;
    const sharedCustom = mergeCustomThemes(this.getActive().settings.customThemes, restoredRaw.settings.customThemes);
    const restored = applySharedCustomThemes(restoredRaw, sharedCustom);
    const trash = (this.state.trash || []).filter((entry) => entry !== item);
    const docs = [restored, ...this.state.docs.map((doc) => applySharedCustomThemes(doc, sharedCustom))];
    this.commit({ activeId: this.state.activeId, docs, trash });
    return restored;
  }

  purge(id: string): void {
    const trash = (this.state.trash || []).filter((entry) => entry.id !== id);
    this.commit({ activeId: this.state.activeId, docs: this.state.docs, trash });
  }

  emptyTrash(): void {
    this.commit({ activeId: this.state.activeId, docs: this.state.docs, trash: [] });
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
      this.setStatus('saved');
      this.listeners.forEach((listener) => {
        listener();
      });
    } else this.commit(state);
    return this.getActive();
  }

  flush(): boolean {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    return this.write();
  }

  private write(): boolean {
    const ok = this.persist(this.state);
    this.setStatus(ok ? 'saved' : 'error');
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

import type * as ReactNamespace from 'react';
import type { Article, ViewMode } from '../domain/article';
import type { ConfirmDialogFn } from '../domain/dialog';
import { assetFilesInMarkdown } from '../domain/images';
import type { ThemeSettings } from '../themes';
import type { DocumentStore } from './document-store';

type Notify = (text: string, tone?: 'success' | 'error' | 'info') => void;

export interface TrashCommandsOptions {
  store: DocumentStore;
  notify: Notify;
  t: (key: string) => string;
  confirm: ConfirmDialogFn;
  onPruneAssets?: (bypassGraceFor?: Iterable<string>) => void;
}

export interface TrashCommandsApi {
  restoreArticle: (id: string) => void;
  purgeArticle: (id: string) => Promise<void>;
  emptyTrash: () => Promise<void>;
}

export function createTrashCommands(options: TrashCommandsOptions): TrashCommandsApi {
  function restoreArticle(id: string): void {
    const restored = options.store.restore(id);
    if (restored) options.notify(options.t('library.restored'));
  }

  async function purgeArticle(id: string): Promise<void> {
    const ok = await options.confirm({ title: options.t('library.purgeConfirm'), danger: true });
    if (!ok) return;
    const target = (options.store.getSnapshot().trash || []).find((entry) => entry.id === id);
    const purgedAssets = target ? assetFilesInMarkdown(target.markdown) : [];
    options.store.purge(id);
    options.store.flush();
    options.onPruneAssets?.(purgedAssets);
    options.notify(options.t('library.purged'));
  }

  async function emptyTrash(): Promise<void> {
    const ok = await options.confirm({ title: options.t('library.emptyTrashConfirm'), danger: true });
    if (!ok) return;
    const purgedAssets = new Set<string>();
    for (const entry of options.store.getSnapshot().trash || []) {
      for (const file of assetFilesInMarkdown(entry.markdown)) purgedAssets.add(file);
    }
    options.store.emptyTrash();
    options.store.flush();
    options.onPruneAssets?.(purgedAssets);
    options.notify(options.t('library.trashEmptied'));
  }

  return { restoreArticle, purgeArticle, emptyTrash };
}

export interface DocumentLibraryOptions {
  React: typeof ReactNamespace;
  store: DocumentStore;
  t: (key: string) => string;
  notify: Notify;
  confirm: ConfirmDialogFn;
  settings: ThemeSettings;
  view: ViewMode;
  onActivate: (entry: Article) => void;
  onPruneAssets?: (bypassGraceFor?: Iterable<string>) => void;
}

export interface DocumentLibraryApi extends TrashCommandsApi {
  open: boolean;
  openSeq: number;
  openLibrary: () => void;
  closeLibrary: () => void;
  switchDocument: (id: string) => void;
  newDocument: () => void;
  deleteDocument: (id: string) => Promise<void>;
}

export function useDocumentLibrary(options: DocumentLibraryOptions): DocumentLibraryApi {
  const React = options.React;
  const [open, setOpen] = React.useState(false);
  const [openSeq, setOpenSeq] = React.useState(0);
  const trashCommands = createTrashCommands({
    store: options.store,
    notify: options.notify,
    t: options.t,
    confirm: options.confirm,
    onPruneAssets: options.onPruneAssets,
  });

  function openLibrary(): void {
    setOpenSeq((prev) => prev + 1);
    setOpen(true);
  }

  function closeLibrary(): void {
    setOpen(false);
  }

  function switchDocument(id: string): void {
    const target = options.store.switchTo(id);
    if (!target) return;
    options.onActivate(target);
    options.onPruneAssets?.();
    setOpen(false);
  }

  function newDocument(): void {
    const entry = options.store.create({
      title: options.t('untitled'),
      markdown: '',
      settings: options.settings,
      view: 'split',
    });
    options.onActivate(entry);
    options.onPruneAssets?.();
    setOpen(false);
  }

  async function deleteDocument(id: string): Promise<void> {
    const ok = await options.confirm({ title: options.t('library.deleteConfirm'), danger: true });
    if (!ok) return;
    const previousActive = options.store.getActive().id;
    const next = options.store.delete(id, options.t('untitled'));
    if (previousActive === id) {
      options.onActivate(next);
    }
  }

  return {
    open,
    openSeq,
    openLibrary,
    closeLibrary,
    switchDocument,
    newDocument,
    deleteDocument,
    ...trashCommands,
  };
}

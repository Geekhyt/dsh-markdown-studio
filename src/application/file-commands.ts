import type * as ReactNamespace from 'react';
import type { Article, DocumentSeed } from '../domain/article';
import { slugify } from '../domain/article';
import type { ConfirmDialogFn } from '../domain/dialog';
import type { DocumentRef } from '../domain/document-ref';
import type { ThemeSettings } from '../themes';
import type { DocumentStore } from './document-store';
import { writeFolderAssets } from './folder-assets';
import type { FileContextApi } from './use-file-context';

type Notify = (text: string, tone?: 'success' | 'error' | 'info') => void;

export interface FileActionsOptions {
  t: (key: string) => string;
  notify: Notify;
  confirm: ConfirmDialogFn;
  fileContext: FileContextApi;
  store: DocumentStore;
  doc: Article;
  settings: ThemeSettings;
  view: 'split' | 'edit' | 'preview';
  markdownRef: ReactNamespace.RefObject<string | null>;
  fileName: string;
  localImageServerUrl: string;
  setMenuOpen: (open: boolean) => void;
  setFileName: (name: string) => void;
  resetEditorTo: (entry: DocumentSeed) => void;
  setDocumentRef: (ref: DocumentRef) => void;
  stampFile: (handle: FileSystemFileHandle, file: File) => Promise<void>;
  download: (name: string, content: Blob | string, mime: string) => boolean;
  isAbortError: (error: unknown) => boolean;
  errorMessage: (error: unknown) => string;
  deriveTitle: (markdown: string) => string;
}

export interface FileActionsApi {
  openLocalFile: () => Promise<void>;
  saveLocalFile: (forceDialog?: boolean) => Promise<void>;
  reloadLinkedFile: () => Promise<void>;
}

export function createFileCommands(options: FileActionsOptions): FileActionsApi {
  const t = options.t;
  const doc = options.doc;

  async function openLocalFile(): Promise<void> {
    if (!window.showOpenFilePicker) {
      options.notify(t('file.unsupported'), 'error');
      return;
    }
    try {
      const handles = await window.showOpenFilePicker({
        multiple: false,
        types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md', '.markdown', '.txt'] } }],
      });
      const handle = handles[0];
      const file = await handle.getFile();
      const text = await file.text();
      options.resetEditorTo({
        title: options.deriveTitle(text),
        markdown: text,
        settings: options.settings,
        view: options.view,
      });
      await options.stampFile(handle, file);
      options.setDocumentRef({ kind: 'file', handle });
      options.setFileName(file.name);
      options.notify(t('file.opened'));
      options.setMenuOpen(false);
    } catch (error) {
      if (!options.isAbortError(error)) {
        options.notify(t('file.openFailed') + ' · ' + options.errorMessage(error), 'error');
      }
    }
  }

  async function chooseSaveHandle(
    forceDialog: boolean | undefined,
    title: string,
    content: string,
  ): Promise<FileSystemFileHandle | null> {
    const linked = options.fileContext.linkedFile();
    if (linked && !forceDialog) return linked;
    if (!window.showSaveFilePicker) {
      if (options.download(slugify(title) + '.md', content, 'text/markdown;charset=utf-8'))
        options.notify(t('toast.exported'));
      return null;
    }
    return window.showSaveFilePicker({
      suggestedName: slugify(title) + '.md',
      types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md'] } }],
    });
  }

  async function writeWithConflict(
    handle: FileSystemFileHandle,
    content: string,
    articleId: string,
    linked: FileSystemFileHandle | null,
  ): Promise<{ result: 'saved' | 'conflict' | 'denied' | 'stale'; writtenContent: string }> {
    const result = await options.fileContext.writeFile(handle, content, false, true);
    if (result !== 'conflict') return { result, writtenContent: content };
    const confirmed = await options.confirm({
      title: t('file.overwriteConfirm'),
      description: t('file.overwriteDescription'),
      confirmLabel: t('file.overwrite'),
      danger: true,
    });
    if (!confirmed || options.store.getActive().id !== articleId || options.fileContext.linkedFile() !== linked)
      return { result: 'stale', writtenContent: content };
    const freshContent = String(options.markdownRef.current || '');
    const overwritten = await options.fileContext.writeFile(handle, freshContent, true, true);
    return { result: overwritten, writtenContent: freshContent };
  }

  async function saveLocalFile(forceDialog?: boolean): Promise<void> {
    const articleId = options.store.getActive().id;
    const linkedBefore = options.fileContext.linkedFile();
    const content = String(options.markdownRef.current || '');
    const title = doc.title || t('untitled');
    try {
      const handle = await chooseSaveHandle(forceDialog, title, content);
      if (!handle || options.store.getActive().id !== articleId) return;
      const { result, writtenContent } = await writeWithConflict(handle, content, articleId, linkedBefore);
      if (result === 'denied') options.notify(t('file.permission'), 'error');
      if (result !== 'saved' || options.store.getActive().id !== articleId) return;
      if (options.fileContext.linkedFile() !== handle) {
        options.setDocumentRef({ kind: 'file', handle });
      }
      options.setFileName(handle.name || options.fileName);
      const folder = options.fileContext.linkedFolder();
      if (folder) {
        try {
          await writeFolderAssets(folder, writtenContent, options.localImageServerUrl);
        } catch (error) {
          /* best effort */
        }
      }
      options.notify(t('file.saved'));
    } catch (error) {
      if (!options.isAbortError(error)) {
        options.notify(t('file.saveFailed') + ' · ' + options.errorMessage(error), 'error');
      }
    }
    options.setMenuOpen(false);
  }

  async function reloadLinkedFile(): Promise<void> {
    await options.fileContext.reload();
  }

  return { openLocalFile, saveLocalFile, reloadLinkedFile };
}

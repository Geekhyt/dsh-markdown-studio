import type * as ReactNamespace from 'react';
import type { HostClient } from '../adapters/host-client';
import { unzipEntries } from '../adapters/zip';
import type { Article, SelectionRange } from '../domain/article';
import { bytesToBase64 } from '../domain/base64';
import type { ConfirmDialogFn } from '../domain/dialog';
import { sampleArticleFor } from '../themes';

type Notify = (text: string, tone?: 'success' | 'error' | 'info') => void;

export interface DocumentActionsOptions {
  React: typeof ReactNamespace;
  t: (key: string) => string;
  locale?: () => 'zh' | 'en';
  notify: Notify;
  confirm: ConfirmDialogFn;
  doc: Article;
  hostClient: HostClient;
  fileRef: ReactNamespace.RefObject<HTMLInputElement | null>;
  setMenuOpen: (open: boolean) => void;
  detachFileContext: () => void;
  setMarkdown: (
    value: string,
    options: { boundary?: boolean; title?: string; prevSelection?: SelectionRange; resetHistory?: boolean },
  ) => void;
  focusRange: (start: number, end: number) => void;
  deriveTitle: (markdown: string) => string;
  errorMessage: (error: unknown) => string;
  onPruneAssets?: () => void;
}

export interface DocumentActionsApi {
  blankArticle: () => void;
  loadSample: (force?: boolean) => Promise<void>;
  clearArticle: () => Promise<void>;
  handleImportClick: () => void;
  importBundle: (file: File) => Promise<void>;
  handleFile: (event: ReactNamespace.ChangeEvent<HTMLInputElement>) => void;
}

function isZipCandidate(file: File, bytes: Uint8Array): boolean {
  if (bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b) return true;
  return /\.zip$/i.test(file.name || '') || /zip/i.test(file.type || '');
}

async function readFileBytes(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer();
  return new TextEncoder().encode(await file.text()).buffer;
}

export function createDocumentCommands(options: DocumentActionsOptions): DocumentActionsApi {
  const t = options.t;

  function blankArticle(): void {
    options.detachFileContext();
    options.setMarkdown('', { boundary: true, title: t('untitled'), resetHistory: true });
    options.focusRange(0, 0);
  }

  async function loadSample(force?: boolean): Promise<void> {
    if (!force && options.doc.markdown.trim()) {
      const ok = await options.confirm({ title: t('confirm.sample') });
      if (!ok) return;
    }
    const sample = sampleArticleFor(options.locale?.());
    options.detachFileContext();
    options.setMarkdown(sample.markdown, { boundary: true, title: sample.title, resetHistory: true });
    options.focusRange(0, 0);
    options.onPruneAssets?.();
    options.notify(t('toast.sampleLoaded'));
  }

  async function clearArticle(): Promise<void> {
    if (options.doc.markdown.trim()) {
      const ok = await options.confirm({ title: t('confirm.clear'), danger: true });
      if (!ok) return;
    }
    blankArticle();
    options.onPruneAssets?.();
    options.notify(t('toast.cleared'));
  }

  function handleImportClick(): void {
    if (options.fileRef.current) options.fileRef.current.click();
    options.setMenuOpen(false);
  }

  async function importBundleBuffer(buffer: ArrayBuffer): Promise<void> {
    try {
      const entries = await unzipEntries(buffer);
      const markdownEntry =
        entries.find(function (entry) {
          return /^article\.md$/i.test(entry.name);
        }) ||
        entries.find(function (entry) {
          return /\.(md|markdown)$/i.test(entry.name);
        });
      if (!markdownEntry) throw new Error('missing Markdown entry');
      const text = new TextDecoder().decode(markdownEntry.data);
      const mapping = new Map<string, string>();
      let failed = 0;
      for (const entry of entries) {
        const match = /^assets\/([a-f0-9]{24}\.(png|jpg))$/i.exec(entry.name);
        if (!match) continue;
        try {
          const mime = match[2].toLowerCase() === 'png' ? 'image/png' : 'image/jpeg';
          const dataUrl = 'data:' + mime + ';base64,' + bytesToBase64(entry.data);
          const stored = await options.hostClient.storeAsset(dataUrl, match[1].toLowerCase());
          mapping.set('assets/' + match[1].toLowerCase(), stored.assetPath || 'assets/' + stored.filename);
        } catch (error) {
          failed++;
        }
      }
      const next = text.replace(/assets\/[a-f0-9]{24}\.(?:png|jpg)/gi, function (path: string) {
        return mapping.get(path.toLowerCase()) || path;
      });
      options.detachFileContext();
      options.setMarkdown(next, { boundary: true, title: options.deriveTitle(next), resetHistory: true });
      options.focusRange(next.length, next.length);
      options.notify(t('toast.bundleImported') + (failed ? ' · ' + failed + ' ' + t('wechat.uploadFailed') : ''));
    } catch (error) {
      options.notify(t('toast.bundleImportFailed') + ' · ' + options.errorMessage(error), 'error');
    }
  }

  async function importBundle(file: File): Promise<void> {
    try {
      await importBundleBuffer(await readFileBytes(file));
    } catch (error) {
      options.notify(t('toast.bundleImportFailed') + ' · ' + options.errorMessage(error), 'error');
    }
  }

  async function importSelectedFile(file: File): Promise<void> {
    try {
      const buffer = await readFileBytes(file);
      const bytes = new Uint8Array(buffer);
      if (isZipCandidate(file, bytes)) {
        await importBundleBuffer(buffer);
        return;
      }
      const text = new TextDecoder().decode(bytes);
      options.detachFileContext();
      options.setMarkdown(text, { boundary: true, title: options.deriveTitle(text), resetHistory: true });
      options.focusRange(text.length, text.length);
      options.notify(t('toast.imported'));
    } catch (error) {
      options.notify(t('toast.copyFailed'), 'error');
    }
  }

  function handleFile(event: ReactNamespace.ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    void importSelectedFile(file);
    event.target.value = '';
  }

  return { blankArticle, loadSample, clearArticle, handleImportClick, importBundle, handleFile };
}

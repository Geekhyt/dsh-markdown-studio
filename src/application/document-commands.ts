import type * as ReactNamespace from 'react';
import type { HostClient } from '../adapters/host-client';
import { unzipEntries, ZIP_LIMITS } from '../adapters/zip';
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
  onTrackInFlight?: (filename: string, active: boolean) => void;
  getActiveArticleId?: () => string;
  isPageAlive?: () => boolean;
  flushBeforeSwitch?: () => Promise<boolean>;
  claimOpenTransition?: () => () => boolean;
  onResetSurface?: () => void;
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
    options.onResetSurface?.();
    options.setMarkdown('', { boundary: true, title: t('untitled'), resetHistory: true });
    options.focusRange(0, 0);
  }

  function isStillActive(targetArticleId: string | undefined): boolean {
    if (options.isPageAlive && !options.isPageAlive()) return false;
    return !targetArticleId || !options.getActiveArticleId || options.getActiveArticleId() === targetArticleId;
  }

  function claimTransition(): () => boolean {
    return options.claimOpenTransition ? options.claimOpenTransition() : () => true;
  }

  async function loadSample(force?: boolean): Promise<void> {
    const targetArticleId = options.getActiveArticleId?.();
    if (!force && options.doc.markdown.trim()) {
      const ok = await options.confirm({ title: t('confirm.sample') });
      if (!ok || !isStillActive(targetArticleId)) return;
    }
    const isCurrentOpen = claimTransition();
    if (options.flushBeforeSwitch && !(await options.flushBeforeSwitch())) return;
    if (!isCurrentOpen() || !isStillActive(targetArticleId)) return;
    const sample = sampleArticleFor(options.locale?.());
    options.detachFileContext();
    options.onResetSurface?.();
    options.setMarkdown(sample.markdown, { boundary: true, title: sample.title, resetHistory: true });
    options.focusRange(0, 0);
    options.onPruneAssets?.();
    options.notify(t('toast.sampleLoaded'));
  }

  async function clearArticle(): Promise<void> {
    const targetArticleId = options.getActiveArticleId?.();
    if (options.doc.markdown.trim()) {
      const ok = await options.confirm({ title: t('confirm.clear'), danger: true });
      if (!ok || !isStillActive(targetArticleId)) return;
    }
    const isCurrentOpen = claimTransition();
    if (options.flushBeforeSwitch && !(await options.flushBeforeSwitch())) return;
    if (!isCurrentOpen() || !isStillActive(targetArticleId)) return;
    blankArticle();
    options.onPruneAssets?.();
    options.notify(t('toast.cleared'));
  }

  function handleImportClick(): void {
    if (options.fileRef.current) options.fileRef.current.click();
    options.setMenuOpen(false);
  }

  async function importBundleBuffer(buffer: ArrayBuffer): Promise<void> {
    const targetArticleId = options.getActiveArticleId?.();
    const isCurrentOpen = claimTransition();
    const tracked: string[] = [];
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
      const assetEntries = entries
        .map((entry) => ({ entry, match: /^assets\/([a-f0-9]{24}\.(png|jpg))$/i.exec(entry.name) }))
        .filter((item): item is { entry: (typeof entries)[number]; match: RegExpExecArray } => Boolean(item.match));
      await Promise.all(
        assetEntries.map(async function ({ entry, match }) {
          try {
            const mime = match[2].toLowerCase() === 'png' ? 'image/png' : 'image/jpeg';
            const dataUrl = 'data:' + mime + ';base64,' + bytesToBase64(entry.data);
            const stored = await options.hostClient.storeAsset(dataUrl, match[1].toLowerCase());
            if (stored.filename) {
              options.onTrackInFlight?.(stored.filename, true);
              tracked.push(stored.filename);
            }
            mapping.set('assets/' + match[1].toLowerCase(), stored.assetPath || 'assets/' + stored.filename);
          } catch {
            failed++;
          }
        }),
      );
      if (!isCurrentOpen() || !isStillActive(targetArticleId)) return;
      if (options.flushBeforeSwitch && !(await options.flushBeforeSwitch())) return;
      if (!isCurrentOpen() || !isStillActive(targetArticleId)) return;
      const next = text.replace(/assets\/[a-f0-9]{24}\.(?:png|jpg)/gi, function (path: string) {
        return mapping.get(path.toLowerCase()) || path;
      });
      options.detachFileContext();
      options.onResetSurface?.();
      options.setMarkdown(next, { boundary: true, title: options.deriveTitle(next), resetHistory: true });
      options.focusRange(next.length, next.length);
      options.notify(t('toast.bundleImported') + (failed ? ' · ' + failed + ' ' + t('wechat.uploadFailed') : ''));
    } catch (error) {
      options.notify(t('toast.bundleImportFailed') + ' · ' + options.errorMessage(error), 'error');
    } finally {
      for (const filename of tracked) options.onTrackInFlight?.(filename, false);
    }
  }

  async function importBundle(file: File): Promise<void> {
    const targetArticleId = options.getActiveArticleId?.();
    const isCurrentOpen = claimTransition();
    try {
      if (file.size > ZIP_LIMITS.archiveBytes) throw new Error('ZIP_LIMIT_EXCEEDED');
      const buffer = await readFileBytes(file);
      if (!isCurrentOpen() || !isStillActive(targetArticleId)) return;
      await importBundleBuffer(buffer);
    } catch (error) {
      options.notify(t('toast.bundleImportFailed') + ' · ' + options.errorMessage(error), 'error');
    }
  }

  async function importSelectedFile(file: File): Promise<void> {
    const targetArticleId = options.getActiveArticleId?.();
    const isCurrentOpen = claimTransition();
    try {
      if (file.size > ZIP_LIMITS.archiveBytes) throw new Error('ZIP_LIMIT_EXCEEDED');
      const buffer = await readFileBytes(file);
      if (!isCurrentOpen() || !isStillActive(targetArticleId)) return;
      const bytes = new Uint8Array(buffer);
      if (isZipCandidate(file, bytes)) {
        await importBundleBuffer(buffer);
        return;
      }
      if (options.flushBeforeSwitch && !(await options.flushBeforeSwitch())) return;
      if (!isCurrentOpen() || !isStillActive(targetArticleId)) return;
      const text = new TextDecoder().decode(bytes);
      options.detachFileContext();
      options.onResetSurface?.();
      options.setMarkdown(text, { boundary: true, title: options.deriveTitle(text), resetHistory: true });
      options.focusRange(text.length, text.length);
      options.notify(t('toast.imported'));
    } catch (error) {
      options.notify(t('toast.importFailed') + ' · ' + options.errorMessage(error), 'error');
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

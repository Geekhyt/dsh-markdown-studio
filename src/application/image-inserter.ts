import type * as ReactNamespace from 'react';
import type { HostClient } from '../adapters/host-client';
import { prepareImageForWechat } from '../adapters/image-encode';

type Notify = (text: string, tone?: 'success' | 'error' | 'info') => void;

export interface ImageInsertOptions {
  t: (key: string) => string;
  notify: Notify;
  hostClient: HostClient;
  describeHostError: (error: unknown) => string;
  insertBlock: (block: string, blockOptions?: { collapseToEnd?: boolean }) => void;
  onTrackInFlight?: (filename: string, active: boolean) => void;
  getActiveArticleId?: () => string;
  isPageAlive?: () => boolean;
}

export interface ImageInsertApi {
  insertImageFiles: (files: FileList | File[]) => Promise<void>;
  handlePaste: (event: ReactNamespace.ClipboardEvent<HTMLElement>) => void;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise(function (resolve, reject) {
    const reader = new FileReader();
    reader.onload = function () {
      resolve(String(reader.result || ''));
    };
    reader.onerror = function () {
      reject(reader.error || new Error('read failed'));
    };
    reader.readAsDataURL(file);
  });
}

export function createImageInserter(options: ImageInsertOptions): ImageInsertApi {
  async function insertImageFiles(files: FileList | File[]): Promise<void> {
    const list = Array.from(files || []).filter(function (file) {
      return file && /^image\//i.test(file.type || '');
    });
    if (!list.length) return;
    const accepted: File[] = [];
    let skipped = 0;
    list.forEach(function (file) {
      if (file.size > 8000000) skipped++;
      else accepted.push(file);
    });
    if (!accepted.length) {
      options.notify(options.t('toast.imageTooLarge'), 'error');
      return;
    }
    const targetArticleId = options.getActiveArticleId?.();
    const items: Array<{ file: File; url: string; filename: string }> = [];
    let failed = 0;
    let lastError: unknown = null;
    try {
      const settled = await Promise.all(
        accepted.map(async function (file) {
          try {
            const dataUrl = await fileToDataUrl(file);
            const prepared = await prepareImageForWechat(dataUrl);
            const stored = await options.hostClient.storeAsset(prepared.dataUrl, prepared.filename);
            const itemUrl = stored.assetPath || stored.localUrl || stored.url;
            if (stored.filename) options.onTrackInFlight?.(stored.filename, true);
            return itemUrl ? { file, url: itemUrl, filename: stored.filename || '' } : null;
          } catch (error) {
            failed++;
            lastError = error;
            return null;
          }
        }),
      );
      for (const entry of settled) {
        if (entry) items.push(entry);
      }
      if (options.isPageAlive && !options.isPageAlive()) return;
      if (targetArticleId && options.getActiveArticleId && options.getActiveArticleId() !== targetArticleId) return;
      if (!items.length) {
        options.notify(lastError ? options.describeHostError(lastError) : options.t('toast.imageTooLarge'), 'error');
        return;
      }
      const block = items
        .map(function (item) {
          const name = String(item.file.name || 'image')
            .replace(/\.[^.]+$/, '')
            .replace(/[[\]]/g, '');
          return '![' + name + '](' + item.url + ')';
        })
        .join('\n\n');
      options.insertBlock(block, { collapseToEnd: true });
      let message = items.length + ' ' + options.t('toast.imagesInserted');
      if (skipped) message += ' · ' + skipped + ' ' + options.t('toast.imagesSkipped');
      if (failed) message += ' · ' + failed + ' ' + options.t('toast.assetsFailed');
      options.notify(message, skipped || failed ? 'error' : 'success');
    } finally {
      for (const item of items) {
        if (item.filename) options.onTrackInFlight?.(item.filename, false);
      }
    }
  }

  function handlePaste(event: ReactNamespace.ClipboardEvent<HTMLElement>): void {
    const clipboard = event.clipboardData;
    if (!clipboard) return;
    const files: File[] = clipboard.files && clipboard.files.length ? Array.from(clipboard.files) : [];
    if (!files.length && clipboard.items) {
      for (let index = 0; index < clipboard.items.length; index++) {
        const item = clipboard.items[index];
        if (item.kind === 'file' && /^image\//i.test(item.type || '')) {
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }
    }
    if (!files.length) return;
    event.preventDefault();
    void insertImageFiles(files);
  }

  return { insertImageFiles, handlePaste };
}

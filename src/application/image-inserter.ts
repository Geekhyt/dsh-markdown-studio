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
    const items: Array<{ file: File; url: string }> = [];
    let failed = 0;
    let lastError: unknown = null;
    for (const file of accepted) {
      try {
        const dataUrl = await fileToDataUrl(file);
        const prepared = await prepareImageForWechat(dataUrl);
        const stored = await options.hostClient.storeAsset(prepared.dataUrl, prepared.filename);
        const itemUrl = stored.assetPath || stored.localUrl || stored.url;
        if (itemUrl) items.push({ file, url: itemUrl });
      } catch (error) {
        failed++;
        lastError = error;
      }
    }
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

import type { HostClient } from '../adapters/host-client';
import { prepareImageForWechat } from '../adapters/image-encode';
import { bytesToBase64 } from '../domain/base64';
import { assetFilesInMarkdown } from '../domain/images';

export async function importFolderAssets(
  dirHandle: FileSystemDirectoryHandle,
  text: string,
  hostClient: Pick<HostClient, 'storeAsset'>,
  onTrackInFlight?: (filename: string, active: boolean) => void,
): Promise<{ text: string; imported: number }> {
  const files = assetFilesInMarkdown(text);
  if (!files.length) return { text, imported: 0 };
  let assetsDir: FileSystemDirectoryHandle;
  try {
    assetsDir = await dirHandle.getDirectoryHandle('assets');
  } catch {
    return { text, imported: 0 };
  }
  const mapping = new Map<string, string>();
  const tracked: string[] = [];
  let imported = 0;
  try {
    await Promise.all(
      files.map(async function (filename) {
        try {
          const handle = await assetsDir.getFileHandle(filename);
          const file = await handle.getFile();
          const bytes = new Uint8Array(await file.arrayBuffer());
          const mime = /\.png$/i.test(filename) ? 'image/png' : 'image/jpeg';
          const prepared = await prepareImageForWechat('data:' + mime + ';base64,' + bytesToBase64(bytes));
          const stored = await hostClient.storeAsset(prepared.dataUrl, filename);
          if (stored.filename) {
            onTrackInFlight?.(stored.filename, true);
            tracked.push(stored.filename);
          }
          const assetPath = stored.assetPath || 'assets/' + stored.filename;
          if (assetPath !== 'assets/' + filename) mapping.set('assets/' + filename.toLowerCase(), assetPath);
          imported++;
        } catch {
          /* skip missing or unsupported assets */
        }
      }),
    );
    const next = text.replace(/assets\/[a-f0-9]{24}\.(?:png|jpg)/gi, function (path: string) {
      return mapping.get(path.toLowerCase()) || path;
    });
    return { text: next, imported };
  } finally {
    for (const filename of tracked) onTrackInFlight?.(filename, false);
  }
}

const folderAssetWriteQueues = new WeakMap<FileSystemDirectoryHandle, Promise<void>>();

async function assetAlreadyWritten(assetsDir: FileSystemDirectoryHandle, filename: string): Promise<boolean> {
  try {
    const existing = await assetsDir.getFileHandle(filename);
    const file = await existing.getFile();
    return file.size > 0;
  } catch {
    return false;
  }
}

async function writeFolderAssetsSerialized(
  dirHandle: FileSystemDirectoryHandle,
  markdown: string,
  localImageServerUrl: string,
): Promise<number> {
  if (dirHandle.queryPermission) {
    const permission = await dirHandle.queryPermission({ mode: 'readwrite' });
    if (permission !== 'granted') return 0;
  }
  const files = assetFilesInMarkdown(markdown);
  if (!files.length) return 0;
  const assetsDir = await dirHandle.getDirectoryHandle('assets', { create: true });
  const base = String(localImageServerUrl || '').replace(/\/+$/, '');
  let written = 0;
  await Promise.all(
    files.map(async function (filename) {
      try {
        if (await assetAlreadyWritten(assetsDir, filename)) return;
        const url = base ? base + '/uploads/' + filename : '/api/markdown-studio/assets/' + filename;
        const response = await fetch(url);
        if (!response.ok) return;
        const bytes = new Uint8Array(await response.arrayBuffer());
        const target = await assetsDir.getFileHandle(filename, { create: true });
        const writable = await target.createWritable();
        try {
          await writable.write(bytes);
          await writable.close();
        } catch (writeError) {
          await writable.abort().catch(() => undefined);
          throw writeError;
        }
        written++;
      } catch {
        /* keep going */
      }
    }),
  );
  return written;
}

export function writeFolderAssets(
  dirHandle: FileSystemDirectoryHandle,
  markdown: string,
  localImageServerUrl: string,
): Promise<number> {
  const prev = folderAssetWriteQueues.get(dirHandle) || Promise.resolve();
  const run = prev.then(
    () => writeFolderAssetsSerialized(dirHandle, markdown, localImageServerUrl),
    () => writeFolderAssetsSerialized(dirHandle, markdown, localImageServerUrl),
  );
  folderAssetWriteQueues.set(
    dirHandle,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}

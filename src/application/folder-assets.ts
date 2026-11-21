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
  } catch (error) {
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
        } catch (error) {
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

export async function writeFolderAssets(
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
        const url = base ? base + '/uploads/' + filename : '/api/markdown-studio/assets/' + filename;
        const response = await fetch(url);
        if (!response.ok) return;
        const bytes = new Uint8Array(await response.arrayBuffer());
        const target = await assetsDir.getFileHandle(filename, { create: true });
        const writable = await target.createWritable();
        await writable.write(bytes);
        await writable.close();
        written++;
      } catch (error) {
        /* keep going */
      }
    }),
  );
  return written;
}

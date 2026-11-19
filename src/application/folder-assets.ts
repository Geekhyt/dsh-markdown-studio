import type { HostClient } from '../adapters/host-client';
import { prepareImageForWechat } from '../adapters/image-encode';
import { bytesToBase64 } from '../domain/base64';
import { assetFilesInMarkdown } from '../domain/images';

export async function importFolderAssets(
  dirHandle: FileSystemDirectoryHandle,
  text: string,
  hostClient: Pick<HostClient, 'storeAsset'>,
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
  let imported = 0;
  for (const filename of files) {
    try {
      const handle = await assetsDir.getFileHandle(filename);
      const file = await handle.getFile();
      const bytes = new Uint8Array(await file.arrayBuffer());
      const mime = /\.png$/i.test(filename) ? 'image/png' : 'image/jpeg';
      const prepared = await prepareImageForWechat('data:' + mime + ';base64,' + bytesToBase64(bytes));
      const stored = await hostClient.storeAsset(prepared.dataUrl, filename);
      const path = stored.assetPath || 'assets/' + stored.filename;
      if (path !== 'assets/' + filename) mapping.set('assets/' + filename, path);
      imported++;
    } catch (error) {
      /* skip missing or unsupported assets */
    }
  }
  const next = text.replace(/assets\/[a-f0-9]{24}\.(?:png|jpg)/g, function (path: string) {
    return mapping.get(path) || path;
  });
  return { text: next, imported };
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
  const base = String(localImageServerUrl || 'http://127.0.0.1:4010').replace(/\/+$/, '');
  let written = 0;
  for (const filename of files) {
    try {
      const response = await fetch(base + '/uploads/' + filename);
      if (!response.ok) continue;
      const bytes = new Uint8Array(await response.arrayBuffer());
      const target = await assetsDir.getFileHandle(filename, { create: true });
      const writable = await target.createWritable();
      await writable.write(bytes);
      await writable.close();
      written++;
    } catch (error) {
      /* keep going */
    }
  }
  return written;
}

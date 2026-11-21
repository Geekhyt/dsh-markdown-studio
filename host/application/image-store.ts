/*
 * Local content-addressed image store.
 *
 * HTTP concerns live in host/http/routes.ts. No configuration or secrets are
 * stored here.
 */
const ASSET_URL_PREFIX = '/api/markdown-studio/assets/';

import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { SAMPLE_IMAGE_BUFFER, SAMPLE_IMAGE_FILENAME, SAMPLE_IMAGE_MIME } from '../sample-asset';

export const MAX_IMAGE_BYTES = 1_000_000;

const ASSET_ID_LENGTH = 24;
const ASSET_NAME_PATTERN = /^[a-f0-9]{24}\.(png|jpg)$/;

export type ImageMime = 'image/png' | 'image/jpeg';

export interface LocalAsset {
  buffer: Buffer;
  mime: ImageMime;
  filename: string;
}

export interface StoredAsset {
  url: string;
  assetPath: string;
  assetUrl: string;
  localUrl: string;
  filename: string;
  id: string;
  mime: ImageMime;
  bytes: number;
}

export interface AssetListItem {
  filename: string;
  assetPath: string;
  url: string;
  bytes: number;
  mime: ImageMime;
  storedAt?: string;
}

interface ManifestEntry {
  mime: string;
  bytes: number;
  storedAt: string;
}

type Manifest = Record<string, ManifestEntry>;

export interface LocalServerInfo {
  port: number;
  url: string;
}

export class ImageHostError extends Error {
  readonly code: string;
  readonly hint: string;
  readonly detail: string;

  constructor(code: string, message: string, hint = '', detail = '') {
    super(message);
    this.name = 'ImageHostError';
    this.code = code;
    this.hint = hint;
    this.detail = detail;
  }
}

function digest(value: Buffer | string): string {
  return createHash('sha256')
    .update(Buffer.isBuffer(value) ? value : String(value))
    .digest('hex');
}

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function hasImageMagicBytes(buffer: Buffer, mime: ImageMime): boolean {
  if (mime === 'image/png') {
    if (buffer.length < PNG_SIG.length) return false;
    for (let i = 0; i < PNG_SIG.length; i++) {
      if (buffer[i] !== PNG_SIG[i]) return false;
    }
    return true;
  }
  return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
}

function parseDataUrl(dataUrl: unknown): { mime: ImageMime; buffer: Buffer; ext: 'png' | 'jpg' } {
  const raw = String(dataUrl || '');
  const comma = raw.indexOf(',');
  if (comma === -1) {
    throw new ImageHostError('INVALID_IMAGE', '图片数据不是有效的 Base64 data URL', '请重新粘贴或拖入图片。');
  }
  const headerMatch = /^data:(image\/[a-z0-9.+-]+);base64$/i.exec(raw.slice(0, comma));
  const payload = raw.slice(comma + 1);
  if (!headerMatch || !payload || !/^[A-Za-z0-9+/=\r\n]+$/.test(payload)) {
    throw new ImageHostError('INVALID_IMAGE', '图片数据不是有效的 Base64 data URL', '请重新粘贴或拖入图片。');
  }
  let mime = headerMatch[1].toLowerCase();
  if (mime === 'image/jpg') mime = 'image/jpeg';
  if (mime !== 'image/png' && mime !== 'image/jpeg') {
    throw new ImageHostError('UNSUPPORTED_IMAGE', '仅接受 JPG / PNG', '请先把 GIF/WebP 转成 PNG 或 JPG。');
  }
  // Reject wildly oversized base64 payloads before decoding to prevent multi-MB transient buffers.
  const compact = payload.replace(/\s+/g, '');
  const estimatedBytes = Math.floor((compact.length * 3) / 4);
  if (estimatedBytes > MAX_IMAGE_BYTES + 4) {
    const mb = (estimatedBytes / (1024 * 1024)).toFixed(2);
    throw new ImageHostError(
      'IMAGE_TOO_LARGE',
      `图片约 ${mb} MB，超过 1 MB 限制`,
      '编辑器会在上传前压缩；若仍失败，请换一张更小的图片。',
    );
  }
  const buffer = Buffer.from(compact, 'base64');
  if (!buffer.length) {
    throw new ImageHostError('INVALID_IMAGE', '图片内容为空', '请重新选择图片。');
  }
  if (buffer.length > MAX_IMAGE_BYTES) {
    const mb = (buffer.length / (1024 * 1024)).toFixed(2);
    throw new ImageHostError(
      'IMAGE_TOO_LARGE',
      `图片约 ${mb} MB，超过 1 MB 限制`,
      '编辑器会在上传前压缩；若仍失败，请换一张更小的图片。',
    );
  }
  if (!hasImageMagicBytes(buffer, mime as ImageMime)) {
    throw new ImageHostError('INVALID_IMAGE', '图片文件头校验失败', '请提供有效的 PNG 或 JPG 图片。');
  }
  return { mime: mime as ImageMime, buffer, ext: mime === 'image/png' ? 'png' : 'jpg' };
}

function field(input: unknown, key: string): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  return (input as Record<string, unknown>)[key];
}

function inputString(input: unknown): string {
  if (typeof input === 'string') return input;
  for (const key of ['filename', 'url', 'assetPath']) {
    const value = field(input, key);
    if (typeof value === 'string' && value) return value;
  }
  return '';
}

function assetFilename(input: unknown): string | null {
  const value = inputString(input);
  const clean = value.split('?')[0].split('#')[0];
  const match = /(?:^|\/)([a-f0-9]{24}\.(?:png|jpg))$/.exec(clean);
  return match ? match[1] : null;
}

export class ImageHostService {
  readonly storageDir: string;
  localServerInfo: LocalServerInfo | null = null;
  localServerError = '';
  private manifestCache: Manifest | null = null;
  private manifestQueue: Promise<void> = Promise.resolve();

  constructor(options: { storageDir: string }) {
    if (!options || !options.storageDir) throw new Error('ImageHostService needs a storageDir');
    this.storageDir = options.storageDir;
  }

  private assetsDir(): string {
    return path.join(this.storageDir, 'assets');
  }

  private manifestPath(): string {
    return path.join(this.storageDir, 'assets.json');
  }

  private async loadManifest(): Promise<Manifest> {
    if (this.manifestCache) return this.manifestCache;
    let raw: string;
    try {
      raw = await readFile(this.manifestPath(), 'utf8');
    } catch (error) {
      if (error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.manifestCache = {};
        return this.manifestCache;
      }
      throw error;
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      this.manifestCache = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Manifest) : {};
    } catch (error) {
      const backup = this.manifestPath() + '.corrupt.' + Date.now();
      await rename(this.manifestPath(), backup).catch(() => undefined);
      this.manifestCache = {};
    }
    return this.manifestCache;
  }

  private async saveManifest(manifest: Manifest): Promise<void> {
    await mkdir(this.storageDir, { recursive: true, mode: 0o700 });
    const file = this.manifestPath();
    const temp = file + '.' + process.pid + '.' + Date.now() + '.' + randomBytes(6).toString('hex') + '.tmp';
    try {
      await writeFile(temp, JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
      await rename(temp, file);
      this.manifestCache = manifest;
    } catch (error) {
      await unlink(temp).catch(() => undefined);
      throw error;
    }
  }

  private enqueueManifest<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.manifestQueue.then(operation, operation);
    this.manifestQueue = run.then(
      function () {
        return undefined;
      },
      function () {
        return undefined;
      },
    );
    return run;
  }

  async storeAsset(input: unknown): Promise<StoredAsset> {
    const image = parseDataUrl(field(input, 'dataUrl'));
    const id = digest(image.buffer).slice(0, ASSET_ID_LENGTH);
    const filename = id + '.' + image.ext;
    const dir = this.assetsDir();
    const file = path.join(dir, filename);
    await this.enqueueManifest(async () => {
      await mkdir(dir, { recursive: true, mode: 0o700 });
      let exists = false;
      try {
        const info = await stat(file);
        // A size mismatch means an earlier write was interrupted; rewrite it.
        exists = info.isFile() && info.size === image.buffer.length;
      } catch (error) {
        exists = false;
      }
      if (!exists) {
        // Write-then-rename keeps content-addressed files all-or-nothing across crashes.
        const temp =
          file + '.' + process.pid + '-' + Date.now().toString(36) + '-' + randomBytes(6).toString('hex') + '.tmp';
        try {
          await writeFile(temp, image.buffer, { mode: 0o644 });
          await rename(temp, file);
        } catch (error) {
          await unlink(temp).catch(() => undefined);
          throw error;
        }
      }
      const manifest = await this.loadManifest();
      if (!manifest[filename]) {
        const next: Manifest = {
          ...manifest,
          [filename]: {
            mime: image.mime,
            bytes: image.buffer.length,
            storedAt: new Date().toISOString(),
          },
        };
        try {
          await this.saveManifest(next);
        } catch (error) {
          if (!exists) await unlink(file).catch(() => undefined);
          throw error;
        }
      }
    });
    const localUrl = this.localServerInfo ? `${this.localServerInfo.url}/uploads/${filename}` : '';
    const assetUrl = ASSET_URL_PREFIX + filename;
    return {
      url: localUrl || assetUrl,
      assetPath: 'assets/' + filename,
      assetUrl,
      localUrl,
      filename,
      id,
      mime: image.mime,
      bytes: image.buffer.length,
    };
  }

  async readAsset(filename: unknown): Promise<LocalAsset | null> {
    const name = typeof filename === 'string' ? filename : '';
    if (!ASSET_NAME_PATTERN.test(name)) return null;
    if (name === SAMPLE_IMAGE_FILENAME) {
      return { buffer: SAMPLE_IMAGE_BUFFER, mime: SAMPLE_IMAGE_MIME, filename: name };
    }
    try {
      const buffer = await readFile(path.join(this.assetsDir(), name));
      return {
        buffer,
        mime: name.endsWith('.png') ? 'image/png' : 'image/jpeg',
        filename: name,
      };
    } catch (error) {
      return null;
    }
  }

  async listAssets(): Promise<{ assets: AssetListItem[] }> {
    return await this.enqueueManifest(async () => {
      let names: string[] = [];
      try {
        names = await readdir(this.assetsDir());
      } catch (error) {
        names = [];
      }
      const manifest = await this.loadManifest();
      const localBase = this.localServerInfo ? this.localServerInfo.url : '';
      const assets: AssetListItem[] = [];
      for (const filename of names.filter((name) => ASSET_NAME_PATTERN.test(name)).sort()) {
        let bytes = 0;
        try {
          bytes = (await stat(path.join(this.assetsDir(), filename))).size;
        } catch (error) {
          continue;
        }
        const entry = manifest[filename];
        if (!entry) continue;
        assets.push({
          filename,
          assetPath: 'assets/' + filename,
          url: localBase ? `${localBase}/uploads/${filename}` : ASSET_URL_PREFIX + filename,
          bytes,
          mime: filename.endsWith('.png') ? 'image/png' : 'image/jpeg',
          storedAt: entry.storedAt,
        });
      }
      return { assets };
    });
  }

  async deleteAsset(input: unknown): Promise<{ filename: string; deleted: true }> {
    const filename = assetFilename(input);
    if (!filename) {
      throw new ImageHostError('ASSET_NOT_FOUND', '本地图片不存在', '请刷新图片列表。');
    }
    await this.enqueueManifest(async () => {
      try {
        await unlink(path.join(this.assetsDir(), filename));
      } catch (error) {
        if (!error || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      const manifest = await this.loadManifest();
      if (manifest[filename]) {
        const next: Manifest = { ...manifest };
        delete next[filename];
        await this.saveManifest(next);
      }
    });
    return { filename, deleted: true };
  }

  info(): { assets: true; loopbackOnly: true; localServerUrl: string; localServerPort: number } {
    return {
      assets: true,
      loopbackOnly: true,
      localServerUrl: this.localServerInfo ? this.localServerInfo.url : '',
      localServerPort: this.localServerInfo ? this.localServerInfo.port : 0,
    };
  }
}

export { parseDataUrl };

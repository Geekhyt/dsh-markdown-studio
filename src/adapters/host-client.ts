import type { AssetItem, HostHealth, StoredAsset } from '../domain/images';

export class HostClientError extends Error {
  readonly code: string;
  readonly hint: string;
  readonly detail: string;

  constructor(code: string, message: string, hint = '', detail = '') {
    super(message);
    this.name = 'HostClientError';
    this.code = code;
    this.hint = hint;
    this.detail = detail;
  }
}

const HOST_ERROR_CODE_KEYS: Record<string, string> = {
  INVALID_IMAGE: 'err.invalidImage',
  UNSUPPORTED_IMAGE: 'err.unsupportedImage',
  IMAGE_TOO_LARGE: 'err.imageTooLarge',
  ASSET_NOT_FOUND: 'err.assetNotFound',
  BODY_TOO_LARGE: 'err.bodyTooLarge',
  BAD_JSON: 'err.badJson',
  HOST_BAD_RESPONSE: 'err.hostBadResponse',
  LOOPBACK_ONLY: 'err.loopbackOnly',
  ORIGIN_REJECTED: 'err.originRejected',
  INTERNAL: 'err.internal',
};

export function formatHostClientError(
  error: unknown,
  labels: { hostMissing: string; fallback: string; t?: (key: string) => string },
): string {
  const candidate = error && typeof error === 'object' ? (error as Record<string, unknown>) : null;
  if (candidate?.code === 'HOST_UNAVAILABLE') return labels.hostMissing;
  const code = stringField(candidate?.code);
  const key = code && Object.hasOwn(HOST_ERROR_CODE_KEYS, code) ? HOST_ERROR_CODE_KEYS[code] : '';
  if (key && labels.t) {
    return `${labels.t(key)} [${code}]`;
  }
  const message = stringField(candidate?.message) || labels.fallback;
  const hint = stringField(candidate?.hint);
  const withHint = hint ? `${message} · ${hint}` : message;
  return code ? `${withHint} [${code}]` : withHint;
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function assetItemOf(value: unknown): AssetItem | null {
  const item = recordOf(value);
  if (!item) return null;
  const filename = stringField(item.filename);
  const assetPath = stringField(item.assetPath);
  const url = stringField(item.url);
  if (!filename || !assetPath || !url) return null;
  const storedAt = stringField(item.storedAt);
  return {
    filename,
    assetPath,
    url,
    bytes: Number(item.bytes) || 0,
    mime: stringField(item.mime) || 'image/png',
    ...(storedAt ? { storedAt } : {}),
  };
}

export class HostClient {
  private readonly route: string;
  private readonly fetchImpl: typeof fetch;

  constructor(route: string, fetchImpl: typeof fetch = (input, init) => globalThis.fetch(input, init)) {
    this.route = route;
    this.fetchImpl = fetchImpl;
  }

  private async post(action: string, payload: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    let response: Response;
    const doFetch = this.fetchImpl;
    try {
      response = await doFetch(this.route, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, ...payload }),
      });
    } catch (error) {
      throw new HostClientError(
        'HOST_UNAVAILABLE',
        'Host unavailable',
        '',
        error instanceof Error ? error.message : '',
      );
    }
    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    if (!contentType.includes('application/json')) {
      throw new HostClientError('HOST_UNAVAILABLE', 'Host returned a non-JSON response');
    }
    let rawJson: unknown;
    try {
      rawJson = await response.json();
    } catch {
      throw new HostClientError('HOST_BAD_RESPONSE', 'Host returned malformed JSON');
    }
    const data = recordOf(rawJson);
    if (!data) throw new HostClientError('HOST_BAD_RESPONSE', 'Host returned an invalid response');
    if (data.ok === false) {
      const error = recordOf(data.error) || {};
      throw new HostClientError(
        stringField(error.code) || 'HOST_ERROR',
        stringField(error.message) || 'Host request failed',
        stringField(error.hint),
        stringField(error.detail),
      );
    }
    if (data.ok !== true) throw new HostClientError('HOST_BAD_RESPONSE', 'Host response has no ok flag');
    return data;
  }

  async health(): Promise<HostHealth> {
    const data = await this.post('health');
    return {
      localServerUrl: stringField(data.localServerUrl),
      localServerPort: Number(data.localServerPort) || 0,
    };
  }

  async storeAsset(dataUrl: string, filename: string): Promise<StoredAsset> {
    const data = await this.post('asset.store', { dataUrl, filename });
    const storedFilename = stringField(data.filename);
    const assetPath = stringField(data.assetPath);
    if (!storedFilename || !assetPath)
      throw new HostClientError('HOST_BAD_RESPONSE', 'Asset store returned no filename');
    return {
      filename: storedFilename,
      assetPath,
      localUrl: stringField(data.localUrl),
      url: stringField(data.url),
      mime: stringField(data.mime) || 'image/png',
      bytes: Number(data.bytes) || 0,
    };
  }

  async listAssets(): Promise<AssetItem[]> {
    const data = await this.post('asset.list');
    if (!Array.isArray(data.assets)) throw new HostClientError('HOST_BAD_RESPONSE', 'Asset list is not an array');
    return data.assets.map(assetItemOf).filter((item): item is AssetItem => item !== null);
  }

  async deleteAsset(filename: string, expectedStoredAt?: string): Promise<void> {
    await this.post('asset.delete', expectedStoredAt ? { filename, expectedStoredAt } : { filename });
  }
}

import assert from 'node:assert/strict';
import { AiClientError, formatAiClientError } from '../src/adapters/ai-client';
import { formatHostClientError, HostClient, HostClientError } from '../src/adapters/host-client';
import { UI_STRINGS_EN } from '../src/locales/ui-strings';

function response(data: unknown, type = 'application/json'): Response {
  return new Response(JSON.stringify(data), { headers: { 'content-type': type } });
}

let calls = 0;
const client = new HostClient('/api/test', async (_input, init) => {
  calls++;
  const body = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>;
  if (body.action === 'health')
    return response({ ok: true, localServerUrl: 'http://127.0.0.1:4010', localServerPort: 4010 });
  if (body.action === 'asset.store')
    return response({
      ok: true,
      filename: '0123456789abcdef01234567.png',
      assetPath: 'assets/0123456789abcdef01234567.png',
      localUrl: 'http://127.0.0.1:4010/uploads/0123456789abcdef01234567.png',
      url: '',
      mime: 'image/png',
      bytes: 4,
    });
  if (body.action === 'asset.list')
    return response({
      ok: true,
      assets: [
        {
          filename: 'a.png',
          assetPath: 'assets/a.png',
          url: 'http://127.0.0.1:4010/uploads/a.png',
          bytes: 2,
          mime: 'image/png',
        },
        { filename: 'bad' },
      ],
    });
  if (body.action === 'asset.delete') return response({ ok: true });
  if (body.action === 'error')
    return response({ ok: false, error: { code: 'IMAGE_TOO_LARGE', message: 'too large', hint: 'compress' } });
  return response({ ok: false, error: { code: 'UNKNOWN_ACTION', message: 'unknown' } });
});

const health = await client.health();
assert.equal(health.localServerUrl, 'http://127.0.0.1:4010');
assert.equal(health.localServerPort, 4010);
const stored = await client.storeAsset('data:image/png;base64,AAAA', 'x.png');
assert.equal(stored.filename, '0123456789abcdef01234567.png');
assert.equal(stored.assetPath, 'assets/0123456789abcdef01234567.png');
const assets = await client.listAssets();
assert.equal(assets.length, 1, 'invalid asset records are dropped');
await client.deleteAsset('a.png');
assert.equal(calls, 4);
await assert.rejects(
  () =>
    new HostClient('/api/test', async () =>
      response({ ok: false, error: { code: 'IMAGE_TOO_LARGE', message: 'too large', hint: 'compress' } }),
    ).deleteAsset('a.png'),
  (error: unknown) => error instanceof HostClientError && error.code === 'IMAGE_TOO_LARGE' && error.hint === 'compress',
);
await assert.rejects(
  () => new HostClient('/api/test', async () => response({ ok: true }, 'text/plain')).health(),
  (error: unknown) => error instanceof HostClientError && error.code === 'HOST_UNAVAILABLE',
);

const labels = { hostMissing: 'host missing', fallback: 'request failed' };
assert.equal(formatHostClientError(new HostClientError('HOST_UNAVAILABLE', 'offline'), labels), 'host missing');
assert.equal(
  formatHostClientError(new HostClientError('IMAGE_TOO_LARGE', 'too large', 'compress'), labels),
  'too large · compress [IMAGE_TOO_LARGE]',
);
assert.equal(formatHostClientError(new Error('plain error'), labels), 'plain error');
assert.equal(formatHostClientError(null, labels), 'request failed');

const tEn = (key: string): string => UI_STRINGS_EN[key] || key;
assert.equal(
  formatHostClientError(new HostClientError('IMAGE_TOO_LARGE', '图片超过限制', '请压缩'), {
    ...labels,
    t: tEn,
  }),
  'Image still exceeds the 1 MB limit after compression. Try a smaller image. [IMAGE_TOO_LARGE]',
);
assert.equal(
  formatAiClientError(new AiClientError('MODEL_UNCONFIGURED', '未检测到可用模型'), tEn),
  'No model configured. Choose a default model in DeepSeek Harness settings first.',
);
assert.equal(
  formatAiClientError(new AiClientError('HTTP_502', 'AI 服务响应异常'), tEn),
  'AI service returned an unexpected HTTP error (HTTP 502)',
);
assert.equal(formatAiClientError(new Error('Provider quota exceeded'), tEn), 'Provider quota exceeded');

console.log('17 host-client checks passed.');

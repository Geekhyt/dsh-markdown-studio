import assert from 'node:assert/strict';
import { AiClient, AiClientError, formatAiClientError } from '../src/adapters/ai-client';
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
assert.equal(
  formatAiClientError(
    new AiClientError(
      'LLM_ERROR',
      'llm-deepseek: no API key for provider route "deepseek-official"; store DEEPSEEK_API_KEY through the credentials service',
    ),
    tEn,
  ),
  'No model API key is configured. Add one under DeepSeek Harness → Models, then retry.',
  'raw host "no API key" failures map to a friendly localized message',
);
assert.equal(
  formatAiClientError(new AiClientError('HTTP_401', 'Unauthorized'), (k) => UI_STRINGS_EN[k] || k),
  'No model API key is configured. Add one under DeepSeek Harness → Models, then retry.',
);

// G6 regressions: Object.prototype safe error code lookup, non-NDJSON 200 OK rejection, and HostClient network/HTTP error branches
assert.equal(
  formatAiClientError(new AiClientError('toString', 'raw'), tEn),
  'raw',
  'formatAiClientError ignores Object.prototype keys like toString',
);
assert.equal(
  formatHostClientError(new HostClientError('toString', 'raw'), { ...labels, t: tEn }),
  'raw [toString]',
  'formatHostClientError ignores Object.prototype keys like toString',
);
await assert.rejects(
  () =>
    new AiClient(
      '/api/ai',
      async () => new Response('<html>login</html>', { status: 200, headers: { 'content-type': 'text/html' } }),
    ).stream({ system: 'sys', prompt: 'p' }),
  (error: unknown) => error instanceof AiClientError && error.code === 'HOST_BAD_RESPONSE',
  'AiClient.stream rejects 200 OK HTML/non-NDJSON responses as HOST_BAD_RESPONSE',
);
await assert.rejects(
  () =>
    new HostClient('/api/test', async () => {
      throw new Error('ECONNREFUSED');
    }).health(),
  (error: unknown) => error instanceof HostClientError && error.code === 'HOST_UNAVAILABLE',
);
await assert.rejects(
  () =>
    new HostClient(
      '/api/test',
      async () => new Response('nope', { status: 502, headers: { 'content-type': 'text/plain' } }),
    ).health(),
  (error: unknown) => error instanceof HostClientError && error.code === 'HOST_UNAVAILABLE',
);
await assert.rejects(
  () =>
    new HostClient(
      '/api/test',
      async () => new Response('{"bad', { status: 200, headers: { 'content-type': 'application/json' } }),
    ).health(),
  (error: unknown) => error instanceof HostClientError && error.code === 'HOST_BAD_RESPONSE',
);
await assert.rejects(
  () =>
    new HostClient(
      '/api/test',
      async () =>
        new Response(JSON.stringify({ ok: false }), { status: 500, headers: { 'content-type': 'application/json' } }),
    ).health(),
  (error: unknown) => error instanceof HostClientError && error.code === 'HOST_ERROR',
);

// G2 regressions: EN localization for HOST_BAD_RESPONSE & RATE_LIMIT, corrupt NDJSON, and expectedStoredAt forwarding
assert.equal(
  formatAiClientError(new AiClientError('HOST_BAD_RESPONSE', 'raw-zh'), tEn),
  UI_STRINGS_EN['err.hostBadResponse'],
  'HOST_BAD_RESPONSE localizes to English UI string',
);
assert.equal(
  formatAiClientError(new AiClientError('RATE_LIMIT', 'raw'), tEn),
  UI_STRINGS_EN['err.aiRateLimited'],
  'RATE_LIMIT localizes to English rate-limit string',
);
await assert.rejects(
  () =>
    new AiClient(
      '/api/ai',
      async () =>
        new Response('{corrupt-ndjson\n', { status: 200, headers: { 'content-type': 'application/x-ndjson' } }),
    ).stream({ system: 'sys', prompt: 'p' }),
  (error: unknown) => error instanceof AiClientError && error.code === 'HOST_BAD_RESPONSE',
  'corrupt NDJSON line throws HOST_BAD_RESPONSE instead of silent stream drop',
);
let capturedDeleteBody: Record<string, unknown> = {};
await new HostClient('/api/test', async (_url, init) => {
  capturedDeleteBody = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>;
  return new Response(JSON.stringify({ ok: true, filename: 'aaaaaaaaaaaaaaaaaaaaaaaa.png', deleted: false }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}).deleteAsset('aaaaaaaaaaaaaaaaaaaaaaaa.png', '2026-01-01T00:00:00.000Z');
assert.equal(capturedDeleteBody.expectedStoredAt, '2026-01-01T00:00:00.000Z', 'deleteAsset forwards expectedStoredAt');

console.log('24 host-client checks passed.');

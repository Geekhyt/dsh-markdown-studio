import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { ImageHostError, ImageHostService, MAX_IMAGE_BYTES, parseDataUrl } from '../host/application/image-store';
import { MATH_PATH, mathRoute } from '../host/http/math-route';
import { MERMAID_PATH, mermaidRoute } from '../host/http/mermaid-route';
import { ASSET_PREFIX, createAssetRoute, createImageRoute } from '../host/http/routes';
import { startLocalImageServer } from '../host/local-server';
import { SAMPLE_IMAGE_FILENAME } from '../host/sample-asset';
import { resolveStorageDir } from '../index';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl9sAAAAASUVORK5CYII=';
const IMAGE = 'data:image/png;base64,' + PNG;
let checks = 0;
async function check(name: string, fn: () => Promise<void>): Promise<void> {
  await fn();
  checks++;
  console.log('ok -', name);
}

async function listen(handler: http.RequestListener): Promise<{ server: http.Server; port: number }> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('expected TCP address');
  return { server, port: address.port };
}

async function post(
  port: number,
  payload: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: string; headers: Headers }> {
  const response = await fetch(`http://127.0.0.1:${port}/api/markdown-studio/wechat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(payload),
  });
  return { status: response.status, body: await response.text(), headers: response.headers };
}

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mdstudio-images-'));
const service = new ImageHostService({ storageDir: tempDir });
const route = createImageRoute({ service });
const routeServer = await listen((req, res) => {
  void route(req, res);
});
let local: Awaited<ReturnType<typeof startLocalImageServer>> = null;

try {
  local = await startLocalImageServer({ service, ports: [0] });
  assert.ok(local, 'local image server starts');
  const localHandle = local;

  await check('resolveStorageDir creates the isolated plugin storage directory cleanly', async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'mdstudio-home-'));
    try {
      const resolved = resolveStorageDir(home);
      assert.equal(resolved, path.join(home, 'storages', 'dsh-markdown-studio'));
      const stat = await fs.stat(resolved);
      assert.ok(stat.isDirectory());
    } finally {
      await fs.rm(home, { recursive: true, force: true });
    }
  });

  await check('unlisted asset files remain hidden from the asset index', async () => {
    const detached = await fs.mkdtemp(path.join(os.tmpdir(), 'mdstudio-orphan-'));
    try {
      const fresh = new ImageHostService({ storageDir: detached });
      assert.deepEqual((await fresh.listAssets()).assets, []);
      await fs.mkdir(path.join(detached, 'assets'));
      await fs.writeFile(path.join(detached, 'assets', 'bbbbbbbbbbbbbbbbbbbbbbbb.jpg'), 'orphan');
      assert.deepEqual((await fresh.listAssets()).assets, []);
    } finally {
      await fs.rm(detached, { recursive: true, force: true });
    }
  });

  await check('image data parser accepts PNG and rejects invalid or oversized data', async () => {
    const parsed = parseDataUrl(IMAGE);
    assert.equal(parsed.mime, 'image/png');
    assert.ok(parsed.buffer.length > 0);
    assert.throws(
      () => parseDataUrl('not-an-image'),
      (error: unknown) => error instanceof ImageHostError && error.code === 'INVALID_IMAGE',
    );
    const spoofed = 'data:image/png;base64,' + Buffer.from('not-png-bytes').toString('base64');
    assert.throws(
      () => parseDataUrl(spoofed),
      (error: unknown) => error instanceof ImageHostError && error.code === 'INVALID_IMAGE',
    );
    const jpeg = 'data:image/jpeg;base64,' + Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64');
    assert.equal(parseDataUrl(jpeg).mime, 'image/jpeg');
    const oversized = 'data:image/png;base64,' + Buffer.alloc(MAX_IMAGE_BYTES + 1).toString('base64');
    assert.throws(
      () => parseDataUrl(oversized),
      (error: unknown) => error instanceof ImageHostError && error.code === 'IMAGE_TOO_LARGE',
    );
  });

  await check('assets are content-addressed, deduped, listed and deleted', async () => {
    const first = await service.storeAsset({ dataUrl: IMAGE, filename: 'shot.png' });
    assert.match(first.assetPath, /^assets\/[a-f0-9]{24}\.png$/);
    assert.equal(first.localUrl, `${localHandle.info.url}/uploads/${first.filename}`);
    const second = await service.storeAsset({ dataUrl: IMAGE, filename: 'other.png' });
    assert.equal(second.assetPath, first.assetPath, 'identical bytes reuse the asset');
    const listed = await service.listAssets();
    assert.equal(listed.assets.length, 1);
    assert.equal(listed.assets[0].assetPath, first.assetPath);
    await service.deleteAsset({ assetPath: first.assetPath });
    assert.equal((await service.listAssets()).assets.length, 0);
    assert.equal(await service.readAsset(first.filename), null);
  });

  await check('parallel asset stores do not lose manifest entries', async () => {
    const alternate =
      'data:image/png;base64,' + Buffer.concat([Buffer.from(PNG, 'base64'), Buffer.from('alt')]).toString('base64');
    const [first, second] = await Promise.all([
      service.storeAsset({ dataUrl: IMAGE }),
      service.storeAsset({ dataUrl: alternate }),
    ]);
    const listed = await service.listAssets();
    assert.ok(listed.assets.some((asset) => asset.filename === first.filename));
    assert.ok(listed.assets.some((asset) => asset.filename === second.filename));
    await service.deleteAsset({ filename: first.filename });
    await service.deleteAsset({ filename: second.filename });
    assert.equal((await service.listAssets()).assets.length, 0);
  });

  await check('built-in sample image is served before the user stores anything', async () => {
    const sample = await service.readAsset(SAMPLE_IMAGE_FILENAME);
    assert.ok(sample && sample.buffer.length > 1000, 'sample image is available');
    const response = await fetch(`${localHandle.info.url}/uploads/${SAMPLE_IMAGE_FILENAME}`);
    assert.equal(response.status, 200);
    assert.equal(
      response.headers.get('content-type'),
      SAMPLE_IMAGE_FILENAME.endsWith('.png') ? 'image/png' : 'image/jpeg',
    );
  });

  await check('local loopback server serves only the content-addressed image', async () => {
    const stored = await service.storeAsset({ dataUrl: IMAGE });
    const response = await fetch(`${localHandle.info.url}/uploads/${stored.filename}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/png');
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.ok(bytes.length > 0);
    const head = await fetch(`${localHandle.info.url}/uploads/${stored.filename}`, { method: 'HEAD' });
    assert.equal(head.status, 200);
    const missing = await fetch(`${localHandle.info.url}/uploads/deadbeefdeadbeefdeadbeef.png`);
    assert.equal(missing.status, 404);
    const health = await fetch(`${localHandle.info.url}/health`);
    assert.equal(health.status, 200);
    assert.equal(((await health.json()) as { service: string }).service, 'markdown-studio-images');
  });

  await check('action route accepts loopback JSON and rejects foreign origins', async () => {
    const health = await post(routeServer.port, { action: 'health' }, { origin: 'dsh-app://harness' });
    assert.equal(health.status, 200);
    const healthBody = JSON.parse(health.body) as {
      ok: boolean;
      service: string;
      version: number;
      localServerPort: number;
    };
    assert.equal(healthBody.ok, true);
    assert.equal(healthBody.service, 'markdown-studio-images');
    assert.equal(healthBody.version, 5);
    assert.equal(healthBody.localServerPort, localHandle.info.port);

    const foreign = await post(routeServer.port, { action: 'health' }, { origin: 'https://evil.example' });
    assert.equal(foreign.status, 403);
    assert.equal((JSON.parse(foreign.body) as { error: { code: string } }).error.code, 'ORIGIN_REJECTED');

    const malformedOrigin = await post(routeServer.port, { action: 'health' }, { origin: '::not-a-valid-origin::' });
    assert.equal(malformedOrigin.status, 403);
    assert.equal((JSON.parse(malformedOrigin.body) as { error: { code: string } }).error.code, 'ORIGIN_REJECTED');

    const wrongType = await fetch(`http://127.0.0.1:${routeServer.port}/api/markdown-studio/wechat`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: '{}',
    });
    assert.equal(wrongType.status, 415);

    const smuggledType = await fetch(`http://127.0.0.1:${routeServer.port}/api/markdown-studio/wechat`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain; x=application/json' },
      body: '{"action":"health"}',
    });
    assert.equal(smuggledType.status, 415, 'CORS-simple text/plain cannot masquerade as JSON');

    const nullOrigin = await post(routeServer.port, { action: 'health' }, { origin: 'null' });
    assert.equal(nullOrigin.status, 403, 'opaque null origin without Sec-Fetch-Site is rejected');
    const vouchedNull = await post(
      routeServer.port,
      { action: 'health' },
      { origin: 'null', 'sec-fetch-site': 'same-origin' },
    );
    assert.equal(vouchedNull.status, 200, 'null origin vouched by Sec-Fetch-Site same-origin is allowed');
  });

  await check('action route stores, lists and deletes assets', async () => {
    const stored = await post(routeServer.port, { action: 'asset.store', dataUrl: IMAGE, filename: 'route.png' });
    assert.equal(stored.status, 200);
    const storedBody = JSON.parse(stored.body) as { ok: boolean; assetPath: string; filename: string };
    assert.equal(storedBody.ok, true);
    assert.match(storedBody.assetPath, /^assets\//);

    const listed = await post(routeServer.port, { action: 'asset.list' });
    const listedBody = JSON.parse(listed.body) as { assets: Array<{ filename: string; assetPath: string }> };
    assert.ok(listedBody.assets.some((asset) => asset.filename === storedBody.filename));

    const deleted = await post(routeServer.port, { action: 'asset.delete', filename: storedBody.filename });
    assert.equal(deleted.status, 200);
    const after = await post(routeServer.port, { action: 'asset.list' });
    assert.equal((JSON.parse(after.body) as { assets: unknown[] }).assets.length, 0);
  });

  await check('action and asset routes reject wrong methods and prefixes', async () => {
    const getAction = await fetch(`http://127.0.0.1:${routeServer.port}/api/markdown-studio/wechat`);
    assert.equal(getAction.status, 405);
    const assetServer = await listen((req, res) => {
      void createAssetRoute({ service })(req, res);
    });
    const postAsset = await fetch(`http://127.0.0.1:${assetServer.port}${ASSET_PREFIX}deadbeefdeadbeefdeadbeef.png`, {
      method: 'POST',
    });
    assert.equal(postAsset.status, 405);
    const wrongPrefix = await fetch(`http://127.0.0.1:${assetServer.port}/not-assets/x.png`);
    assert.equal(wrongPrefix.status, 404);
    assetServer.server.close();
  });

  await check('image route rejects non-loopback and handles internal errors', async () => {
    const fakeResponse = () => {
      const state = { status: 0, body: '', headersSent: false };
      const res = {
        statusCode: 0,
        headersSent: false,
        setHeader(): void {},
        writeHead(code: number): void {
          state.status = code;
        },
        end(value?: unknown): void {
          state.body = String(value || '');
        },
      } as unknown as http.ServerResponse;
      return { res, state };
    };
    const foreign = fakeResponse();
    const foreignReq = {
      method: 'POST',
      socket: { remoteAddress: '10.0.0.2' },
      headers: {},
    } as unknown as http.IncomingMessage;
    await route(foreignReq, foreign.res);
    assert.equal((foreign.res as http.ServerResponse).statusCode, 403);
    assert.match(foreign.state.body, /LOOPBACK_ONLY/);

    const badService = {
      info(): never {
        throw new Error('boom');
      },
    } as unknown as ImageHostService;
    const badRoute = createImageRoute({ service: badService });
    const internal = fakeResponse();
    const request = Readable.from([Buffer.from('{"action":"health"}')]) as unknown as http.IncomingMessage;
    request.method = 'POST';
    request.headers = { host: '127.0.0.1', origin: 'dsh-app://harness', 'content-type': 'application/json' };
    Object.defineProperty(request, 'socket', { value: { remoteAddress: '127.0.0.1' } });
    await badRoute(request, internal.res);
    assert.equal((internal.res as http.ServerResponse).statusCode, 500);
    assert.match(internal.state.body, /INTERNAL/);
    assert.equal(internal.state.body.includes('boom'), false, '500 response does not leak raw internal error text');
  });

  await check('Mermaid chunk is served as JavaScript', async () => {
    const mermaidServer = await listen((req, res) => {
      void mermaidRoute(req, res);
    });
    const response = await fetch(`http://127.0.0.1:${mermaidServer.port}${MERMAID_PATH}`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') || '', /javascript/);
    assert.ok((await response.arrayBuffer()).byteLength > 1_000_000);
    mermaidServer.server.close();
  });

  await check('MathJax chunk is served as JavaScript', async () => {
    const mathServer = await listen((req, res) => {
      void mathRoute(req, res);
    });
    const response = await fetch(`http://127.0.0.1:${mathServer.port}${MATH_PATH}`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') || '', /javascript/);
    assert.ok((await response.arrayBuffer()).byteLength > 100_000);
    mathServer.server.close();
  });

  await check('authenticated asset route serves HEAD and rejects missing files', async () => {
    const stored = await service.storeAsset({ dataUrl: IMAGE });
    const assetServer = await listen((req, res) => {
      void createAssetRoute({ service })(req, res);
    });
    const response = await fetch(`http://127.0.0.1:${assetServer.port}${stored.assetUrl}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/png');
    const missing = await fetch(`http://127.0.0.1:${assetServer.port}${ASSET_PREFIX}deadbeefdeadbeefdeadbeef.png`);
    assert.equal(missing.status, 404);
    assetServer.server.close();
  });

  await check('unknown actions and malformed JSON return structured errors', async () => {
    const unknown = await post(routeServer.port, { action: 'config.save' });
    assert.equal(unknown.status, 400);
    assert.equal((JSON.parse(unknown.body) as { error: { code: string } }).error.code, 'UNKNOWN_ACTION');

    const malformed = await fetch(`http://127.0.0.1:${routeServer.port}/api/markdown-studio/wechat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{bad',
    });
    assert.equal(malformed.status, 200);
    assert.equal(((await malformed.json()) as { error: { code: string } }).error.code, 'BAD_JSON');
  });

  await check('binary SHA-256 distinguishes distinct non-UTF-8 PNG bytes without U+FFFD collision', async () => {
    const base = Buffer.from(IMAGE.split(',')[1], 'base64');
    const imgA = Buffer.concat([base, Buffer.from([0x80, 0xfe, 0x91])]);
    const imgB = Buffer.concat([base, Buffer.from([0x81, 0xff, 0x92])]);
    const a = await service.storeAsset({ dataUrl: `data:image/png;base64,${imgA.toString('base64')}` });
    const b = await service.storeAsset({ dataUrl: `data:image/png;base64,${imgB.toString('base64')}` });
    assert.notEqual(a.filename, b.filename, 'distinct binary payloads hash to distinct asset filenames');
  });

  await check('desktop origin allowlist accepts dsh-app:// and rejects arbitrary custom schemes', async () => {
    const allowed = await fetch(`http://127.0.0.1:${routeServer.port}/api/markdown-studio/wechat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'dsh-app://main' },
      body: JSON.stringify({ action: 'health' }),
    });
    assert.equal(allowed.status, 200);
    const blocked = await fetch(`http://127.0.0.1:${routeServer.port}/api/markdown-studio/wechat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'evil-scheme://attacker' },
      body: JSON.stringify({ action: 'health' }),
    });
    assert.equal(blocked.status, 403);
  });

  await check('asset route handles HEAD requests and internal errors safely', async () => {
    const stored = await service.storeAsset({ dataUrl: IMAGE });
    const failingService = {
      ...service,
      readAsset: async (name: string) => {
        if (name === 'boom.png') throw new Error('disk failure');
        return service.readAsset(name);
      },
    } as unknown as ImageHostService;
    const assetServer = await listen((req, res) => {
      void createAssetRoute({ service: failingService })(req, res);
    });
    const headOk = await fetch(`http://127.0.0.1:${assetServer.port}${stored.assetUrl}`, { method: 'HEAD' });
    assert.equal(headOk.status, 200);
    const headErr = await fetch(`http://127.0.0.1:${assetServer.port}${ASSET_PREFIX}boom.png`, { method: 'HEAD' });
    assert.equal(headErr.status, 500);
    assert.equal(await headErr.text(), '');
    const getErr = await fetch(`http://127.0.0.1:${assetServer.port}${ASSET_PREFIX}boom.png`);
    assert.equal(getErr.status, 500);
    assetServer.server.close();
  });

  await check(
    'math, mermaid, and local server enforce loopback Host, HEAD semantics, and 8-byte PNG signature',
    async () => {
      const truncatedPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x00, 0x00]).toString('base64');
      assert.throws(() => parseDataUrl(`data:image/png;base64,${truncatedPng}`), ImageHostError);

      const requestWithHost = (port: number, reqPath: string, method: string, hostHeader: string) =>
        new Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
          const req = http.request(
            { host: '127.0.0.1', port, path: reqPath, method, headers: { host: hostHeader } },
            (res) => {
              const chunks: Buffer[] = [];
              res.on('data', (c) => chunks.push(Buffer.from(c)));
              res.on('end', () =>
                resolve({
                  status: res.statusCode || 0,
                  body: Buffer.concat(chunks).toString('utf8'),
                  headers: res.headers,
                }),
              );
            },
          );
          req.on('error', reject);
          req.end();
        });

      const mathServer = await listen((req, res) => {
        void mathRoute(req, res);
      });
      const mermaidServer = await listen((req, res) => {
        void mermaidRoute(req, res);
      });
      try {
        assert.equal(
          (await requestWithHost(mathServer.port, MATH_PATH, 'HEAD', `127.0.0.1:${mathServer.port}`)).status,
          200,
        );
        assert.equal(
          (await requestWithHost(mathServer.port, MATH_PATH, 'POST', `127.0.0.1:${mathServer.port}`)).status,
          405,
        );
        assert.equal((await requestWithHost(mathServer.port, MATH_PATH, 'GET', 'evil.example:80')).status, 403);

        assert.equal(
          (await requestWithHost(mermaidServer.port, MERMAID_PATH, 'HEAD', `127.0.0.1:${mermaidServer.port}`)).status,
          200,
        );
        assert.equal(
          (await requestWithHost(mermaidServer.port, MERMAID_PATH, 'POST', `127.0.0.1:${mermaidServer.port}`)).status,
          405,
        );
        assert.equal((await requestWithHost(mermaidServer.port, MERMAID_PATH, 'GET', 'evil.example:80')).status, 403);

        assert.ok(local, 'local server is active');
        const localPort = local.info.port;
        const healthGet = await requestWithHost(localPort, '/health', 'GET', `127.0.0.1:${localPort}`);
        assert.equal(healthGet.status, 200);
        assert.equal(healthGet.headers['access-control-allow-origin'], undefined, '/health omits wildcard ACAO');
        const healthHead = await requestWithHost(localPort, '/health', 'HEAD', `127.0.0.1:${localPort}`);
        assert.equal(healthHead.status, 200);
        assert.equal(healthHead.body, '');
        const localRebind = await requestWithHost(localPort, '/health', 'GET', 'evil.example:80');
        assert.equal(localRebind.status, 403, 'local server rejects non-loopback Host header');
        const missingHead = await requestWithHost(
          localPort,
          '/uploads/not-found.png',
          'HEAD',
          `127.0.0.1:${localPort}`,
        );
        assert.equal(missingHead.status, 404);
        assert.equal(missingHead.body, '');
      } finally {
        mathServer.server.close();
        mermaidServer.server.close();
      }
    },
  );
} finally {
  routeServer.server.close();
  if (local) await local.stop();
  await fs.rm(tempDir, { recursive: true, force: true });
}

console.log(`\n${checks} image-host checks passed.`);

import assert from 'node:assert/strict';
import { createZipStreamWriter, unzipEntries, ZIP_LIMITS } from '../src/adapters/zip';

const chunks: Uint8Array[] = [];
let closed = false;
const writer = createZipStreamWriter({
  async write(data: Uint8Array) {
    chunks.push(data.slice());
  },
  async close() {
    closed = true;
  },
});
const encoder = new TextEncoder();
await writer.add('article.md', encoder.encode('# Stream\n'));
await writer.add('assets/' + '0123456789abcdef01234567' + '.png', new Uint8Array([1, 2, 3, 4]));
await writer.close();
assert.equal(closed, true, 'stream writer closes the sink');
const size = chunks.reduce((total, chunk) => total + chunk.length, 0);
const bytes = new Uint8Array(size);
let at = 0;
for (const chunk of chunks) {
  bytes.set(chunk, at);
  at += chunk.length;
}
const entries = await unzipEntries(bytes.buffer);
assert.deepEqual(
  entries.map((entry) => entry.name),
  ['article.md', 'assets/0123456789abcdef01234567.png'],
);
assert.equal(new TextDecoder().decode(entries[0].data), '# Stream\n');
assert.deepEqual(Array.from(entries[1].data), [1, 2, 3, 4]);
await assert.rejects(() => writer.add('late.txt', encoder.encode('x')), /closed/);
console.log('6 streaming ZIP checks passed.');

const largeChunks: Uint8Array[] = [];
const largeWriter = createZipStreamWriter({
  write: async (chunk) => {
    largeChunks.push(chunk.slice());
  },
  close: async () => {},
});
for (let i = 0; i < 502; i++) await largeWriter.add('asset-' + i, new Uint8Array([i % 256]));
await largeWriter.close();
assert.equal((await unzipEntries(await new Blob(largeChunks as unknown as BlobPart[]).arrayBuffer())).length, 502);
const bounded = createZipStreamWriter({ write: async () => {}, close: async () => {} });
for (let i = 0; i < ZIP_LIMITS.entries; i++) await bounded.add(String(i), new Uint8Array());
await assert.rejects(() => bounded.add('overflow', new Uint8Array()), /ZIP_LIMIT_EXCEEDED/);
console.log('ok - streaming archives use the same read/write entry budget');

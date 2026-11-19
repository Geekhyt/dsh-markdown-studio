import assert from 'node:assert/strict';
import { crc32, deflateRawSync } from 'node:zlib';
import { assertZipBudget, unzipEntries, ZIP_LIMITS, zipStore } from '../src/adapters/zip';
import { bytesToBase64 } from '../src/domain/base64';

const encoder = new TextEncoder();
const entries = [
  { name: 'article.md', data: encoder.encode('# Hello\n') },
  { name: 'assets/a.png', data: new Uint8Array([137, 80, 78, 71]) },
];
const blob = zipStore(entries);
const parsed = await unzipEntries(await blob.arrayBuffer());
assert.equal(parsed.length, 2, 'all entries round-trip');
assert.equal(parsed[0].name, 'article.md');
assert.equal(new TextDecoder().decode(parsed[0].data), '# Hello\n');
assert.deepEqual(Array.from(parsed[1].data), [137, 80, 78, 71]);
assert.equal(bytesToBase64(new Uint8Array([65, 66, 67])), 'QUJD');
await assert.rejects(() => unzipEntries(new ArrayBuffer(8)), /not a zip file/);

function makeZip(name: string, text: string, method = 8): ArrayBuffer {
  const nameBytes = encoder.encode(name);
  const raw = encoder.encode(text);
  const compressed = method === 8 ? new Uint8Array(deflateRawSync(Buffer.from(raw))) : raw;
  const crc = crc32(Buffer.from(raw)) >>> 0;
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6);
  local.writeUInt16LE(method, 8);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(raw.length, 22);
  local.writeUInt16LE(nameBytes.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(method, 10);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(raw.length, 24);
  central.writeUInt16LE(nameBytes.length, 28);
  central.writeUInt32LE(0, 42);
  const centralOffset = local.length + nameBytes.length + compressed.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + nameBytes.length, 12);
  end.writeUInt32LE(centralOffset, 16);
  const output = Buffer.concat([
    local,
    Buffer.from(nameBytes),
    Buffer.from(compressed),
    central,
    Buffer.from(nameBytes),
    end,
  ]);
  return output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength) as ArrayBuffer;
}

const deflated = await unzipEntries(makeZip('deflated.md', '# Deflated\n'));
assert.equal(new TextDecoder().decode(deflated[0].data), '# Deflated\n');
await assert.rejects(() => unzipEntries(makeZip('bad.md', 'x', 99)), /unsupported zip compression/);
await assert.rejects(() => unzipEntries(new ArrayBuffer(40)), /not a zip file/);
const stored = await unzipEntries(makeZip('stored.md', '# Stored\n', 0));
assert.equal(new TextDecoder().decode(stored[0].data), '# Stored\n');
const directoryEntry = await unzipEntries(makeZip('folder/', '', 0));
assert.equal(directoryEntry.length, 0, 'directory entries are skipped');

const valid = Buffer.from(makeZip('valid.md', '# Valid\n'));
const centralAt = valid.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
const corruptDirectory = Buffer.from(valid);
corruptDirectory.writeUInt32LE(0, centralAt);
await assert.rejects(
  () =>
    unzipEntries(
      corruptDirectory.buffer.slice(
        corruptDirectory.byteOffset,
        corruptDirectory.byteOffset + corruptDirectory.byteLength,
      ) as ArrayBuffer,
    ),
  /corrupt zip directory/,
);

const truncated = valid.subarray(0, valid.length - 10);
await assert.rejects(
  () =>
    unzipEntries(
      truncated.buffer.slice(truncated.byteOffset, truncated.byteOffset + truncated.byteLength) as ArrayBuffer,
    ),
  /corrupt zip|not a zip file/,
);

const tooMany = Buffer.from(valid);
const eocdAt = tooMany.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
tooMany.writeUInt16LE(ZIP_LIMITS.entries + 1, eocdAt + 10);
await assert.rejects(
  () => unzipEntries(tooMany.buffer.slice(tooMany.byteOffset, tooMany.byteOffset + tooMany.byteLength) as ArrayBuffer),
  /ZIP_LIMIT_EXCEEDED/,
);

console.log('14 zip checks passed.');

for (const images of [198, 199, 200, 500]) {
  const large = [
    ...entries,
    ...Array.from({ length: images }, (_, i) => ({ name: 'assets/' + i + '.png', data: new Uint8Array([i % 256]) })),
  ];
  const restored = await unzipEntries(await zipStore(large).arrayBuffer());
  assert.deepEqual(restored, large, 'large archives round-trip beyond the former 200-entry limit');
}
const dishonest = Buffer.from(makeZip('large.md', 'x'.repeat(100_000)));
const dishonestCentral = dishonest.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
dishonest.writeUInt32LE(1, dishonestCentral + 24);
await assert.rejects(
  () =>
    unzipEntries(
      dishonest.buffer.slice(dishonest.byteOffset, dishonest.byteOffset + dishonest.byteLength) as ArrayBuffer,
    ),
  /ZIP_LIMIT_EXCEEDED/,
  'actual inflate output is bounded before allocation completes',
);
assert.throws(() => assertZipBudget(1, ZIP_LIMITS.totalBytes + 1), /ZIP_LIMIT_EXCEEDED/);
assert.throws(() => assertZipBudget(1, 0, ZIP_LIMITS.entryBytes + 1), /ZIP_LIMIT_EXCEEDED/);
assert.throws(
  () =>
    zipStore(Array.from({ length: ZIP_LIMITS.entries + 1 }, (_, i) => ({ name: String(i), data: new Uint8Array() }))),
  /ZIP_LIMIT_EXCEEDED/,
);
const badCrc = Buffer.from(makeZip('bad-crc.md', 'hello', 0));
badCrc[30 + 'bad-crc.md'.length] ^= 1;
await assert.rejects(
  () => unzipEntries(badCrc.buffer.slice(badCrc.byteOffset, badCrc.byteOffset + badCrc.byteLength) as ArrayBuffer),
  /corrupt zip content/,
);
console.log('ok - ZIP large round trips, shared budgets and bounded decompression');

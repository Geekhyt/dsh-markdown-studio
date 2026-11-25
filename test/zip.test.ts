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

// Zip-Slip path traversal rejection
const traversal = Buffer.from(makeZip('../evil.md', 'pwn', 0));
await assert.rejects(
  () =>
    unzipEntries(
      traversal.buffer.slice(traversal.byteOffset, traversal.byteOffset + traversal.byteLength) as ArrayBuffer,
    ),
  /unsafe zip path/,
);

// Encrypted local file header flag rejection
const encrypted = Buffer.from(makeZip('secret.md', 'hello', 0));
encrypted.writeUInt16LE(1, 6);
await assert.rejects(
  () =>
    unzipEntries(
      encrypted.buffer.slice(encrypted.byteOffset, encrypted.byteOffset + encrypted.byteLength) as ArrayBuffer,
    ),
  /encrypted zip/,
);

// Mismatched LFH compression method rejection
const badMethod = Buffer.from(makeZip('method.md', 'hello', 0));
badMethod.writeUInt16LE(8, 8);
await assert.rejects(
  () =>
    unzipEntries(
      badMethod.buffer.slice(badMethod.byteOffset, badMethod.byteOffset + badMethod.byteLength) as ArrayBuffer,
    ),
  /corrupt zip entry/,
);

// Overlapping local entry ranges (zip-bomb aliasing) rejection
const twoEntries = Buffer.from(
  await zipStore([
    { name: 'a.md', data: new TextEncoder().encode('hello') },
    { name: 'b.md', data: new TextEncoder().encode('world') },
  ]).arrayBuffer(),
);
const firstCd = twoEntries.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
const secondCd = twoEntries.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), firstCd + 4);
twoEntries.writeUInt32LE(0, secondCd + 42); // alias second entry to offset 0
await assert.rejects(
  () =>
    unzipEntries(
      twoEntries.buffer.slice(twoEntries.byteOffset, twoEntries.byteOffset + twoEntries.byteLength) as ArrayBuffer,
    ),
  /corrupt zip/,
);

// High compression ratio (>100:1 over 1 MiB) bomb rejection
const bomb = Buffer.from(makeZip('bomb.md', 'A'.repeat(1_200_000), 8));
await assert.rejects(
  () => unzipEntries(bomb.buffer.slice(bomb.byteOffset, bomb.byteOffset + bomb.byteLength) as ArrayBuffer),
  /ZIP_LIMIT_EXCEEDED/,
);

// Split-entry aggregate compression ratio bomb rejection (2 entries × 1 MiB <= single-entry threshold)
const splitChunk = Buffer.alloc(1024 * 1024);
const deflatedChunk = deflateRawSync(splitChunk);
const splitCrc = crc32(splitChunk);
const splitParts: Buffer[] = [];
const splitCentral: Buffer[] = [];
let splitOffset = 0;
for (let idx = 0; idx < 2; idx++) {
  const nameBuf = Buffer.from(`chunk-${idx}.bin`);
  const lfh = Buffer.alloc(30);
  lfh.writeUInt32LE(0x04034b50, 0);
  lfh.writeUInt16LE(20, 4);
  lfh.writeUInt16LE(8, 8);
  lfh.writeUInt32LE(splitCrc, 14);
  lfh.writeUInt32LE(deflatedChunk.length, 18);
  lfh.writeUInt32LE(splitChunk.length, 22);
  lfh.writeUInt16LE(nameBuf.length, 26);
  const cdh = Buffer.alloc(46);
  cdh.writeUInt32LE(0x02014b50, 0);
  cdh.writeUInt16LE(20, 4);
  cdh.writeUInt16LE(20, 6);
  cdh.writeUInt16LE(8, 10);
  cdh.writeUInt32LE(splitCrc, 16);
  cdh.writeUInt32LE(deflatedChunk.length, 20);
  cdh.writeUInt32LE(splitChunk.length, 24);
  cdh.writeUInt16LE(nameBuf.length, 28);
  cdh.writeUInt32LE(splitOffset, 42);
  splitParts.push(lfh, nameBuf, deflatedChunk);
  splitCentral.push(cdh, nameBuf);
  splitOffset += lfh.length + nameBuf.length + deflatedChunk.length;
}
const splitCentralBuf = Buffer.concat(splitCentral);
const splitEocd = Buffer.alloc(22);
splitEocd.writeUInt32LE(0x06054b50, 0);
splitEocd.writeUInt16LE(2, 8);
splitEocd.writeUInt16LE(2, 10);
splitEocd.writeUInt32LE(splitCentralBuf.length, 12);
splitEocd.writeUInt32LE(splitOffset, 16);
const splitBomb = Buffer.concat([...splitParts, splitCentralBuf, splitEocd]);
await assert.rejects(
  () =>
    unzipEntries(
      splitBomb.buffer.slice(splitBomb.byteOffset, splitBomb.byteOffset + splitBomb.byteLength) as ArrayBuffer,
    ),
  /ZIP_LIMIT_EXCEEDED/,
  'aggregate archive compression ratio guard rejects split <=1 MiB zip bombs',
);

// Darwin (macOS versionMadeBy host OS = 19) symlink entry must be skipped just like Unix (3) symlinks
const darwinSymBuf = Buffer.from(
  await zipStore([{ name: 'link.txt', data: new TextEncoder().encode('/etc/passwd') }]).arrayBuffer(),
);
const darwinCd = darwinSymBuf.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
assert.ok(darwinCd >= 0, 'central directory header located');
darwinSymBuf.writeUInt16LE((19 << 8) | 20, darwinCd + 4);
darwinSymBuf.writeUInt32LE((0o120777 << 16) >>> 0, darwinCd + 38);
const darwinEntries = await unzipEntries(
  darwinSymBuf.buffer.slice(darwinSymBuf.byteOffset, darwinSymBuf.byteOffset + darwinSymBuf.byteLength) as ArrayBuffer,
);
assert.equal(darwinEntries.length, 0, 'Darwin (OS=19) symlink entry is skipped cleanly');

console.log('ok - ZIP large round trips, shared budgets and bounded decompression');

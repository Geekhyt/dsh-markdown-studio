export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

/** Shared read/write budgets. Limits apply to actual inflated bytes as well as metadata. */
export const ZIP_LIMITS = {
  entries: 4096,
  entryBytes: 50 * 1024 * 1024,
  totalBytes: 256 * 1024 * 1024,
  archiveBytes: 300 * 1024 * 1024,
  nameBytes: 4096,
} as const;

export function assertZipBudget(count: number, total: number, size = 0, nameBytes = 0): void {
  if (
    count > ZIP_LIMITS.entries ||
    total > ZIP_LIMITS.totalBytes ||
    size > ZIP_LIMITS.entryBytes ||
    nameBytes > ZIP_LIMITS.nameBytes
  ) {
    throw new Error('ZIP_LIMIT_EXCEEDED');
  }
}

let crcTable: number[] | null = null;

export function crc32(bytes: Uint8Array): number {
  let table = crcTable;
  if (!table) {
    table = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    crcTable = table;
  }
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index++) crc = table[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff];
}

function u32(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}

export interface ZipStreamWriter {
  add(name: string, data: Uint8Array): Promise<void>;
  close(): Promise<void>;
}

interface WritableLike {
  write(data: Uint8Array): Promise<unknown>;
  close(): Promise<unknown>;
}

/** Stream a store-only ZIP to a writable target, keeping only central metadata. */
export function createZipStreamWriter(sink: WritableLike): ZipStreamWriter {
  const encoder = new TextEncoder();
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const centrals: Array<{ name: Uint8Array; crc: number; size: number; offset: number }> = [];
  let offset = 0;
  let closed = false;
  let totalBytes = 0;
  let queue: Promise<void> = Promise.resolve();

  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = queue.then(task, task);
    queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  return {
    add(name, data) {
      return enqueue(async () => {
        if (closed) throw new Error('zip stream is closed');
        const encoded = encoder.encode(name);
        assertZipBudget(centrals.length + 1, totalBytes + data.length, data.length, encoded.length);
        const crc = crc32(data);
        const local = new Uint8Array([
          ...u32(0x04034b50),
          ...u16(20),
          ...u16(0x0800),
          ...u16(0),
          ...u16(dosTime),
          ...u16(dosDate),
          ...u32(crc),
          ...u32(data.length),
          ...u32(data.length),
          ...u16(encoded.length),
          ...u16(0),
        ]);
        const entryOffset = offset;
        try {
          await sink.write(local);
          await sink.write(encoded);
          await sink.write(data);
        } catch (error) {
          closed = true;
          throw error;
        }
        totalBytes += data.length;
        centrals.push({ name: encoded, crc, size: data.length, offset: entryOffset });
        offset += local.length + encoded.length + data.length;
      });
    },
    close() {
      return enqueue(async () => {
        if (closed) return;
        closed = true;
        const centralOffset = offset;
        let centralSize = 0;
        for (const entry of centrals) {
          const header = new Uint8Array([
            ...u32(0x02014b50),
            ...u16(20),
            ...u16(20),
            ...u16(0x0800),
            ...u16(0),
            ...u16(dosTime),
            ...u16(dosDate),
            ...u32(entry.crc),
            ...u32(entry.size),
            ...u32(entry.size),
            ...u16(entry.name.length),
            ...u16(0),
            ...u16(0),
            ...u16(0),
            ...u16(0),
            ...u32(0),
            ...u32(entry.offset),
          ]);
          await sink.write(header);
          await sink.write(entry.name);
          centralSize += header.length + entry.name.length;
        }
        await sink.write(
          new Uint8Array([
            ...u32(0x06054b50),
            ...u16(0),
            ...u16(0),
            ...u16(centrals.length),
            ...u16(centrals.length),
            ...u32(centralSize),
            ...u32(centralOffset),
            ...u16(0),
          ]),
        );
        await sink.close();
      });
    },
  };
}

export function zipStore(entries: ZipEntry[]): Blob {
  const encoder = new TextEncoder();
  let totalBytes = 0;
  for (const entry of entries) {
    totalBytes += entry.data.length;
    assertZipBudget(entries.length, totalBytes, entry.data.length, encoder.encode(entry.name).length);
  }
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const locals: Uint8Array[] = [];
  const centrals: Array<{ name: Uint8Array; crc: number; size: number; offset: number }> = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const data = entry.data;
    const crc = crc32(data);
    const local = new Uint8Array([
      ...u32(0x04034b50),
      ...u16(20),
      ...u16(0x0800),
      ...u16(0),
      ...u16(dosTime),
      ...u16(dosDate),
      ...u32(crc),
      ...u32(data.length),
      ...u32(data.length),
      ...u16(name.length),
      ...u16(0),
    ]);
    locals.push(local, name, data);
    centrals.push({ name, crc, size: data.length, offset });
    offset += local.length + name.length + data.length;
  }

  const centralOffset = offset;
  let centralSize = 0;
  const centralChunks: Uint8Array[] = [];
  for (const entry of centrals) {
    const header = new Uint8Array([
      ...u32(0x02014b50),
      ...u16(20),
      ...u16(20),
      ...u16(0x0800),
      ...u16(0),
      ...u16(dosTime),
      ...u16(dosDate),
      ...u32(entry.crc),
      ...u32(entry.size),
      ...u32(entry.size),
      ...u16(entry.name.length),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u32(0),
      ...u32(entry.offset),
    ]);
    centralChunks.push(header, entry.name);
    centralSize += header.length + entry.name.length;
  }

  const end = new Uint8Array([
    ...u32(0x06054b50),
    ...u16(0),
    ...u16(0),
    ...u16(entries.length),
    ...u16(entries.length),
    ...u32(centralSize),
    ...u32(centralOffset),
    ...u16(0),
  ]);
  return new Blob([...locals, ...centralChunks, end] as unknown as BlobPart[], { type: 'application/zip' });
}

async function inflateRawBytes(bytes: Uint8Array, limit: number): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') throw new Error('deflate-raw is not supported in this browser');
  const reader = new Blob([bytes as unknown as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'))
    .getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > limit) throw new Error('ZIP_LIMIT_EXCEEDED');
      chunks.push(chunk.value);
    }
  } catch (error) {
    await reader.cancel().catch(function () {
      /* preserve the original error */
    });
    throw error;
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

const MAX_ZIP_COMPRESSION_RATIO = 100;
const RATIO_GUARD_MIN_BYTES = 1024 * 1024;

function isUnsafeZipPath(name: string): boolean {
  if (!name) return false;
  if (/[\x00-\x1f]/.test(name)) return true;
  if (name.startsWith('/') || name.startsWith('\\') || /^[a-zA-Z]:/.test(name)) return true;
  return name.split(/[/\\]/).some((segment) => segment === '..');
}

function zipDirectory(view: DataView): { count: number; start: number; end: number } {
  if (view.byteLength > ZIP_LIMITS.archiveBytes) throw new Error('ZIP_LIMIT_EXCEEDED');
  const lowest = Math.max(0, view.byteLength - 65557);
  let end = -1;
  for (let at = view.byteLength - 22; at >= lowest; at--) {
    if (view.getUint32(at, true) === 0x06054b50 && at + 22 + view.getUint16(at + 20, true) === view.byteLength) {
      end = at;
      break;
    }
  }
  if (end < 0) throw new Error('not a zip file');
  const diskEntries = view.getUint16(end + 8, true);
  const count = view.getUint16(end + 10, true);
  const size = view.getUint32(end + 12, true);
  const start = view.getUint32(end + 16, true);
  assertZipBudget(count, 0);
  if (diskEntries !== count || view.getUint16(end + 4, true) || view.getUint16(end + 6, true) || start + size !== end)
    throw new Error('corrupt zip directory');
  return { count, start, end };
}

interface ZipRecord {
  name: string;
  size: number;
  compressed: Uint8Array;
  method: number;
  crc: number;
  isSymlink: boolean;
  rangeStart: number;
  rangeEnd: number;
}

function decodeZipName(bytes: Uint8Array, utf8Flag: boolean): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    if (utf8Flag) throw new Error('corrupt zip filename');
    return new TextDecoder('iso-8859-1').decode(bytes);
  }
}

function zipRecord(
  buffer: ArrayBuffer,
  offset: number,
  directory: { start: number; end: number },
): { entry: ZipRecord; next: number } {
  const view = new DataView(buffer);
  if (offset + 46 > directory.end || view.getUint32(offset, true) !== 0x02014b50)
    throw new Error('corrupt zip directory');
  const versionMadeBy = view.getUint16(offset + 4, true);
  const flags = view.getUint16(offset + 8, true);
  const method = view.getUint16(offset + 10, true);
  const compressedSize = view.getUint32(offset + 20, true);
  const size = view.getUint32(offset + 24, true);
  const nameLength = view.getUint16(offset + 28, true);
  const externalAttr = view.getUint32(offset + 38, true);
  const next = offset + 46 + nameLength + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
  const local = view.getUint32(offset + 42, true);
  assertZipBudget(0, 0, size, nameLength);
  if (next > directory.end || local + 30 > directory.start || view.getUint32(local, true) !== 0x04034b50)
    throw new Error('corrupt zip entry');
  const localFlags = view.getUint16(local + 6, true);
  if (flags & 1 || localFlags & 1) throw new Error('encrypted zip is not supported');
  if (view.getUint16(local + 8, true) !== method) throw new Error('corrupt zip entry');
  const localNameLength = view.getUint16(local + 26, true);
  const start = local + 30 + localNameLength + view.getUint16(local + 28, true);
  if (start + compressedSize > directory.start) throw new Error('corrupt zip data');
  if (size > RATIO_GUARD_MIN_BYTES && compressedSize > 0 && size / compressedSize > MAX_ZIP_COMPRESSION_RATIO) {
    throw new Error('ZIP_LIMIT_EXCEEDED');
  }
  const rawName = decodeZipName(new Uint8Array(buffer, offset + 46, nameLength), Boolean(flags & 0x0800));
  const rawLocalName = decodeZipName(new Uint8Array(buffer, local + 30, localNameLength), Boolean(localFlags & 0x0800));
  if (rawLocalName !== rawName) throw new Error('corrupt zip entry');
  if (isUnsafeZipPath(rawName)) throw new Error('unsafe zip path');
  const name = rawName.replace(/\\/g, '/');
  const unixMode = (externalAttr >>> 16) & 0o170000;
  const isSymlink = versionMadeBy >>> 8 === 3 && unixMode === 0o120000;
  return {
    next,
    entry: {
      name,
      size,
      method,
      compressed: new Uint8Array(buffer, start, compressedSize),
      crc: view.getUint32(offset + 16, true),
      isSymlink,
      rangeStart: local,
      rangeEnd: start + compressedSize,
    },
  };
}

function assertDisjointRanges(records: ZipRecord[]): void {
  const sorted = [...records].sort((a, b) => a.rangeStart - b.rangeStart);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].rangeStart < sorted[i - 1].rangeEnd) throw new Error('corrupt zip overlap');
  }
}

export async function unzipEntries(buffer: ArrayBuffer): Promise<ZipEntry[]> {
  const directory = zipDirectory(new DataView(buffer));
  const records: ZipRecord[] = [];
  let offset = directory.start;
  let total = 0;
  let totalCompressed = 0;
  for (let index = 0; index < directory.count; index++) {
    const record = zipRecord(buffer, offset, directory);
    offset = record.next;
    total += record.entry.size;
    totalCompressed += record.entry.compressed.length;
    assertZipBudget(index + 1, total);
    if (total > RATIO_GUARD_MIN_BYTES && totalCompressed > 0 && total / totalCompressed > MAX_ZIP_COMPRESSION_RATIO) {
      throw new Error('ZIP_LIMIT_EXCEEDED');
    }
    records.push(record.entry);
  }
  if (offset !== directory.end) throw new Error('corrupt zip directory');
  assertDisjointRanges(records);
  const entries: ZipEntry[] = [];
  const names = new Set<string>();
  for (const record of records) {
    let data: Uint8Array;
    if (record.method === 0) {
      if (record.compressed.length !== record.size) throw new Error('corrupt zip size');
      data = record.compressed.slice();
    } else if (record.method === 8) data = await inflateRawBytes(record.compressed, record.size);
    else throw new Error('unsupported zip compression');
    if (data.length !== record.size || crc32(data) !== record.crc) throw new Error('corrupt zip content');
    const normKey = record.name.toLowerCase();
    if (names.has(normKey)) throw new Error('duplicate zip entry');
    names.add(normKey);
    if (!record.isSymlink && record.name && !record.name.endsWith('/')) entries.push({ name: record.name, data });
  }
  return entries;
}

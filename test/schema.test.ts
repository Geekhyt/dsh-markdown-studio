import assert from 'node:assert/strict';
import type { LibraryState } from '../src/domain/article';
import { createLibraryBackup, parseLibraryBackup } from '../src/domain/library-backup';
import {
  ARCHIVE_SCHEMA_VERSION,
  BACKUP_SCHEMA_VERSION,
  isFutureSchema,
  LIBRARY_SCHEMA_VERSION,
  readSchemaVersion,
  supportedSchemaVersion,
} from '../src/domain/schema';
import { DEFAULT_SETTINGS } from '../src/themes';

assert.equal(readSchemaVersion(undefined, 1), 1);
assert.equal(readSchemaVersion(2, 1), 2);
assert.equal(readSchemaVersion(0, 1), null);
assert.equal(readSchemaVersion(1.5, 1), null);
assert.equal(readSchemaVersion('2', 1), 2);
assert.equal(supportedSchemaVersion(3, 1, 2), null, 'future schemas are rejected');
assert.equal(supportedSchemaVersion(undefined, 2, LIBRARY_SCHEMA_VERSION), 2);
assert.equal(isFutureSchema(ARCHIVE_SCHEMA_VERSION + 1, ARCHIVE_SCHEMA_VERSION), true);

const library: LibraryState = {
  activeId: 'a',
  docs: [{ id: 'a', title: 'A', markdown: '# A', settings: { ...DEFAULT_SETTINGS }, view: 'split', updatedAt: 1 }],
};
const backup = createLibraryBackup(library);
assert.equal(backup.schemaVersion, BACKUP_SCHEMA_VERSION);
assert.ok(parseLibraryBackup(JSON.parse(JSON.stringify(backup))));
const legacy = { ...JSON.parse(JSON.stringify(backup)), schemaVersion: undefined };
assert.ok(parseLibraryBackup(legacy), 'backups without schemaVersion remain importable');
const future = { ...JSON.parse(JSON.stringify(backup)), schemaVersion: BACKUP_SCHEMA_VERSION + 1 };
assert.equal(parseLibraryBackup(future), null, 'future backups are rejected');
console.log('12 schema checks passed.');

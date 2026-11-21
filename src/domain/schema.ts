/**
 * Persisted-data schema versions.
 *
 * Increasing a version means old readers may not open the file. Add a
 * migration test fixture and document the change before bumping.
 */
export const LIBRARY_SCHEMA_VERSION = 2;
export const BACKUP_SCHEMA_VERSION = 2;
export const ARCHIVE_SCHEMA_VERSION = 2;

function parseIntegerVersion(value: unknown): number | null {
  if (typeof value === 'number') return Number.isInteger(value) ? value : null;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return Number(value.trim());
  return null;
}

export function readSchemaVersion(value: unknown, fallback: number): number | null {
  if (value === undefined || value === null) return fallback;
  const version = parseIntegerVersion(value);
  if (version === null || version < 1 || version > 1000) return null;
  return version;
}

/** Return the version only when this build can read it (no downgrade). */
export function supportedSchemaVersion(value: unknown, fallback: number, current: number): number | null {
  const version = readSchemaVersion(value, fallback);
  return version !== null && version <= current ? version : null;
}

export function isFutureSchema(value: unknown, current: number): boolean {
  if (value === undefined || value === null) return false;
  const version = parseIntegerVersion(value);
  return version !== null && version > current;
}

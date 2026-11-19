/**
 * Persisted-data schema versions.
 *
 * Increasing a version means old readers may not open the file. Add a
 * migration test fixture and document the change before bumping.
 */
export const LIBRARY_SCHEMA_VERSION = 2;
export const BACKUP_SCHEMA_VERSION = 2;
export const ARCHIVE_SCHEMA_VERSION = 2;

export function readSchemaVersion(value: unknown, fallback: number): number | null {
  if (value === undefined || value === null) return fallback;
  const version = Number(value);
  if (!Number.isInteger(version) || version < 1 || version > 1000) return null;
  return version;
}

/** Return the version only when this build can read it (no downgrade). */
export function supportedSchemaVersion(value: unknown, fallback: number, current: number): number | null {
  const version = readSchemaVersion(value, fallback);
  return version !== null && version <= current ? version : null;
}

export function isFutureSchema(value: unknown, current: number): boolean {
  if (value === undefined || value === null) return false;
  const version = Number(value);
  return Number.isInteger(version) && version > current;
}

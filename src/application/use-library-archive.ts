import type * as ReactNamespace from 'react';
import type { HostClient } from '../adapters/host-client';
import {
  assertZipBudget,
  createZipStreamWriter,
  unzipEntries,
  ZIP_LIMITS,
  type ZipEntry,
  zipStore,
} from '../adapters/zip';
import { type Article, compactLibraryForStorage, type LibraryState } from '../domain/article';
import { bytesToBase64 } from '../domain/base64';
import type { ConfirmDialogFn } from '../domain/dialog';
import {
  collectReferencedAssets,
  isAssetFilename,
  LIBRARY_ARCHIVE_BACKUP,
  LIBRARY_ARCHIVE_FORMAT,
  LIBRARY_ARCHIVE_MANIFEST,
  LIBRARY_ARCHIVE_VERSION,
  missingArchiveAssets,
} from '../domain/library-archive';
import type { MergeConflict, MergeDecision } from '../domain/library-backup';
import {
  createLibraryBackup,
  extractBackupWritingSkills,
  mergeConflicts,
  mergeLibraryBackup,
  mergeWritingSkillStates,
  parseLibraryBackup,
} from '../domain/library-backup';
import { ARCHIVE_SCHEMA_VERSION, supportedSchemaVersion } from '../domain/schema';
import type { WritingSkillState } from '../domain/writing-skills';
import { useLatest, useMountDisposable } from '../runtime/react-lifecycle';
import type { DocumentStore } from './document-store';

const IMPORT_RECOVERY_KEY = 'dsh.markdown-studio.library.import-recovery.v1';

export function collectImportRecoveryAssets(): string[] {
  try {
    const raw = window.localStorage.getItem(IMPORT_RECOVERY_KEY);
    if (!raw) return [];
    const parsed = parseLibraryBackup(JSON.parse(raw));
    return parsed ? collectReferencedAssets(parsed) : [];
  } catch {
    return [];
  }
}

type Notify = (text: string, tone?: 'success' | 'error' | 'info') => void;

export type ImportModeChoice = 'merge' | 'replace';

export interface ImportBackupSummary {
  fileName: string;
  docCount: number;
  assetCount: number;
  missingCount: number;
}

export interface LibraryArchiveOptions {
  React: typeof ReactNamespace;
  t: (key: string) => string;
  notify: Notify;
  confirm: ConfirmDialogFn;
  store: DocumentStore;
  library: LibraryState;
  hostClient: HostClient;
  localImageServerUrl: string;
  download: (name: string, content: Blob | string, mime: string) => boolean;
  onReplace: (article: Article) => void;
  onClose: () => void;
  chooseImportMode?: (summary: ImportBackupSummary) => Promise<ImportModeChoice | null>;
  resolveConflicts?: (
    conflicts: MergeConflict[],
    defaultDecision: MergeDecision,
  ) => Promise<Record<string, MergeDecision> | null>;
  writingSkills?: WritingSkillState;
  onWritingSkills?: (next: WritingSkillState) => void;
  onTrackInFlight?: (filename: string, active: boolean) => void;
}

export interface LibraryArchiveApi {
  recoveryAvailable: boolean;
  exportJson: () => Promise<void>;
  exportArchive: () => Promise<void>;
  importFile: (file: File | null | undefined, merge?: boolean, prefer?: 'current' | 'incoming') => Promise<void>;
  recover: () => Promise<void>;
}

interface ResolvedImportPlan {
  merge: boolean;
  decisions: Record<string, MergeDecision>;
}

async function resolveImportMode(
  options: LibraryArchiveOptions,
  summary: ImportBackupSummary,
  explicitMerge: boolean | undefined,
): Promise<{ merge: boolean; confirmed: boolean } | null> {
  if (explicitMerge === undefined && options.chooseImportMode) {
    const choice = await options.chooseImportMode(summary);
    if (!choice) return null;
    return { merge: choice === 'merge', confirmed: true };
  }
  return { merge: Boolean(explicitMerge), confirmed: false };
}

async function resolveImportConflicts(
  options: LibraryArchiveOptions,
  parsed: LibraryState,
  prefer: MergeDecision,
): Promise<{ decisions: Record<string, MergeDecision>; confirmed: boolean } | null> {
  if (!options.resolveConflicts) return { decisions: {}, confirmed: false };
  const conflicts = mergeConflicts(options.store.getSnapshot(), parsed);
  if (!conflicts.length) return { decisions: {}, confirmed: false };
  const resolved = await options.resolveConflicts(conflicts, prefer);
  if (!resolved) return null;
  return { decisions: resolved, confirmed: true };
}

async function resolveImportPlan(
  options: LibraryArchiveOptions,
  parsed: LibraryState,
  summary: ImportBackupSummary,
  isArchive: boolean,
  explicitMerge: boolean | undefined,
  prefer: MergeDecision,
): Promise<ResolvedImportPlan | null> {
  const mode = await resolveImportMode(options, summary, explicitMerge);
  if (!mode) return null;
  const conflictPlan = mode.merge
    ? await resolveImportConflicts(options, parsed, prefer)
    : { decisions: {}, confirmed: false };
  if (!conflictPlan) return null;
  if (!mode.confirmed && !conflictPlan.confirmed) {
    const title = isArchive
      ? buildArchiveConfirmTitle(options.t, mode.merge, summary.docCount, summary.assetCount, summary.missingCount)
      : options.t(mode.merge ? 'library.mergeConfirm' : 'library.importConfirm');
    if (!(await options.confirm({ title }))) return null;
  }
  return { merge: mode.merge, decisions: conflictPlan.decisions };
}

function buildArchiveConfirmTitle(
  t: (key: string) => string,
  merge: boolean,
  docCount: number,
  assetCount: number,
  missingCount: number,
): string {
  const base =
    t(merge ? 'library.mergeConfirm' : 'library.archiveConfirm') +
    ' ' +
    docCount +
    ' ' +
    t('library.articles') +
    ', ' +
    assetCount +
    ' ' +
    t('localImages');
  return missingCount ? base + ' · ' + missingCount + ' ' + t('library.archiveMissing') : base;
}

function remapLibraryAssetPaths(library: LibraryState, mapping: Map<string, string>): LibraryState {
  if (!mapping.size) return library;
  const lowerMap = new Map<string, string>();
  for (const [oldPath, newPath] of mapping.entries()) {
    if (oldPath.toLowerCase() !== newPath.toLowerCase()) lowerMap.set(oldPath.toLowerCase(), newPath);
  }
  if (!lowerMap.size) return library;
  const rewrite = (md: string): string =>
    md.replace(/assets\/[a-f0-9]{24}\.(?:png|jpg)/gi, (match) => lowerMap.get(match.toLowerCase()) || match);
  return {
    activeId: library.activeId,
    docs: library.docs.map((doc) => ({ ...doc, markdown: rewrite(doc.markdown) })),
    trash: (library.trash || []).map((doc) => ({ ...doc, markdown: rewrite(doc.markdown) })),
  };
}

function assetFetchUrl(base: string, filename: string): string {
  return base ? base + '/uploads/' + filename : '/api/markdown-studio/assets/' + filename;
}

async function runWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      results[idx] = await worker(items[idx]);
    }
  });
  await Promise.all(workers);
  return results;
}

export function useLibraryArchive(options: LibraryArchiveOptions): LibraryArchiveApi {
  const React = options.React;
  const t = options.t;
  const store = options.store;
  const hostClient = options.hostClient;
  const writingSkillsRef = useLatest(React, options.writingSkills);
  const mountedRef = React.useRef(true);
  useMountDisposable(React, () => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  });
  const [recoveryAvailable, setRecoveryAvailable] = React.useState(function () {
    try {
      return !!window.localStorage.getItem(IMPORT_RECOVERY_KEY);
    } catch (error) {
      return false;
    }
  });

  function snapshotImportRecovery(): { ok: boolean; previous: string | null } {
    let previous: string | null = null;
    try {
      previous = window.localStorage.getItem(IMPORT_RECOVERY_KEY);
      const backup = createLibraryBackup(compactLibraryForStorage(store.getSnapshot()), writingSkillsRef.current);
      window.localStorage.setItem(IMPORT_RECOVERY_KEY, JSON.stringify(backup));
      setRecoveryAvailable(true);
      return { ok: true, previous };
    } catch (error) {
      options.notify(t('library.recoveryFailed'), 'error');
      return { ok: false, previous };
    }
  }

  function restoreImportRecovery(previous: string | null): void {
    try {
      if (previous === null) window.localStorage.removeItem(IMPORT_RECOVERY_KEY);
      else window.localStorage.setItem(IMPORT_RECOVERY_KEY, previous);
      setRecoveryAvailable(Boolean(previous));
    } catch {
      /* best effort */
    }
  }

  function applyImportedSkills(rawPayload: unknown, merge: boolean, prefer: MergeDecision): void {
    if (!options.onWritingSkills) return;
    const incoming = extractBackupWritingSkills(rawPayload);
    if (!incoming) return;
    const liveSkills = writingSkillsRef.current;
    const nextSkills = merge && liveSkills ? mergeWritingSkillStates(liveSkills, incoming, prefer) : incoming;
    options.onWritingSkills(nextSkills);
  }

  function replace(next: Article): void {
    options.onReplace(next);
    options.onClose();
  }

  async function exportJson(): Promise<void> {
    const backup = createLibraryBackup(compactLibraryForStorage(store.getSnapshot()), options.writingSkills);
    const stamp = new Date().toISOString().slice(0, 10);
    if (
      options.download(
        'mdstudio-library-' + stamp + '.json',
        JSON.stringify(backup, null, 2),
        'application/json;charset=utf-8',
      )
    ) {
      options.notify(t('library.exported'));
    }
  }

  async function exportArchive(): Promise<void> {
    try {
      await exportArchiveChecked();
    } catch (error) {
      options.notify(
        t(
          error instanceof Error && error.message === 'ZIP_LIMIT_EXCEEDED'
            ? 'library.archiveLimit'
            : 'library.archiveFailed',
        ),
        'error',
      );
    }
  }

  async function exportArchiveChecked(): Promise<void> {
    const currentLib = store.getSnapshot();
    const files = collectReferencedAssets(currentLib);
    assertZipBudget(files.length + 2, 0);
    const base = String(options.localImageServerUrl || '').replace(/\/+$/, '');
    const stamp = new Date().toISOString().slice(0, 10);
    const archiveName = 'mdstudio-library-' + stamp + '.zip';
    const encoder = new TextEncoder();

    if (window.showSaveFilePicker) {
      let writable: FileSystemWritableFileStream | null = null;
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: archiveName,
          types: [{ description: 'ZIP', accept: { 'application/zip': ['.zip'] } }],
        });
        writable = await handle.createWritable();
      } catch (error) {
        const domError = error as DOMException;
        if (domError && domError.name === 'AbortError' && !String(domError.message || '').includes('Intercepted')) {
          return;
        }
      }
      if (writable) {
        const writer = createZipStreamWriter(
          writable as unknown as { write(data: Uint8Array): Promise<unknown>; close(): Promise<unknown> },
        );
        const missing: string[] = [];
        try {
          const fetched = await runWithConcurrency(files, 4, async (filename) => {
            try {
              const response = await fetch(assetFetchUrl(base, filename));
              if (!response.ok) return { filename, data: null as Uint8Array | null };
              return { filename, data: new Uint8Array(await response.arrayBuffer()) };
            } catch {
              return { filename, data: null as Uint8Array | null };
            }
          });
          for (const item of fetched) {
            if (!item.data) missing.push(item.filename);
            else await writer.add('assets/' + item.filename, item.data);
          }
          await writer.add(
            LIBRARY_ARCHIVE_BACKUP,
            encoder.encode(
              JSON.stringify(
                createLibraryBackup(compactLibraryForStorage(currentLib), writingSkillsRef.current),
                null,
                2,
              ),
            ),
          );
          await writer.add(
            LIBRARY_ARCHIVE_MANIFEST,
            encoder.encode(
              JSON.stringify(
                {
                  format: LIBRARY_ARCHIVE_FORMAT,
                  version: LIBRARY_ARCHIVE_VERSION,
                  schemaVersion: ARCHIVE_SCHEMA_VERSION,
                  exportedAt: new Date().toISOString(),
                  assets: files,
                  missing,
                },
                null,
                2,
              ),
            ),
          );
          await writer.close();
          const msg = missing.length
            ? t('library.archiveExported') + ' · ' + missing.length + ' ' + t('library.archiveMissing')
            : t('library.archiveExported');
          options.notify(msg, missing.length ? 'error' : 'success');
        } catch (error) {
          try {
            await writable.abort();
          } catch (abortError) {
            /* ignore */
          }
          options.notify(
            t(
              error instanceof Error && error.message === 'ZIP_LIMIT_EXCEEDED'
                ? 'library.archiveLimit'
                : 'library.archiveFailed',
            ),
            'error',
          );
        }
        return;
      }
    }

    const entries: ZipEntry[] = [];
    let total = 0;
    const missing: string[] = [];
    const fetched = await runWithConcurrency(files, 4, async (filename) => {
      try {
        const response = await fetch(assetFetchUrl(base, filename));
        if (!response.ok) return { filename, data: null as Uint8Array | null };
        return { filename, data: new Uint8Array(await response.arrayBuffer()) };
      } catch {
        return { filename, data: null as Uint8Array | null };
      }
    });
    for (const item of fetched) {
      if (!item.data) {
        missing.push(item.filename);
        continue;
      }
      total += item.data.length;
      assertZipBudget(files.length + 2, total, item.data.length);
      entries.push({ name: 'assets/' + item.filename, data: item.data });
    }
    entries.push({
      name: LIBRARY_ARCHIVE_BACKUP,
      data: encoder.encode(
        JSON.stringify(createLibraryBackup(compactLibraryForStorage(currentLib), writingSkillsRef.current), null, 2),
      ),
    });
    entries.push({
      name: LIBRARY_ARCHIVE_MANIFEST,
      data: encoder.encode(
        JSON.stringify(
          {
            format: LIBRARY_ARCHIVE_FORMAT,
            version: LIBRARY_ARCHIVE_VERSION,
            schemaVersion: ARCHIVE_SCHEMA_VERSION,
            exportedAt: new Date().toISOString(),
            assets: files,
            missing,
          },
          null,
          2,
        ),
      ),
    });
    if (options.download(archiveName, zipStore(entries), 'application/zip')) {
      const msg = missing.length
        ? t('library.archiveExported') + ' · ' + missing.length + ' ' + t('library.archiveMissing')
        : t('library.archiveExported');
      options.notify(msg, missing.length ? 'error' : 'success');
    }
  }

  async function importArchive(
    fileName: string,
    buffer: ArrayBuffer,
    explicitMerge: boolean | undefined,
    prefer: 'current' | 'incoming',
  ): Promise<void> {
    const entries = await unzipEntries(buffer);
    const backupEntry = entries.find(function (entry) {
      return entry.name === LIBRARY_ARCHIVE_BACKUP;
    });
    if (!backupEntry) throw new Error('missing library.json');
    const manifestEntry = entries.find(function (entry) {
      return entry.name === LIBRARY_ARCHIVE_MANIFEST;
    });
    if (manifestEntry) {
      const manifest = JSON.parse(new TextDecoder().decode(manifestEntry.data)) as {
        format?: unknown;
        version?: unknown;
        schemaVersion?: unknown;
      };
      if (
        manifest.format !== LIBRARY_ARCHIVE_FORMAT ||
        manifest.version !== LIBRARY_ARCHIVE_VERSION ||
        supportedSchemaVersion(manifest.schemaVersion, ARCHIVE_SCHEMA_VERSION, ARCHIVE_SCHEMA_VERSION) === null
      ) {
        throw new Error('unsupported library archive');
      }
    }
    const rawPayload = JSON.parse(new TextDecoder().decode(backupEntry.data)) as unknown;
    const parsed = parseLibraryBackup(rawPayload, t('untitled'));
    if (!parsed) throw new Error('invalid backup');
    const assets = entries.filter(function (entry) {
      return entry.name.indexOf('assets/') === 0 && isAssetFilename(entry.name.slice(7));
    });
    const present = assets.map(function (entry) {
      return entry.name.slice(7);
    });
    const missing = missingArchiveAssets(parsed, present);
    const plan = await resolveImportPlan(
      options,
      parsed,
      { fileName, docCount: parsed.docs.length, assetCount: assets.length, missingCount: missing.length },
      true,
      explicitMerge,
      prefer,
    );
    if (!plan || !mountedRef.current) return;
    const recovery = snapshotImportRecovery();
    if (!recovery.ok) return;
    const remapped = new Map<string, string>();
    let failedAssets = 0;
    const tracked: string[] = [];
    try {
      await runWithConcurrency(assets, 4, async (entry) => {
        const filename = entry.name.slice(7);
        const mime = /\.png$/i.test(filename) ? 'image/png' : 'image/jpeg';
        try {
          const stored = await hostClient.storeAsset('data:' + mime + ';base64,' + bytesToBase64(entry.data), filename);
          if (stored.filename) {
            options.onTrackInFlight?.(stored.filename, true);
            tracked.push(stored.filename);
          }
          const nextPath = stored.assetPath || (stored.filename ? 'assets/' + stored.filename : '');
          if (nextPath && nextPath !== 'assets/' + filename) remapped.set('assets/' + filename, nextPath);
        } catch {
          failedAssets++;
        }
      });
      if (!mountedRef.current) {
        restoreImportRecovery(recovery.previous);
        return;
      }
      const preparedParsed = remapLibraryAssetPaths(parsed, remapped);
      const nextLibrary = plan.merge
        ? mergeLibraryBackup(store.getSnapshot(), preparedParsed, prefer, plan.decisions)
        : preparedParsed;
      const nextActive = store.replaceAll(nextLibrary, true);
      applyImportedSkills(rawPayload, plan.merge, prefer);
      replace(nextActive);
      const totalMissing = missing.length + failedAssets;
      const baseMsg = t(plan.merge ? 'library.merged' : 'library.archiveImported');
      options.notify(
        totalMissing ? baseMsg + ' · ' + totalMissing + ' ' + t('library.archiveMissing') : baseMsg,
        totalMissing ? 'error' : 'success',
      );
    } catch (error) {
      restoreImportRecovery(recovery.previous);
      throw error;
    } finally {
      for (const filename of tracked) options.onTrackInFlight?.(filename, false);
    }
  }

  async function importFile(
    file: File | null | undefined,
    merge?: boolean,
    prefer: 'current' | 'incoming' = 'incoming',
  ): Promise<void> {
    if (!file) return;
    try {
      if (file.size > ZIP_LIMITS.archiveBytes) throw new Error('ZIP_LIMIT_EXCEEDED');
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      if (bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b) {
        await importArchive(file.name || '', buffer, merge, prefer);
        return;
      }
      const rawPayload = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
      const parsed = parseLibraryBackup(rawPayload, t('untitled'));
      if (!parsed) throw new Error('invalid backup');
      const plan = await resolveImportPlan(
        options,
        parsed,
        { fileName: file.name || '', docCount: parsed.docs.length, assetCount: 0, missingCount: 0 },
        false,
        merge,
        prefer,
      );
      if (!plan || !mountedRef.current) return;
      const recovery = snapshotImportRecovery();
      if (!recovery.ok) return;
      try {
        const nextLibrary = plan.merge
          ? mergeLibraryBackup(store.getSnapshot(), parsed, prefer, plan.decisions)
          : parsed;
        const nextActive = store.replaceAll(nextLibrary, true);
        applyImportedSkills(rawPayload, plan.merge, prefer);
        replace(nextActive);
        options.notify(t(plan.merge ? 'library.merged' : 'library.imported'));
      } catch (error) {
        restoreImportRecovery(recovery.previous);
        throw error;
      }
    } catch (error) {
      options.notify(
        t(
          error instanceof Error && error.message === 'LIBRARY_SAVE_FAILED'
            ? 'storage.saveFailed'
            : error instanceof Error && error.message === 'ZIP_LIMIT_EXCEEDED'
              ? 'library.archiveLimit'
              : 'library.importInvalid',
        ),
        'error',
      );
    }
  }

  async function recover(): Promise<void> {
    try {
      const raw = window.localStorage.getItem(IMPORT_RECOVERY_KEY);
      if (!raw) {
        options.notify(t('library.noRecovery'), 'error');
        setRecoveryAvailable(false);
        return;
      }
      const rawPayload = JSON.parse(raw) as unknown;
      const parsed = parseLibraryBackup(rawPayload, t('untitled'));
      if (!parsed) throw new Error('invalid recovery');
      const ok = await options.confirm({ title: t('library.recoverConfirm') });
      if (!ok) return;
      const nextActive = store.replaceAll(parsed, true);
      applyImportedSkills(rawPayload, false, 'incoming');
      replace(nextActive);
      window.localStorage.removeItem(IMPORT_RECOVERY_KEY);
      setRecoveryAvailable(false);
      options.notify(t('library.recovered'));
    } catch (error) {
      options.notify(
        t(
          error instanceof Error && error.message === 'LIBRARY_SAVE_FAILED'
            ? 'storage.saveFailed'
            : error instanceof Error && error.message === 'ZIP_LIMIT_EXCEEDED'
              ? 'library.archiveLimit'
              : 'library.importInvalid',
        ),
        'error',
      );
    }
  }

  return { recoveryAvailable, exportJson, exportArchive, importFile, recover };
}

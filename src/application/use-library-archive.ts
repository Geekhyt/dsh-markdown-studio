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
import { ARCHIVE_SCHEMA_VERSION } from '../domain/schema';
import type { WritingSkillState } from '../domain/writing-skills';
import type { DocumentStore } from './document-store';

const IMPORT_RECOVERY_KEY = 'dsh.markdown-studio.library.import-recovery.v1';

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

async function resolveImportPlan(
  options: LibraryArchiveOptions,
  parsed: LibraryState,
  summary: ImportBackupSummary,
  isArchive: boolean,
  explicitMerge: boolean | undefined,
  prefer: MergeDecision,
): Promise<ResolvedImportPlan | null> {
  let merge = Boolean(explicitMerge);
  let alreadyConfirmed = false;
  if (explicitMerge === undefined && options.chooseImportMode) {
    const choice = await options.chooseImportMode(summary);
    if (!choice) return null;
    merge = choice === 'merge';
    alreadyConfirmed = true;
  }
  let decisions: Record<string, MergeDecision> = {};
  if (merge && options.resolveConflicts) {
    const conflicts = mergeConflicts(options.library, parsed);
    if (conflicts.length) {
      const resolved = await options.resolveConflicts(conflicts, prefer);
      if (!resolved) return null;
      decisions = resolved;
      alreadyConfirmed = true;
    }
  }
  if (!alreadyConfirmed) {
    const title = isArchive
      ? buildArchiveConfirmTitle(options.t, merge, summary.docCount, summary.assetCount, summary.missingCount)
      : options.t(merge ? 'library.mergeConfirm' : 'library.importConfirm');
    const ok = await options.confirm({ title });
    if (!ok) return null;
  }
  return { merge, decisions };
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

export function useLibraryArchive(options: LibraryArchiveOptions): LibraryArchiveApi {
  const React = options.React;
  const t = options.t;
  const store = options.store;
  const library = options.library;
  const hostClient = options.hostClient;
  const [recoveryAvailable, setRecoveryAvailable] = React.useState(function () {
    try {
      return !!window.localStorage.getItem(IMPORT_RECOVERY_KEY);
    } catch (error) {
      return false;
    }
  });

  async function saveImportRecovery(): Promise<boolean> {
    try {
      const backup = createLibraryBackup(compactLibraryForStorage(library), options.writingSkills);
      window.localStorage.setItem(IMPORT_RECOVERY_KEY, JSON.stringify(backup));
      setRecoveryAvailable(true);
      return true;
    } catch (error) {
      options.notify(t('library.recoveryFailed'), 'error');
      return false;
    }
  }

  function applyImportedSkills(rawPayload: unknown, merge: boolean, prefer: MergeDecision): void {
    if (!options.onWritingSkills) return;
    const incoming = extractBackupWritingSkills(rawPayload);
    if (!incoming) return;
    const nextSkills =
      merge && options.writingSkills ? mergeWritingSkillStates(options.writingSkills, incoming, prefer) : incoming;
    options.onWritingSkills(nextSkills);
  }

  function replace(next: Article): void {
    options.onReplace(next);
    options.onClose();
  }

  async function exportJson(): Promise<void> {
    const backup = createLibraryBackup(library, options.writingSkills);
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
    const files = collectReferencedAssets(library);
    assertZipBudget(files.length + 2, 0);
    const base = String(options.localImageServerUrl || 'http://127.0.0.1:4010').replace(/\/+$/, '');
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
          for (const filename of files) {
            let data: Uint8Array;
            try {
              const response = await fetch(base + '/uploads/' + filename);
              if (!response.ok) {
                missing.push(filename);
                continue;
              }
              data = new Uint8Array(await response.arrayBuffer());
            } catch (error) {
              missing.push(filename);
              continue;
            }
            await writer.add('assets/' + filename, data);
          }
          await writer.add(
            LIBRARY_ARCHIVE_BACKUP,
            encoder.encode(JSON.stringify(createLibraryBackup(library, options.writingSkills), null, 2)),
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
          options.notify(t('library.archiveExported'));
          if (missing.length) options.notify(missing.length + ' ' + t('library.archiveMissing'), 'error');
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
    for (const filename of files) {
      try {
        const response = await fetch(base + '/uploads/' + filename);
        if (!response.ok) {
          missing.push(filename);
          continue;
        }
        const data = new Uint8Array(await response.arrayBuffer());
        total += data.length;
        assertZipBudget(files.length + 2, total, data.length);
        entries.push({ name: 'assets/' + filename, data });
      } catch (error) {
        if (error instanceof Error && error.message === 'ZIP_LIMIT_EXCEEDED') throw error;
        missing.push(filename);
      }
    }
    entries.push({
      name: LIBRARY_ARCHIVE_BACKUP,
      data: encoder.encode(JSON.stringify(createLibraryBackup(library, options.writingSkills), null, 2)),
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
      options.notify(t('library.archiveExported'));
    }
    if (missing.length) options.notify(missing.length + ' ' + t('library.archiveMissing'), 'error');
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
        (manifest.schemaVersion !== undefined && Number(manifest.schemaVersion) > ARCHIVE_SCHEMA_VERSION)
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
    if (!plan) return;
    if (!(await saveImportRecovery())) return;
    for (const entry of assets) {
      const filename = entry.name.slice(7);
      const mime = /\.png$/i.test(filename) ? 'image/png' : 'image/jpeg';
      await hostClient.storeAsset('data:' + mime + ';base64,' + bytesToBase64(entry.data), filename);
    }
    const nextLibrary = plan.merge ? mergeLibraryBackup(library, parsed, prefer, plan.decisions) : parsed;
    applyImportedSkills(rawPayload, plan.merge, prefer);
    replace(store.replaceAll(nextLibrary, true));
    options.notify(t(plan.merge ? 'library.merged' : 'library.archiveImported'));
    if (missing.length) options.notify(missing.length + ' ' + t('library.archiveMissing'), 'error');
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
      if (!plan) return;
      if (!(await saveImportRecovery())) return;
      const nextLibrary = plan.merge ? mergeLibraryBackup(library, parsed, prefer, plan.decisions) : parsed;
      applyImportedSkills(rawPayload, plan.merge, prefer);
      replace(store.replaceAll(nextLibrary, true));
      options.notify(t(plan.merge ? 'library.merged' : 'library.imported'));
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
      applyImportedSkills(rawPayload, false, 'incoming');
      replace(store.replaceAll(parsed, true));
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

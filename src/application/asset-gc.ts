import type { HostClient } from '../adapters/host-client';
import type { LibraryState } from '../domain/article';
import { assetFilesInMarkdown } from '../domain/images';
import { collectReferencedAssets } from '../domain/library-archive';
import { SAMPLE_MARKDOWN, SAMPLE_MARKDOWN_EN } from '../themes';

const BUILTIN_SAMPLE_ASSETS = new Set([
  ...assetFilesInMarkdown(SAMPLE_MARKDOWN),
  ...assetFilesInMarkdown(SAMPLE_MARKDOWN_EN),
]);

const DEFAULT_MIN_ASSET_AGE_MS = 60_000;

export interface AssetGarbageCollectorOptions {
  hostClient: Pick<HostClient, 'listAssets' | 'deleteAsset'>;
  getSnapshot: () => LibraryState;
  mermaidFilenames?: () => ReadonlySet<string>;
  extraFilenames?: () => Iterable<string>;
  minAgeMs?: number;
}

export interface AssetPruneOptions {
  bypassGraceFor?: Iterable<string>;
}

export interface AssetGarbageCollector {
  prune: (options?: AssetPruneOptions) => Promise<string[]>;
}

function isWithinGraceWindow(storedAt: string | undefined, minAgeMs: number, now: number): boolean {
  if (!storedAt || minAgeMs <= 0) return false;
  const parsed = Date.parse(storedAt);
  return Number.isFinite(parsed) && now - parsed < minAgeMs;
}

export function createAssetGarbageCollector(options: AssetGarbageCollectorOptions): AssetGarbageCollector {
  const minAgeMs = options.minAgeMs ?? DEFAULT_MIN_ASSET_AGE_MS;
  let inFlight: Promise<string[]> | null = null;
  let pendingRerun = false;
  const pendingBypass = new Set<string>();

  function liveReferences(): Set<string> {
    const kept = new Set<string>(BUILTIN_SAMPLE_ASSETS);
    for (const filename of collectReferencedAssets(options.getSnapshot())) {
      kept.add(filename);
    }
    if (options.mermaidFilenames) {
      for (const filename of options.mermaidFilenames()) {
        kept.add(filename);
      }
    }
    if (options.extraFilenames) {
      for (const filename of options.extraFilenames()) {
        if (filename) kept.add(filename);
      }
    }
    return kept;
  }

  async function runPrune(pruneOptions?: AssetPruneOptions): Promise<string[]> {
    const bypassGrace = new Set<string>(pruneOptions?.bypassGraceFor || []);
    const before = liveReferences();
    let stored: Awaited<ReturnType<typeof options.hostClient.listAssets>>;
    try {
      stored = await options.hostClient.listAssets();
    } catch {
      return [];
    }
    const after = liveReferences();
    const now = Date.now();
    const orphans = stored
      .filter(function (item) {
        if (before.has(item.filename) || after.has(item.filename)) return false;
        if (bypassGrace.has(item.filename)) return true;
        return !isWithinGraceWindow(item.storedAt, minAgeMs, now);
      })
      .map(function (item) {
        return item.filename;
      });
    const removed: string[] = [];
    await Promise.all(
      orphans.map(async function (filename) {
        try {
          await options.hostClient.deleteAsset(filename);
          removed.push(filename);
        } catch {
          /* best-effort cleanup when host is offline */
        }
      }),
    );
    return removed;
  }

  function prune(pruneOptions?: AssetPruneOptions): Promise<string[]> {
    if (inFlight) {
      pendingRerun = true;
      for (const file of pruneOptions?.bypassGraceFor || []) pendingBypass.add(file);
      return inFlight;
    }
    const runWithFollowups = async (): Promise<string[]> => {
      const removed = await runPrune(pruneOptions);
      while (pendingRerun) {
        pendingRerun = false;
        const nextBypass = Array.from(pendingBypass);
        pendingBypass.clear();
        const extra = await runPrune(nextBypass.length ? { bypassGraceFor: nextBypass } : undefined);
        removed.push(...extra);
      }
      return removed;
    };
    const task = runWithFollowups().finally(function () {
      if (inFlight === task) inFlight = null;
    });
    inFlight = task;
    return task;
  }

  return { prune };
}

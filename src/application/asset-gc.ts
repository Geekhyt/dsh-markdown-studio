import type { HostClient } from '../adapters/host-client';
import type { LibraryState } from '../domain/article';
import { assetFilesInMarkdown } from '../domain/images';
import { collectReferencedAssets } from '../domain/library-archive';
import { SAMPLE_MARKDOWN, SAMPLE_MARKDOWN_EN } from '../themes';

const BUILTIN_SAMPLE_ASSETS = new Set([
  ...assetFilesInMarkdown(SAMPLE_MARKDOWN),
  ...assetFilesInMarkdown(SAMPLE_MARKDOWN_EN),
]);

export interface AssetGarbageCollectorOptions {
  hostClient: Pick<HostClient, 'listAssets' | 'deleteAsset'>;
  getSnapshot: () => LibraryState;
  mermaidFilenames?: () => ReadonlySet<string>;
  extraFilenames?: () => Iterable<string>;
}

export interface AssetGarbageCollector {
  prune: () => Promise<string[]>;
}

export function createAssetGarbageCollector(options: AssetGarbageCollectorOptions): AssetGarbageCollector {
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

  async function prune(): Promise<string[]> {
    const before = liveReferences();
    let stored: Awaited<ReturnType<typeof options.hostClient.listAssets>>;
    try {
      stored = await options.hostClient.listAssets();
    } catch {
      return [];
    }
    const after = liveReferences();
    const orphans = stored
      .map(function (item) {
        return item.filename;
      })
      .filter(function (filename) {
        return !before.has(filename) && !after.has(filename);
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

  return { prune };
}

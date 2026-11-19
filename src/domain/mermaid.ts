export interface MermaidCacheEntry {
  status: 'loading' | 'ready' | 'error';
  filename?: string;
  assetPath?: string;
  promise?: Promise<void>;
  error?: string;
}

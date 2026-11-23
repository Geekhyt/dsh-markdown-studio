const PLUGIN_ID = 'dsh-markdown-studio';
const REGISTRY_KEY = `__dshPluginCss__:${PLUGIN_ID}`;

export interface PluginStyleRegistry {
  mounted: boolean;
  sheets: Map<string, string>;
}

export function getPluginStyleRegistry(): PluginStyleRegistry {
  const host = globalThis as Record<string, unknown>;
  const existing = host[REGISTRY_KEY] as PluginStyleRegistry | undefined;
  if (existing) return existing;
  const created: PluginStyleRegistry = { mounted: false, sheets: new Map() };
  host[REGISTRY_KEY] = created;
  return created;
}

export function isPluginStylesMounted(): boolean {
  return getPluginStyleRegistry().mounted;
}

export function mountPluginStyles(): void {
  const reg = getPluginStyleRegistry();
  reg.mounted = true;
  if (typeof document === 'undefined' || !document.head) return;
  reg.sheets.forEach((css, tagId) => {
    const selector = `style[data-plugin-css=${JSON.stringify(tagId)}]`;
    if (document.querySelector(selector)) return;
    const tag = document.createElement('style');
    tag.dataset.plugin = PLUGIN_ID;
    tag.dataset.pluginCss = tagId;
    tag.textContent = css;
    document.head.appendChild(tag);
  });
}

export function unmountPluginStyles(): void {
  const reg = getPluginStyleRegistry();
  reg.mounted = false;
  if (typeof document === 'undefined') return;
  document.documentElement?.classList?.remove('data_color_scheme_dark');
  const styleNodes = document.querySelectorAll(`style[data-plugin=${JSON.stringify(PLUGIN_ID)}]`);
  styleNodes.forEach((node) => {
    const candidate = node as { id?: string; dataset?: { pluginCss?: string }; remove?: () => void };
    if (
      typeof candidate.remove === 'function' &&
      (candidate.dataset?.pluginCss || String(candidate.id || '').startsWith('js_darkmode_style__'))
    ) {
      candidate.remove();
    }
  });
  const scriptNodes = document.querySelectorAll(`script[data-plugin=${JSON.stringify(PLUGIN_ID)}]`);
  scriptNodes.forEach((node) => {
    const candidate = node as { remove?: () => void };
    if (typeof candidate.remove === 'function') candidate.remove();
  });
}

import mermaid from 'mermaid';

declare global {
  interface Window {
    __MDSTUDIO_MERMAID__?: { render: typeof render };
  }
}

let initialized = false;

function ensureInitialized(): void {
  if (initialized) return;
  mermaid.initialize({
    startOnLoad: false,
    theme: 'neutral',
    securityLevel: 'strict',
    htmlLabels: false,
    flowchart: { htmlLabels: false },
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
  });
  initialized = true;
}

export async function render(code: unknown, id?: string): Promise<string> {
  ensureInitialized();
  const source = String(code || '');
  const result = await mermaid.render(id || `mdstudio-mermaid-${Math.random().toString(36).slice(2)}`, source);
  return result.svg;
}

if (typeof window !== 'undefined') {
  window.__MDSTUDIO_MERMAID__ = { render };
}

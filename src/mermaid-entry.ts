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

let renderSeq = 0;

function removeBodyNode(nodeId: string): void {
  const node = document.getElementById(nodeId);
  if (node && node.parentNode === document.body) node.remove();
}

/** Mermaid mounts a temporary `#d<id>` (or sandbox `#i<id>`) node on <body> and leaves it behind when parsing fails. */
function removeTempNodes(id: string): void {
  if (typeof document === 'undefined') return;
  removeBodyNode('d' + id);
  removeBodyNode('i' + id);
}

export async function render(code: unknown, id?: string): Promise<string> {
  ensureInitialized();
  const source = String(code || '');
  renderSeq += 1;
  const renderId = (id || 'mdstudio-mermaid') + '-r' + renderSeq;
  try {
    const result = await mermaid.render(renderId, source);
    return result.svg;
  } finally {
    removeTempNodes(renderId);
  }
}

if (typeof window !== 'undefined') {
  window.__MDSTUDIO_MERMAID__ = { render };
}

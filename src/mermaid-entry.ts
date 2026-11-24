import mermaid from 'mermaid';
import { hasExternalCssUrl, stripExternalCssUrls } from './domain/custom-css';

declare global {
  interface Window {
    __MDSTUDIO_MERMAID__?: { render: typeof render };
  }
}

let initialized = false;

const MERMAID_SECURE_KEYS = [
  'secure',
  'securityLevel',
  'startOnLoad',
  'maxTextSize',
  'suppressErrorRendering',
  'maxEdges',
  'themeCSS',
  'htmlLabels',
  'flowchart',
  'fontFamily',
];

function ensureInitialized(): void {
  if (initialized) return;
  mermaid.initialize({
    startOnLoad: false,
    theme: 'neutral',
    securityLevel: 'strict',
    secure: MERMAID_SECURE_KEYS,
    htmlLabels: false,
    flowchart: { htmlLabels: false },
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
  });
  initialized = true;
}

const XLINK_NS = 'http://www.w3.org/1999/xlink';
const SVG_PAINT_ATTRS = ['fill', 'stroke', 'filter', 'clip-path', 'mask'];

function scanQuotedEnd(text: string, openIndex: number): number {
  const quote = text[openIndex];
  for (let i = openIndex + 1; i < text.length; i++) {
    if (text[i] === '\\' && quote === '"') {
      i++;
      continue;
    }
    if (text[i] === quote) return i;
  }
  return text.length - 1;
}

function findDirectiveBraceEnd(source: string, openBrace: number): number {
  let depth = 1;
  for (let i = openBrace + 1; i < source.length; i++) {
    const ch = source[i];
    if (ch === '"' || ch === "'") {
      i = scanQuotedEnd(source, i);
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function splitDirectiveEntries(body: string): string[] {
  const entries: string[] = [];
  let start = 0;
  let depth = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '"' || ch === "'") {
      i = scanQuotedEnd(body, i);
      continue;
    }
    if (ch === '{' || ch === '[') depth++;
    else if ((ch === '}' || ch === ']') && depth > 0) depth--;
    else if (depth === 0 && (ch === ',' || ch === '\n')) {
      entries.push(body.slice(start, i));
      start = i + 1;
    }
  }
  entries.push(body.slice(start));
  return entries;
}

function stripImgFromDirectiveBody(body: string): string {
  const kept = splitDirectiveEntries(body)
    .map((entry) => entry.trim())
    .filter((entry) => entry && !/^img\s*:/i.test(entry));
  if (!kept.length) return '';
  return body.includes('\n') ? '\n  ' + kept.join('\n  ') + '\n' : ' ' + kept.join(', ') + ' ';
}

/** Strip Mermaid 11 `@{ img: ... }` metadata so `mermaid.render()` never triggers outbound `new Image()` SSRF fetches. */
export function stripMermaidImageDirectives(source: string): string {
  let out = '';
  let cursor = 0;
  while (cursor < source.length) {
    const idx = source.indexOf('@{', cursor);
    if (idx < 0) {
      out += source.slice(cursor);
      break;
    }
    const end = findDirectiveBraceEnd(source, idx + 1);
    if (end < 0) {
      out += source.slice(cursor);
      break;
    }
    out += source.slice(cursor, idx) + '@{' + stripImgFromDirectiveBody(source.slice(idx + 2, end)) + '}';
    cursor = end + 1;
  }
  return out;
}

function isLocalFragmentRef(value: string): boolean {
  return value.trim().startsWith('#');
}

function stripUnsafeSvgAttrs(node: Element): void {
  const style = node.getAttribute('style');
  if (style) {
    const cleanStyle = stripExternalCssUrls(style);
    if (cleanStyle) node.setAttribute('style', cleanStyle);
    else node.removeAttribute('style');
  }
  for (const attr of SVG_PAINT_ATTRS) {
    const val = node.getAttribute(attr);
    if (val && hasExternalCssUrl(val)) node.removeAttribute(attr);
  }
  for (const attr of Array.from(node.attributes)) {
    if (attr.name.toLowerCase().startsWith('on')) node.removeAttribute(attr.name);
  }
}

function stripUnsafeSvgLinks(node: Element, tag: string): void {
  const href = node.getAttribute('href');
  if (href && (tag !== 'use' || !isLocalFragmentRef(href))) node.removeAttribute('href');
  const xlinkHref = node.getAttributeNS(XLINK_NS, 'href') || node.getAttribute('xlink:href');
  if (xlinkHref && (tag !== 'use' || !isLocalFragmentRef(xlinkHref))) {
    node.removeAttribute('xlink:href');
    node.removeAttributeNS(XLINK_NS, 'href');
  }
}

function sanitizeMermaidSvgNode(node: Element): void {
  const tag = node.tagName.toLowerCase();
  if (tag === 'style') {
    node.textContent = stripExternalCssUrls(node.textContent || '');
    return;
  }
  stripUnsafeSvgAttrs(node);
  stripUnsafeSvgLinks(node, tag);
}

/** DOM-sanitize Mermaid SVG output: drop `<script>`, `<image>`, `<foreignObject>`, external links/URLs, and scrub `<style>`. */
export function sanitizeMermaidSvg(svg: string): string {
  if (typeof DOMParser !== 'undefined' && typeof XMLSerializer !== 'undefined') {
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const root = doc.documentElement;
    if (root && root.tagName.toLowerCase() === 'svg') {
      for (const el of Array.from(root.querySelectorAll('script, image, foreignObject'))) el.remove();
      Array.from(root.querySelectorAll('a')).forEach((link) => {
        while (link.firstChild) link.parentNode?.insertBefore(link.firstChild, link);
        link.remove();
      });
      sanitizeMermaidSvgNode(root);
      Array.from(root.querySelectorAll('*')).forEach(sanitizeMermaidSvgNode);
      return new XMLSerializer().serializeToString(root);
    }
  }
  return svg
    .replace(/<(?:script|image|foreignObject)\b[\s\S]*?(?:\/>|<\/(?:script|image|foreignObject)\s*>)/gi, '')
    .replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi, function (_m, open, css, close) {
      return open + stripExternalCssUrls(css) + close;
    });
}

let renderSeq = 0;
let renderQueue: Promise<unknown> = Promise.resolve();

function removeTempNode(nodeId: string): void {
  const node = document.getElementById(nodeId);
  if (node) node.remove();
}

/** Mermaid mounts a temporary `#d<id>` (or sandbox `#i<id>`) node and leaves it behind when parsing fails. */
function removeTempNodes(id: string): void {
  if (typeof document === 'undefined') return;
  removeTempNode('d' + id);
  removeTempNode('i' + id);
}

async function renderSerialized(source: string, id?: string): Promise<string> {
  ensureInitialized();
  renderSeq += 1;
  const renderId = (id || 'mdstudio-mermaid') + '-r' + renderSeq;
  try {
    const safeSource = stripMermaidImageDirectives(source);
    const result = await mermaid.render(renderId, safeSource);
    return sanitizeMermaidSvg(result.svg);
  } finally {
    removeTempNodes(renderId);
  }
}

export function render(code: unknown, id?: string): Promise<string> {
  const source = String(code || '');
  const task = renderQueue.then(
    () => renderSerialized(source, id),
    () => renderSerialized(source, id),
  );
  renderQueue = task.then(
    () => undefined,
    () => undefined,
  );
  return task;
}

if (typeof window !== 'undefined') {
  window.__MDSTUDIO_MERMAID__ = { render };
}

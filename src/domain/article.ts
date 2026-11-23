import type { ThemeSettings } from '../themes';

export type ViewMode = 'split' | 'edit' | 'preview';

export interface DocState {
  title: string;
  markdown: string;
}

export interface Article extends DocState {
  id: string;
  settings: ThemeSettings;
  view: ViewMode;
  updatedAt: number;
  deletedAt?: number;
}

export interface LibraryState {
  activeId: string;
  docs: Article[];
  trash?: Article[];
}

export interface DocumentSeed extends DocState {
  settings: ThemeSettings;
  view: ViewMode;
}

export interface SelectionRange {
  start: number;
  end: number;
}

export interface Heading {
  level: number;
  text: string;
  start: number;
  length: number;
}

export function parseView(value: unknown): ViewMode {
  return value === 'edit' || value === 'preview' ? value : 'split';
}

const FRONTMATTER_BLOCK_RE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/** Parse validated leading YAML frontmatter (`key: value` / list items / comments only, never leading `---` HR). */
export function parseFrontmatterBlock(
  text: string,
): { meta: Record<string, string>; body: string; offset: number } | null {
  const match = FRONTMATTER_BLOCK_RE.exec(text);
  if (!match) return null;
  const lines = match[1].split(/\r?\n/);
  const meta: Record<string, string> = {};
  let lastKey = '';
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    if (!line || line.charAt(0) === '#') continue;
    if (lastKey && /^[ \t]+-[ \t]+(.*)$/.test(raw)) {
      const item = raw.replace(/^[ \t]+-[ \t]+/, '').trim();
      meta[lastKey] = meta[lastKey] ? meta[lastKey] + ', ' + item : item;
      continue;
    }
    const pair = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!pair) return null;
    let value = pair[2].trim();
    if (
      value.length >= 2 &&
      ((value.charAt(0) === '"' && value.charAt(value.length - 1) === '"') ||
        (value.charAt(0) === "'" && value.charAt(value.length - 1) === "'"))
    ) {
      value = value.slice(1, -1);
    }
    lastKey = pair[1];
    meta[lastKey] = value;
  }
  const offset = match[0].length;
  return { meta, body: text.slice(offset), offset };
}

/** Strip leading validated YAML frontmatter block, returning remaining text and its starting char offset. */
export function stripLeadingFrontmatter(text: string): { body: string; offset: number } {
  const parsed = parseFrontmatterBlock(text);
  return parsed ? { body: parsed.body, offset: parsed.offset } : { body: text, offset: 0 };
}

function stripFencedCodeLines(text: string): string {
  const lines = text.split('\n');
  const kept: string[] = [];
  let fence = '';
  for (const line of lines) {
    const clean = line.endsWith('\r') ? line.slice(0, -1) : line;
    const prev = fence;
    fence = advanceHeadingFence(fence, clean);
    if (!prev && !fence) kept.push(line);
  }
  return kept.join('\n');
}

export function deriveTitle(markdown: unknown, fallback: string): string {
  const text = String(markdown || '');
  const frontmatter = parseFrontmatterBlock(text);
  if (frontmatter?.meta.title) {
    return frontmatter.meta.title.trim() || fallback;
  }
  const h1 = markdownHeadings(text).find((item) => item.level === 1);
  return h1 ? h1.text.trim() || fallback : fallback;
}

export function markdownToPlain(markdown: unknown): string {
  const withoutFrontmatter = stripLeadingFrontmatter(String(markdown || '')).body;
  return stripFencedCodeLines(withoutFrontmatter)
    .replace(/^ {0,3}:::(?:scroll(?:-x)?(?:\s+\d+(?:px)?)?|\s*)$/gim, '')
    .replace(/^ {0,3}:::(?:meta|lead|tldr|pull|sign|callout)[ \t]*/gim, '')
    .replace(/^>\s*\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*$/gim, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^\d+[.)]\s+/gm, '')
    .replace(/==([^=\n]+)==/g, '$1')
    .replace(/\+\+([^+\n]+)\+\+/g, '$1')
    .replace(/[*~`]/g, '')
    .replace(/(^|[^A-Za-z0-9])_+|_+($|[^A-Za-z0-9])/g, '$1$2')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function slugify(title: unknown): string {
  const value = String(title || 'markdown')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return value || 'markdown';
}

function advanceHeadingFence(active: string, line: string): string {
  if (!active) {
    const open = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (!open || (open[1].charAt(0) === '`' && open[2].includes('`'))) return '';
    return open[1];
  }
  const close = new RegExp('^ {0,3}' + active.charAt(0) + '{' + active.length + ',}[ \\t]*$');
  return close.test(line) ? '' : active;
}

export function markdownHeadings(text: string): Heading[] {
  const { body, offset: startOffset } = stripLeadingFrontmatter(String(text || ''));
  const lines = body.split('\n');
  const headings: Heading[] = [];
  let offset = startOffset;
  let fence = '';
  for (const line of lines) {
    const clean = line.endsWith('\r') ? line.slice(0, -1) : line;
    const prevFence = fence;
    fence = advanceHeadingFence(fence, clean);
    if (!prevFence && !fence) {
      const match = /^ {0,3}(#{1,6})\s+(.+)$/.exec(clean);
      if (match) {
        headings.push({
          level: match[1].length,
          text: match[2].replace(/\s+#+\s*$/, ''),
          start: offset,
          length: clean.length,
        });
      }
    }
    offset += line.length + 1;
  }
  return headings;
}

function keepOwnCustomTheme(article: Article): Article {
  const list = article.settings.customThemes;
  if (!list || !list.length) return article;
  const own = list.filter(function (theme) {
    return theme.id === article.settings.theme;
  });
  return { ...article, settings: { ...article.settings, customThemes: own } };
}

/**
 * Custom themes are shared studio presets that `DocumentStore` mirrors onto every article in
 * memory. Persisting that mirror would grow storage as articles × themes, so stored snapshots
 * keep the full list on the first article only and the theme each other article actually uses
 * (enough for its selection to survive parsing). `DocumentStore` re-unifies them on load.
 */
export function compactLibraryForStorage(state: LibraryState): LibraryState {
  return {
    ...state,
    docs: state.docs.map(function (doc, index) {
      return index === 0 ? doc : keepOwnCustomTheme(doc);
    }),
    ...(state.trash ? { trash: state.trash.map(keepOwnCustomTheme) } : {}),
  };
}

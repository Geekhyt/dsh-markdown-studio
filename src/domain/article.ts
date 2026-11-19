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

export function deriveTitle(markdown: unknown, fallback: string): string {
  const text = String(markdown || '');
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (frontmatter) {
    const titleLine = /^title\s*:\s*(.+)$/m.exec(frontmatter[1]);
    if (titleLine) return titleLine[1].trim().replace(/^["']|["']$/g, '') || fallback;
  }
  const heading = /^#\s+(.+)$/m.exec(text);
  return heading ? heading[1].trim() : fallback;
}

export function markdownToPlain(markdown: unknown): string {
  return String(markdown || '')
    .replace(/(?:`{3,}|~{3,})[\s\S]*?(?:`{3,}|~{3,})/g, '')
    .replace(/^ {0,3}:::(?:scroll(?:-x)?(?:\s+\d+(?:px)?)?|\s*)$/gim, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^\d+[.)]\s+/gm, '')
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
  const lines = String(text || '').split('\n');
  const headings: Heading[] = [];
  let offset = 0;
  let fence = '';
  for (const line of lines) {
    const prevFence = fence;
    fence = advanceHeadingFence(fence, line);
    if (!prevFence && !fence) {
      const match = /^ {0,3}(#{1,6})\s+(.+)$/.exec(line);
      if (match) {
        headings.push({
          level: match[1].length,
          text: match[2].replace(/\s+#+\s*$/, ''),
          start: offset,
          length: line.length,
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

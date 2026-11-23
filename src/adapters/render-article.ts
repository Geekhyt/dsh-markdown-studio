import { markdownToPlain } from '../domain/article';
import { resolveArticleImageSrc } from '../domain/images';
import type { MermaidCacheEntry } from '../domain/mermaid';
import { engine } from '../engine';
import * as themes from '../themes';
import {
  prepareClipboardDom,
  removeEmptyHeadingDecorations,
  removeEmptyZeroHeightContainers,
  stripFontFamilies,
} from './wechat-clipboard-dom';

/**
 * Dual-mode Markdown → Inline-CSS HTML compilation pipeline (`forPreview` vs `forCopy`):
 * - `forPreview`: preserves structural spans (e.g. empty heading decorations) so theme switches
 *   apply live, and allows `PreviewPane` to run `mp-darkmode` in-place when host dark mode is active.
 * - `forCopy`: NEVER reads the live preview DOM (which may be mutated by `mp-darkmode`); instead
 *   re-renders clean light-mode HTML, flattens nested lists, strips `font-family`, and prunes
 *   zero-height nodes to pass WeChat Official Account structural validation.
 */
export interface RenderArticleOptions {
  forPreview?: boolean;
  imageBaseUrl?: string;
  mermaidAssets?: Map<string, MermaidCacheEntry>;
  locale?: 'zh' | 'en';
  footnotesTitle: string;
  referencesTitle?: string;
  scrollVerticalHint?: string;
  scrollHorizontalHint?: string;
  imagePlaceholderPrefix?: string;
  imagePlaceholderFallback?: string;
  codeBlockAriaLabel?: string;
  forCopy?: boolean;
}

export interface RenderedArticle {
  html: string;
  text: string;
  refs: number;
  localImages: number;
  bg: string;
  paper: boolean;
  stageBg: string;
  meta?: Record<string, string>;
}

const DEFAULT_TLDR_TITLES: Record<string, string> = {
  classic: '30 秒速览',
  gallery: '导览',
  tech: 'TL;DR',
  warm: '先看这三句',
  night: '本篇看点',
  ink: '提要',
  ruby: '本期要点',
  poster: '先看结论',
};

const DEFAULT_TLDR_TITLES_EN: Record<string, string> = {
  classic: 'Key Takeaways',
  gallery: 'Overview',
  tech: 'TL;DR',
  warm: 'Three Quick Notes',
  night: 'Highlights',
  ink: 'Abstract',
  ruby: 'Executive Brief',
  poster: 'Bottom Line',
};

function applyThemeTldrTitles(root: HTMLElement, themeId: string, locale?: 'zh' | 'en'): void {
  const table = locale === 'en' ? DEFAULT_TLDR_TITLES_EN : DEFAULT_TLDR_TITLES;
  const fallback = table[themeId] || table.classic;
  Array.from(root.querySelectorAll<HTMLElement>('.mdstudio-tldr-title[data-mdstudio-default-tldr]')).forEach(
    function (node) {
      node.textContent = fallback;
      node.removeAttribute('data-mdstudio-default-tldr');
    },
  );
}

function labelScrollRegions(nodes: HTMLElement[], baseLabel: string): void {
  const multi = nodes.length > 1;
  nodes.forEach(function (node, index) {
    node.setAttribute('tabindex', '0');
    node.setAttribute('role', 'region');
    node.setAttribute('aria-label', multi ? `${baseLabel} ${index + 1}` : baseLabel);
  });
}

function markPreviewScrollRegions(root: HTMLElement, options: RenderArticleOptions): void {
  if (!options.forPreview) return;
  const isEn = options.locale === 'en';
  const vLabel = options.scrollVerticalHint || (isEn ? 'Vertical scroll region' : '上下滑动区域');
  const hLabel = options.scrollHorizontalHint || (isEn ? 'Horizontal scroll region' : '左右滑动区域');
  labelScrollRegions(Array.from(root.querySelectorAll<HTMLElement>('.mdstudio-scroll-body')), vLabel);
  labelScrollRegions(Array.from(root.querySelectorAll<HTMLElement>('.mdstudio-scroll-track')), hLabel);
}

export function renderArticle(
  markdown: string,
  settings: themes.ThemeSettings,
  options: RenderArticleOptions,
): RenderedArticle {
  const forPreview = !!options.forPreview;
  const imageBaseUrl = String(options.imageBaseUrl || '').replace(/\/+$/, '');
  const result = engine.renderMarkdown(markdown, {
    locale: options.locale,
    linkFootnotes: settings.linkFootnotes,
    footnotesTitle: options.footnotesTitle,
    referencesTitle: options.referencesTitle,
    scrollVerticalHint: options.scrollVerticalHint,
    scrollHorizontalHint: options.scrollHorizontalHint,
  });
  const css = themes.buildCss(settings);
  const host = document.createElement('div');
  host.innerHTML =
    '<section id="mdstudio" class="mdstudio-content" data-tool="dsh-markdown-studio">' + result.html + '</section>';
  const root = host.firstElementChild as HTMLElement | null;
  if (!root) return { html: '', text: '', refs: 0, localImages: 0, bg: '#ffffff', paper: false, stageBg: '#ffffff' };
  applyThemeTldrTitles(root, settings.theme, options.locale);
  let localImages = 0;
  const mermaidAssets = options.mermaidAssets;
  if (mermaidAssets && imageBaseUrl) {
    const assets = mermaidAssets;
    const mermaidTheme = themes.mermaidThemeFor(settings);
    Array.from(root.querySelectorAll<HTMLElement>('pre > code.mdstudio-lang-mermaid')).forEach(function (codeNode) {
      const pre = codeNode.parentNode;
      const source = String(codeNode.textContent || '').trim();
      const entry = assets.get(themes.mermaidCacheKey(source, mermaidTheme));
      if (entry && entry.status === 'ready' && entry.filename) {
        const image = document.createElement('img');
        image.setAttribute('src', imageBaseUrl + '/uploads/' + entry.filename);
        image.setAttribute('alt', 'Mermaid diagram');
        image.setAttribute('data-mdstudio-local', 'true');
        if (pre && pre.parentNode) pre.parentNode.replaceChild(image, pre);
      }
    });
  }
  const mathNodes = Array.from(root.querySelectorAll<HTMLElement>('.mdstudio-math'));
  const math = typeof window !== 'undefined' ? window.__MDSTUDIO_MATH__ : undefined;
  if (mathNodes.length) {
    const mathLabelPrefix = options.locale === 'en' ? 'Formula: ' : '公式：';
    mathNodes.forEach(function (node) {
      if (!math) {
        node.textContent = node.getAttribute('data-mdstudio-tex') || '';
        return;
      }
      try {
        node.innerHTML = math.render(
          node.getAttribute('data-mdstudio-tex'),
          node.getAttribute('data-mdstudio-display') === '1',
          mathLabelPrefix,
        );
        node.setAttribute('data-mdstudio-math', 'true');
      } catch {
        node.textContent = node.getAttribute('data-mdstudio-tex') || '';
      }
    });
  }

  function localPlaceholder(img: HTMLImageElement, src: string): void {
    const alt = (img.getAttribute('alt') || '').trim();
    let name = alt;
    if (!name) {
      const base =
        String(src || '')
          .split('/')
          .pop() || '';
      try {
        name = decodeURIComponent(base.split('?')[0]);
      } catch {
        name = base.split('?')[0];
      }
    }
    const placeholderPrefix =
      options.imagePlaceholderPrefix || (options.locale === 'en' ? '🖼 Insert image here: ' : '🖼 此处插入图片：');
    const placeholderFallback =
      options.imagePlaceholderFallback || (options.locale === 'en' ? 'Local image' : '本地图片');
    const parent = img.parentElement;
    let onlyImage = false;
    if (parent && parent.tagName === 'P') {
      onlyImage = Array.from(parent.childNodes).every(
        (node) => node === img || (node.nodeType === 3 && !(node.nodeValue || '').trim()),
      );
    }
    const inlineParent = Boolean(
      parent &&
        ((parent.tagName === 'P' && !onlyImage) ||
          /^(A|SPAN|STRONG|EM|DEL|INS|MARK|CODE|SUB|SUP|SMALL|LABEL|FIGCAPTION|H[1-6])$/.test(parent.tagName)),
    );
    const placeholder = document.createElement(inlineParent ? 'span' : 'section');
    placeholder.className = 'mdstudio-img-placeholder';
    placeholder.textContent = placeholderPrefix + (name || placeholderFallback);
    if (parent && parent.tagName === 'P' && onlyImage) {
      parent.classList.remove('mdstudio-figure');
      if (parent.nextElementSibling?.classList.contains('mdstudio-caption')) {
        parent.nextElementSibling.remove();
      }
      if (parent.parentNode) {
        parent.parentNode.replaceChild(placeholder, parent);
        return;
      }
    }
    if (img.parentNode) img.parentNode.replaceChild(placeholder, img);
  }

  Array.from(root.querySelectorAll<HTMLImageElement>('img')).forEach(function (img) {
    const src = img.getAttribute('src') || '';
    const resolved = resolveArticleImageSrc(src, imageBaseUrl);
    if (resolved) {
      localImages++;
      img.setAttribute('src', resolved);
      if (forPreview) {
        img.setAttribute('data-mdstudio-local', 'true');
        return;
      }
      return;
    }
    if (/^data:image\//i.test(src)) {
      localImages++;
      if (forPreview) {
        img.setAttribute('data-mdstudio-local', 'true');
        return;
      }
      if (!settings.imagePlaceholders) return;
      localPlaceholder(img, src);
      return;
    }
    if (/^(https?:)?\/\//i.test(src)) return;
    if (!forPreview && !settings.imagePlaceholders) return;
    localPlaceholder(img, src);
  });
  if (options.forCopy) prepareClipboardDom(root);
  engine.inlineCss(root, css + (mathNodes.length && math ? '\n' + math.cssText : ''), {
    allowExternalCssResources: Boolean(settings.allowExternalCssResources),
  });
  if (options.forCopy) {
    removeEmptyHeadingDecorations(root);
    removeEmptyZeroHeightContainers(root);
    stripFontFamilies(root);
  }
  const codeBlockAria = options.codeBlockAriaLabel || (options.locale === 'en' ? 'Code block' : '代码块');
  const preNodes = Array.from(root.querySelectorAll<HTMLPreElement>('pre'));
  preNodes.forEach(function (pre) {
    if (!pre.style.getPropertyValue('overflow-x')) pre.style.setProperty('overflow-x', 'auto');
    if (!pre.style.getPropertyValue('white-space')) pre.style.setProperty('white-space', 'pre');
    if (!pre.style.getPropertyValue('word-break')) pre.style.setProperty('word-break', 'normal');
  });
  labelScrollRegions(preNodes, codeBlockAria);
  markPreviewScrollRegions(root, options);
  if (settings.codeNbsp && document.createTreeWalker) {
    Array.from(root.querySelectorAll<HTMLPreElement>('pre')).forEach(function (pre) {
      const walker = document.createTreeWalker(pre, NodeFilter.SHOW_TEXT);
      const nodes = [];
      while (walker.nextNode()) {
        const node = walker.currentNode;
        const value = node.nodeValue;
        if (value && value.indexOf(' ') !== -1) nodes.push(node);
      }
      nodes.forEach(function (node) {
        const value = node.nodeValue;
        if (value) node.nodeValue = value.replace(/ /g, '\u00a0');
      });
    });
  }
  const paper = themes.isPaperTheme(settings.theme);
  return {
    html: root.outerHTML,
    text: markdownToPlain(markdown),
    refs: result.refs.length,
    localImages: localImages,
    bg: root.style.backgroundColor || '#ffffff',
    paper: paper,
    stageBg: paper ? '#ffffff' : root.style.backgroundColor || '#ffffff',
    meta: result.meta,
  };
}

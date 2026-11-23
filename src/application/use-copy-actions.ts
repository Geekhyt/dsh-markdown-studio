import type * as ReactNamespace from 'react';
import { renderArticle } from '../adapters/render-article';
import type { Article } from '../domain/article';
import { markdownToPlain } from '../domain/article';
import type { MermaidCacheEntry } from '../domain/mermaid';
import { inspectWechatHtml } from '../domain/wechat-html-lint';
import { mermaidThemeFor, type MermaidTheme, type ThemeSettings } from '../themes';
import type { MathAssetsApi } from './use-math-assets';

type Notify = (text: string, tone?: 'success' | 'error' | 'info') => void;

export interface CopyActionsOptions {
  React: typeof ReactNamespace;
  t: (key: string) => string;
  locale?: 'zh' | 'en';
  notify: Notify;
  doc: Article;
  settings: ThemeSettings;
  localImageServerUrl: string;
  mermaidAssets: {
    ensure: (markdown: string, targetTheme?: MermaidTheme) => Promise<Map<string, MermaidCacheEntry> | void>;
    cache: Map<string, MermaidCacheEntry>;
  };
  mathAssets: Pick<MathAssetsApi, 'ensure'>;
  copyRef: ReactNamespace.RefObject<HTMLDivElement | null>;
  setMenuOpen: (open: boolean) => void;
  describeHostError: (error: unknown) => string;
}

export interface CopyActionsApi {
  copying: boolean;
  copyArticle: () => Promise<void>;
  copyPlainText: () => Promise<void>;
}

export function useCopyActions(options: CopyActionsOptions): CopyActionsApi {
  const React = options.React;
  const [copying, setCopying] = React.useState(false);
  const copyingRef = React.useRef(false);
  const t = options.t;
  const doc = options.doc;
  const settings = options.settings;

  function copyViaHolder(applyContent: (holder: HTMLDivElement) => void): boolean {
    const holder = options.copyRef.current;
    if (!holder) return false;
    const rawActive = document.activeElement;
    const prevActive =
      rawActive && typeof (rawActive as HTMLElement).focus === 'function' ? (rawActive as HTMLElement) : null;
    applyContent(holder);
    try {
      holder.focus();
      const range = document.createRange();
      range.selectNodeContents(holder);
      const selection = window.getSelection();
      if (!selection) return false;
      selection.removeAllRanges();
      selection.addRange(range);
      const ok = document.execCommand('copy');
      selection.removeAllRanges();
      return ok;
    } catch {
      return false;
    } finally {
      holder.innerHTML = '';
      if (prevActive && prevActive !== holder && prevActive.isConnected) {
        try {
          prevActive.focus({ preventScroll: true });
        } catch {
          /* ignore */
        }
      }
    }
  }

  function legacyCopy(html: string): boolean {
    return copyViaHolder(function (holder) {
      holder.innerHTML = html;
    });
  }

  async function copyRichText(html: string, plain: string): Promise<boolean> {
    if (navigator.clipboard && typeof window.ClipboardItem !== 'undefined') {
      try {
        await navigator.clipboard.write([
          new window.ClipboardItem({
            'text/html': new Blob([html], { type: 'text/html' }),
            'text/plain': new Blob([plain], { type: 'text/plain' }),
          }),
        ]);
        return true;
      } catch (error) {
        if (window.console) window.console.warn('[markdown-studio] clipboard.write failed, falling back', error);
      }
    }
    return legacyCopy(html);
  }

  async function copyArticle(): Promise<void> {
    if (!doc.markdown.trim()) {
      options.notify(t('toast.empty'), 'error');
      return;
    }
    if (copyingRef.current) return;
    copyingRef.current = true;
    setCopying(true);
    try {
      const [mermaidSnapshot] = await Promise.all([
        options.mermaidAssets.ensure(doc.markdown, mermaidThemeFor(settings)),
        options.mathAssets.ensure(doc.markdown),
      ]);
      const mermaidMap = mermaidSnapshot && mermaidSnapshot.size ? mermaidSnapshot : options.mermaidAssets.cache;
      const article = renderArticle(doc.markdown, settings, {
        locale: options.locale,
        imageBaseUrl: options.localImageServerUrl || 'http://127.0.0.1:4010',
        mermaidAssets: mermaidMap,
        footnotesTitle: t('footnotes.title'),
        referencesTitle: t('references.title'),
        scrollVerticalHint: t('scroll.verticalHint'),
        scrollHorizontalHint: t('scroll.horizontalHint'),
        imagePlaceholderPrefix: t('render.imagePlaceholderPrefix'),
        imagePlaceholderFallback: t('render.imagePlaceholderFallback'),
        codeBlockAriaLabel: t('render.codeBlockAria'),
        forCopy: true,
      });
      const issues = inspectWechatHtml(article.html);
      if (issues.length) window.console.warn('[markdown-studio] clipboard compatibility', issues);
      let ok = false;
      try {
        ok = await copyRichText(article.html, article.text);
      } catch {
        ok = false;
      }
      options.notify(ok ? t('toast.copied') : t('toast.copyFailed'), ok ? 'success' : 'error');
    } catch (error) {
      options.notify(options.describeHostError(error), 'error');
    } finally {
      copyingRef.current = false;
      setCopying(false);
    }
  }

  async function copyPlainText(): Promise<void> {
    const text = markdownToPlain(doc.markdown);
    let ok = false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        ok = true;
      }
    } catch {
      ok = false;
    }
    if (!ok) {
      ok = copyViaHolder(function (holder) {
        holder.textContent = text;
      });
    }
    options.notify(ok ? t('toast.textCopied') : t('toast.copyFailed'), ok ? 'success' : 'error');
    options.setMenuOpen(false);
  }

  return { copying, copyArticle, copyPlainText };
}

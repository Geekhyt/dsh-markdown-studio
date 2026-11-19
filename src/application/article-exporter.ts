import type * as ReactNamespace from 'react';
import { renderArticle } from '../adapters/render-article';
import { assertZipBudget, type ZipEntry, zipStore } from '../adapters/zip';
import type { Article } from '../domain/article';
import { slugify } from '../domain/article';
import { findCustomTheme, mergeCustomThemes } from '../domain/custom-themes';
import { assetFilesInMarkdown } from '../domain/images';
import { parseThemePatch } from '../domain/settings';
import type { ThemeSettings } from '../themes';
import type { MathAssetsApi } from './use-math-assets';
import type { MermaidAssetsApi } from './use-mermaid-assets';

type Notify = (text: string, tone?: 'success' | 'error' | 'info') => void;

export interface ArticleExportOptions {
  React: typeof ReactNamespace;
  t: (key: string) => string;
  locale?: 'zh' | 'en';
  notify: Notify;
  doc: Article;
  settings: ThemeSettings;
  localImageServerUrl: string;
  mermaidAssets: Pick<MermaidAssetsApi, 'ensure' | 'cache'>;
  mathAssets: Pick<MathAssetsApi, 'ensure'>;
  download: (name: string, content: Blob | string, mime: string) => boolean;
  closeMenu: () => void;
  updateSettings: (patch: Partial<ThemeSettings>) => void;
}

export interface ArticleExportApi {
  exportHtml: () => Promise<void>;
  exportMarkdown: () => void;
  exportBundle: () => Promise<void>;
  exportTheme: () => void;
  importThemeFile: (file: File | null | undefined) => Promise<void>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, function (char) {
    return char === '&' ? '&amp;' : char === '<' ? '&lt;' : char === '>' ? '&gt;' : char === '"' ? '&quot;' : '&#39;';
  });
}

export function createArticleExporter(options: ArticleExportOptions): ArticleExportApi {
  const t = options.t;
  const doc = options.doc;
  const settings = options.settings;
  const base = String(options.localImageServerUrl || 'http://127.0.0.1:4010').replace(/\/+$/, '');
  const title = doc.title || t('untitled');

  function exportTheme(): void {
    const activeCustom = findCustomTheme(settings.customThemes, settings.theme);
    const payload = {
      version: 1,
      name: activeCustom ? activeCustom.name : title,
      settings: {
        theme: settings.theme,
        codeTheme: settings.codeTheme,
        accent: settings.accent,
        fontSize: settings.fontSize,
        lineHeight: settings.lineHeight,
        customThemes: settings.customThemes || [],
        linkFootnotes: settings.linkFootnotes,
        imagePlaceholders: settings.imagePlaceholders,
        codeNbsp: settings.codeNbsp,
      },
    };
    if (options.download('mdstudio-theme.json', JSON.stringify(payload, null, 2) + '\n', 'application/json')) {
      options.notify(t('toast.themeExported'));
    }
  }

  async function importThemeFile(file: File | null | undefined): Promise<void> {
    if (!file) return;
    try {
      const patch = parseThemePatch(JSON.parse(await file.text()) as unknown);
      if (!patch) throw new Error('no known fields');
      if (patch.customThemes) {
        patch.customThemes = mergeCustomThemes(settings.customThemes, patch.customThemes);
      }
      options.updateSettings(patch);
      options.notify(t('toast.themeImported'));
    } catch (error) {
      options.notify(t('toast.themeInvalid'), 'error');
    }
  }

  async function exportBundle(): Promise<void> {
    try {
      await exportBundleChecked();
    } catch (error) {
      options.notify(
        t(
          error instanceof Error && error.message === 'ZIP_LIMIT_EXCEEDED'
            ? 'library.archiveLimit'
            : 'toast.bundleFailed',
        ),
        'error',
      );
    }
  }

  async function exportBundleChecked(): Promise<void> {
    const files = assetFilesInMarkdown(doc.markdown);
    assertZipBudget(files.length + 2, 0);
    const entries: ZipEntry[] = [];
    try {
      const fetched = await Promise.all(
        files.map(async function (filename): Promise<ZipEntry> {
          const response = await fetch(base + '/uploads/' + filename);
          if (!response.ok) throw new Error('HTTP ' + response.status);
          return { name: 'assets/' + filename, data: new Uint8Array(await response.arrayBuffer()) };
        }),
      );
      entries.push(...fetched);
    } catch (error) {
      options.notify(t('toast.bundleFailed') + ' · ' + errorMessage(error), 'error');
      return;
    }
    entries.unshift({ name: 'article.md', data: new TextEncoder().encode(doc.markdown) });
    entries.push({
      name: 'README.txt',
      data: new TextEncoder().encode(
        'article.md references the images in assets/. Keep the folder next to the Markdown file.\n',
      ),
    });
    if (options.download(slugify(title) + '.zip', zipStore(entries), 'application/zip')) {
      options.notify(t('toast.bundleExported'));
    }
    options.closeMenu();
  }

  async function exportHtml(): Promise<void> {
    await Promise.all([options.mermaidAssets.ensure(doc.markdown), options.mathAssets.ensure()]);
    const article = renderArticle(doc.markdown, settings, {
      locale: options.locale,
      imageBaseUrl: base,
      mermaidAssets: options.mermaidAssets.cache,
      footnotesTitle: t('footnotes.title'),
      referencesTitle: t('references.title'),
      scrollVerticalHint: t('scroll.verticalHint'),
      scrollHorizontalHint: t('scroll.horizontalHint'),
      imagePlaceholderPrefix: t('render.imagePlaceholderPrefix'),
      imagePlaceholderFallback: t('render.imagePlaceholderFallback'),
      codeBlockAriaLabel: t('render.codeBlockAria'),
    });
    const htmlLang = options.locale === 'en' ? 'en' : 'zh-CN';
    const page =
      '<!doctype html>\n<html lang="' +
      htmlLang +
      '">\n<head>\n<meta charset="utf-8">\n' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">\n' +
      '<meta name="generator" content="dsh-markdown-studio">\n<title>' +
      escapeHtml(title) +
      '</title>\n' +
      '<style>html,body{margin:0;padding:0;background:#f1f2f4}body{padding:32px 16px}</style>\n</head>\n' +
      '<body><div style="max-width:677px;margin:0 auto;background:' +
      escapeHtml(article.bg || '#ffffff') +
      '">' +
      article.html +
      '</div></body>\n</html>';
    if (options.download(slugify(title) + '.html', page, 'text/html;charset=utf-8'))
      options.notify(t('toast.exported'));
    options.closeMenu();
  }

  function exportMarkdown(): void {
    if (options.download(slugify(title) + '.md', doc.markdown, 'text/markdown;charset=utf-8'))
      options.notify(t('toast.exported'));
    options.closeMenu();
  }

  return { exportHtml, exportMarkdown, exportBundle, exportTheme, importThemeFile };
}

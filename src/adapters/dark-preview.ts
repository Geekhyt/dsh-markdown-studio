import { contrast, DARK_STAGE_DEFAULT, ensureContrast, parseHex, rgbToHex } from '../theme-system/color';

const DARK_TEXT_MIN_CONTRAST = 4.5;

function rgbTuple(color: string): [number, number, number] | null {
  const rgb = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(color);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  const srgb = /color\(\s*srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/i.exec(color);
  if (srgb) return [Number(srgb[1]) * 255, Number(srgb[2]) * 255, Number(srgb[3]) * 255];
  return null;
}

export function alphaOf(color: string): number {
  const value = String(color || '').trim();
  if (value.toLowerCase() === 'transparent') return 0;
  const match =
    /(?:rgba?\(\s*[\d.]+[,\s]+[\d.]+[,\s]+[\d.]+\s*[,/]|color\(\s*srgb\s+[\d.]+\s+[\d.]+\s+[\d.]+\s*\/)\s*([\d.]+)\s*\)/i.exec(
      value,
    );
  return match ? Number(match[1]) : 1;
}

function luminance(color: string): number {
  const rgb = rgbTuple(color);
  if (!rgb) return 1;
  const channels = rgb.map(function (value) {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function compositeOver(
  fg: [number, number, number],
  alpha: number,
  bg: [number, number, number],
): [number, number, number] {
  const a = Math.max(0, Math.min(1, alpha));
  return [fg[0] * a + bg[0] * (1 - a), fg[1] * a + bg[1] * (1 - a), fg[2] * a + bg[2] * (1 - a)];
}

function nearestOpaqueBgHex(element: HTMLElement, stopAt: HTMLElement): { hex: string; lum: number } {
  const layers: Array<{ rgb: [number, number, number]; alpha: number }> = [];
  let baseRgb: [number, number, number] = parseHex(DARK_STAGE_DEFAULT);
  let cursor: HTMLElement | null = element;
  while (cursor) {
    const bg = window.getComputedStyle(cursor).backgroundColor;
    const alpha = alphaOf(bg);
    if (alpha > 0.01) {
      const rgb = rgbTuple(bg);
      if (rgb) {
        if (alpha >= 0.99) {
          baseRgb = rgb;
          break;
        }
        layers.push({ rgb, alpha });
      }
    }
    if (cursor === stopAt) break;
    cursor = cursor.parentElement;
  }
  let blended = baseRgb;
  for (let i = layers.length - 1; i >= 0; i--) {
    blended = compositeOver(layers[i].rgb, layers[i].alpha, blended);
  }
  const hex = rgbToHex(blended[0], blended[1], blended[2]);
  return { hex, lum: luminance(`rgb(${blended[0]}, ${blended[1]}, ${blended[2]})`) };
}

function hasDirectTextOrMath(element: HTMLElement): boolean {
  if (element.classList.contains('mdstudio-math')) return true;
  for (let node = element.firstChild; node; node = node.nextSibling) {
    if (node.nodeType === 3 && (node.nodeValue || '').trim()) return true;
  }
  return false;
}

/**
 * Guarantee WCAG AA (>= 4.5:1) legibility on dark surfaces across every
 * text-bearing element rather than relying on a fixed tag allowlist.
 */
function liftDarkText(root: HTMLElement): void {
  if (typeof window === 'undefined') return;
  root.querySelectorAll<HTMLElement>('*').forEach(function (element) {
    if (element.closest('svg') || !hasDirectTextOrMath(element)) return;
    const bg = nearestOpaqueBgHex(element, root);
    if (bg.lum >= 0.25) return;
    const color = window.getComputedStyle(element).color;
    const fgRgb = rgbTuple(color);
    if (!fgRgb) return;
    const fgHex = rgbToHex(fgRgb[0], fgRgb[1], fgRgb[2]);
    if (contrast(fgHex, bg.hex) >= DARK_TEXT_MIN_CONTRAST) return;
    element.style.setProperty('color', ensureContrast(fgHex, bg.hex, DARK_TEXT_MIN_CONTRAST), 'important');
  });
}

function normalizeDarkSurfaces(root: HTMLElement): void {
  if (typeof window === 'undefined') return;
  root.querySelectorAll<HTMLElement>('*').forEach(function (element) {
    if (element.closest('svg')) return;
    if (/^(IMG|VIDEO|IFRAME|CANVAS)$/i.test(element.tagName)) return;
    const style = window.getComputedStyle(element);
    const background = style.backgroundColor;
    const image = style.backgroundImage;
    if (image && image !== 'none' && image.indexOf('url(') === -1) {
      element.style.setProperty('background-image', 'none', 'important');
    }
    if (alphaOf(background) < 0.08 || luminance(background) <= 0.42) return;
    element.style.setProperty('background-color', 'color-mix(in srgb, ' + background + ' 12%, #1b1d22)', 'important');
  });
}

type DarkmodeApi = typeof import('mp-darkmode');
let loadedDarkmode: DarkmodeApi | null = null;

function tagDarkmodeStyles(): void {
  if (typeof document === 'undefined') return;
  document.querySelectorAll<HTMLStyleElement>('style[id^="js_darkmode_style__"]').forEach(function (tag) {
    tag.dataset.plugin = 'dsh-markdown-studio';
  });
}

export function cleanupDarkPreview(): void {
  if (typeof document === 'undefined') return;
  try {
    loadedDarkmode?.reset?.([]);
  } catch {
    /* ignore reset failure on detached documents */
  }
  document.documentElement?.classList?.remove('data_color_scheme_dark');
  document.querySelectorAll<HTMLStyleElement>('style[id^="js_darkmode_style__"]').forEach(function (tag) {
    tag.remove();
  });
}

/**
 * Apply WeChat's official Dark Mode transform to a preview clone. The source
 * HTML and clipboard output stay in the authored light theme.
 */
export async function applyDarkPreview(article: HTMLElement, isCancelled?: () => boolean): Promise<boolean> {
  try {
    const root = article.querySelector<HTMLElement>('#mdstudio');
    if (root) {
      const initial = window.getComputedStyle(root).backgroundColor;
      if (alphaOf(initial) > 0.1 && luminance(initial) < 0.2) {
        cleanupDarkPreview();
        return true;
      }
    }
    const Darkmode = await import('mp-darkmode');
    if (isCancelled?.() || !article.isConnected) return false;
    loadedDarkmode = Darkmode;
    if (typeof Darkmode.reset === 'function') Darkmode.reset([]);
    if (root) {
      const initialBg = window.getComputedStyle(root).backgroundColor;
      if (alphaOf(initialBg) < 0.1) root.style.setProperty('background-color', '#ffffff');
      if (!root.style.color) root.style.setProperty('color', '#1f2328');
    }
    const target = root || article;
    const nodes = [target, ...Array.from(target.querySelectorAll<HTMLElement>('*'))];
    Darkmode.run(nodes, { mode: 'dark' });
    tagDarkmodeStyles();
    if (root) {
      normalizeDarkSurfaces(root);
      liftDarkText(root);
    }
    return true;
  } catch (error) {
    if (typeof window !== 'undefined' && window.console) {
      window.console.warn('[markdown-studio] dark preview failed', error);
    }
    return false;
  }
}

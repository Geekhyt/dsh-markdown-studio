import { contrast, DARK_STAGE_DEFAULT, ensureContrast, parseHex, rgbToHex } from '../theme-system/color';

const DARK_TEXT_MIN_CONTRAST = 4.6;

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

function readBgLayer(element: HTMLElement): { rgb: [number, number, number]; alpha: number } | null {
  const bg = window.getComputedStyle(element).backgroundColor;
  const alpha = alphaOf(bg);
  if (alpha <= 0.01) return null;
  const rgb = rgbTuple(bg);
  return rgb ? { rgb, alpha } : null;
}

function nextAncestor(cursor: HTMLElement, stopAt: HTMLElement): HTMLElement | null {
  return cursor === stopAt ? null : cursor.parentElement;
}

function blendColorLayers(
  layers: Array<{ rgb: [number, number, number]; alpha: number }>,
  baseRgb: [number, number, number],
): [number, number, number] {
  let blended = baseRgb;
  for (let i = layers.length - 1; i >= 0; i--) {
    blended = compositeOver(layers[i].rgb, layers[i].alpha, blended);
  }
  return blended;
}

function nearestOpaqueBgHex(
  element: HTMLElement,
  stopAt: HTMLElement,
): { rgb: [number, number, number]; hex: string; lum: number } {
  const layers: Array<{ rgb: [number, number, number]; alpha: number }> = [];
  let baseRgb: [number, number, number] = parseHex(DARK_STAGE_DEFAULT);
  for (let cursor: HTMLElement | null = element; cursor; cursor = nextAncestor(cursor, stopAt)) {
    const layer = readBgLayer(cursor);
    if (!layer) continue;
    if (layer.alpha >= 0.99) {
      baseRgb = layer.rgb;
      break;
    }
    layers.push(layer);
  }
  const blended = blendColorLayers(layers, baseRgb);
  const hex = rgbToHex(blended[0], blended[1], blended[2]);
  return { rgb: blended, hex, lum: luminance(`rgb(${blended[0]}, ${blended[1]}, ${blended[2]})`) };
}

function isNonEmptyTextNode(node: ChildNode): boolean {
  return node.nodeType === 3 && Boolean((node.nodeValue || '').trim());
}

function hasDirectTextOrMath(element: HTMLElement): boolean {
  if (element.classList.contains('mdstudio-math')) return true;
  for (let node = element.firstChild; node; node = node.nextSibling) {
    if (isNonEmptyTextNode(node)) return true;
  }
  return false;
}

function resolveFgHex(element: HTMLElement, bgRgb: [number, number, number]): string | null {
  const raw = window.getComputedStyle(element).color;
  const fgRgb = rgbTuple(raw);
  if (!fgRgb) return null;
  const alpha = alphaOf(raw);
  const effective = alpha < 0.99 ? compositeOver(fgRgb, alpha, bgRgb) : fgRgb;
  return rgbToHex(effective[0], effective[1], effective[2]);
}

function shouldLiftElement(element: HTMLElement): boolean {
  return !element.closest('svg') && hasDirectTextOrMath(element);
}

function needsContrastLift(fgHex: string | null, bgHex: string): fgHex is string {
  return Boolean(fgHex) && contrast(fgHex as string, bgHex) < DARK_TEXT_MIN_CONTRAST;
}

function liftElementContrast(element: HTMLElement, root: HTMLElement): void {
  if (!shouldLiftElement(element)) return;
  const bg = nearestOpaqueBgHex(element, root);
  if (bg.lum >= 0.25) return;
  const fgHex = resolveFgHex(element, bg.rgb);
  if (!needsContrastLift(fgHex, bg.hex)) return;
  element.style.setProperty('color', ensureContrast(fgHex, bg.hex, DARK_TEXT_MIN_CONTRAST), 'important');
}

/**
 * Guarantee WCAG AA (>= 4.5:1) legibility on dark surfaces across every
 * text-bearing element rather than relying on a fixed tag allowlist.
 */
function liftDarkText(root: HTMLElement): void {
  if (typeof window === 'undefined') return;
  liftElementContrast(root, root);
  root.querySelectorAll<HTMLElement>('*').forEach(function (element) {
    liftElementContrast(element, root);
  });
}

function isMediaOrSvg(element: HTMLElement): boolean {
  return Boolean(element.closest('svg')) || /^(IMG|VIDEO|IFRAME|CANVAS)$/i.test(element.tagName);
}

function clearNonUrlBgImage(element: HTMLElement, image: string): void {
  if (image && image !== 'none' && image.indexOf('url(') === -1) {
    element.style.setProperty('background-image', 'none', 'important');
  }
}

function normalizeSurfaceElement(element: HTMLElement): void {
  if (isMediaOrSvg(element)) return;
  const style = window.getComputedStyle(element);
  clearNonUrlBgImage(element, style.backgroundImage);
  const background = style.backgroundColor;
  if (alphaOf(background) < 0.08 || luminance(background) <= 0.42) return;
  element.style.setProperty('background-color', 'color-mix(in srgb, ' + background + ' 12%, #1b1d22)', 'important');
}

function normalizeDarkSurfaces(root: HTMLElement): void {
  if (typeof window === 'undefined') return;
  normalizeSurfaceElement(root);
  root.querySelectorAll<HTMLElement>('*').forEach(normalizeSurfaceElement);
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

function isAlreadyDarkRoot(root: HTMLElement | null): boolean {
  if (!root) return false;
  const initial = window.getComputedStyle(root).backgroundColor;
  return alphaOf(initial) > 0.1 && luminance(initial) < 0.2;
}

function isCancelledOrDetached(article: HTMLElement, isCancelled?: () => boolean): boolean {
  return Boolean(isCancelled?.()) || !article.isConnected;
}

function prepareLightRoot(root: HTMLElement | null): void {
  if (!root) return;
  const initialBg = window.getComputedStyle(root).backgroundColor;
  if (alphaOf(initialBg) < 0.1) root.style.setProperty('background-color', '#ffffff');
  if (!root.style.color) root.style.setProperty('color', '#1f2328');
}

function runDarkmodeOnTarget(Darkmode: DarkmodeApi, target: HTMLElement): void {
  if (typeof Darkmode.reset === 'function') Darkmode.reset([]);
  const nodes = [target, ...Array.from(target.querySelectorAll<HTMLElement>('*'))];
  Darkmode.run(nodes, { mode: 'dark' });
  tagDarkmodeStyles();
}

function finalizeDarkRoot(root: HTMLElement | null): void {
  if (!root) return;
  normalizeDarkSurfaces(root);
  liftDarkText(root);
}

function warnDarkPreviewFailure(error: unknown): void {
  if (typeof window !== 'undefined' && window.console) {
    window.console.warn('[markdown-studio] dark preview failed', error);
  }
}

/**
 * Apply WeChat's official Dark Mode transform to a preview clone. The source
 * HTML and clipboard output stay in the authored light theme.
 */
export async function applyDarkPreview(article: HTMLElement, isCancelled?: () => boolean): Promise<boolean> {
  try {
    const root = article.querySelector<HTMLElement>('#mdstudio');
    if (isAlreadyDarkRoot(root)) {
      cleanupDarkPreview();
      return true;
    }
    const Darkmode = await import('mp-darkmode');
    if (isCancelledOrDetached(article, isCancelled)) return false;
    loadedDarkmode = Darkmode;
    prepareLightRoot(root);
    runDarkmodeOnTarget(Darkmode, root || article);
    finalizeDarkRoot(root);
    return true;
  } catch (error) {
    warnDarkPreviewFailure(error);
    return false;
  }
}

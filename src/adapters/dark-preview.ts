import { contrast, DARK_STAGE_DEFAULT, ensureContrast, parseHex, rgbToHex } from '../theme-system/color';

const DARK_TEXT_MIN_CONTRAST = 4.6;
const COLOR_CACHE_LIMIT = 256;

type RgbaTuple = [number, number, number, number];

let probeCanvasCtx: CanvasRenderingContext2D | null | undefined;
const browserRgbaCache = new Map<string, RgbaTuple | null>();

function isProbeSample(data: Uint8ClampedArray): boolean {
  return data[0] === 1 && data[1] === 2 && data[2] === 3 && data[3] === 255;
}

function getColorProbeContext(): CanvasRenderingContext2D | null {
  if (probeCanvasCtx !== undefined) return probeCanvasCtx;
  if (typeof document === 'undefined' || /jsdom/i.test(typeof navigator !== 'undefined' ? navigator.userAgent : '')) {
    return (probeCanvasCtx = null);
  }
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx || typeof ctx.getImageData !== 'function') return (probeCanvasCtx = null);
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = '#010203';
    ctx.fillRect(0, 0, 1, 1);
    probeCanvasCtx = isProbeSample(ctx.getImageData(0, 0, 1, 1).data) ? ctx : null;
  } catch {
    probeCanvasCtx = null;
  }
  return probeCanvasCtx;
}

function assignProbeColor(ctx: CanvasRenderingContext2D, value: string): boolean {
  ctx.fillStyle = '#010203';
  ctx.fillStyle = value;
  if (ctx.fillStyle !== '#010203') return true;
  ctx.fillStyle = '#040506';
  ctx.fillStyle = value;
  return ctx.fillStyle !== '#040506';
}

/**
 * Resolve any browser-supported CSS Color 4/5 expression (oklch, oklab, lch, lab,
 * hwb, display-p3, rec2020, color-mix, relative colors, named colors) directly via
 * the browser's native 2D canvas sRGB rasterizer. Returns `undefined` when Canvas 2D
 * is unavailable (e.g. JSDOM), signaling callers to use the pure JS fallback.
 */
function resolveBrowserRgba(color: string): RgbaTuple | null | undefined {
  const ctx = getColorProbeContext();
  if (!ctx) return undefined;
  const key = color.trim();
  if (!key) return null;
  const cached = browserRgbaCache.get(key);
  if (cached !== undefined) return cached;
  let resolved: RgbaTuple | null = null;
  if (assignProbeColor(ctx, key)) {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    resolved = [d[0], d[1], d[2], d[3] / 255];
  }
  if (browserRgbaCache.size >= COLOR_CACHE_LIMIT) browserRgbaCache.clear();
  browserRgbaCache.set(key, resolved);
  return resolved;
}

function linearToSrgb255(linear: number): number {
  const clamped = Math.max(0, Math.min(1, linear));
  const encoded = clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, encoded * 255));
}

function srgbToLinear(v: number): number {
  const c = Math.max(0, Math.min(1, v));
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function oklabToRgb(L: number, a: number, b: number): [number, number, number] {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;
  const lr = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const lg = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const lb = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  return [linearToSrgb255(lr), linearToSrgb255(lg), linearToSrgb255(lb)];
}

function parseAngleRad(raw: string): number {
  if (raw === 'none') return 0;
  const val = parseFloat(raw);
  if (!Number.isFinite(val)) return 0;
  if (raw.endsWith('grad')) return (val * Math.PI) / 200;
  if (raw.endsWith('rad')) return val;
  if (raw.endsWith('turn')) return val * Math.PI * 2;
  return (val * Math.PI) / 180;
}

function parseColor4Component(raw: string, pctScale: number): number {
  if (raw.toLowerCase() === 'none') return 0;
  return raw.endsWith('%') ? (parseFloat(raw) / 100) * pctScale : parseFloat(raw);
}

const OPAQUE_RGB_RE = /^rgba?\(\s*[\d.]+[,\s]+[\d.]+[,\s]+[\d.]+\s*\)$/i;
const OPAQUE_HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const RGB_PREFIX_RE = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/][^)]*)?\s*\)$/i;
const SLASH_ALPHA_RE = /^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^()]+\/\s*(none|[\d.eE+-]+%?)\s*\)$/i;
const LEGACY_RGBA_ALPHA_RE = /^rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*(none|[\d.eE+-]+%?)\s*\)$/i;

function parseCssColor4Fallback(color: string): [number, number, number] | null {
  const value = color.trim();
  const srgb = /^color\(\s*srgb\s+(none|[\d.eE+-]+)\s+(none|[\d.eE+-]+)\s+(none|[\d.eE+-]+)/i.exec(value);
  if (srgb) {
    return [
      parseColor4Component(srgb[1], 1) * 255,
      parseColor4Component(srgb[2], 1) * 255,
      parseColor4Component(srgb[3], 1) * 255,
    ];
  }
  const p3 = /^color\(\s*display-p3\s+(none|[\d.eE+-]+)\s+(none|[\d.eE+-]+)\s+(none|[\d.eE+-]+)/i.exec(value);
  if (p3) {
    const lr = srgbToLinear(parseColor4Component(p3[1], 1));
    const lg = srgbToLinear(parseColor4Component(p3[2], 1));
    const lb = srgbToLinear(parseColor4Component(p3[3], 1));
    return [
      linearToSrgb255(1.2249401 * lr - 0.2246988 * lg - 0.0002413 * lb),
      linearToSrgb255(-0.0420569 * lr + 1.0419966 * lg + 0.0000603 * lb),
      linearToSrgb255(-0.0196376 * lr - 0.0786361 * lg + 1.0982737 * lb),
    ];
  }
  const oklab = /^oklab\(\s*(none|[\d.eE+-]+%?)\s+(none|[\d.eE+-]+%?)\s+(none|[\d.eE+-]+%?)/i.exec(value);
  if (oklab) {
    return oklabToRgb(
      parseColor4Component(oklab[1], 1),
      parseColor4Component(oklab[2], 0.4),
      parseColor4Component(oklab[3], 0.4),
    );
  }
  const oklch = /^oklch\(\s*(none|[\d.eE+-]+%?)\s+(none|[\d.eE+-]+%?)\s+(none|[\d.eE+-]+(?:deg|rad|grad|turn)?)/i.exec(
    value,
  );
  if (oklch) {
    const L = parseColor4Component(oklch[1], 1);
    const C = parseColor4Component(oklch[2], 0.4);
    const H = parseAngleRad(oklch[3].toLowerCase());
    return oklabToRgb(L, C * Math.cos(H), C * Math.sin(H));
  }
  return null;
}

function rgbTuple(color: string): [number, number, number] | null {
  const value = String(color || '').trim();
  const rgb = RGB_PREFIX_RE.exec(value);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  const native = resolveBrowserRgba(value);
  if (native !== undefined) return native ? [native[0], native[1], native[2]] : null;
  return parseCssColor4Fallback(value);
}

export function alphaOf(color: string): number {
  const value = String(color || '').trim();
  if (value.toLowerCase() === 'transparent') return 0;
  if (OPAQUE_RGB_RE.test(value) || OPAQUE_HEX_RE.test(value)) return 1;
  const slash = SLASH_ALPHA_RE.exec(value);
  if (slash) return parseColor4Component(slash[1], 1);
  const legacy = LEGACY_RGBA_ALPHA_RE.exec(value);
  if (legacy) return parseColor4Component(legacy[1], 1);
  const native = resolveBrowserRgba(value);
  return native ? native[3] : 1;
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

function shouldLiftElement(element: HTMLElement, darkened: ReadonlySet<HTMLElement>): boolean {
  if (element.closest('svg')) return false;
  return element.tagName === 'LI' || darkened.has(element) || hasDirectTextOrMath(element);
}

function needsContrastLift(fgHex: string | null, bgHex: string): fgHex is string {
  return Boolean(fgHex) && contrast(fgHex as string, bgHex) < DARK_TEXT_MIN_CONTRAST;
}

function liftElementContrast(element: HTMLElement, root: HTMLElement, darkened: ReadonlySet<HTMLElement>): void {
  if (!shouldLiftElement(element, darkened)) return;
  const bg = nearestOpaqueBgHex(element, root);
  if (bg.lum >= 0.25) return;
  const fgHex = resolveFgHex(element, bg.rgb);
  if (!needsContrastLift(fgHex, bg.hex)) return;
  element.style.setProperty('color', ensureContrast(fgHex, bg.hex, DARK_TEXT_MIN_CONTRAST), 'important');
}

/**
 * Guarantee WCAG AA (>= 4.5:1) legibility on dark surfaces across every
 * text-bearing element, list marker owner (`<li>`), and darkened surface container.
 */
function liftDarkText(root: HTMLElement, darkened: ReadonlySet<HTMLElement>): void {
  if (typeof window === 'undefined') return;
  liftElementContrast(root, root, darkened);
  root.querySelectorAll<HTMLElement>('*').forEach(function (element) {
    liftElementContrast(element, root, darkened);
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

function normalizeSurfaceElement(element: HTMLElement, root: HTMLElement, darkened: Set<HTMLElement>): void {
  if (isMediaOrSvg(element)) return;
  const style = window.getComputedStyle(element);
  clearNonUrlBgImage(element, style.backgroundImage);
  const background = style.backgroundColor;
  const alpha = alphaOf(background);
  if (alpha < 0.08) return;
  const rgb = rgbTuple(background);
  if (!rgb) return;
  let effectiveLum = luminance(`rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`);
  if (alpha < 0.99) {
    const backdrop =
      element === root ? parseHex(DARK_STAGE_DEFAULT) : nearestOpaqueBgHex(element.parentElement || root, root).rgb;
    const blended = compositeOver(rgb, alpha, backdrop);
    effectiveLum = luminance(`rgb(${blended[0]}, ${blended[1]}, ${blended[2]})`);
  }
  if (effectiveLum <= 0.42) return;
  element.style.setProperty('background-color', 'color-mix(in srgb, ' + background + ' 12%, #1b1d22)', 'important');
  darkened.add(element);
}

function normalizeDarkSurfaces(root: HTMLElement): Set<HTMLElement> {
  const darkened = new Set<HTMLElement>();
  if (typeof window === 'undefined') return darkened;
  normalizeSurfaceElement(root, root, darkened);
  root.querySelectorAll<HTMLElement>('*').forEach(function (element) {
    normalizeSurfaceElement(element, root, darkened);
  });
  return darkened;
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
  const darkened = normalizeDarkSurfaces(root);
  liftDarkText(root, darkened);
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
    cleanupDarkPreview();
    warnDarkPreviewFailure(error);
    return false;
  }
}

import { isPluginLifecycleMounted, onPluginLifecycleUnmount } from '../runtime/react-lifecycle';
import { contrast, DARK_STAGE_DEFAULT, ensureContrast, parseHex, rgbToHex } from '../theme-system/color';

const DARK_TEXT_MIN_CONTRAST = 4.6;
const COLOR_CACHE_LIMIT = 256;
const DARK_SURFACE_MIX_RGB: [number, number, number] = [27, 29, 34];
const DARK_STAGE_RGB: [number, number, number] = parseHex(DARK_STAGE_DEFAULT);
const MEDIA_TAG_RE = /^(?:IMG|VIDEO|IFRAME|CANVAS)$/i;

type RgbaTuple = [number, number, number, number];
type RgbTuple = [number, number, number];

interface DarkmodeApi {
  run(nodes: HTMLElement[], opt?: { mode?: string }, container?: HTMLElement): void;
  reset(nodes: HTMLElement[]): void;
}

interface DarkAdjustmentPlan {
  bgImageClears: HTMLElement[];
  surfaceDarkens: Array<[HTMLElement, string]>;
  colorLifts: Array<[HTMLElement, string]>;
  darkened: Set<HTMLElement>;
}

let probeCanvasCtx: CanvasRenderingContext2D | null | undefined;
const browserRgbaCache = new Map<string, RgbaTuple | null>();
let loadedDarkmode: DarkmodeApi | null = null;
let sharedDarkmodeLoadPromise: Promise<DarkmodeApi | null> | null = null;

onPluginLifecycleUnmount(() => {
  sharedDarkmodeLoadPromise = null;
  loadedDarkmode = null;
});

function isProbeSample(data: Uint8ClampedArray): boolean {
  return data[0] === 1 && data[1] === 2 && data[2] === 3 && data[3] === 255;
}

function isJsdomEnvironment(): boolean {
  const winUa = typeof window !== 'undefined' && window.navigator ? window.navigator.userAgent : '';
  const navUa = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  return /jsdom/i.test(winUa) || /jsdom/i.test(navUa);
}

function getColorProbeContext(): CanvasRenderingContext2D | null {
  if (probeCanvasCtx !== undefined) return probeCanvasCtx;
  if (typeof document === 'undefined' || isJsdomEnvironment()) {
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

function oklabToRgb(L: number, a: number, b: number): RgbTuple {
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

const OPAQUE_RGB_RE = /^rgba?\(\s*[\d.]+%?[,\s]+[\d.]+%?[,\s]+[\d.]+%?\s*\)$/i;
const OPAQUE_HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const HEX_ALPHA_4_RE = /^#([0-9a-f])([0-9a-f])([0-9a-f])([0-9a-f])$/i;
const HEX_ALPHA_8_RE = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;
const RGB_PREFIX_RE = /^rgba?\(\s*([\d.]+%?)[,\s]+([\d.]+%?)[,\s]+([\d.]+%?)(?:[,\s/][^)]*)?\s*\)$/i;
const HSL_RE =
  /^hsla?\(\s*(none|[\d.eE+-]+(?:deg|rad|grad|turn)?)[,\s]+(none|[\d.eE+-]+%?)[,\s]+(none|[\d.eE+-]+%?)(?:[,\s/][^)]*)?\s*\)$/i;
const SLASH_ALPHA_RE = /^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^()]+\/\s*(none|[\d.eE+-]+%?)\s*\)$/i;
const LEGACY_ALPHA_RE = /^(?:rgba?|hsla?)\(\s*[^,]+,\s*[^,]+,\s*[^,]+,\s*(none|[\d.eE+-]+%?)\s*\)$/i;

function clamp255(n: number): number {
  return Math.max(0, Math.min(255, n));
}

function hslChannel(hDeg: number, s: number, l: number, n: number): number {
  const k = (n + hDeg / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
}

function hslToRgbTuple(hRad: number, sPct: number, lPct: number): RgbTuple {
  const hDeg = ((((hRad * 180) / Math.PI) % 360) + 360) % 360;
  const s = Math.max(0, Math.min(1, sPct / 100));
  const l = Math.max(0, Math.min(1, lPct / 100));
  return [
    clamp255(hslChannel(hDeg, s, l, 0) * 255),
    clamp255(hslChannel(hDeg, s, l, 8) * 255),
    clamp255(hslChannel(hDeg, s, l, 4) * 255),
  ];
}

function parseCssColor4Fallback(color: string): RgbTuple | null {
  const value = color.trim();
  const hex4 = HEX_ALPHA_4_RE.exec(value);
  if (hex4) return [parseInt(hex4[1] + hex4[1], 16), parseInt(hex4[2] + hex4[2], 16), parseInt(hex4[3] + hex4[3], 16)];
  const hex8 = HEX_ALPHA_8_RE.exec(value);
  if (hex8) return [parseInt(hex8[1], 16), parseInt(hex8[2], 16), parseInt(hex8[3], 16)];
  const hsl = HSL_RE.exec(value);
  if (hsl) {
    return hslToRgbTuple(
      parseAngleRad(hsl[1].toLowerCase()),
      parseColor4Component(hsl[2], 100),
      parseColor4Component(hsl[3], 100),
    );
  }
  const srgb = /^color\(\s*srgb\s+(none|[\d.eE+-]+%?)\s+(none|[\d.eE+-]+%?)\s+(none|[\d.eE+-]+%?)/i.exec(value);
  if (srgb) {
    return [
      clamp255(parseColor4Component(srgb[1], 1) * 255),
      clamp255(parseColor4Component(srgb[2], 1) * 255),
      clamp255(parseColor4Component(srgb[3], 1) * 255),
    ];
  }
  const p3 = /^color\(\s*display-p3\s+(none|[\d.eE+-]+%?)\s+(none|[\d.eE+-]+%?)\s+(none|[\d.eE+-]+%?)/i.exec(value);
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

function rgbTuple(color: string): RgbTuple | null {
  const value = String(color || '').trim();
  const rgb = RGB_PREFIX_RE.exec(value);
  if (rgb) {
    return [
      clamp255(parseColor4Component(rgb[1], 255)),
      clamp255(parseColor4Component(rgb[2], 255)),
      clamp255(parseColor4Component(rgb[3], 255)),
    ];
  }
  const native = resolveBrowserRgba(value);
  if (native !== undefined) return native ? [native[0], native[1], native[2]] : null;
  return parseCssColor4Fallback(value);
}

export function alphaOf(color: string): number {
  const value = String(color || '').trim();
  if (value.toLowerCase() === 'transparent') return 0;
  if (OPAQUE_RGB_RE.test(value) || OPAQUE_HEX_RE.test(value)) return 1;
  const hex4 = HEX_ALPHA_4_RE.exec(value);
  if (hex4) return parseInt(hex4[4] + hex4[4], 16) / 255;
  const hex8 = HEX_ALPHA_8_RE.exec(value);
  if (hex8) return parseInt(hex8[4], 16) / 255;
  const slash = SLASH_ALPHA_RE.exec(value);
  if (slash) return parseColor4Component(slash[1], 1);
  const legacy = LEGACY_ALPHA_RE.exec(value);
  if (legacy) return parseColor4Component(legacy[1], 1);
  const native = resolveBrowserRgba(value);
  return native ? native[3] : 1;
}

function channelToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function rgbLuminance(rgb: RgbTuple): number {
  return 0.2126 * channelToLinear(rgb[0]) + 0.7152 * channelToLinear(rgb[1]) + 0.0722 * channelToLinear(rgb[2]);
}

function luminance(color: string): number {
  const rgb = rgbTuple(color);
  return rgb ? rgbLuminance(rgb) : 1;
}

function compositeOver(fg: RgbTuple, alpha: number, bg: RgbTuple): RgbTuple {
  const a = Math.max(0, Math.min(1, alpha));
  return [fg[0] * a + bg[0] * (1 - a), fg[1] * a + bg[1] * (1 - a), fg[2] * a + bg[2] * (1 - a)];
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

function resolveColorHex(raw: string, bgRgb: RgbTuple): string | null {
  const fgRgb = rgbTuple(raw);
  if (!fgRgb) return null;
  const alpha = alphaOf(raw);
  // Preserve authored `color: transparent` (e.g. unchecked task checkboxes) instead of turning it visible gray.
  if (alpha <= 0.01) return null;
  const effective = alpha < 0.99 ? compositeOver(fgRgb, alpha, bgRgb) : fgRgb;
  return rgbToHex(effective[0], effective[1], effective[2]);
}

function shouldLiftElement(element: HTMLElement, darkened: ReadonlySet<HTMLElement>): boolean {
  return element.tagName === 'LI' || darkened.has(element) || hasDirectTextOrMath(element);
}

function needsContrastLift(fgHex: string | null, bgHex: string): fgHex is string {
  return Boolean(fgHex) && contrast(fgHex as string, bgHex) < DARK_TEXT_MIN_CONTRAST;
}

function evaluateSurfaceBg(
  element: HTMLElement,
  bg: string,
  parentBgRgb: RgbTuple,
  plan: DarkAdjustmentPlan,
): RgbTuple {
  const alpha = alphaOf(bg);
  if (alpha <= 0.01) return parentBgRgb;
  const rgb = rgbTuple(bg);
  if (!rgb) return parentBgRgb;
  const blended = alpha < 0.99 ? compositeOver(rgb, alpha, parentBgRgb) : rgb;
  if (alpha >= 0.08 && rgbLuminance(blended) > 0.42) {
    plan.surfaceDarkens.push([element, 'color-mix(in srgb, ' + bg + ' 12%, #1b1d22)']);
    plan.darkened.add(element);
    return compositeOver(blended, 0.12, DARK_SURFACE_MIX_RGB);
  }
  return blended;
}

function planDarkSubtree(element: HTMLElement, parentBgRgb: RgbTuple, plan: DarkAdjustmentPlan): void {
  if (element.tagName.toLowerCase() === 'svg') return;
  const isMedia = MEDIA_TAG_RE.test(element.tagName);
  const style = window.getComputedStyle(element);
  let effectiveBgRgb = parentBgRgb;
  if (!isMedia) {
    const bgImage = style.backgroundImage;
    if (bgImage && bgImage !== 'none' && bgImage.indexOf('url(') === -1) {
      plan.bgImageClears.push(element);
    }
    effectiveBgRgb = evaluateSurfaceBg(element, style.backgroundColor, parentBgRgb, plan);
    if (shouldLiftElement(element, plan.darkened) && rgbLuminance(effectiveBgRgb) < 0.45) {
      const bgHex = rgbToHex(effectiveBgRgb[0], effectiveBgRgb[1], effectiveBgRgb[2]);
      const fgHex = resolveColorHex(style.color, effectiveBgRgb);
      if (needsContrastLift(fgHex, bgHex)) {
        plan.colorLifts.push([element, ensureContrast(fgHex, bgHex, DARK_TEXT_MIN_CONTRAST)]);
      }
    }
  }
  for (let child = element.firstElementChild; child; child = child.nextElementSibling) {
    planDarkSubtree(child as HTMLElement, effectiveBgRgb, plan);
  }
}

function flushDarkAdjustments(plan: DarkAdjustmentPlan): void {
  for (let i = 0; i < plan.bgImageClears.length; i++) {
    plan.bgImageClears[i].style.setProperty('background-image', 'none', 'important');
  }
  for (let i = 0; i < plan.surfaceDarkens.length; i++) {
    const [el, value] = plan.surfaceDarkens[i];
    el.style.setProperty('background-color', value, 'important');
  }
  for (let i = 0; i < plan.colorLifts.length; i++) {
    const [el, value] = plan.colorLifts[i];
    el.style.setProperty('color', value, 'important');
  }
}

function readRootEffectiveBgRgb(root: HTMLElement): RgbTuple {
  const raw = window.getComputedStyle(root).backgroundColor;
  const alpha = alphaOf(raw);
  if (alpha <= 0.01) return DARK_STAGE_RGB;
  const rgb = rgbTuple(raw);
  if (!rgb) return DARK_STAGE_RGB;
  return alpha < 0.99 ? compositeOver(rgb, alpha, DARK_STAGE_RGB) : rgb;
}

/**
 * Single-pass FastDOM Read -> Compute -> Write dark surface normalization and
 * WCAG AA (>= 4.5:1) contrast lifting, eliminating O(N*depth) layout thrashing.
 */
function finalizeDarkRoot(root: HTMLElement | null, dirtyBlocks?: readonly HTMLElement[]): void {
  if (!root || typeof window === 'undefined') return;
  const plan: DarkAdjustmentPlan = {
    bgImageClears: [],
    surfaceDarkens: [],
    colorLifts: [],
    darkened: new Set<HTMLElement>(),
  };
  if (dirtyBlocks && dirtyBlocks.length > 0) {
    const rootBgRgb = readRootEffectiveBgRgb(root);
    for (let i = 0; i < dirtyBlocks.length; i++) {
      planDarkSubtree(dirtyBlocks[i], rootBgRgb, plan);
    }
  } else {
    planDarkSubtree(root, DARK_STAGE_RGB, plan);
  }
  flushDarkAdjustments(plan);
}

function getWindowDarkmode(): DarkmodeApi | null {
  if (typeof window === 'undefined') return null;
  return window.__MDSTUDIO_DARKMODE__ || null;
}

function loadDarkmodeRuntime(): Promise<DarkmodeApi | null> {
  const existing = getWindowDarkmode();
  if (existing) {
    loadedDarkmode = existing;
    return Promise.resolve(existing);
  }
  if (typeof document === 'undefined' || isJsdomEnvironment()) {
    return Promise.resolve(null);
  }
  if (sharedDarkmodeLoadPromise) return sharedDarkmodeLoadPromise;
  sharedDarkmodeLoadPromise = new Promise(function (resolve) {
    const script = document.createElement('script');
    script.src = '/api/markdown-studio/darkmode.js';
    script.async = true;
    script.setAttribute('data-plugin', 'dsh-markdown-studio');
    script.onload = function () {
      sharedDarkmodeLoadPromise = null;
      if (!isPluginLifecycleMounted()) {
        delete (window as unknown as Record<string, unknown>).__MDSTUDIO_DARKMODE__;
        script.remove();
        resolve(null);
        return;
      }
      const api = getWindowDarkmode();
      if (!api) script.remove();
      loadedDarkmode = api;
      resolve(api);
    };
    script.onerror = function () {
      sharedDarkmodeLoadPromise = null;
      script.remove();
      resolve(null);
    };
    document.head.appendChild(script);
  });
  return sharedDarkmodeLoadPromise;
}

function tagDarkmodeStyles(): void {
  if (typeof document === 'undefined') return;
  document.querySelectorAll<HTMLStyleElement>('style[id^="js_darkmode_style__"]').forEach(function (tag) {
    tag.dataset.plugin = 'dsh-markdown-studio';
  });
}

export function cleanupDarkPreview(): void {
  if (typeof document === 'undefined') return;
  try {
    (loadedDarkmode || getWindowDarkmode())?.reset?.([]);
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

function collectSubtreeNodes(roots: readonly HTMLElement[]): HTMLElement[] {
  const nodes: HTMLElement[] = [];
  for (let i = 0; i < roots.length; i++) {
    const block = roots[i];
    nodes.push(block);
    const descendants = block.querySelectorAll<HTMLElement>('*');
    for (let j = 0; j < descendants.length; j++) nodes.push(descendants[j]);
  }
  return nodes;
}

function runDarkmodeOnTarget(Darkmode: DarkmodeApi, target: HTMLElement, dirtyBlocks?: readonly HTMLElement[]): void {
  if (dirtyBlocks && dirtyBlocks.length > 0) {
    Darkmode.run(collectSubtreeNodes(dirtyBlocks), { mode: 'dark' }, target);
    tagDarkmodeStyles();
    return;
  }
  if (typeof Darkmode.reset === 'function') Darkmode.reset([]);
  Darkmode.run(collectSubtreeNodes([target]), { mode: 'dark' });
  tagDarkmodeStyles();
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
export async function applyDarkPreview(
  article: HTMLElement,
  isCancelled?: () => boolean,
  dirtyBlocks?: readonly HTMLElement[],
): Promise<boolean> {
  try {
    const root = article.querySelector<HTMLElement>('#mdstudio');
    if (dirtyBlocks && dirtyBlocks.length === 0) return true;
    const incremental = Boolean(dirtyBlocks && dirtyBlocks.length > 0 && root);
    const rootHasMpDark = Boolean(root && /js_darkmode__/.test(root.className));
    if (isAlreadyDarkRoot(root) && (!incremental || !rootHasMpDark)) {
      if (!incremental) cleanupDarkPreview();
      // Even when the theme root is already dark (e.g. `night`), adapt bright child blocks (e.g. `codeTheme: 'github'`) and lift contrast.
      finalizeDarkRoot(root, incremental ? dirtyBlocks : undefined);
      return true;
    }
    const Darkmode = await loadDarkmodeRuntime();
    if (isCancelledOrDetached(article, isCancelled)) return false;
    if (Darkmode) {
      loadedDarkmode = Darkmode;
      if (!incremental) prepareLightRoot(root);
      runDarkmodeOnTarget(Darkmode, root || article, incremental ? dirtyBlocks : undefined);
    } else if (!incremental) {
      prepareLightRoot(root);
    }
    finalizeDarkRoot(root, incremental ? dirtyBlocks : undefined);
    return true;
  } catch (error) {
    cleanupDarkPreview();
    warnDarkPreviewFailure(error);
    return false;
  }
}

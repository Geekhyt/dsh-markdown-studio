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

function nearestOpaqueBgLuminance(element: HTMLElement, stopAt: HTMLElement): number {
  let cursor: HTMLElement | null = element;
  while (cursor) {
    const bg = window.getComputedStyle(cursor).backgroundColor;
    if (alphaOf(bg) >= 0.08) return luminance(bg);
    if (cursor === stopAt) break;
    cursor = cursor.parentElement;
  }
  return 0.05;
}

/** Keep dark-preview headings readable even when a theme accent is very dark. */
function liftDarkText(root: HTMLElement): void {
  if (typeof window === 'undefined') return;
  const selector =
    'h1,h2,h3,h4,h5,h6,strong,b,em,a,.mdstudio-link,blockquote,p,li,td,th,.mdstudio-alert-title,.mdstudio-math,code,span,mark,u,del,sup,.mdstudio-img-placeholder,.mdstudio-pull';
  root.querySelectorAll<HTMLElement>(selector).forEach(function (element) {
    if (!(element.textContent || '').trim() && !element.classList.contains('mdstudio-math')) return;
    if (element.closest('svg')) return;
    if (nearestOpaqueBgLuminance(element, root) >= 0.25) return;
    const color = window.getComputedStyle(element).color;
    if (luminance(color) >= 0.3) return;
    element.style.setProperty('color', 'color-mix(in srgb, ' + color + ' 35%, #f2f2f2)', 'important');
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
      root.style.setProperty('background-color', '#ffffff');
      root.style.setProperty('color', '#1f2328');
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

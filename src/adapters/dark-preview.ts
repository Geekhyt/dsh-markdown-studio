function rgbTuple(color: string): [number, number, number] | null {
  const match = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(color);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function alphaOf(color: string): number {
  const value = String(color || '').trim();
  if (value.toLowerCase() === 'transparent') return 0;
  const match = /rgba?\(\s*[\d.]+[,\s]+[\d.]+[,\s]+[\d.]+\s*[,/]\s*([\d.]+)\s*\)/i.exec(value);
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

/** Keep dark-preview headings readable even when a theme accent is very dark. */
function liftDarkText(root: HTMLElement): void {
  if (typeof window === 'undefined') return;
  const selector =
    'h1,h2,h3,h4,h5,h6,strong,b,em,a,.mdstudio-link,blockquote,p,li,td,th,.mdstudio-alert-title,.mdstudio-math,code,span,mark,u,del,sup,.mdstudio-img-placeholder,.mdstudio-pull';
  root.querySelectorAll<HTMLElement>(selector).forEach(function (element) {
    if (!(element.textContent || '').trim() && !element.classList.contains('mdstudio-math')) return;
    if (element.closest('svg')) return;
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
    if (alphaOf(background) < 0.08 || luminance(background) <= 0.42) return;
    element.style.setProperty('background-color', 'color-mix(in srgb, ' + background + ' 12%, #1b1d22)', 'important');
    const image = style.backgroundImage;
    if (image && image !== 'none' && image.indexOf('url(') === -1) {
      element.style.setProperty('background-image', 'none', 'important');
    }
  });
}

/**
 * Apply WeChat's official Dark Mode transform to a preview clone. The source
 * HTML and clipboard output stay in the authored light theme.
 */
export async function applyDarkPreview(article: HTMLElement): Promise<boolean> {
  try {
    const root = article.querySelector<HTMLElement>('#mdstudio');
    if (root) {
      const initial = window.getComputedStyle(root).backgroundColor;
      if (alphaOf(initial) > 0.1 && luminance(initial) < 0.2) return true;
    }
    const Darkmode = await import('mp-darkmode');
    if (root) {
      root.style.setProperty('background-color', '#ffffff');
      root.style.setProperty('color', '#1f2328');
    }
    const nodes = [article, ...Array.from(article.querySelectorAll<HTMLElement>('*'))];
    Darkmode.run(nodes, { mode: 'dark' });
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

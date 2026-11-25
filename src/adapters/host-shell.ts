/*
 * Host window titlebar inset observer.
 *
 * Keeps the plugin header clear of macOS traffic lights / DSH collapsed sidebar
 * controls without coupling layout measurement directly into StudioPage.
 */
function parseClearance(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const match = /^(\d+(?:\.\d+)?)(px)?$/i.exec(trimmed);
  if (!match) return null;
  const parsed = Number(match[1]);
  if (!match[2] && parsed !== 0) return null;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function readPublishedClearance(target: HTMLElement): number | null {
  const inlineVal = target.style ? target.style.getPropertyValue('--dsh-frame-leading-clearance') : '';
  const parsedInline = parseClearance(inlineVal);
  if (parsedInline !== null) return parsedInline;
  if (typeof window.getComputedStyle !== 'function') return null;
  return parseClearance(window.getComputedStyle(target).getPropertyValue('--dsh-frame-leading-clearance'));
}

function isCoarsePointer(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
}

function resolveHostClearance(target: HTMLElement): number {
  const published = readPublishedClearance(target);
  if (published !== null) return published;
  const docEl = typeof document !== 'undefined' ? document.documentElement : null;
  const platform = docEl && typeof docEl.getAttribute === 'function' ? docEl.getAttribute('data-platform') : null;
  if (platform === 'darwin') {
    return docEl?.hasAttribute('data-fullscreen') ? 84 : 160;
  }
  if (platform) return 84;
  if (isCoarsePointer()) return 0;
  return window.innerWidth > 720 ? 160 : 0;
}

function observeDocAttributes(onMutate: () => void): { disconnect(): void } | null {
  if (typeof MutationObserver === 'undefined' || typeof document === 'undefined' || !document.documentElement) {
    return null;
  }
  const mo = new MutationObserver(onMutate);
  mo.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-fullscreen', 'data-platform', 'style', 'class'],
  });
  return mo;
}

function createResizeNotifier(target: HTMLElement, onResize?: (width: number) => void): () => void {
  if (!onResize) return function () {};
  let lastWidth = target.clientWidth;
  return function (): void {
    const width = target.clientWidth;
    if (width <= 0 || width === lastWidth) return;
    lastWidth = width;
    onResize(width);
  };
}

export function observeHostTitlebarInset(target: HTMLElement, onResize?: (width: number) => void): () => void {
  const notifyResize = createResizeNotifier(target, onResize);
  const update = function (): void {
    const left = target.getBoundingClientRect().left;
    const clearance = resolveHostClearance(target);
    const inset = clearance > 0 ? Math.min(220, Math.max(0, Math.round(clearance - left))) : 0;
    target.style.setProperty('--mdstudio-host-inset', inset + 'px');
    if (inset > 0) target.setAttribute('data-mdstudio-host-titlebar', '');
    else target.removeAttribute('data-mdstudio-host-titlebar');
    notifyResize();
  };
  update();
  const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
  if (observer) observer.observe(target);
  const docObserver = observeDocAttributes(update);
  window.addEventListener('resize', update);
  return function (): void {
    if (observer) observer.disconnect();
    if (docObserver) docObserver.disconnect();
    window.removeEventListener('resize', update);
    target.style.removeProperty('--mdstudio-host-inset');
    target.removeAttribute('data-mdstudio-host-titlebar');
  };
}

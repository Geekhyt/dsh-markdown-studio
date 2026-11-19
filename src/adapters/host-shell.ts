/*
 * Host window titlebar inset observer.
 *
 * Keeps the plugin header clear of macOS traffic lights / DSH collapsed sidebar
 * controls without coupling layout measurement directly into StudioPage.
 */
function readPublishedClearance(target: HTMLElement): number {
  const inlineVal = target.style ? target.style.getPropertyValue('--dsh-frame-leading-clearance') : '';
  if (inlineVal) return parseFloat(inlineVal) || 0;
  if (typeof window.getComputedStyle !== 'function') return 0;
  return parseFloat(window.getComputedStyle(target).getPropertyValue('--dsh-frame-leading-clearance')) || 0;
}

function resolveHostClearance(target: HTMLElement): number {
  const published = readPublishedClearance(target);
  if (published > 0) return published;
  const docEl = typeof document !== 'undefined' ? document.documentElement : null;
  const platform = docEl && typeof docEl.getAttribute === 'function' ? docEl.getAttribute('data-platform') : null;
  if (platform === 'darwin') {
    return docEl?.hasAttribute('data-fullscreen') ? 84 : 160;
  }
  if (platform) return 84;
  return window.innerWidth > 720 ? 160 : 0;
}

function observeDocAttributes(onMutate: () => void): { disconnect(): void } | null {
  if (typeof MutationObserver === 'undefined' || typeof document === 'undefined' || !document.documentElement) {
    return null;
  }
  const mo = new MutationObserver(onMutate);
  mo.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-fullscreen', 'data-platform', 'style'],
  });
  return mo;
}

export function observeHostTitlebarInset(target: HTMLElement): () => void {
  const update = function (): void {
    const left = target.getBoundingClientRect().left;
    const clearance = resolveHostClearance(target);
    const inset = clearance > 0 ? Math.min(220, Math.max(0, Math.round(clearance - left))) : 0;
    target.style.setProperty('--mdstudio-host-inset', inset + 'px');
    if (inset > 0) target.setAttribute('data-mdstudio-host-titlebar', '');
    else target.removeAttribute('data-mdstudio-host-titlebar');
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

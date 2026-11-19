import { browserAdaptor } from 'mathjax-full/js/adaptors/browserAdaptor.js';
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js';
import { AllPackages } from 'mathjax-full/js/input/tex/AllPackages.js';
import { TeX } from 'mathjax-full/js/input/tex.js';
import { mathjax } from 'mathjax-full/js/mathjax.js';
import { SVG } from 'mathjax-full/js/output/svg.js';

declare global {
  interface Window {
    __MDSTUDIO_MATH__?: { cssText: string; render: (tex: unknown, displayMode?: boolean) => string };
  }
}

const adaptor = browserAdaptor();
RegisterHTMLHandler(adaptor);
// The TeX `html` extension (\href, \style, \class, \cssId) can inject links and
// arbitrary styles into the SVG output, so it is never loaded.
const SAFE_TEX_PACKAGES = AllPackages.filter(function (name) {
  return name !== 'html';
});
const tex = new TeX({ packages: SAFE_TEX_PACKAGES });
const svg = new SVG({ fontCache: 'none' });
const doc = mathjax.document(document, { InputJax: tex, OutputJax: svg });

export const cssText = '';

/** Defense in depth: unwrap every SVG `<a>` so formulas can never carry navigable links. */
function stripSvgLinks(root: Element): void {
  Array.from(root.querySelectorAll('a')).forEach(function (link) {
    while (link.firstChild) link.parentNode?.insertBefore(link.firstChild, link);
    link.remove();
  });
  Array.from(root.querySelectorAll('[href], [xlink\\:href]')).forEach(function (node) {
    if (node.tagName.toLowerCase() === 'use') return;
    node.removeAttribute('href');
    node.removeAttribute('xlink:href');
  });
}

export function render(texSource: unknown, displayMode?: boolean): string {
  const node = doc.convert(String(texSource || ''), { display: Boolean(displayMode) });
  const svgNode = node.firstElementChild;
  if (svgNode) {
    svgNode.setAttribute('aria-label', '公式：' + String(texSource || ''));
    stripSvgLinks(svgNode);
  }
  let html = adaptor.outerHTML(svgNode || node);
  if (!/^<svg[^>]*\sxmlns=/.test(html)) {
    html = html.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
  }
  return html;
}

if (typeof window !== 'undefined') {
  window.__MDSTUDIO_MATH__ = { cssText, render };
}

import { browserAdaptor } from 'mathjax-full/js/adaptors/browserAdaptor.js';
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js';
import { AllPackages } from 'mathjax-full/js/input/tex/AllPackages.js';
import { TeX } from 'mathjax-full/js/input/tex.js';
import { mathjax } from 'mathjax-full/js/mathjax.js';
import { SVG } from 'mathjax-full/js/output/svg.js';
import { hasCssUrlRef, parseCssDeclarations } from './domain/custom-css';

declare global {
  interface Window {
    __MDSTUDIO_MATH__?: {
      cssText: string;
      render: (tex: unknown, displayMode?: boolean, labelPrefix?: string) => string;
    };
  }
}

const adaptor = browserAdaptor();
RegisterHTMLHandler(adaptor);
// Exclude TeX extensions that inject links, arbitrary inline CSS styles, or
// `<foreignObject>` tooltips (`html`: \href/\style, `bbox`: \bbox[...], `action`: \mathtip/\toggle, `unicode`: \unicode[style]{...}).
const BLOCKED_TEX_PACKAGES = new Set(['html', 'bbox', 'action', 'unicode']);
const SAFE_TEX_PACKAGES = AllPackages.filter(function (name) {
  return !BLOCKED_TEX_PACKAGES.has(name);
});
const svg = new SVG({ fontCache: 'none' });

export const cssText = '';

const SVG_PAINT_ATTRS = ['fill', 'stroke', 'filter', 'clip-path', 'mask'];
const ALLOWED_ROOT_STYLE_PROPS = new Set([
  'vertical-align',
  'min-width',
  'width',
  'height',
  'max-width',
  'color',
  'background-color',
]);
const ALLOWED_CHILD_STYLE_PROPS = new Set([
  'stroke-width',
  'color',
  'background-color',
  'font-size',
  'font-weight',
  'font-style',
]);

function isSafeStyleDecl(prop: string, value: string, allowed: Set<string>): boolean {
  return allowed.has(prop) && !hasCssUrlRef(value) && !/expression\s*\(/i.test(value);
}

function sanitizeInlineStyle(raw: string, allowed: Set<string>): string {
  const kept: string[] = [];
  for (const decl of parseCssDeclarations(raw)) {
    if (isSafeStyleDecl(decl.prop, decl.value, allowed)) {
      kept.push(decl.prop + ': ' + decl.value);
    }
  }
  return kept.join('; ');
}

function sanitizeSvgStyle(node: Element, isRoot: boolean): void {
  const inlineStyle = node.getAttribute('style');
  if (!inlineStyle) return;
  const cleanStyle = sanitizeInlineStyle(inlineStyle, isRoot ? ALLOWED_ROOT_STYLE_PROPS : ALLOWED_CHILD_STYLE_PROPS);
  if (cleanStyle) node.setAttribute('style', cleanStyle);
  else node.removeAttribute('style');
}

function sanitizeSvgPaintAttrs(node: Element): void {
  for (const attr of SVG_PAINT_ATTRS) {
    const value = node.getAttribute(attr);
    if (value && hasCssUrlRef(value)) node.removeAttribute(attr);
  }
}

function sanitizeSvgNode(node: Element, isRoot: boolean): void {
  sanitizeSvgStyle(node, isRoot);
  sanitizeSvgPaintAttrs(node);
}

const XLINK_NS = 'http://www.w3.org/1999/xlink';

function stripNodeLinks(node: Element): void {
  const isUse = node.tagName.toLowerCase() === 'use';
  const href = node.getAttribute('href');
  if (href && (!isUse || !href.trim().startsWith('#'))) node.removeAttribute('href');
  const xlink = node.getAttributeNS?.(XLINK_NS, 'href') || node.getAttribute('xlink:href');
  if (xlink && (!isUse || !xlink.trim().startsWith('#'))) {
    node.removeAttribute('xlink:href');
    node.removeAttributeNS?.(XLINK_NS, 'href');
  }
}

/** Defense in depth: unwrap SVG links, drop `<foreignObject>`/`<image>`/`<script>`, and enforce paint & style allowlists. */
export function stripSvgLinks(root: Element): void {
  Array.from(root.querySelectorAll('foreignObject, image, script')).forEach(function (node) {
    node.remove();
  });
  Array.from(root.querySelectorAll('a')).forEach(function (link) {
    while (link.firstChild) link.parentNode?.insertBefore(link.firstChild, link);
    link.remove();
  });
  stripNodeLinks(root);
  sanitizeSvgNode(root, true);
  Array.from(root.querySelectorAll('*')).forEach(function (node) {
    stripNodeLinks(node);
    sanitizeSvgNode(node, false);
  });
}

function decorateMathSvg(svgNode: Element | null, source: string, labelPrefix: string): void {
  if (!svgNode) return;
  svgNode.setAttribute('aria-label', labelPrefix + source);
  stripSvgLinks(svgNode);
}

function ensureSvgNamespace(html: string): string {
  return /^<svg[^>]*\sxmlns=/.test(html) ? html : html.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
}

const MAX_MATH_SVG_CHARS = 250_000;

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function render(texSource: unknown, displayMode?: boolean, labelPrefix = '公式：'): string {
  const source = String(texSource || '');
  // Fresh TeX input instance with bounded macro/buffer limits prevents cross-formula leaks and macro-bomb DoS.
  const tex = new TeX({ packages: SAFE_TEX_PACKAGES, maxMacros: 200, maxBuffer: 2048 });
  const doc = mathjax.document(document, { InputJax: tex, OutputJax: svg });
  const node = doc.convert(source, { display: Boolean(displayMode) });
  const svgNode = node.firstElementChild;
  decorateMathSvg(svgNode, source, labelPrefix);
  const html = ensureSvgNamespace(adaptor.outerHTML(svgNode || node));
  if (html.length > MAX_MATH_SVG_CHARS) return escapeText(source);
  return html;
}

if (typeof window !== 'undefined') {
  window.__MDSTUDIO_MATH__ = { cssText, render };
}

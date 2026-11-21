import { hasCssUrlRef } from '../domain/custom-css';

/**
 * DOM-only cleanup for the clipboard copy. The preview keeps the original
 * semantic structure; only copied HTML gets WeChat-specific guard nodes and
 * list flattening.
 */
export function prepareClipboardDom(root: HTMLElement): void {
  moveNestedLists(root);
  normalizeTaskLists(root);
  normalizeImageDimensions(root);
  stripFragmentLinks(root);
  sanitizeMathSvgs(root);
  unwrapParagraphSections(root);
  markHorizontalScrollExemptions(root);
}

function convertTaskListToSection(list: HTMLElement): void {
  const blockChild = 'p,pre,blockquote,ul,ol,table,section,div,hr,h1,h2,h3,h4,h5,h6';
  const container = list.ownerDocument.createElement('section');
  container.className = list.className || 'mdstudio-task-list';
  Array.from(list.children).forEach(function (child) {
    if (child.tagName.toLowerCase() !== 'li') {
      container.appendChild(child);
      return;
    }
    const tag = child.querySelector(blockChild) ? 'section' : 'p';
    const row = list.ownerDocument.createElement(tag);
    row.className = (child as HTMLElement).className;
    while (child.firstChild) row.appendChild(child.firstChild);
    container.appendChild(row);
  });
  list.replaceWith(container);
}

function normalizeTaskLists(root: HTMLElement): void {
  Array.from(root.querySelectorAll<HTMLElement>('ul')).forEach(function (list) {
    const parent = list.parentElement;
    if (parent && /^(UL|OL)$/i.test(parent.tagName)) return;
    const isTask =
      list.classList.contains('mdstudio-task-list') || Boolean(list.querySelector(':scope > li.mdstudio-task'));
    if (!isTask) return;
    convertTaskListToSection(list);
  });
}

function markHorizontalScrollExemptions(root: HTMLElement): void {
  const blocks = 'section,p,div,li,ul,ol,h1,h2,h3,h4,h5,h6,table,blockquote,pre';
  Array.from(root.querySelectorAll<HTMLElement>('.mdstudio-scroll-x')).forEach(function (box) {
    box.setAttribute('data-ignore-width', '');
    Array.from(box.querySelectorAll<HTMLElement>(blocks)).forEach(function (child) {
      child.setAttribute('data-ignore-width', '');
    });
  });
}

function unwrapParagraphSections(root: HTMLElement): void {
  Array.from(root.querySelectorAll<HTMLElement>('p > section')).forEach(function (section) {
    const paragraph = section.parentElement;
    if (!paragraph || paragraph.tagName !== 'P' || !paragraph.parentNode) return;
    const before = paragraph.ownerDocument.createElement('p');
    if (paragraph.className) before.className = paragraph.className;
    while (paragraph.firstChild && paragraph.firstChild !== section) {
      before.appendChild(paragraph.firstChild);
    }
    if ((before.textContent || '').trim() || before.querySelector('img,svg,br')) {
      paragraph.parentNode.insertBefore(before, paragraph);
    }
    paragraph.parentNode.insertBefore(section, paragraph);
    if (!(paragraph.textContent || '').trim() && !paragraph.querySelector('img,svg,br,section')) {
      paragraph.remove();
    }
  });
}

function moveNestedLists(root: HTMLElement): void {
  const anchors = new Map<HTMLElement, HTMLElement>();
  Array.from(root.querySelectorAll<HTMLElement>('li ul, li ol')).forEach(function (list) {
    const item = list.closest<HTMLElement>('li');
    if (!item || !root.contains(item)) return;
    const anchor = anchors.get(item) || item;
    anchor.insertAdjacentElement('afterend', list);
    anchors.set(item, list);
  });
}

function normalizeImageDimensions(root: HTMLElement): void {
  Array.from(root.querySelectorAll<HTMLImageElement>('img')).forEach(function (image) {
    const width = image.getAttribute('width');
    const height = image.getAttribute('height');
    if (width) {
      image.removeAttribute('width');
      image.style.width = /^\d+$/.test(width) ? width + 'px' : width;
    }
    if (height) {
      image.removeAttribute('height');
      image.style.height = /^\d+$/.test(height) ? height + 'px' : height;
    }
  });
}

function stripFragmentLinks(root: HTMLElement): void {
  Array.from(root.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')).forEach(function (link) {
    link.removeAttribute('href');
  });
}

function inheritedSvgFill(element: SVGElement, stopAt: Element): string {
  let cursor: Element | null = element;
  while (cursor && cursor !== stopAt) {
    const fill = (cursor.getAttribute('fill') || '').trim();
    if (fill && hasCssUrlRef(fill)) return '';
    if (fill && fill.toLowerCase() !== 'currentcolor' && fill.toLowerCase() !== 'none') return fill;
    cursor = cursor.parentElement;
  }
  return '';
}

function sanitizeSvgPathElement(element: SVGElement, svg: SVGSVGElement): void {
  const ownFill = (element.getAttribute('fill') || '').trim().toLowerCase();
  const inlineStrokeWidth = element.style?.strokeWidth || '';
  if (ownFill === 'none') {
    element.setAttribute('fill', 'none');
    if (!element.getAttribute('stroke') || hasCssUrlRef(element.getAttribute('stroke') || '')) {
      element.setAttribute('stroke', 'currentColor');
    }
    if (inlineStrokeWidth && !element.getAttribute('stroke-width')) {
      element.setAttribute('stroke-width', inlineStrokeWidth);
    }
    return;
  }
  const explicitFill = inheritedSvgFill(element, svg);
  element.setAttribute('fill', explicitFill || 'currentColor');
  element.setAttribute('stroke', 'none');
}

function stripUnsafeSvgPaintAttrs(element: Element): void {
  Array.from(element.attributes).forEach(function (attribute) {
    if (attribute.name.indexOf('data-') === 0) element.removeAttribute(attribute.name);
    else if (/^(?:fill|stroke|filter|clip-path|mask)$/i.test(attribute.name) && hasCssUrlRef(attribute.value)) {
      element.removeAttribute(attribute.name);
    }
  });
}

function sanitizeMathSvgs(root: HTMLElement): void {
  Array.from(root.querySelectorAll<HTMLElement>('.mdstudio-math')).forEach(function (node) {
    const display = node.getAttribute('data-mdstudio-display') === '1';
    const svg = node.querySelector('svg');
    if (svg) {
      Array.from(svg.querySelectorAll('foreignObject')).forEach(function (fo) {
        fo.remove();
      });
      stripUnsafeSvgPaintAttrs(svg);
      if (hasCssUrlRef(svg.getAttribute('style') || '')) svg.removeAttribute('style');
      const width = svg.getAttribute('width');
      const height = svg.getAttribute('height');
      if (width) {
        svg.removeAttribute('width');
        svg.style.width = width;
      }
      if (height) {
        svg.removeAttribute('height');
        svg.style.height = height;
      }
      svg.style.maxWidth = display ? '300%' : '100%';
      // Some editor sanitizers drop MathJax bookkeeping attributes and inline
      // styles on SVG children, which can leave only <rect> rules visible.
      // Keep the geometry and paint, but remove attributes we do not need.
      Array.from(svg.querySelectorAll<SVGElement>('*')).forEach(function (element) {
        stripUnsafeSvgPaintAttrs(element);
        if (element.tagName.toLowerCase() === 'path') sanitizeSvgPathElement(element, svg);
        if (element.tagName.toLowerCase() !== 'svg') element.removeAttribute('style');
      });
    }
    const replacement = node.ownerDocument.createElement(display ? 'section' : 'span');
    replacement.className = display ? 'mdstudio-math-block' : 'mdstudio-math-inline';
    replacement.setAttribute('data-mdstudio-math', 'true');
    while (node.firstChild) replacement.appendChild(node.firstChild);
    node.replaceWith(replacement);
  });
}

/**
 * The WeChat spec recommends not setting a font family; the platform's stack
 * is intentionally consistent between the editor and mobile clients.
 */
export function stripFontFamilies(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>('[style]').forEach(function (element) {
    element.style.removeProperty('font-family');
  });
  root.style.removeProperty('font-family');
}

/**
 * Empty heading decorations compute to zero height and are reported by the
 * WeChat structure checker. Copy output keeps the heading text only.
 */
export function removeEmptyHeadingDecorations(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>('.mdstudio-heading-prefix, .mdstudio-heading-suffix').forEach(function (element) {
    if ((element.textContent || '').trim()) return;
    if (element.style.display !== 'none' && hasNonZeroBoxStyle(element)) return;
    element.remove();
  });
}

function isPositiveCssLength(value: string): boolean {
  const trimmed = String(value || '').trim();
  if (!/^[0-9]*\.?[0-9]+(?:px|em|rem|ex|ch|%|vh|vw|pt|cm|mm|in)?$/i.test(trimmed)) return false;
  return parseFloat(trimmed) > 0;
}

function hasNonZeroBoxStyle(element: HTMLElement): boolean {
  const style = element.style;
  if (!style) return false;
  const topBorder =
    isPositiveCssLength(style.borderTopWidth) && Boolean(style.borderTopStyle && style.borderTopStyle !== 'none');
  const botBorder =
    isPositiveCssLength(style.borderBottomWidth) &&
    Boolean(style.borderBottomStyle && style.borderBottomStyle !== 'none');
  return (
    isPositiveCssLength(style.height) ||
    isPositiveCssLength(style.minHeight) ||
    isPositiveCssLength(style.paddingTop) ||
    isPositiveCssLength(style.paddingBottom) ||
    topBorder ||
    botBorder
  );
}

/**
 * Final safety net for WeChat's height:0 check. Empty presentational nodes
 * without text, media, or explicit vertical box sizing are removed statically.
 */
export function removeEmptyZeroHeightContainers(root: HTMLElement): void {
  const media = 'img,svg,video,iframe,canvas,hr,br';
  root.querySelectorAll<HTMLElement>('*').forEach(function (element) {
    if (element.closest('svg')) return;
    if (element.matches(media)) return;
    if (element.closest('table')) return;
    if ((element.textContent || '').length) return;
    if (element.querySelector(media)) return;
    if (hasNonZeroBoxStyle(element)) return;
    element.remove();
  });
}

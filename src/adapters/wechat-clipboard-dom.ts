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

const TASK_BLOCK_CHILD = 'p,pre,blockquote,ul,ol,table,section,div,hr,h1,h2,h3,h4,h5,h6';

function taskItemToNode(child: Element, doc: Document): Element {
  if (child.tagName.toLowerCase() !== 'li') return child;
  const tag = child.querySelector(TASK_BLOCK_CHILD) ? 'section' : 'p';
  const row = doc.createElement(tag);
  row.className = (child as HTMLElement).className;
  while (child.firstChild) row.appendChild(child.firstChild);
  return row;
}

function appendTaskRun(doc: Document, parent: DocumentFragment, className: string, items: Element[]): void {
  const section = doc.createElement('section');
  section.className = className || 'mdstudio-task-list';
  for (const child of items) section.appendChild(taskItemToNode(child, doc));
  parent.appendChild(section);
}

function appendRegularRun(doc: Document, parent: DocumentFragment, items: Element[]): void {
  let ul: HTMLUListElement | null = null;
  for (const child of items) {
    const tag = child.tagName.toLowerCase();
    if (tag === 'ul' || tag === 'ol') {
      ul = null;
      parent.appendChild(child);
    } else {
      if (!ul) {
        ul = doc.createElement('ul');
        parent.appendChild(ul);
      }
      ul.appendChild(child);
    }
  }
}

function convertTaskListToSection(list: HTMLElement): void {
  const doc = list.ownerDocument;
  const children = Array.from(list.children);
  const hasRegular = children.some(
    (child) => child.tagName.toLowerCase() === 'li' && !child.classList.contains('mdstudio-task'),
  );
  const frag = doc.createDocumentFragment();
  if (!hasRegular) {
    appendTaskRun(doc, frag, list.className || 'mdstudio-task-list', children);
    list.replaceWith(frag);
    return;
  }
  let runKind: 'task' | 'regular' | null = null;
  let bucket: Element[] = [];
  const flush = (): void => {
    if (!bucket.length) return;
    if (runKind === 'task') appendTaskRun(doc, frag, 'mdstudio-task-list', bucket);
    else appendRegularRun(doc, frag, bucket);
    bucket = [];
  };
  for (const child of children) {
    const tag = child.tagName.toLowerCase();
    if (tag === 'section' && child.classList.contains('mdstudio-list-continuation')) {
      flush();
      runKind = null;
      frag.appendChild(child);
      continue;
    }
    const isSublist = tag === 'ul' || tag === 'ol';
    const isTaskLi = tag === 'li' && child.classList.contains('mdstudio-task');
    const kind: 'task' | 'regular' = isSublist && runKind === 'task' ? 'task' : isTaskLi ? 'task' : 'regular';
    if (runKind && runKind !== kind) flush();
    runKind = kind;
    bucket.push(child);
  }
  flush();
  list.replaceWith(frag);
}

function splitListAroundTaskSections(root: HTMLElement): void {
  const selector = 'ul > section.mdstudio-task-list, ol > section.mdstudio-task-list';
  for (let pass = 0; pass < 200; pass++) {
    const section = root.querySelector<HTMLElement>(selector);
    if (!section) break;
    const parentList = section.parentElement as HTMLElement | null;
    if (!parentList || !parentList.parentNode) break;
    const doc = parentList.ownerDocument;
    const tag = parentList.tagName.toLowerCase();
    const after = doc.createElement(tag);
    while (section.nextSibling) after.appendChild(section.nextSibling);
    if (tag === 'ol' && after.children.length) {
      const parsedStart = parseInt(parentList.getAttribute('start') || '1', 10);
      const baseStart = Number.isFinite(parsedStart) ? parsedStart : 1;
      const beforeItems = Array.from(parentList.children).filter((el) => el.tagName.toLowerCase() === 'li').length;
      if (baseStart + beforeItems !== 1) after.setAttribute('start', String(baseStart + beforeItems));
    }
    if (!section.style.paddingLeft) section.style.paddingLeft = '1.4em';
    parentList.parentNode.insertBefore(section, parentList.nextSibling);
    if (after.children.length) parentList.parentNode.insertBefore(after, section.nextSibling);
    if (!parentList.children.length) parentList.remove();
  }
}

function normalizeTaskLists(root: HTMLElement): void {
  Array.from(root.querySelectorAll<HTMLElement>('ul')).forEach(function (list) {
    const isTask =
      list.classList.contains('mdstudio-task-list') || Boolean(list.querySelector(':scope > li.mdstudio-task'));
    if (!isTask) return;
    convertTaskListToSection(list);
  });
  splitListAroundTaskSections(root);
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

function hasMeaningfulContent(node: Element): boolean {
  return Boolean((node.textContent || '').trim() || node.querySelector('img,svg,br,section'));
}

const PHRASING_CONTAINER_RE = /^(SPAN|STRONG|EM|B|I|A|DEL|INS|MARK|U|SMALL|SUB|SUP|CODE|LABEL)$/;

function shouldStopInlineLift(inline: HTMLElement, stopAtParagraph: boolean): boolean {
  return stopAtParagraph ? inline.tagName === 'P' : !PHRASING_CONTAINER_RE.test(inline.tagName);
}

function liftSectionOutOfInlineParent(section: HTMLElement, stopAtParagraph: boolean): void {
  while (section.parentElement) {
    const inline = section.parentElement;
    if (shouldStopInlineLift(inline, stopAtParagraph) || !inline.parentNode) break;
    const grand = inline.parentNode;
    const before = inline.cloneNode(false) as HTMLElement;
    while (inline.firstChild && inline.firstChild !== section) {
      before.appendChild(inline.firstChild);
    }
    if (hasMeaningfulContent(before)) grand.insertBefore(before, inline);
    grand.insertBefore(section, inline);
    if (!hasMeaningfulContent(inline)) inline.remove();
  }
}

function demoteSectionToInlineBlockSpan(section: HTMLElement): void {
  const span = section.ownerDocument.createElement('span');
  for (const attr of Array.from(section.attributes)) {
    span.setAttribute(attr.name, attr.value);
  }
  if (!span.style.display) span.style.display = 'inline-block';
  while (section.firstChild) span.appendChild(section.firstChild);
  section.replaceWith(span);
}

function unwrapParagraphSections(root: HTMLElement): void {
  // Headings cannot legally contain <section>; demote any nested <section> inside h1-h6 to inline-block <span>.
  Array.from(
    root.querySelectorAll<HTMLElement>('h1 section, h2 section, h3 section, h4 section, h5 section, h6 section'),
  ).forEach(function (section) {
    if (section.isConnected) demoteSectionToInlineBlockSpan(section);
  });
  Array.from(root.querySelectorAll<HTMLElement>('p section')).forEach(function (section) {
    if (!section.closest('p')) return;
    liftSectionOutOfInlineParent(section, true);
    const paragraph = section.parentElement;
    if (!paragraph || paragraph.tagName !== 'P' || !paragraph.parentNode) return;
    const before = paragraph.ownerDocument.createElement('p');
    if (paragraph.className) before.className = paragraph.className;
    while (paragraph.firstChild && paragraph.firstChild !== section) {
      before.appendChild(paragraph.firstChild);
    }
    if (hasMeaningfulContent(before)) {
      paragraph.parentNode.insertBefore(before, paragraph);
    }
    paragraph.parentNode.insertBefore(section, paragraph);
    if (!hasMeaningfulContent(paragraph)) {
      paragraph.remove();
    }
  });
  // Lift any remaining <section> nested inside phrasing elements (e.g. <li><strong><section>...</section></strong></li>).
  const phrasingSel =
    'span section, strong section, em section, a section, del section, ins section, mark section, u section';
  Array.from(root.querySelectorAll<HTMLElement>(phrasingSel)).forEach(function (section) {
    if (!section.isConnected) return;
    if (section.closest('h1, h2, h3, h4, h5, h6')) {
      demoteSectionToInlineBlockSpan(section);
      return;
    }
    liftSectionOutOfInlineParent(section, false);
  });
}

function moveTrailingListSiblings(item: HTMLElement, list: HTMLElement): HTMLElement {
  const trailing: ChildNode[] = [];
  for (let node = list.nextSibling; node; node = node.nextSibling) {
    if (node.nodeType === 1) {
      const tag = (node as Element).tagName.toLowerCase();
      if (tag === 'ul' || tag === 'ol') break;
    }
    trailing.push(node);
  }
  const meaningful = trailing.some(
    (node) => node.nodeType === 1 || (node.nodeType === 3 && Boolean((node.nodeValue || '').trim())),
  );
  if (!meaningful) return list;
  const cont = item.ownerDocument.createElement('section');
  cont.className = 'mdstudio-list-continuation';
  for (const node of trailing) cont.appendChild(node);
  list.insertAdjacentElement('afterend', cont);
  return cont;
}

function moveNestedLists(root: HTMLElement): void {
  const anchors = new Map<HTMLElement, HTMLElement>();
  Array.from(root.querySelectorAll<HTMLElement>('li ul, li ol')).forEach(function (list) {
    const item = list.closest<HTMLElement>('li');
    if (!item || !root.contains(item)) return;
    // Never hoist lists nested inside blockquotes, callouts/sections, or table cells within an `<li>`.
    if (list.parentElement?.closest('li, blockquote, section, td, th') !== item) return;
    const anchor = anchors.get(item) || item;
    const trailing = list.parentElement === item ? moveTrailingListSiblings(item, list) : list;
    anchor.insertAdjacentElement('afterend', list);
    if (trailing !== list) list.insertAdjacentElement('afterend', trailing);
    anchors.set(item, trailing);
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

function inheritedSvgPaint(element: SVGElement, stopAt: Element, attr: 'fill' | 'stroke'): string {
  let cursor: Element | null = element;
  while (cursor && cursor !== stopAt) {
    const val = (cursor.getAttribute(attr) || '').trim();
    if (val && hasCssUrlRef(val)) return '';
    if (val && val.toLowerCase() !== 'currentcolor' && val.toLowerCase() !== 'none') return val;
    cursor = cursor.parentElement;
  }
  return '';
}

function sanitizeSvgPathElement(element: SVGElement, svg: SVGSVGElement): void {
  const ownFill = (element.getAttribute('fill') || '').trim().toLowerCase();
  const ownStroke = (element.getAttribute('stroke') || '').trim().toLowerCase();
  const inlineStrokeWidth = element.style?.strokeWidth || '';
  if (ownFill === 'none') {
    element.setAttribute('fill', 'none');
    if (ownStroke === 'none') return;
    const explicitStroke = inheritedSvgPaint(element, svg, 'stroke');
    element.setAttribute('stroke', explicitStroke || 'currentColor');
    if (inlineStrokeWidth && !element.getAttribute('stroke-width')) {
      element.setAttribute('stroke-width', inlineStrokeWidth);
    }
    return;
  }
  const explicitFill = inheritedSvgPaint(element, svg, 'fill');
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
    const insideHeading = Boolean(node.closest('h1, h2, h3, h4, h5, h6'));
    const replacement = node.ownerDocument.createElement(display && !insideHeading ? 'section' : 'span');
    replacement.className = display ? 'mdstudio-math-block' : 'mdstudio-math-inline';
    if (display && insideHeading) replacement.style.display = 'inline-block';
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

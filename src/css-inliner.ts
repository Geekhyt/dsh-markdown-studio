import { splitTopLevel } from './markdown-parser';

/**
 * Pure CSS rule parser, specificity calculator, CSS variable/counter evaluator,
 * pseudo-element materializer, and DOM inline-style writer for WeChat HTML.
 */

interface Declaration {
  prop: string;
  value: string;
  important: boolean;
}

interface ParsedRule {
  selectors: string[];
  decls: Declaration[];
  order: number;
}

interface CssEntry {
  selector: string;
  pseudo: string | null;
  decls: Declaration[];
  order: number;
  specificity: number;
}

interface StyleCandidate {
  value: string;
  important: boolean;
}

interface StyleValue extends StyleCandidate {
  specificity: number;
  order: number;
  index: number;
}

/**
 * Inline styles must be written in real cascade order: a later shorthand
 * (`border: 0`) has to reset an earlier longhand (`border-left`), and a more
 * specific longhand has to survive a less specific shorthand. Map insertion
 * order (first rule that touched a property) does not guarantee either.
 */
function cascadeOrder(a: [string, StyleValue], b: [string, StyleValue]): number {
  const x = a[1];
  const y = b[1];
  if (x.important !== y.important) return x.important ? 1 : -1;
  if (x.specificity !== y.specificity) return x.specificity - y.specificity;
  if (x.order !== y.order) return x.order - y.order;
  return x.index - y.index;
}

/* ------------------------------------------------------------------------- */
/* CSS parsing                                                                */
/* ------------------------------------------------------------------------- */

function stripCssComments(css: string): string {
  return String(css || '').replace(/\/\*[\s\S]*?\*\//g, '');
}

function findCssBlockEnd(css: string, openIndex: number): number {
  var depth = 1;
  var quote = null;
  for (var i = openIndex + 1; i < css.length; i++) {
    var ch = css[i];
    if (quote) {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return css.length;
}

export function parseDeclarations(body: string): Declaration[] {
  var decls: Declaration[] = [];
  splitTopLevel(body, ';').forEach(function (part) {
    if (!part.trim()) return;
    var split = /^\s*([^:]+?)\s*:\s*([\s\S]*)$/.exec(part);
    if (!split) return;
    var prop = split[1].trim();
    var value = split[2].trim();
    if (!prop || !value) return;
    var important = false;
    if (/!\s*important\s*$/i.test(value)) {
      important = true;
      value = value.replace(/!\s*important\s*$/i, '').trim();
    }
    decls.push({ prop: prop, value: value, important: important });
  });
  return decls;
}

export function parseRules(css: string): ParsedRule[] {
  var clean = stripCssComments(css).replace(/@(?:import|charset|namespace)\b[^;{}]*;/gi, '');
  var rules: ParsedRule[] = [];
  var i = 0;
  var order = 0;
  while (i < clean.length) {
    var open = clean.indexOf('{', i);
    if (open === -1) break;
    var prelude = clean.slice(i, open).trim();
    var close = findCssBlockEnd(clean, open);
    var body = clean.slice(open + 1, close);
    if (prelude && prelude.charAt(0) !== '@') {
      rules.push({
        selectors: splitTopLevel(prelude, ',')
          .map(function (s) {
            return s.trim();
          })
          .filter(Boolean),
        decls: parseDeclarations(body),
        order: order++,
      });
    }
    i = close + 1;
  }
  return rules;
}

export function normalizeSelector(selector: string): string {
  var value = String(selector || '').trim();
  if (!value) return '';
  value = value.replace(/(^|[\s>+~,])(?::root|html|body)(?=$|[\s>+~,.#[:])/gi, '$1#mdstudio');
  value = value.replace(/#mdstudio(\s+)#mdstudio/gi, '#mdstudio');
  value = value.replace(/#mdstudio(\s*>\s*)#mdstudio/gi, '#mdstudio');
  value = value.replace(
    /\.mdstudio-notes-title\b/g,
    ':is(.mdstudio-notes-title, .mdstudio-refs-title, .mdstudio-footnotes-title)',
  );
  value = value.replace(/\.mdstudio-notes\b(?!-)/g, ':is(.mdstudio-notes, .mdstudio-references, .mdstudio-footnotes)');
  value = value.replace(/\.mdstudio-task-box-checked\b/g, '.mdstudio-task-box.is-checked');
  value = value.replace(/\.mdstudio-task-done\b/g, '.mdstudio-task.is-checked .mdstudio-task-text');
  return value;
}

function splitPseudoElement(selector: string): { base: string; pseudo: string } | null {
  var match = /^(.*?)::?(before|after)\s*$/i.exec(selector);
  if (match) return { base: match[1].trim(), pseudo: match[2].toLowerCase() };
  var unsupported = /::?(selection|placeholder|marker|first-line|first-letter|backdrop|file-selector-button)\s*$/i.exec(
    selector,
  );
  if (unsupported) return { base: selector, pseudo: 'skip' };
  return null;
}

export function selectorSpecificity(selector: string): number {
  var source = selector
    .replace(/:not\(([^)]*)\)/gi, ' $1 ')
    .replace(/:is\(([^)]*)\)/gi, ' $1 ')
    .replace(/\[[^\]]*\]/g, ' .attr ');
  var ids = (source.match(/#[\w-]+/g) || []).length;
  var classes = (source.match(/\.[\w-]+|:[\w-]+(?:\([^)]*\))?/g) || []).length;
  var types = (source.match(/(^|[\s>+~])([a-zA-Z][\w-]*)/g) || []).length;
  var pseudoElements = (selector.match(/::[\w-]+/g) || []).length;
  return ids * 100 + classes * 10 + types + pseudoElements;
}

function isStateSelector(selector: string): boolean {
  return /:{1,2}(hover|active|focus|focus-visible|focus-within|visited|target|checked|disabled|enabled|link|any-link)\b/i.test(
    selector,
  );
}

function findTopLevelComma(value: string): number {
  var depth = 0;
  var quote = null;
  for (var i = 0; i < value.length; i++) {
    var ch = value[i];
    if (quote) {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (ch === ',' && depth === 0) return i;
  }
  return -1;
}

export function resolveVars(value: unknown, vars: Record<string, string>, depth?: number): string {
  var input = String(value == null ? '' : value);
  var level = depth || 0;
  if (!vars || input.indexOf('var(') === -1 || level > 8) return input;
  var out = '';
  var i = 0;
  while (i < input.length) {
    var start = input.indexOf('var(', i);
    if (start === -1) {
      out += input.slice(i);
      break;
    }
    out += input.slice(i, start);
    var depthParen = 1;
    var end = -1;
    for (var j = start + 4; j < input.length; j++) {
      if (input[j] === '(') depthParen++;
      else if (input[j] === ')') {
        depthParen--;
        if (depthParen === 0) {
          end = j;
          break;
        }
      }
    }
    if (end === -1) {
      out += input.slice(start);
      break;
    }
    var inner = input.slice(start + 4, end);
    var comma = findTopLevelComma(inner);
    var name = (comma === -1 ? inner : inner.slice(0, comma)).trim();
    var fallback = comma === -1 ? '' : inner.slice(comma + 1).trim();
    var resolved = vars[name];
    if (resolved == null || resolved === '') resolved = fallback;
    out += resolveVars(resolved, vars, level + 1);
    i = end + 1;
  }
  return out;
}

function decodeContentValue(value: string): string {
  if (!value) return '';
  var match = /^(['"])([\s\S]*)\1$/.exec(String(value).trim());
  if (!match) return '';
  return match[2]
    .replace(/\\n/g, '\n')
    .replace(/\\A/g, '\n')
    .replace(/\\([\\'"])/g, '$1')
    .replace(/\\([0-9a-f]{1,6})\s?/gi, function (_, hex) {
      try {
        return String.fromCodePoint(parseInt(hex, 16));
      } catch (error) {
        return '';
      }
    });
}

function parseCounterList(raw: string, fallback: number): Array<[string, number]> {
  var tokens = String(raw || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!tokens.length || tokens[0].toLowerCase() === 'none') return [];
  var pairs: Array<[string, number]> = [];
  for (var i = 0; i < tokens.length; i++) {
    var name = tokens[i];
    var next = i + 1 < tokens.length ? Number(tokens[i + 1]) : NaN;
    if (!Number.isNaN(next) && /^-?\d+$/.test(tokens[i + 1])) {
      pairs.push([name, next]);
      i++;
    } else {
      pairs.push([name, fallback]);
    }
  }
  return pairs;
}

function formatCounter(num: number, style: string): string {
  if (style === 'decimal-leading-zero') return (num >= 0 && num < 10 ? '0' : '') + String(num);
  if (style === 'upper-alpha' && num >= 1 && num <= 26) return String.fromCharCode(64 + num);
  if (style === 'lower-alpha' && num >= 1 && num <= 26) return String.fromCharCode(96 + num);
  return String(num);
}

function evaluatePseudoContent(raw: string, counters: Record<string, number> | undefined): string {
  var input = String(raw || '').trim();
  if (!input || input === 'none' || input === 'normal') return '';
  var tokenRe = /(['"])((?:\\.|(?!\1)[\s\S])*)\1|counter\(\s*([\w-]+)\s*(?:,\s*([\w-]+)\s*)?\)/gi;
  var out = '';
  var match: RegExpExecArray | null;
  while ((match = tokenRe.exec(input)) !== null) {
    if (match[1]) out += decodeContentValue(match[0]);
    else out += formatCounter((counters && counters[match[3]]) || 0, (match[4] || 'decimal').toLowerCase());
  }
  return out;
}

function snapshotCounters(
  root: HTMLElement,
  styleMap: Map<HTMLElement, Map<string, StyleValue>>,
  pseudoTargets: Map<HTMLElement, unknown>,
  vars: Record<string, string>,
): Map<HTMLElement, Record<string, number>> {
  var snapshots = new Map<HTMLElement, Record<string, number>>();
  if (!pseudoTargets.size) return snapshots;
  var state: Record<string, number> = {};
  var nodes: HTMLElement[] = [root];
  var descendants = root.querySelectorAll('*');
  for (var i = 0; i < descendants.length; i++) nodes.push(descendants[i] as HTMLElement);
  nodes.forEach(function (el) {
    var props = styleMap.get(el);
    var reset = props && props.get('counter-reset');
    if (reset) {
      parseCounterList(resolveVars(reset.value, vars), 0).forEach(function (pair) {
        state[pair[0]] = pair[1];
      });
    }
    var inc = props && props.get('counter-increment');
    if (inc) {
      parseCounterList(resolveVars(inc.value, vars), 1).forEach(function (pair) {
        state[pair[0]] = (state[pair[0]] || 0) + pair[1];
      });
    }
    if (pseudoTargets.has(el)) snapshots.set(el, { ...state });
  });
  return snapshots;
}

function beats(candidate: StyleCandidate, candidateItem: CssEntry, previous: StyleValue): boolean {
  if (candidate.important !== previous.important) return candidate.important;
  if (candidateItem.specificity !== previous.specificity) return candidateItem.specificity > previous.specificity;
  return candidateItem.order >= previous.order;
}

function matchesElement(element: HTMLElement, selector: string): boolean {
  try {
    return element.matches(selector);
  } catch (error) {
    return false;
  }
}

function queryAll(root: HTMLElement, selector: string): HTMLElement[] {
  var found: HTMLElement[] = [];
  if (matchesElement(root, selector)) found.push(root);
  var list: NodeListOf<Element>;
  try {
    list = root.querySelectorAll(selector);
  } catch (error) {
    return found;
  }
  for (var i = 0; i < list.length; i++) found.push(list[i] as HTMLElement);
  return found;
}

var VOID_TAGS = /^(img|input|br|hr|source|track|wbr|video|audio|iframe|embed|area|base|col|link|meta|param)$/i;

export function inlineCss<T extends HTMLElement>(root: T, css: string): T {
  if (!root || !css) return root;
  var rawRules = parseRules(css);
  var entries: CssEntry[] = [];
  rawRules.forEach(function (rule) {
    rule.selectors.forEach(function (selector) {
      var normalized = normalizeSelector(selector);
      if (!normalized) return;
      var pseudo = splitPseudoElement(normalized);
      entries.push({
        selector: pseudo ? pseudo.base : normalized,
        pseudo: pseudo ? pseudo.pseudo : null,
        decls: rule.decls,
        order: rule.order,
        specificity: selectorSpecificity(pseudo ? pseudo.base : normalized),
      });
    });
  });

  var vars: Record<string, string> = {};
  entries.forEach(function (entry) {
    if (entry.pseudo) return;
    if (!matchesElement(root, entry.selector)) return;
    entry.decls.forEach(function (decl) {
      if (decl.prop.indexOf('--') !== 0) return;
      vars[decl.prop] = resolveVars(decl.value, vars);
    });
  });

  var styleMap = new Map<HTMLElement, Map<string, StyleValue>>();
  entries.forEach(function (entry) {
    if (entry.pseudo) return;
    if (isStateSelector(entry.selector)) return;
    var elements = queryAll(root, entry.selector);
    elements.forEach(function (element) {
      var existingProps = styleMap.get(element);
      var props: Map<string, StyleValue> = existingProps || new Map<string, StyleValue>();
      if (!existingProps) styleMap.set(element, props);
      entry.decls.forEach(function (decl, index) {
        if (decl.prop.indexOf('--') === 0) return;
        var previous = props.get(decl.prop);
        var candidate: StyleCandidate = { value: decl.value, important: decl.important };
        if (!previous || beats(candidate, entry, previous)) {
          props.set(decl.prop, {
            value: decl.value,
            important: decl.important,
            specificity: entry.specificity,
            order: entry.order,
            index: index,
          });
        }
      });
    });
  });

  var originalStyles = new Map<HTMLElement, CSSStyleDeclaration>();
  styleMap.forEach(function (_props, element) {
    originalStyles.set(element, (element.cloneNode(false) as HTMLElement).style);
  });

  styleMap.forEach(function (props, element) {
    const original = originalStyles.get(element);
    if (!original) return;
    Array.from(props.entries())
      .sort(cascadeOrder)
      .forEach(function (pair) {
        var prop = pair[0];
        var decl = pair[1];
        if (/^counter-(?:reset|increment)$/i.test(prop)) return;
        var existing = original ? original.getPropertyValue(prop) : '';
        if (existing) {
          var existingImportant = original.getPropertyPriority(prop) === 'important';
          if (!(decl.important && !existingImportant)) return;
        }
        try {
          element.style.setProperty(prop, resolveVars(decl.value, vars), decl.important ? 'important' : '');
        } catch (error) {
          /* invalid value: leave it to the browser */
        }
      });
  });

  var pseudoMap = new Map<HTMLElement, Record<string, Map<string, StyleValue>>>();
  entries.forEach(function (entry) {
    const pseudoName = entry.pseudo;
    if (!pseudoName || pseudoName === 'skip') return;
    if (isStateSelector(entry.selector)) return;
    var elements = queryAll(root, entry.selector);
    elements.forEach(function (element) {
      if (VOID_TAGS.test(element.tagName || '')) return;
      var record = pseudoMap.get(element);
      if (!record) {
        record = {};
        pseudoMap.set(element, record);
      }
      var props: Map<string, StyleValue> = record[pseudoName] || new Map<string, StyleValue>();
      record[pseudoName] = props;
      entry.decls.forEach(function (decl, index) {
        var previous = props.get(decl.prop);
        var candidate: StyleCandidate = { value: decl.value, important: decl.important };
        if (!previous || beats(candidate, entry, previous)) {
          props.set(decl.prop, {
            value: decl.value,
            important: decl.important,
            specificity: entry.specificity,
            order: entry.order,
            index: index,
          });
        }
      });
    });
  });

  var counters = snapshotCounters(root, styleMap, pseudoMap, vars);
  pseudoMap.forEach(function (record, element) {
    var elementCounters = counters.get(element);
    Object.keys(record).forEach(function (pseudo) {
      var props = record[pseudo];
      var span = element.ownerDocument.createElement('span');
      span.setAttribute('data-mdstudio-pseudo', pseudo);
      var content = '';
      Array.from(props.entries())
        .sort(cascadeOrder)
        .forEach(function (pair) {
          var prop = pair[0];
          var decl = pair[1];
          if (prop === 'content') {
            content = evaluatePseudoContent(resolveVars(decl.value, vars), elementCounters);
            return;
          }
          if (prop.indexOf('--') === 0) return;
          try {
            span.style.setProperty(prop, resolveVars(decl.value, vars), decl.important ? 'important' : '');
          } catch (error) {
            /* ignore */
          }
        });
      if (span.style.display === 'block') {
        span.style.setProperty('display', 'inline-block');
        if (!span.style.width) span.style.setProperty('width', '100%');
      }
      if (content) span.textContent = content;
      if (pseudo === 'before') element.insertBefore(span, element.firstChild);
      else element.appendChild(span);
    });
  });

  return root;
}

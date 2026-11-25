import {
  findCssBlockEnd,
  findCssBlockOpen,
  hasExternalCssUrl,
  splitCssTopLevel,
  stripCssComments,
} from './domain/custom-css';

/**
 * Pure CSS rule parser, specificity calculator, CSS variable/counter evaluator,
 * pseudo-element materializer, and DOM inline-style writer for WeChat HTML.
 */

export interface InlineCssOptions {
  allowExternalCssResources?: boolean;
}

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
  specificity: SpecificityTuple;
}

type SpecificityTuple = readonly [number, number, number];

interface StyleCandidate {
  value: string;
  important: boolean;
}

interface StyleValue extends StyleCandidate {
  specificity: SpecificityTuple;
  order: number;
  index: number;
}

function compareSpecificity(a: SpecificityTuple, b: SpecificityTuple): number {
  if (a[0] !== b[0]) return a[0] - b[0];
  if (a[1] !== b[1]) return a[1] - b[1];
  return a[2] - b[2];
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
  const specDiff = compareSpecificity(x.specificity, y.specificity);
  if (specDiff !== 0) return specDiff;
  if (x.order !== y.order) return x.order - y.order;
  return x.index - y.index;
}

/* ------------------------------------------------------------------------- */
/* CSS parsing                                                                */
/* ------------------------------------------------------------------------- */

export function parseDeclarations(body: string): Declaration[] {
  const decls: Declaration[] = [];
  splitCssTopLevel(body, ';').forEach(function (part) {
    const trimmed = part.trim();
    if (!trimmed || trimmed.includes('{') || trimmed.includes('}')) return;
    const split = /^\s*([^:]+?)\s*:\s*([\s\S]*)$/.exec(trimmed);
    if (!split) return;
    const rawProp = split[1].trim();
    const prop = rawProp.indexOf('--') === 0 ? rawProp : rawProp.toLowerCase();
    let value = split[2].trim();
    if (!prop || !value) return;
    let important = false;
    if (/!\s*important\s*$/i.test(value)) {
      important = true;
      value = value.replace(/!\s*important\s*$/i, '').trim();
    }
    decls.push({ prop: prop, value: value, important: important });
  });
  return decls;
}

function stripStatementAtRules(css: string): string {
  let out = '';
  let quote = '';
  let depth = 0;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (quote) {
      out += ch;
      if (ch === '\\' && i + 1 < css.length) out += css[++i];
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      out += ch;
      continue;
    }
    if (ch === '{') {
      depth++;
    } else if (ch === '}' && depth > 0) {
      depth--;
    } else if (depth === 0 && ch === '@' && (i === 0 || /[\s;{}]/.test(css[i - 1]))) {
      const end = findStatementAtRuleEnd(css, i);
      if (end !== -1) {
        i = end;
        continue;
      }
    }
    out += ch;
  }
  return out;
}

function findStatementAtRuleEnd(css: string, start: number): number {
  let quote = '';
  for (let j = start + 1; j < css.length; j++) {
    const ch = css[j];
    if (quote) {
      if (ch === '\\') j++;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '{') return -1;
    else if (ch === ';') return j;
  }
  return -1;
}

export function parseRules(css: string): ParsedRule[] {
  const clean = stripStatementAtRules(stripCssComments(css));
  const rules: ParsedRule[] = [];
  let i = 0;
  let order = 0;
  while (i < clean.length) {
    const open = findCssBlockOpen(clean, i);
    if (open === -1) break;
    const prelude = clean
      .slice(i, open)
      .replace(/^[;\s]+/, '')
      .trim();
    const close = findCssBlockEnd(clean, open);
    const body = clean.slice(open + 1, close);
    if (prelude && prelude.charAt(0) !== '@') {
      rules.push({
        selectors: splitCssTopLevel(prelude, ',')
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

export function normalizeSelector(selector: string, rootReplacement = '#mdstudio'): string {
  let value = String(selector || '').trim();
  if (!value) return '';
  if (rootReplacement) {
    value = value.replace(/(^|[\s>+~,(])(?::root|html|body)(?=$|[\s>+~,.#[:)])/gi, '$1' + rootReplacement);
    const escaped = rootReplacement.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rootAtom = `(?:${escaped}|#mdstudio|\\.mdstudio-content)`;
    const redundantRootRe = new RegExp(
      `(^|[\\s>+~,(])${rootAtom}(?:\\s+|\\s*>\\s*)${rootAtom}(?=$|[\\s>+~,.#[:)])`,
      'gi',
    );
    let prev = '';
    while (value !== prev) {
      prev = value;
      value = value.replace(redundantRootRe, '$1' + rootReplacement);
    }
  }
  value = value.replace(
    /\.mdstudio-notes-title\b/g,
    ':is(.mdstudio-notes-title, .mdstudio-refs-title, .mdstudio-footnotes-title)',
  );
  value = value.replace(/\.mdstudio-notes\b(?!-)/g, ':is(.mdstudio-notes, .mdstudio-references, .mdstudio-footnotes)');
  value = value.replace(/\.mdstudio-task-box-checked\b/g, '.mdstudio-task-box.is-checked');
  value = value.replace(/([a-zA-Z][\w-]*)?\.mdstudio-task-done\b/g, function (_m, tag?: string) {
    return '.mdstudio-task.is-checked ' + (tag || '') + '.mdstudio-task-text';
  });
  return value;
}

function splitPseudoElement(selector: string): { base: string; pseudo: string } | null {
  const match = /^(.*?)::?(before|after)\s*$/i.exec(selector);
  if (match) return { base: match[1].trim(), pseudo: match[2].toLowerCase() };
  const unsupported =
    /::?(selection|placeholder|marker|first-line|first-letter|backdrop|file-selector-button)\s*$/i.exec(selector);
  if (unsupported) return { base: selector, pseudo: 'skip' };
  return null;
}

function addSpecificity(a: SpecificityTuple, b: SpecificityTuple): SpecificityTuple {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function maxBranchSpecificity(inner: string): SpecificityTuple {
  let best: SpecificityTuple = [0, 0, 0];
  for (const branch of splitCssTopLevel(inner, ',')) {
    const trimmed = branch.trim();
    if (!trimmed) continue;
    const cur = selectorSpecificityTuple(trimmed);
    if (compareSpecificity(cur, best) > 0) best = cur;
  }
  return best;
}

function replaceAttributeSelectors(selector: string): string {
  let out = '';
  let quote = '';
  for (let i = 0; i < selector.length; i++) {
    const ch = selector[i];
    if (ch !== '[') {
      out += ch;
      continue;
    }
    let j = i + 1;
    quote = '';
    while (j < selector.length) {
      const c = selector[j];
      if (quote) {
        if (c === '\\') j++;
        else if (c === quote) quote = '';
      } else if (c === '"' || c === "'") {
        quote = c;
      } else if (c === ']') {
        break;
      }
      j++;
    }
    out += ' .attr ';
    i = j;
  }
  return out;
}

function extractBalancedPseudo(selector: string, pattern: RegExp, onInner: (inner: string) => void): string {
  let out = '';
  let i = 0;
  while (i < selector.length) {
    pattern.lastIndex = i;
    const match = pattern.exec(selector);
    if (!match) {
      out += selector.slice(i);
      break;
    }
    out += selector.slice(i, match.index) + ' ';
    const open = match.index + match[0].length - 1;
    const close = findMatchingParen(selector, open + 1);
    if (close === -1) {
      out += selector.slice(match.index);
      break;
    }
    onInner(selector.slice(open + 1, close));
    i = close + 1;
  }
  return out;
}

function selectorSpecificityTuple(selector: string): SpecificityTuple {
  let bonus: SpecificityTuple = [0, 0, 0];
  let source = replaceAttributeSelectors(selector);
  source = extractBalancedPseudo(source, /:where\(/gi, function () {});
  source = extractBalancedPseudo(source, /:(?:is|not|has)\(/gi, function (inner) {
    bonus = addSpecificity(bonus, maxBranchSpecificity(inner));
  });
  source = extractBalancedPseudo(source, /:nth-(?:last-)?child\(/gi, function (inner) {
    bonus = addSpecificity(bonus, [0, 1, 0]);
    const ofMatch = /\bof\s+([\s\S]+)$/i.exec(inner);
    if (ofMatch) bonus = addSpecificity(bonus, maxBranchSpecificity(ofMatch[1]));
  });
  const doublePseudoCount = (source.match(/::[\w-]+/g) || []).length;
  source = source.replace(/::[\w-]+/g, ' ');
  const legacyPseudo = /:(?:before|after|first-line|first-letter)\b/gi;
  const pseudoElements = doublePseudoCount + (source.match(legacyPseudo) || []).length;
  source = source.replace(legacyPseudo, ' ');
  const ids = (source.match(/#[\w-]+/g) || []).length;
  const classes = (source.match(/\.[\w-]+|:[\w-]+(?:\([^)]*\))?/g) || []).length;
  source = source.replace(/:[\w-]+\([^)]*\)/g, ' ');
  const types = (source.match(/(^|[\s>+~])([a-zA-Z][\w-]*)/g) || []).length;
  return addSpecificity(bonus, [ids, classes, types + pseudoElements]);
}

export function selectorSpecificity(selector: string): number {
  const [ids, classes, types] = selectorSpecificityTuple(selector);
  return ids * 100 + classes * 10 + types;
}

function isStateSelector(selector: string): boolean {
  return /:{1,2}(hover|active|focus|focus-visible|focus-within|visited|target|checked|disabled|enabled|link|any-link)\b/i.test(
    selector,
  );
}

function findTopLevelComma(value: string): number {
  let depth = 0;
  let quote = null;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
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

function findMatchingParen(input: string, from: number): number {
  let depthParen = 1;
  let quote: string | null = null;
  for (let j = from; j < input.length; j++) {
    const ch = input[j];
    if (quote) {
      if (ch === '\\') {
        j++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '(') depthParen++;
    else if (ch === ')' && --depthParen === 0) return j;
  }
  return -1;
}

const MAX_VAR_EXPANSIONS = 64;
const MAX_VAR_VALUE_LEN = 4096;

interface VarBudget {
  steps: number;
}

function findNextVarCall(input: string, from: number): number {
  let quote = '';
  for (let i = from; i < input.length; i++) {
    const ch = input[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (
      (ch === 'v' || ch === 'V') &&
      input.slice(i, i + 4).toLowerCase() === 'var(' &&
      (i === 0 || !/[a-zA-Z0-9_-]/.test(input[i - 1]))
    ) {
      return i;
    }
  }
  return -1;
}

interface ResolvedVar {
  value: string;
  valid: boolean;
}

function resolveVarsChecked(
  input: string,
  vars: Record<string, string>,
  level: number,
  visiting: Set<string>,
  budget: VarBudget,
): ResolvedVar {
  if (!vars || !/var\(/i.test(input)) {
    return { value: input, valid: true };
  }
  if (level > 8 || budget.steps >= MAX_VAR_EXPANSIONS) {
    return { value: '', valid: false };
  }
  let out = '';
  let i = 0;
  while (i < input.length) {
    const start = findNextVarCall(input, i);
    if (start === -1) {
      out += input.slice(i);
      break;
    }
    out += input.slice(i, start);
    const end = findMatchingParen(input, start + 4);
    if (end === -1) {
      out += input.slice(start);
      break;
    }
    if (++budget.steps > MAX_VAR_EXPANSIONS) return { value: out.slice(0, MAX_VAR_VALUE_LEN), valid: false };
    const inner = input.slice(start + 4, end);
    const comma = findTopLevelComma(inner);
    const name = (comma === -1 ? inner : inner.slice(0, comma)).trim();
    const fallback = comma === -1 ? '' : inner.slice(comma + 1).trim();
    const hasFallback = comma !== -1;
    const raw = Object.hasOwn(vars, name) ? vars[name] : undefined;
    if (raw != null && raw !== '' && !visiting.has(name)) {
      visiting.add(name);
      const nested = resolveVarsChecked(raw, vars, level + 1, visiting, budget);
      visiting.delete(name);
      if (nested.valid && nested.value !== '') {
        out += nested.value;
      } else if (hasFallback) {
        const fb = resolveVarsChecked(fallback, vars, level + 1, visiting, budget);
        if (!fb.valid) return { value: '', valid: false };
        out += fb.value;
      } else {
        return { value: '', valid: false };
      }
    } else if (hasFallback) {
      const fb = resolveVarsChecked(fallback, vars, level + 1, visiting, budget);
      if (!fb.valid) return { value: '', valid: false };
      out += fb.value;
    } else {
      return { value: '', valid: false };
    }
    if (out.length > MAX_VAR_VALUE_LEN) return { value: out.slice(0, MAX_VAR_VALUE_LEN), valid: true };
    i = end + 1;
  }
  return { value: out, valid: true };
}

export function resolveVars(value: unknown, vars: Record<string, string>, depth?: number): string {
  const input = String(value == null ? '' : value);
  return resolveVarsChecked(input, vars, depth || 0, new Set<string>(), { steps: 0 }).value;
}

function decodeContentValue(value: string): string {
  if (!value) return '';
  const match = /^(['"])([\s\S]*)\1$/.exec(String(value).trim());
  if (!match) return '';
  return match[2].replace(/\\([0-9a-f]{1,6})[ \t\r\n\f]?|\\([\s\S])/gi, function (_, hex?: string, escaped?: string) {
    if (hex) {
      try {
        return String.fromCodePoint(parseInt(hex, 16));
      } catch {
        return '';
      }
    }
    return escaped || '';
  });
}

function parseCounterList(raw: string, fallback: number): Array<[string, number]> {
  const tokens = String(raw || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!tokens.length || tokens[0].toLowerCase() === 'none') return [];
  const pairs: Array<[string, number]> = [];
  for (let i = 0; i < tokens.length; i++) {
    const name = tokens[i];
    const next = i + 1 < tokens.length ? Number(tokens[i + 1]) : NaN;
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
  const input = String(raw || '').trim();
  if (!input || input === 'none' || input === 'normal') return '';
  const tokenRe = /(['"])((?:\\[\s\S]|(?!\1)[^\\])*)\1|counter\(\s*([\w-]+)\s*(?:,\s*([\w-]+)\s*)?\)/gi;
  let out = '';
  let match: RegExpExecArray | null;
  while ((match = tokenRe.exec(input)) !== null) {
    if (match[1]) out += decodeContentValue(match[0]);
    else {
      const val = counters && Object.hasOwn(counters, match[3]) ? counters[match[3]] : 0;
      out += formatCounter(val, (match[4] || 'decimal').toLowerCase());
    }
  }
  return out;
}

function applyCounterProps(
  props: Map<string, StyleValue[]> | undefined,
  vars: Record<string, string>,
  state: Record<string, number>,
  scopedResets?: Map<string, number | undefined>,
): void {
  if (!props) return;
  const resetList = props.get('counter-reset');
  const incList = props.get('counter-increment');
  const reset = resetList ? winningCandidate(resetList) : null;
  const inc = incList ? winningCandidate(incList) : null;
  if (reset) {
    parseCounterList(resolveVars(reset.value, vars), 0).forEach(function (pair) {
      if (scopedResets && !scopedResets.has(pair[0])) {
        scopedResets.set(pair[0], Object.hasOwn(state, pair[0]) ? state[pair[0]] : undefined);
      }
      state[pair[0]] = pair[1];
    });
  }
  if (inc) {
    parseCounterList(resolveVars(inc.value, vars), 1).forEach(function (pair) {
      state[pair[0]] = (Object.hasOwn(state, pair[0]) ? state[pair[0]] : 0) + pair[1];
    });
  }
}

function snapshotCounters(
  root: HTMLElement,
  styleMap: Map<HTMLElement, Map<string, StyleValue[]>>,
  pseudoTargets: Map<HTMLElement, Record<string, Map<string, StyleValue[]>>>,
  varsFor: (element: HTMLElement) => Record<string, string>,
): Map<HTMLElement, Record<string, number>> {
  const snapshots = new Map<HTMLElement, Record<string, number>>();
  if (!pseudoTargets.size) return snapshots;
  const state: Record<string, number> = Object.create(null) as Record<string, number>;
  function walk(el: HTMLElement): void {
    const props = styleMap.get(el);
    const pseudoRec = pseudoTargets.get(el);
    const hasCounterProps = Boolean(
      props?.has('counter-reset') ||
        props?.has('counter-increment') ||
        pseudoRec?.before?.has('counter-reset') ||
        pseudoRec?.before?.has('counter-increment') ||
        pseudoRec?.after?.has('counter-reset') ||
        pseudoRec?.after?.has('counter-increment'),
    );
    const scopedResets = new Map<string, number | undefined>();
    const vars = hasCounterProps ? varsFor(el) : null;
    if (vars) {
      applyCounterProps(props, vars, state, scopedResets);
      if (pseudoRec?.before) applyCounterProps(pseudoRec.before, vars, state);
    }
    if (pseudoRec) {
      const snap: Record<string, number> = Object.create(null) as Record<string, number>;
      Object.assign(snap, state);
      snapshots.set(el, snap);
    }
    for (let child = el.firstElementChild; child; child = child.nextElementSibling) {
      walk(child as HTMLElement);
    }
    if (vars && pseudoRec?.after) {
      applyCounterProps(pseudoRec.after, vars, state);
    }
    scopedResets.forEach(function (prevVal, name) {
      if (prevVal === undefined) delete state[name];
      else state[name] = prevVal;
    });
  }
  walk(root);
  return snapshots;
}

function beats(candidate: StyleCandidate, candidateItem: CssEntry, previous: StyleValue): boolean {
  if (candidate.important !== previous.important) return candidate.important;
  const specDiff = compareSpecificity(candidateItem.specificity, previous.specificity);
  if (specDiff !== 0) return specDiff > 0;
  return candidateItem.order >= previous.order;
}

function winningCandidate(list: StyleValue[]): StyleValue | null {
  if (!list.length) return null;
  let best = list[0];
  for (let i = 1; i < list.length; i++) {
    const cur = list[i];
    if (cascadeOrder(['', cur], ['', best]) >= 0) best = cur;
  }
  return best;
}

function matchesElement(element: HTMLElement, selector: string): boolean {
  try {
    return element.matches(selector);
  } catch {
    return false;
  }
}

function isSvgInterior(element: Element): boolean {
  return element.tagName.toLowerCase() !== 'svg' && Boolean(element.closest('svg'));
}

function queryAll(root: HTMLElement, selector: string): HTMLElement[] {
  const found: HTMLElement[] = [];
  if (matchesElement(root, selector)) found.push(root);
  let list: NodeListOf<Element>;
  try {
    list = root.querySelectorAll(selector);
  } catch {
    return found;
  }
  for (let i = 0; i < list.length; i++) {
    const el = list[i];
    if (!isSvgInterior(el)) found.push(el as HTMLElement);
  }
  return found;
}

const VOID_TAGS = /^(img|input|br|hr|source|track|wbr|video|audio|iframe|embed|area|base|col|link|meta|param)$/i;

function buildElementVars(
  element: HTMLElement,
  root: HTMLElement,
  varMap: Map<HTMLElement, Map<string, StyleValue>>,
  cache: Map<HTMLElement, Record<string, string>>,
): Record<string, string> {
  const cached = cache.get(element);
  if (cached) return cached;
  const parent = element !== root ? (element.parentElement as HTMLElement | null) : null;
  const parentVars = parent && root.contains(parent) ? buildElementVars(parent, root, varMap, cache) : {};
  const own = varMap.get(element);
  if (!own) {
    cache.set(element, parentVars);
    return parentVars;
  }
  const resolved: Record<string, string> = { ...parentVars };
  const status = new Map<string, 'visiting' | 'done'>();
  function resolveOwn(name: string): void {
    if (status.has(name)) return;
    const decl = own!.get(name);
    if (!decl) return;
    status.set(name, 'visiting');
    const depRe = /var\(\s*(--[^\s,)]+)/gi;
    let depMatch: RegExpExecArray | null;
    while ((depMatch = depRe.exec(decl.value)) !== null) {
      const dep = depMatch[1];
      if (dep !== name && own!.has(dep) && !status.has(dep)) resolveOwn(dep);
    }
    const lookup: Record<string, string> = { ...resolved };
    const visiting = new Set<string>();
    for (const [k, st] of status.entries()) {
      if (st === 'visiting' && k !== name) visiting.add(k);
    }
    const directSelfRef = new RegExp(`var\\(\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s*[,)])`, 'i');
    if (directSelfRef.test(decl.value)) {
      if (Object.hasOwn(parentVars, name)) lookup[name] = parentVars[name];
      else delete lookup[name];
    } else {
      visiting.add(name);
    }
    const next = resolveVarsChecked(decl.value, lookup, 0, visiting, { steps: 0 });
    if (next.valid && next.value) resolved[name] = next.value;
    else delete resolved[name];
    status.set(name, 'done');
  }
  for (const name of own.keys()) resolveOwn(name);
  cache.set(element, resolved);
  return resolved;
}

function reapplyOriginalInlineStyles(element: HTMLElement, original: CSSStyleDeclaration): void {
  for (let i = 0; i < original.length; i++) {
    const prop = original.item(i);
    if (!prop) continue;
    const priority = original.getPropertyPriority(prop);
    if (priority !== 'important' && element.style.getPropertyPriority(prop) === 'important') continue;
    try {
      element.style.setProperty(prop, original.getPropertyValue(prop), priority);
    } catch {
      /* ignore */
    }
  }
}

export function inlineCss<T extends HTMLElement>(root: T, css: string, options?: InlineCssOptions): T {
  if (!root || !css) return root;
  const allowExternal = Boolean(options?.allowExternalCssResources);
  const rawRules = parseRules(css);
  const entries: CssEntry[] = [];
  rawRules.forEach(function (rule) {
    rule.selectors.forEach(function (selector) {
      const normalized = normalizeSelector(selector);
      if (!normalized) return;
      const pseudo = splitPseudoElement(normalized);
      const specSelector = normalizeSelector(selector, '.mdstudio-content');
      const specPseudo = splitPseudoElement(specSelector);
      entries.push({
        selector: pseudo ? pseudo.base : normalized,
        pseudo: pseudo ? pseudo.pseudo : null,
        decls: rule.decls,
        order: rule.order,
        specificity: selectorSpecificityTuple(specPseudo ? specPseudo.base : specSelector),
      });
    });
  });

  const styleMap = new Map<HTMLElement, Map<string, StyleValue[]>>();
  const varMap = new Map<HTMLElement, Map<string, StyleValue>>();
  entries.forEach(function (entry) {
    if (entry.pseudo) return;
    if (isStateSelector(entry.selector)) return;
    const elements = queryAll(root, entry.selector);
    elements.forEach(function (element) {
      entry.decls.forEach(function (decl, index) {
        if (decl.prop.indexOf('--') === 0) {
          const existingProps = varMap.get(element);
          const props: Map<string, StyleValue> = existingProps || new Map<string, StyleValue>();
          if (!existingProps) varMap.set(element, props);
          const previous = props.get(decl.prop);
          const candidate: StyleCandidate = { value: decl.value, important: decl.important };
          if (!previous || beats(candidate, entry, previous)) {
            props.set(decl.prop, {
              value: decl.value,
              important: decl.important,
              specificity: entry.specificity,
              order: entry.order,
              index: index,
            });
          }
          return;
        }
        const existingProps = styleMap.get(element);
        const props: Map<string, StyleValue[]> = existingProps || new Map<string, StyleValue[]>();
        if (!existingProps) styleMap.set(element, props);
        const list = props.get(decl.prop) || [];
        list.push({
          value: decl.value,
          important: decl.important,
          specificity: entry.specificity,
          order: entry.order,
          index: index,
        });
        props.set(decl.prop, list);
      });
    });
  });

  const varCache = new Map<HTMLElement, Record<string, string>>();
  const originalStyles = new Map<HTMLElement, CSSStyleDeclaration>();
  styleMap.forEach(function (_props, element) {
    originalStyles.set(element, (element.cloneNode(false) as HTMLElement).style);
  });

  styleMap.forEach(function (props, element) {
    const original = originalStyles.get(element);
    if (!original) return;
    const elementVars = buildElementVars(element, root, varMap, varCache);
    const ordered: Array<[string, StyleValue]> = [];
    props.forEach(function (list, prop) {
      for (const decl of list) ordered.push([prop, decl]);
    });
    ordered.sort(cascadeOrder).forEach(function (pair) {
      const prop = pair[0];
      const decl = pair[1];
      if (/^counter-(?:reset|increment)$/i.test(prop)) return;
      const existing = original.getPropertyValue(prop);
      if (existing) {
        const existingImportant = original.getPropertyPriority(prop) === 'important';
        if (!(decl.important && !existingImportant)) return;
      }
      const checked = resolveVarsChecked(decl.value, elementVars, 0, new Set<string>(), { steps: 0 });
      if (!checked.valid) return;
      if (!allowExternal && hasExternalCssUrl(checked.value)) return;
      try {
        element.style.setProperty(prop, checked.value, decl.important ? 'important' : '');
      } catch {
        /* invalid value: leave it to the browser */
      }
    });
    if (original.length > 0) reapplyOriginalInlineStyles(element, original);
  });

  const pseudoMap = new Map<HTMLElement, Record<string, Map<string, StyleValue[]>>>();
  entries.forEach(function (entry) {
    const pseudoName = entry.pseudo;
    if (!pseudoName || pseudoName === 'skip') return;
    if (isStateSelector(entry.selector)) return;
    const elements = queryAll(root, entry.selector);
    elements.forEach(function (element) {
      if (VOID_TAGS.test(element.tagName || '')) return;
      let record = pseudoMap.get(element);
      if (!record) {
        record = {};
        pseudoMap.set(element, record);
      }
      const props: Map<string, StyleValue[]> = record[pseudoName] || new Map<string, StyleValue[]>();
      record[pseudoName] = props;
      entry.decls.forEach(function (decl, index) {
        const list = props.get(decl.prop) || [];
        list.push({
          value: decl.value,
          important: decl.important,
          specificity: entry.specificity,
          order: entry.order,
          index: index,
        });
        props.set(decl.prop, list);
      });
    });
  });

  const counters = snapshotCounters(root, styleMap, pseudoMap, function (el) {
    return buildElementVars(el, root, varMap, varCache);
  });
  pseudoMap.forEach(function (record, element) {
    const elementCounters = counters.get(element);
    const elementVars = buildElementVars(element, root, varMap, varCache);
    Object.keys(record).forEach(function (pseudo) {
      const props = record[pseudo];
      const pseudoVars: Record<string, string> = { ...elementVars };
      props.forEach(function (list, prop) {
        if (prop.indexOf('--') !== 0) return;
        const winner = winningCandidate(list);
        if (!winner) return;
        const checked = resolveVarsChecked(winner.value, pseudoVars, 0, new Set<string>(), { steps: 0 });
        if (checked.valid && checked.value) pseudoVars[prop] = checked.value;
      });
      const contentList = props.get('content');
      if (!contentList || !contentList.length) return;
      const orderedContent = contentList.map((decl): [string, StyleValue] => ['content', decl]).sort(cascadeOrder);
      let rawContent = '';
      for (let idx = orderedContent.length - 1; idx >= 0; idx--) {
        const checked = resolveVarsChecked(orderedContent[idx][1].value, pseudoVars, 0, new Set<string>(), {
          steps: 0,
        });
        if (checked.valid) {
          rawContent = checked.value.trim();
          break;
        }
      }
      if (!rawContent || rawContent === 'none' || rawContent === 'normal') return;
      const span = element.ownerDocument.createElement('span');
      span.setAttribute('data-mdstudio-pseudo', pseudo);
      const content = evaluatePseudoContent(rawContent, elementCounters);
      const orderedPseudo: Array<[string, StyleValue]> = [];
      props.forEach(function (list, prop) {
        if (prop === 'content' || prop.indexOf('--') === 0 || /^counter-(?:reset|increment)$/i.test(prop)) return;
        for (const decl of list) orderedPseudo.push([prop, decl]);
      });
      orderedPseudo.sort(cascadeOrder).forEach(function (pair) {
        const prop = pair[0];
        const decl = pair[1];
        const checked = resolveVarsChecked(decl.value, pseudoVars, 0, new Set<string>(), { steps: 0 });
        if (!checked.valid) return;
        if (!allowExternal && hasExternalCssUrl(checked.value)) return;
        try {
          span.style.setProperty(prop, checked.value, decl.important ? 'important' : '');
        } catch {
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

import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { css } from '@codemirror/lang-css';
import { markdown } from '@codemirror/lang-markdown';
import { bracketMatching, HighlightStyle, indentOnInput, syntaxHighlighting, syntaxTree } from '@codemirror/language';
import { highlightSelectionMatches } from '@codemirror/search';
import type { Extension, Range, Text } from '@codemirror/state';
import { Annotation, Compartment, EditorState, RangeSetBuilder, StateEffect, StateField } from '@codemirror/state';
import type { DecorationSet, ViewUpdate } from '@codemirror/view';
import {
  Decoration,
  drawSelection,
  dropCursor,
  EditorView,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  placeholder,
  rectangularSelection,
  ViewPlugin,
  WidgetType,
} from '@codemirror/view';
import { tags } from '@lezer/highlight';
import type {
  EditorApi,
  EditorCoords,
  EditorDiffOffset,
  EditorDiffPart,
  EditorDiffTransition,
  EditorInlineBlock,
  EditorScrollInfo,
  EditorSelection,
} from '../domain/editor-types';

export type {
  EditorApi,
  EditorCoords,
  EditorDiffOffset,
  EditorDiffPart,
  EditorDiffTransition,
  EditorInlineBlock,
  EditorScrollInfo,
  EditorSelection,
};

export interface EditorOptions {
  parent: HTMLElement;
  doc?: string;
  placeholder?: string;
  ariaLabel?: string;
  language?: 'markdown' | 'css';
  dark?: boolean;
  enableHistory?: boolean;
  onChange?: (value: string, selection: EditorSelection) => void;
  onSelection?: (selection: EditorSelection) => void;
  onBlur?: () => void;
}

const PROSE_FONT =
  'var(--dsw-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif)';
const CODE_FONT =
  'var(--ds-font-family-code, "SFMono-Regular", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New")';

const lightHighlightStyle = HighlightStyle.define([
  { tag: tags.heading, color: 'var(--dsw-alias-label-primary, #0f1115)', fontWeight: '600' },
  { tag: tags.strong, color: 'var(--dsw-alias-label-primary, #0f1115)', fontWeight: '600' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  {
    tag: [tags.link, tags.url],
    color: 'var(--shiki-token-link, var(--dsw-alias-state-business-primary, #1d5bd6))',
    textDecoration: 'underline',
  },
  { tag: tags.quote, color: 'var(--dsw-alias-label-secondary, #5f6672)' },
  { tag: tags.monospace, fontFamily: CODE_FONT, fontSize: '0.925em' },
  { tag: [tags.keyword, tags.operator], color: 'var(--shiki-token-keyword, #1d5bd6)' },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--shiki-token-string-expression, #177245)' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--shiki-token-constant, #b45309)' },
  { tag: [tags.comment, tags.meta, tags.processingInstruction], color: 'var(--dsw-alias-label-secondary, #525866)' },
  { tag: [tags.propertyName, tags.attributeName], color: 'var(--shiki-token-function, #0f766e)' },
  { tag: tags.tagName, color: 'var(--shiki-token-parameter, #be123c)' },
]);

const darkHighlightStyle = HighlightStyle.define([
  { tag: tags.heading, color: 'var(--dsw-alias-label-primary, #f9fafb)', fontWeight: '600' },
  { tag: tags.strong, color: 'var(--dsw-alias-label-primary, #f9fafb)', fontWeight: '600' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  {
    tag: [tags.link, tags.url],
    color: 'var(--shiki-token-link, var(--dsw-alias-state-business-primary, #7aa8ff))',
    textDecoration: 'underline',
  },
  { tag: tags.quote, color: 'var(--dsw-alias-label-secondary, #9ca3af)' },
  { tag: tags.monospace, fontFamily: CODE_FONT, fontSize: '0.925em' },
  { tag: [tags.keyword, tags.operator], color: 'var(--shiki-token-keyword, #93c5fd)' },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--shiki-token-string, #86efac)' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--shiki-token-constant, #fcd34d)' },
  { tag: [tags.comment, tags.meta, tags.processingInstruction], color: 'var(--dsw-alias-label-secondary, #a6adbb)' },
  { tag: [tags.propertyName, tags.attributeName], color: 'var(--shiki-token-function, #5eead4)' },
  { tag: tags.tagName, color: 'var(--shiki-token-parameter, #fda4af)' },
]);

const monoLineMark = Decoration.line({ class: 'cm-md-mono-line' });

function buildMonoLineDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const tree = syntaxTree(view.state);
  const doc = view.state.doc;
  let lastLineFrom = -1;
  for (const range of view.visibleRanges) {
    tree.iterate({
      from: range.from,
      to: range.to,
      enter(node) {
        if (node.name !== 'Table' && node.name !== 'FencedCode' && node.name !== 'CodeBlock') return undefined;
        const startLine = doc.lineAt(node.from).number;
        const endLine = doc.lineAt(Math.min(doc.length, node.to)).number;
        for (let num = startLine; num <= endLine; num++) {
          const line = doc.line(num);
          if (line.from > lastLineFrom) {
            builder.add(line.from, line.from, monoLineMark);
            lastLineFrom = line.from;
          }
        }
        return false;
      },
    });
  }
  return builder.finish();
}

const markdownMonoLines = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildMonoLineDecorations(view);
    }
    update(update: ViewUpdate): void {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildMonoLineDecorations(update.view);
      }
    }
  },
  {
    decorations: (instance) => instance.decorations,
  },
);

function editorTheme(dark: boolean, isCss: boolean): Extension {
  const fgFallback = dark ? '#f9fafb' : '#0f1115';
  const menuBgFallback = dark ? '#20232a' : '#ffffff';
  return EditorView.theme(
    {
      '&': {
        height: '100%',
        backgroundColor: 'transparent',
        color: 'var(--dsw-alias-label-primary, ' + fgFallback + ')',
        fontFamily: isCss ? CODE_FONT : PROSE_FONT,
        fontSize: isCss ? '13px' : 'var(--dsh-content-font-size, 14px)',
      },
      '.cm-scroller': {
        fontFamily: 'inherit',
        lineHeight: isCss ? '1.68' : '1.8',
        overflow: 'auto',
      },
      '.cm-content': {
        minWidth: '0',
        padding: isCss ? '16px 20px 48px' : '22px 28px 64px',
        caretColor: 'var(--dsw-alias-brand-primary, ' + fgFallback + ')',
        tabSize: '2',
      },
      '.cm-line': { padding: '0' },
      '.cm-md-mono-line': {
        fontFamily: CODE_FONT,
        fontSize: '0.925em',
        lineHeight: '1.68',
      },
      '.cm-gutters': {
        backgroundColor: 'transparent',
        color: 'var(--dsw-alias-label-tertiary, ' + (dark ? '#9098a8' : '#666d7a') + ')',
        border: 'none',
        paddingLeft: '10px',
        paddingRight: '4px',
        fontFamily: CODE_FONT,
        fontSize: '11.5px',
      },
      '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionLayer .cm-selectionBackground, ::selection':
        {
          backgroundColor:
            'var(--dsw-alias-bg-document-selection, color-mix(in srgb, var(--dsw-alias-label-primary, ' +
            fgFallback +
            ') 14%, transparent))',
        },
      '.cm-cursor, .cm-dropCursor': {
        borderLeftColor: 'var(--dsw-alias-brand-primary, ' + fgFallback + ')',
      },
      '.cm-placeholder': {
        color: 'var(--dsw-alias-label-tertiary, ' + (dark ? '#9098a8' : '#666d7a') + ')',
      },
      '.cm-tooltip': {
        border: '0.5px solid var(--dsw-alias-border-l3, rgba(15, 17, 21, 0.1))',
        borderRadius: 'var(--dsw-radius-sm, 8px)',
        backgroundColor: 'var(--dsw-specific-menu, ' + menuBgFallback + ')',
        boxShadow: 'var(--dsw-elevation-panel, 0 8px 24px rgba(0, 0, 0, 0.12))',
        color: 'var(--dsw-alias-label-primary, ' + fgFallback + ')',
      },
      '.mdstudio-cm-ai-del-range': {
        borderRadius: '3px',
        backgroundColor: dark ? 'rgba(248, 81, 73, 0.16)' : 'rgba(229, 72, 77, 0.11)',
      },
      '.mdstudio-cm-ai-del-word': {
        borderRadius: '3px',
        padding: '1px 1px',
        backgroundColor: dark ? 'rgba(248, 81, 73, 0.34)' : 'rgba(229, 72, 77, 0.25)',
        textDecoration: 'line-through',
        textDecorationColor: dark ? 'rgba(255, 123, 114, 0.85)' : 'rgba(220, 38, 38, 0.72)',
      },
    },
    { dark },
  );
}

const setInlineBlocksEffect = StateEffect.define<readonly EditorInlineBlock[]>();
const setDiffTransitionEffect = StateEffect.define<EditorDiffTransition | null>();

const inlineBlockSpecs = new WeakMap<HTMLElement, EditorInlineBlock>();

function makeActionBtn(
  label: string,
  cls: string,
  wrap: HTMLElement,
  pick: (spec: EditorInlineBlock) => (() => void) | undefined,
): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = cls;
  btn.textContent = label;
  btn.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const current = inlineBlockSpecs.get(wrap);
    if (current) pick(current)?.();
  });
  return btn;
}

function appendDiffSpans(parent: HTMLElement, parts: readonly EditorDiffPart[], changedCls: string): void {
  for (const part of parts) {
    if (part.changed) {
      const span = document.createElement('span');
      span.className = changedCls;
      span.textContent = part.text;
      parent.appendChild(span);
    } else {
      parent.appendChild(document.createTextNode(part.text));
    }
  }
}

function appendProseContent(prose: HTMLElement, item: EditorInlineBlock): void {
  prose.textContent = '';
  if (item.status === 'ready' && item.addParts && item.addParts.length > 0) {
    appendDiffSpans(prose, item.addParts, 'mdstudio-ai-add-word');
    return;
  }
  prose.textContent = item.text;
  if (item.status === 'streaming') {
    const caret = document.createElement('span');
    caret.className = 'mdstudio-ai-stream-caret';
    caret.setAttribute('aria-hidden', 'true');
    prose.appendChild(caret);
  }
}

class AiInlineBlockWidget extends WidgetType {
  constructor(readonly spec: EditorInlineBlock) {
    super();
  }

  eq(other: AiInlineBlockWidget): boolean {
    const a = this.spec;
    const b = other.spec;
    return (
      a.id === b.id &&
      a.from === b.from &&
      a.to === b.to &&
      a.text === b.text &&
      a.status === b.status &&
      a.warning === b.warning &&
      a.primaryLabel === b.primaryLabel &&
      a.secondaryLabel === b.secondaryLabel &&
      a.retryLabel === b.retryLabel &&
      (a.addParts?.length ?? 0) === (b.addParts?.length ?? 0) &&
      a.onPrimary === b.onPrimary &&
      a.onSecondary === b.onSecondary &&
      a.onRetry === b.onRetry
    );
  }

  updateDOM(dom: HTMLElement): boolean {
    const item = this.spec;
    const labelsKey = `${item.primaryLabel}\0${item.secondaryLabel}\0${item.retryLabel || ''}`;
    if (dom.getAttribute('data-mdstudio-ai-patch') !== item.id) return false;
    if (dom.getAttribute('data-mdstudio-ai-status') !== item.status) return false;
    if (dom.getAttribute('data-mdstudio-ai-labels') !== labelsKey) return false;
    const existingWarn = dom.querySelector<HTMLElement>('.mdstudio-ai-inline-reason');
    if (Boolean(item.warning) !== Boolean(existingWarn)) return false;
    const prose = dom.querySelector<HTMLElement>('.mdstudio-ai-inline-prose');
    if (!prose) return false;
    inlineBlockSpecs.set(dom, item);
    appendProseContent(prose, item);
    if (existingWarn && item.warning) existingWarn.textContent = item.warning;
    return true;
  }

  toDOM(): HTMLElement {
    const item = this.spec;
    const wrap = document.createElement('div');
    wrap.className = 'mdstudio-ai-inline-card is-' + item.status;
    wrap.setAttribute('data-mdstudio-ai-patch', item.id);
    wrap.setAttribute('data-mdstudio-ai-status', item.status);
    wrap.setAttribute(
      'data-mdstudio-ai-labels',
      `${item.primaryLabel}\0${item.secondaryLabel}\0${item.retryLabel || ''}`,
    );
    wrap.setAttribute('role', item.status === 'error' ? 'alert' : 'region');
    wrap.setAttribute('aria-label', item.warning || item.primaryLabel || item.secondaryLabel);
    inlineBlockSpecs.set(wrap, item);

    const prose = document.createElement('div');
    prose.className = 'mdstudio-ai-inline-prose';
    prose.setAttribute('aria-live', item.status === 'error' ? 'assertive' : 'polite');
    appendProseContent(prose, item);
    wrap.appendChild(prose);

    const bar = document.createElement('div');
    bar.className = 'mdstudio-ai-inline-bar';
    if (item.warning) {
      const warn = document.createElement('span');
      warn.className = 'mdstudio-ai-inline-reason is-warn';
      warn.textContent = item.warning;
      bar.appendChild(warn);
    }

    const btns = document.createElement('div');
    btns.className = 'mdstudio-ai-inline-btns';
    btns.appendChild(
      makeActionBtn(
        item.secondaryLabel,
        'mdstudio-dsh-btn is-sm is-outline mdstudio-diff-outline-btn',
        wrap,
        (spec) => spec.onSecondary,
      ),
    );
    if (item.status === 'error' && item.retryLabel && item.onRetry) {
      btns.appendChild(
        makeActionBtn(
          item.retryLabel,
          'mdstudio-dsh-btn is-sm is-outline mdstudio-diff-outline-btn',
          wrap,
          (spec) => spec.onRetry,
        ),
      );
    }
    if (item.status === 'ready') {
      btns.appendChild(
        makeActionBtn(item.primaryLabel, 'mdstudio-dsh-btn is-sm is-primary', wrap, (spec) => spec.onPrimary),
      );
    }
    bar.appendChild(btns);
    wrap.appendChild(bar);
    return wrap;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

function scheduleGhostCollapse(outer: HTMLElement): void {
  void outer.offsetHeight;
  window.requestAnimationFrame(() => {
    outer.classList.add('is-collapsing');
  });
}

class AiDiffGhostWidget extends WidgetType {
  constructor(readonly spec: EditorDiffTransition) {
    super();
  }

  eq(other: AiDiffGhostWidget): boolean {
    return this.spec.seq === other.spec.seq && this.spec.kind === other.spec.kind;
  }

  toDOM(): HTMLElement {
    const showDel = this.spec.kind === 'accept' && !this.spec.inlinePhrase;
    const outer = document.createElement('div');
    outer.className = 'mdstudio-ai-ghost-collapse is-' + this.spec.kind;
    outer.setAttribute('aria-hidden', 'true');
    const inner = document.createElement('div');
    inner.className = 'mdstudio-ai-ghost-inner';
    const box = document.createElement('div');
    box.className = showDel ? 'mdstudio-ai-ghost-del' : 'mdstudio-ai-ghost-add';
    appendDiffSpans(box, this.spec.ghostParts, showDel ? 'mdstudio-ai-del-word' : 'mdstudio-ai-add-word');
    inner.appendChild(box);
    outer.appendChild(inner);
    scheduleGhostCollapse(outer);
    return outer;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

function diffBandLineClass(base: string, ln: number, first: number, last: number): string {
  let cls = base;
  if (ln === first) cls += ' is-first';
  if (ln === last) cls += ' is-last';
  return cls;
}

function appendBandMarks(
  doc: Text,
  from: number,
  to: number,
  lineCls: string,
  rangeCls: string,
  out: Range<Decoration>[],
): void {
  const startLine = doc.lineAt(from);
  const endLine = doc.lineAt(to);
  if (from <= startLine.from && to >= endLine.to) {
    for (let ln = startLine.number; ln <= endLine.number; ln++) {
      out.push(
        Decoration.line({ class: diffBandLineClass(lineCls, ln, startLine.number, endLine.number) }).range(
          doc.line(ln).from,
        ),
      );
    }
    return;
  }
  out.push(Decoration.mark({ class: rangeCls }).range(from, to));
}

function appendOffsetMarks(
  from: number,
  to: number,
  offsets: readonly EditorDiffOffset[],
  cls: string,
  out: Range<Decoration>[],
): void {
  for (const off of offsets) {
    const mFrom = Math.max(from, Math.min(to, from + off.fromOffset));
    const mTo = Math.max(mFrom, Math.min(to, from + off.toOffset));
    if (mTo > mFrom) out.push(Decoration.mark({ class: cls }).range(mFrom, mTo));
  }
}

function buildInlineBlockDecorations(doc: Text, blocks: readonly EditorInlineBlock[]): DecorationSet {
  if (!blocks.length) return Decoration.none;
  const docLen = doc.length;
  const out: Range<Decoration>[] = [];
  for (const item of blocks) {
    const from = Math.max(0, Math.min(docLen, item.from));
    const to = Math.max(from, Math.min(docLen, item.to));
    if (item.status !== 'error' && to > from) {
      appendBandMarks(doc, from, to, 'mdstudio-cm-ai-del-line', 'mdstudio-cm-ai-del-range', out);
      appendOffsetMarks(from, to, item.delOffsets || [], 'mdstudio-cm-ai-del-word', out);
    }
    const widgetAnchor = doc.lineAt(to).to;
    out.push(Decoration.widget({ widget: new AiInlineBlockWidget(item), block: true, side: 1 }).range(widgetAnchor));
  }
  return Decoration.set(out, true);
}

function appendAcceptTransition(
  doc: Text,
  from: number,
  to: number,
  spec: EditorDiffTransition,
  out: Range<Decoration>[],
): void {
  if (spec.inlinePhrase) {
    appendOffsetMarks(from, to, spec.offsets, 'mdstudio-cm-ai-ink-settle', out);
    out.push(Decoration.widget({ widget: new AiDiffGhostWidget(spec), block: true, side: 1 }).range(doc.lineAt(to).to));
    return;
  }
  out.push(
    Decoration.widget({ widget: new AiDiffGhostWidget(spec), block: true, side: -1 }).range(doc.lineAt(from).from),
  );
  appendOffsetMarks(from, to, spec.offsets, 'mdstudio-cm-ai-ink-settle', out);
}

function buildDiffTransitionDecorations(doc: Text, spec: EditorDiffTransition | null): DecorationSet {
  if (!spec) return Decoration.none;
  const docLen = doc.length;
  const from = Math.max(0, Math.min(docLen, spec.from));
  const to = Math.max(from, Math.min(docLen, spec.to));
  const out: Range<Decoration>[] = [];
  if (spec.kind === 'accept') {
    appendAcceptTransition(doc, from, to, spec, out);
  } else {
    if (to > from) {
      appendBandMarks(doc, from, to, 'mdstudio-cm-ai-reject-line', 'mdstudio-cm-ai-reject-range', out);
      appendOffsetMarks(from, to, spec.offsets, 'mdstudio-cm-ai-reject-word', out);
    }
    out.push(Decoration.widget({ widget: new AiDiffGhostWidget(spec), block: true, side: 1 }).range(doc.lineAt(to).to));
  }
  return Decoration.set(out, true);
}

const inlineBlocksField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(decorations, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setInlineBlocksEffect)) {
        return buildInlineBlockDecorations(tr.state.doc, effect.value);
      }
    }
    return tr.docChanged ? decorations.map(tr.changes) : decorations;
  },
  provide: (field) => EditorView.decorations.from(field),
});

const diffTransitionField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(decorations, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setDiffTransitionEffect)) {
        return buildDiffTransitionDecorations(tr.state.doc, effect.value);
      }
    }
    return tr.docChanged ? Decoration.none : decorations;
  },
  provide: (field) => EditorView.decorations.from(field),
});

const ProgrammaticUpdate = Annotation.define<boolean>();
const ProgrammaticSelection = Annotation.define<boolean>();

export function computeMinimalChange(
  current: string,
  next: string,
): { from: number; to: number; insert: string } | null {
  if (current === next) return null;
  let start = 0;
  const minLen = Math.min(current.length, next.length);
  while (start < minLen && current.charCodeAt(start) === next.charCodeAt(start)) start++;
  let endCurrent = current.length;
  let endNext = next.length;
  while (endCurrent > start && endNext > start && current.charCodeAt(endCurrent - 1) === next.charCodeAt(endNext - 1)) {
    endCurrent--;
    endNext--;
  }
  return { from: start, to: endCurrent, insert: next.slice(start, endNext) };
}

export function create(options: EditorOptions): EditorApi {
  const opts = options;
  const isCss = opts.language === 'css';
  const onUpdate = (update: ViewUpdate): void => {
    const isSilentSync =
      update.transactions.length > 0 && update.transactions.every((tr) => tr.annotation(ProgrammaticUpdate) === true);
    const isProgrammaticSelection =
      update.transactions.length > 0 &&
      update.transactions.every(
        (tr) => tr.annotation(ProgrammaticSelection) === true || tr.annotation(ProgrammaticUpdate) === true,
      );
    if (update.docChanged && !isSilentSync && opts.onChange) {
      const selection = update.state.selection.main;
      opts.onChange(update.state.doc.toString(), { start: selection.from, end: selection.to, head: selection.head });
    }
    if ((update.selectionSet || (update.docChanged && !isSilentSync)) && opts.onSelection) {
      const selection = update.state.selection.main;
      opts.onSelection({
        start: selection.from,
        end: selection.to,
        head: selection.head,
        programmatic: isProgrammaticSelection,
      });
    }
  };

  let dark = !!opts.dark;
  const themeCompartment = new Compartment();
  const highlightCompartment = new Compartment();
  const placeholderCompartment = new Compartment();
  const contentAttrsCompartment = new Compartment();
  const resolveAriaLabel = (label?: string, ph?: string): string =>
    label || ph || (isCss ? 'CSS editor' : 'Markdown editor');

  const extensions: Extension[] = [
    ...(isCss ? [lineNumbers()] : [markdownMonoLines, inlineBlocksField, diffTransitionField]),
    ...(opts.enableHistory ? [history()] : []),
    highlightSpecialChars(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(false),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    rectangularSelection(),
    highlightSelectionMatches(),
    highlightCompartment.of(syntaxHighlighting(dark ? darkHighlightStyle : lightHighlightStyle, { fallback: true })),
    isCss ? css() : markdown(),
    EditorView.lineWrapping,
    contentAttrsCompartment.of(
      EditorView.contentAttributes.of({ 'aria-label': resolveAriaLabel(opts.ariaLabel, opts.placeholder) }),
    ),
    placeholderCompartment.of(opts.placeholder ? placeholder(opts.placeholder) : []),
    themeCompartment.of(editorTheme(dark, isCss)),
    keymap.of([...(opts.enableHistory ? historyKeymap : []), ...closeBracketsKeymap, ...defaultKeymap]),
    EditorView.updateListener.of(onUpdate),
    EditorView.domEventHandlers({
      blur: () => {
        if (opts.onBlur) opts.onBlur();
        return false;
      },
    }),
  ];

  const state = EditorState.create({ doc: opts.doc || '', extensions });
  const view = new EditorView({ state, parent: opts.parent });
  let lastInlineBlockCount = 0;
  view.scrollDOM.tabIndex = 0;
  view.scrollDOM.setAttribute('role', 'region');
  view.scrollDOM.setAttribute('aria-label', resolveAriaLabel(opts.ariaLabel, opts.placeholder));
  const scrollElement = view.scrollDOM;
  const scrollListeners = new Set<(info: EditorScrollInfo) => void>();
  const scrollInfo = (): EditorScrollInfo => ({
    top: scrollElement.scrollTop,
    max: Math.max(0, scrollElement.scrollHeight - scrollElement.clientHeight),
  });
  const handleScroll = (): void => {
    const info = scrollInfo();
    scrollListeners.forEach((listener) => {
      listener(info);
    });
  };
  scrollElement.addEventListener('scroll', handleScroll, { passive: true });

  return {
    getValue() {
      return view.state.doc.toString();
    },
    setValue(value: string, silent = false) {
      const change = computeMinimalChange(view.state.doc.toString(), value);
      if (!change) return;
      view.dispatch({
        changes: change,
        ...(silent ? { annotations: ProgrammaticUpdate.of(true) } : {}),
      });
    },
    getSelection() {
      const range = view.state.selection.main;
      return { start: range.from, end: range.to, head: range.head };
    },
    getScrollInfo() {
      return scrollInfo();
    },
    scrollToRatio(ratio: number) {
      const info = scrollInfo();
      scrollElement.scrollTop = Math.max(0, Math.min(1, ratio)) * info.max;
    },
    onScroll(listener: (info: EditorScrollInfo) => void) {
      scrollListeners.add(listener);
      return () => {
        scrollListeners.delete(listener);
      };
    },
    revealRange(start: number, end: number) {
      const length = view.state.doc.length;
      const from = Math.max(0, Math.min(length, start));
      const to = Math.max(from, Math.min(length, end));
      view.dispatch({
        selection: { anchor: from, head: to },
        scrollIntoView: true,
        annotations: ProgrammaticSelection.of(true),
      });
    },
    focusRange(start: number, end: number) {
      const length = view.state.doc.length;
      const from = Math.max(0, Math.min(length, start));
      const to = Math.max(from, Math.min(length, end));
      view.dispatch({
        selection: { anchor: from, head: to },
        scrollIntoView: true,
        annotations: ProgrammaticSelection.of(true),
      });
      view.focus();
    },
    focus() {
      view.focus();
    },
    coordsAtPos(pos: number) {
      const clamped = Math.max(0, Math.min(view.state.doc.length, pos));
      const rect = view.coordsAtPos(clamped);
      return rect ? { top: rect.top, bottom: rect.bottom, left: rect.left } : null;
    },
    setInlineBlocks(blocks: readonly EditorInlineBlock[]) {
      if (isCss) return;
      if (lastInlineBlockCount === 0 && blocks.length === 0) return;
      const enteringSession = lastInlineBlockCount === 0 && blocks.length > 0;
      lastInlineBlockCount = blocks.length;
      const sel = view.state.selection.main;
      const anchorPos = blocks.length > 0 ? Math.max(0, Math.min(view.state.doc.length, blocks[0].to)) : sel.to;
      const collapse = enteringSession && sel.from !== sel.to ? { selection: { anchor: anchorPos } } : {};
      view.dispatch({
        ...collapse,
        effects: setInlineBlocksEffect.of(blocks),
        annotations: ProgrammaticSelection.of(true),
      });
    },
    setPlaceholder(nextPlaceholder: string, nextAriaLabel?: string) {
      const label = resolveAriaLabel(nextAriaLabel, nextPlaceholder);
      view.scrollDOM.setAttribute('aria-label', label);
      view.dispatch({
        effects: [
          placeholderCompartment.reconfigure(nextPlaceholder ? placeholder(nextPlaceholder) : []),
          contentAttrsCompartment.reconfigure(EditorView.contentAttributes.of({ 'aria-label': label })),
        ],
      });
    },
    setDiffTransition(transition: EditorDiffTransition | null) {
      if (isCss) return;
      const moveCaret =
        transition && transition.kind === 'accept'
          ? { selection: { anchor: Math.max(0, Math.min(view.state.doc.length, transition.to)) } }
          : {};
      view.dispatch({
        ...moveCaret,
        effects: setDiffTransitionEffect.of(transition),
        annotations: ProgrammaticSelection.of(true),
      });
    },
    setDark(value: boolean) {
      dark = !!value;
      view.dispatch({
        effects: [
          themeCompartment.reconfigure(editorTheme(dark, isCss)),
          highlightCompartment.reconfigure(
            syntaxHighlighting(dark ? darkHighlightStyle : lightHighlightStyle, { fallback: true }),
          ),
        ],
      });
    },
    destroy() {
      scrollElement.removeEventListener('scroll', handleScroll);
      scrollListeners.clear();
      view.destroy();
    },
  };
}

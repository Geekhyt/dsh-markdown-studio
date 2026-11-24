import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { createFormattingCommands } from '../src/application/editor-formatting';
import { createEditorSearch, type SearchState } from '../src/application/editor-search';
import { createEditorShortcuts, type EditorShortcutsOptions } from '../src/application/editor-shortcuts';
import { type DocumentHistoryApi, useDocumentHistory } from '../src/application/use-document-history';
import { DEFAULT_SETTINGS } from '../src/themes';

const called: string[] = [];
const options = new Proxy(
  {},
  {
    get: (_target, key) => {
      if (key === 't') return (text: string) => text;
      if (key === 'selection') return () => ({ start: 0, end: 0 });
      if (key === 'editorValue') return () => '';
      if (key === 'persistNow') return () => true;
      return () => {
        called.push(String(key));
      };
    },
  },
) as EditorShortcutsOptions;
const handler = createEditorShortcuts(options);
function press(key: string, expected: string, extras = {}) {
  called.length = 0;
  const event = {
    key,
    ctrlKey: true,
    nativeEvent: {},
    preventDefault() {},
    ...extras,
  } as unknown as React.KeyboardEvent<HTMLElement>;
  handler(event);
  assert.ok(called.includes(expected), `${key} triggers ${expected}`);
}
for (const [key, action] of [
  ['u', 'wrapSelection'],
  ['f', 'openSearch'],
  ['i', 'wrapSelection'],
  ['k', 'wrapSelection'],
  ['e', 'wrapSelection'],
  ['z', 'undo'],
  ['y', 'redo'],
  ['Enter', 'copyArticle'],
])
  press(key, action);
press('Tab', 'replaceRange', { ctrlKey: false });
// Verify modifier guards: Ctrl+Tab / Alt+Tab / Shift+Cmd+I / Shift+Cmd+Enter do not misfire
for (const extras of [{}, { altKey: true, ctrlKey: false }, { metaKey: true, ctrlKey: false }]) {
  called.length = 0;
  handler({
    key: 'Tab',
    ctrlKey: true,
    nativeEvent: {},
    preventDefault() {},
    ...extras,
  } as unknown as React.KeyboardEvent<HTMLElement>);
  assert.equal(called.length, 0, `modified Tab (${JSON.stringify(extras)}) does not insert spaces`);
}
for (const [key, extras] of [
  ['i', { shiftKey: true }],
  ['Enter', { shiftKey: true }],
] as const) {
  called.length = 0;
  handler({
    key,
    ctrlKey: true,
    nativeEvent: {},
    preventDefault() {},
    ...extras,
  } as unknown as React.KeyboardEvent<HTMLElement>);
  assert.equal(called.length, 0, `Shift+Ctrl+${key} does not hijack DevTools or copy`);
}
for (const key of ['b', 'e', 'x', 'h']) press(key, 'wrapSelection', { shiftKey: true });
press('z', 'redo', { shiftKey: true });
for (let i = 1; i <= 6; i++) press(String(i), 'applyHeadingLevel', { code: 'Digit' + i });
for (const i of [0, 7, 8, 9]) press(String(i), 'setLinePrefix', { code: 'Digit' + i, shiftKey: true });
for (const [key, action, code] of [
  ['4', 'setLinePrefix', 'Digit4'],
  ['c', 'insertCodeBlock', 'KeyC'],
  ['t', 'insertTable', 'KeyT'],
  ['p', 'openImagePicker', 'KeyP'],
  ['-', 'insertHr', 'Minus'],
  ['v', 'insertScrollBox', 'KeyV'],
  ['x', 'insertScrollXBox', 'KeyX'],
  ['l', 'toggleLinkFootnotes', 'KeyL'],
])
  press(key, action, { altKey: true, code });
// Verify macOS Option dead-key characters still trigger via physical event.code
for (const [deadKey, action, code] of [
  ['¢', 'setLinePrefix', 'Digit4'],
  ['ç', 'insertCodeBlock', 'KeyC'],
  ['†', 'insertTable', 'KeyT'],
  ['π', 'openImagePicker', 'KeyP'],
  ['–', 'insertHr', 'Minus'],
  ['√', 'insertScrollBox', 'KeyV'],
  ['≈', 'insertScrollXBox', 'KeyX'],
  ['¬', 'toggleLinkFootnotes', 'KeyL'],
])
  press(deadKey, action, { altKey: true, code });
press('´', 'insertMathBlock', { altKey: true, shiftKey: true, code: 'KeyE' });
press('e', 'insertMathBlock', { altKey: true, shiftKey: true, code: 'KeyE' });
// WCAG 2.1.2 Escape -> Tab releases focus without preventing default or mutating text
{
  called.length = 0;
  let prevented = false;
  const scope = {};
  handler({
    key: 'Escape',
    currentTarget: scope,
    nativeEvent: {},
    preventDefault() {
      prevented = true;
    },
  } as unknown as React.KeyboardEvent<HTMLElement>);
  // Shift keydown before Shift+Tab must not disarm Escape -> Tab escape hatch
  handler({
    key: 'Shift',
    shiftKey: true,
    currentTarget: scope,
    nativeEvent: {},
    preventDefault() {
      prevented = true;
    },
  } as unknown as React.KeyboardEvent<HTMLElement>);
  called.length = 0;
  handler({
    key: 'Tab',
    shiftKey: true,
    currentTarget: scope,
    nativeEvent: {},
    preventDefault() {
      prevented = true;
    },
  } as unknown as React.KeyboardEvent<HTMLElement>);
  assert.equal(prevented, false, 'Escape followed by Shift+Tab releases keyboard focus');
  assert.equal(called.length, 0, 'Escape followed by Shift+Tab does not mutate the document');
}
// Tab inside embedded AI inline review card does not mutate document or auto-accept
{
  called.length = 0;
  let prevented = false;
  const fakeButton = {
    tagName: 'BUTTON',
    closest(sel: string) {
      return sel.includes('mdstudio-ai-inline-card') || sel.includes('button') ? fakeButton : null;
    },
  };
  handler({
    key: 'Tab',
    target: fakeButton,
    nativeEvent: {},
    preventDefault() {
      prevented = true;
    },
  } as unknown as React.KeyboardEvent<HTMLElement>);
  assert.equal(prevented, false, 'Tab inside AI inline card button is not intercepted');
  assert.equal(called.length, 0, 'Tab inside AI inline card does not mutate editor');
}

// Multi-line Tab block indent & Shift+Tab block outdent + disarmEscapeTab
{
  const { disarmEscapeTab } = await import('../src/application/editor-shortcuts');
  let value = '- alpha\n- beta\n- gamma';
  let sel = { start: 0, end: value.length };
  const handler = createEditorShortcuts(
    new Proxy(
      {},
      {
        get: (_target, key) => {
          if (key === 'editorValue') return () => value;
          if (key === 'selection') return () => sel;
          if (key === 'replaceRange') {
            return (_cur: string, start: number, end: number, text: string, nextStart?: number, nextEnd?: number) => {
              value = value.slice(0, start) + text + value.slice(end);
              sel = { start: nextStart ?? start, end: nextEnd ?? start };
            };
          }
          return () => {};
        },
      },
    ) as EditorShortcutsOptions,
  );
  const scope = {};
  handler({
    key: 'Tab',
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    currentTarget: scope,
    target: scope,
    preventDefault() {},
  } as unknown as React.KeyboardEvent<HTMLElement>);
  assert.equal(
    value,
    '  - alpha\n  - beta\n  - gamma',
    'multi-line Tab indents every selected line instead of deleting',
  );
  assert.equal(sel.start, 2);
  assert.equal(sel.end, value.length);

  handler({
    key: 'Tab',
    shiftKey: true,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    currentTarget: scope,
    target: scope,
    preventDefault() {},
  } as unknown as React.KeyboardEvent<HTMLElement>);
  assert.equal(value, '- alpha\n- beta\n- gamma', 'multi-line Shift+Tab outdents every selected line cleanly');

  // Escape arms focus escape, disarmEscapeTab clears it on blur/click
  handler({
    key: 'Escape',
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    currentTarget: scope,
    target: scope,
    preventDefault() {},
  } as unknown as React.KeyboardEvent<HTMLElement>);
  disarmEscapeTab();
  let tabPreventedAfterDisarm = false;
  sel = { start: 0, end: 0 };
  handler({
    key: 'Tab',
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    currentTarget: scope,
    target: scope,
    preventDefault() {
      tabPreventedAfterDisarm = true;
    },
  } as unknown as React.KeyboardEvent<HTMLElement>);
  assert.equal(tabPreventedAfterDisarm, true, 'disarmEscapeTab restores normal Tab indent after blur/click');
}

// G7 regressions: code fence/alert inner caret, insertHr collapseToEnd, multi-line setLinePrefix,
// Unicode İ search/replace, outdentBlock clamped selection, and IME composing + CRLF history buffering.
{
  let doc = 'hello';
  let sel = { start: 5, end: 5 };
  const fmt = createFormattingCommands({
    t: (k) => k,
    notify: () => {},
    editorValue: () => doc,
    selection: () => sel,
    replaceRange: (value, start, end, text, selectStart, selectEnd) => {
      doc = value.slice(0, start) + text + value.slice(end);
      const nextStart = selectStart == null ? start + text.length : selectStart;
      const nextEnd = selectEnd == null ? nextStart : selectEnd;
      sel = { start: nextStart, end: nextEnd };
    },
    setMarkdown: (value) => {
      doc = value;
    },
    focusRange: (start, end) => {
      sel = { start, end };
    },
    clearSlash: () => {},
    imageRef: { current: null },
    settings: { ...DEFAULT_SETTINGS },
    updateSettings: () => {},
  });
  fmt.insertCodeBlock();
  assert.equal(sel.start, sel.end, 'insertCodeBlock places collapsed caret inside fence when nothing is selected');
  assert.equal(doc.slice(0, sel.start).endsWith('```\n'), true, 'caret lands on inner code line');
  assert.equal(doc.slice(sel.end).startsWith('\n```'), true, 'closing fence follows inner caret');

  doc = 'first line';
  sel = { start: 10, end: 10 };
  fmt.insertHr();
  assert.equal(sel.start, sel.end, 'insertHr collapses selection after divider');

  doc = '  a\nb\n  c';
  sel = { start: 0, end: doc.length };
  fmt.setLinePrefix('- ');
  assert.equal(doc, '  - a\n- b\n  - c', 'setLinePrefix formats all selected lines while preserving indentation');

  doc = 'first\n\nsecond';
  sel = { start: 0, end: doc.length };
  fmt.setLinePrefix('1. ');
  assert.equal(doc, '1. first\n\n2. second', 'ordered list numbering stays consecutive across blank lines');

  // G5 regressions: symmetric wrapSelection toggle, setLinePrefix toggle, and AltGraph bypass
  doc = 'hello';
  sel = { start: 0, end: 5 };
  fmt.wrapSelection('*', '*', 'italic');
  assert.equal(doc, '*hello*');
  fmt.wrapSelection('*', '*', 'italic');
  assert.equal(doc, 'hello', 'second Italic press toggles off cleanly instead of producing **hello**');
  fmt.wrapSelection('**', '**', 'bold');
  assert.equal(doc, '**hello**');
  fmt.wrapSelection('**', '**', 'bold');
  assert.equal(doc, 'hello', 'second Bold press toggles off cleanly');
  doc = 'quote line';
  sel = { start: 0, end: doc.length };
  fmt.setLinePrefix('> ');
  assert.equal(doc, '> quote line');
  fmt.setLinePrefix('> ');
  assert.equal(doc, 'quote line', 'second Quote press toggles off cleanly');

  called.length = 0;
  handler({
    key: 'c',
    code: 'KeyC',
    ctrlKey: true,
    altKey: true,
    getModifierState: (mod: string) => mod === 'AltGraph',
    nativeEvent: {},
    preventDefault() {},
  } as unknown as React.KeyboardEvent<HTMLElement>);
  assert.equal(called.length, 0, 'AltGraph character composition is never hijacked as Ctrl+Alt shortcut');

  // Unicode case-folding search/replace (Turkish İ -> i\u0307 expands length under toLowerCase)
  let searchDoc = 'İstanbul foo bar';
  let searchSel = { start: 0, end: 0 };
  let searchPanel: SearchState = { open: true, query: 'foo', replacement: 'BAZ' };
  const makeSearch = () =>
    createEditorSearch({
      editorValue: () => searchDoc,
      selection: () => searchSel,
      setMarkdown: (next) => {
        searchDoc = next;
      },
      focusRange: (start, end) => {
        searchSel = { start, end };
      },
      notify: () => {},
      t: (k) => k,
      searchPanel,
      setSearchPanel: (updater) => {
        searchPanel = typeof updater === 'function' ? updater(searchPanel) : updater;
      },
      searchInputRef: { current: null },
      setOutlineOpen: () => {},
    });
  makeSearch().findNext();
  assert.equal(searchDoc.slice(searchSel.start, searchSel.end), 'foo', 'findNext aligns offset after Turkish İ');
  makeSearch().replaceOne();
  assert.equal(searchDoc, 'İstanbul BAZ bar', 'replaceOne replaces exact matched slice after Turkish İ');
  searchDoc = 'İstanbul foo and FOO';
  searchSel = { start: 0, end: 0 };
  makeSearch().replaceAll();
  assert.equal(searchDoc, 'İstanbul BAZ and BAZ', 'replaceAll matches Unicode case-insensitively without drift');

  // IME composing + CRLF normalization in useDocumentHistory
  const dom = new JSDOM('<div id="h"></div>', { url: 'http://localhost' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  let hist!: DocumentHistoryApi;
  let applied = 'init';
  function HistProbe() {
    hist = useDocumentHistory({
      React,
      initialMarkdown: 'line1\r\nline2',
      onApply: (next) => {
        applied = next;
      },
      getSelection: () => ({ start: applied.length, end: applied.length }),
      focusRange: () => {},
    });
    return null;
  }
  const r = createRoot(dom.window.document.getElementById('h')!);
  await React.act(async () => {
    r.render(React.createElement(HistProbe));
  });
  assert.equal(hist.markdownRef.current, 'line1\nline2', 'initial CRLF normalized to LF');
  await React.act(async () => {
    hist.setMarkdown('line1\nline2n', { composing: true });
    hist.setMarkdown('line1\nline2ni', { composing: true });
    hist.setMarkdown('line1\nline2', { composing: false }); // cancelled IME
  });
  assert.equal(hist.undo(), false, 'cancelled IME preedit creates zero phantom undo snapshots');
  await React.act(async () => {
    hist.setMarkdown('line1\nline2n', { composing: true });
    hist.setMarkdown('line1\nline2你', { composing: false }); // committed IME
  });
  assert.equal(applied, 'line1\nline2你');
  assert.equal(hist.undo(), true, 'committed IME collapses into single undo snapshot');
  assert.equal(applied, 'line1\nline2');
  // Immediate undo right after composing frame without trailing composing:false still undoes cleanly
  await React.act(async () => {
    hist.setMarkdown('line1\nline2好', { composing: true });
  });
  assert.equal(hist.undo(), true, 'immediate undo flushes pending IME composition base snapshot');
  assert.equal(applied, 'line1\nline2');
  await React.act(async () => {
    r.unmount();
  });
  dom.window.close();
}

// Post-review formatting regressions: multi-paragraph bold toggle, ***bold+italic*** italic toggle, task->bullet convert
{
  const { createFormattingCommands } = await import('../src/application/editor-formatting');
  const { DEFAULT_SETTINGS } = await import('../src/themes');
  let val = 'Para 1\n\nPara 2';
  let sel = { start: 0, end: val.length };
  const fmt = createFormattingCommands({
    editorValue: () => val,
    selection: () => sel,
    replaceRange: (_cur, start, end, text, nextStart, nextEnd) => {
      val = val.slice(0, start) + text + val.slice(end);
      sel = { start: nextStart ?? start, end: nextEnd ?? start + text.length };
    },
    setMarkdown: (next) => {
      val = next;
    },
    focusRange: (s, e) => {
      sel = { start: s, end: e };
    },
    clearSlash: () => {},
    imageRef: { current: null },
    t: (k) => k,
    notify: () => {},
    settings: { ...DEFAULT_SETTINGS },
    updateSettings: () => {},
  });
  fmt.wrapSelection('**', '**');
  assert.equal(val, '**Para 1**\n\n**Para 2**');
  fmt.wrapSelection('**', '**');
  assert.equal(val, 'Para 1\n\nPara 2', 'multi-paragraph bold toggles off cleanly on second press');

  val = '**foo** and **bar**';
  sel = { start: 0, end: val.length };
  fmt.wrapSelection('**', '**');
  assert.equal(val, '****foo** and **bar****', 'multi-span selection does not strip inner matched delimiters');

  val = '**hello**';
  sel = { start: 2, end: 7 };
  fmt.wrapSelection('*', '*');
  assert.equal(val, '***hello***');
  fmt.wrapSelection('*', '*');
  assert.equal(val, '**hello**', 'italic toggles off cleanly inside ***bold+italic***');

  val = '- [ ] todo';
  sel = { start: 0, end: 0 };
  fmt.insertList();
  assert.equal(val, '- todo', 'bullet list converts task item to regular bullet instead of stripping');
}

console.log('ok - Notion-aligned, conflict-free formatting, document, multi-line Tab, and macOS Option shortcuts pass');

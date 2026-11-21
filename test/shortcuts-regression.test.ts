import assert from 'node:assert/strict';
import type * as React from 'react';
import { createEditorShortcuts, type EditorShortcutsOptions } from '../src/application/editor-shortcuts';

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
console.log('ok - Notion-aligned, conflict-free formatting, document, multi-line Tab, and macOS Option shortcuts pass');

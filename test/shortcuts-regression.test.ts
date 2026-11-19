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
  ['Tab', 'replaceRange'],
])
  press(key, action);
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
console.log('ok - Notion-aligned, conflict-free formatting, document, and macOS Option shortcuts pass');

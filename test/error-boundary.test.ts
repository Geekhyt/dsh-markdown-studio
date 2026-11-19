import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
const { window } = dom;
function setGlobal(name: string, value: unknown): void {
  try {
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  } catch (error) {
    (globalThis as Record<string, unknown>)[name] = value;
  }
}
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
setGlobal('window', window);
setGlobal('document', window.document);
setGlobal('navigator', window.navigator);
setGlobal('HTMLElement', window.HTMLElement);

const React: typeof import('react') = (await import('react')).default;
const ReactDOM: typeof import('react-dom/client') = await import('react-dom/client');
const { act } = React;
const { createErrorBoundary } = await import('../src/ui/error-boundary');

const ErrorBoundary = createErrorBoundary(React);
function Throwing(): React.ReactNode {
  throw new Error('test render failure');
}

const container = window.document.createElement('div');
window.document.body.appendChild(container);
const root = ReactDOM.createRoot(container);
const originalError = console.error;
console.error = () => {};
window.console.error = () => {};

await act(async () => {
  root.render(React.createElement(ErrorBoundary, { t: (key: string) => key }, React.createElement(Throwing)));
});
assert.ok(container.querySelector('.mdstudio-error-boundary'), 'boundary renders a fallback');
assert.ok((container.textContent || '').includes('error.title'), 'fallback exposes the title key');

const retry = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
  (button) => button.textContent === 'error.retry',
);
assert.ok(retry, 'fallback has a retry action');
await act(async () => {
  retry.click();
});
assert.ok(container.querySelector('.mdstudio-error-boundary'), 'a failed retry keeps the fallback');

console.error = originalError;
window.console.error = originalError;
await act(async () => {
  root.unmount();
});
container.remove();
console.log('3 error-boundary checks passed.');

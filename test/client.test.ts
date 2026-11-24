import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import type { ComponentType, ReactElement } from 'react';
import { resolveActiveLocaleId } from '../src/locales/ui-strings';
import type { ClientContext, ClientPlugin, LocaleService } from '../src/types/dsh';

const root = path.resolve(import.meta.dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { name: string };
const shellSource = fs.readFileSync(path.join(root, 'dist/client.js'), 'utf8');
const studioSource = fs.readFileSync(path.join(root, 'dist/client.studio.js'), 'utf8');

type ModuleRequire = ((name: string) => unknown) & {
  async: (chunk: string) => Promise<unknown>;
};

interface ModuleDefinition {
  id: string;
  chunk?: string;
  factory(require: ModuleRequire): ClientPlugin;
}

let shellDef: ModuleDefinition | null = null;
const chunkDefs = new Map<string, ModuleDefinition>();
const sandbox = {
  window: {
    __ModuleLoader__: {
      load(value: ModuleDefinition): void {
        if (value.chunk) chunkDefs.set(value.chunk, value);
        else shellDef = value;
      },
    },
    console,
  },
  console,
  setTimeout,
  clearTimeout,
  URL,
  Blob: class Blob {},
};
vm.createContext(sandbox);
vm.runInContext(shellSource, sandbox, { filename: 'client.js' });
vm.runInContext(studioSource, sandbox, { filename: 'client.studio.js' });

const loadedShell = shellDef as ModuleDefinition | null;
const loadedStudio = chunkDefs.get('client.studio.js') || null;
assert.ok(loadedShell, 'dist/client.js registers the main module definition');
assert.equal(loadedShell.id, pkg.name, 'shell module id equals the package name');
assert.equal(typeof loadedShell.factory, 'function');
assert.ok(loadedStudio, 'dist/client.studio.js registers the lazy studio chunk');
assert.equal(loadedStudio.id, pkg.name, 'studio chunk id equals the package name');

const ReactStub = {
  Component: class Component {},
  Fragment: 'fragment',
  useState<T>(init: T): [T, (next: T) => void] {
    return [init, () => {}];
  },
  useEffect(): void {},
  createElement(type: string, props: Record<string, unknown>, ...children: unknown[]): ReactElement {
    return { type, props, children } as unknown as ReactElement;
  },
} as unknown as typeof import('react');

function makeRequire(withPrimitives: boolean): ModuleRequire {
  const req = ((name: string) => {
    if (name === 'react') return ReactStub;
    if (name === '@deepseek-ai/dsh-client-ui-primitives') {
      if (!withPrimitives) throw new Error('optional module absent');
      return {
        Button: function MockButton() {
          return null;
        },
        IconCopy: function MockIconCopy() {
          return null;
        },
      };
    }
    assert.fail(`unexpected require: ${name}`);
  }) as ModuleRequire;
  req.async = async (spec: string) => {
    assert.equal(spec, './client.studio.js');
    return loadedStudio!.factory(makeRequire(withPrimitives));
  };
  return req;
}

const plugin = loadedShell.factory(makeRequire(false));
const pluginWithPrimitives = loadedShell.factory(makeRequire(true));
assert.equal(typeof pluginWithPrimitives.apply, 'function', 'factory accepts shared DSH UI primitives');

assert.equal(Array.from(plugin.inject).join(','), 'slots');
assert.equal(typeof plugin.apply, 'function');

const localeRegistrations: Array<{ ns: string; id: string; dict: Record<string, string> }> = [];
const fakeLocale: LocaleService = {
  getSnapshot() {
    return { revision: 1, locales: [{ id: 'en' }, { id: 'zh' }] };
  },
  getLocale() {
    return { active: 'zh' };
  },
  subscribe() {
    return () => {};
  },
  register(ns, id, dict) {
    localeRegistrations.push({ ns, id, dict });
    return () => {};
  },
  bind() {
    return (key: string) => {
      const zh = localeRegistrations.find((entry) => entry.id === 'zh');
      return zh && zh.dict[key] ? zh.dict[key] : key;
    };
  },
};

const injected: string[] = [];
const registrations: Array<{
  options: { name: string; id?: string; key?: string; order?: number; label?: () => string };
  component: ComponentType;
}> = [];
const effects: Array<() => void> = [];
const fakeCtx: ClientContext = {
  get<T>(name: string): T | undefined {
    return name === 'locale' ? (fakeLocale as T) : undefined;
  },
  effect(fn) {
    const dispose = fn();
    if (typeof dispose === 'function') effects.push(dispose);
  },
  slots: {
    inject(key, callback) {
      injected.push(key);
      callback();
    },
    register(options, component) {
      registrations.push({ options, component });
      return () => {};
    },
  },
};

plugin.apply(fakeCtx);

assert.deepEqual(injected, ['sidebar.panellist', 'main']);
assert.equal(registrations.length, 2);

const sidebar = registrations[0];
assert.equal(sidebar.options.name, 'sidebar.panellist');
assert.equal(sidebar.options.id, 'dsh-markdown-studio');
assert.equal(sidebar.options.order, 40);
assert.equal(typeof sidebar.options.label, 'function');
const sidebarLabel = sidebar.options.label;
assert.ok(sidebarLabel);
assert.equal(sidebarLabel(), 'Markdown Studio');

const icon = (sidebar.component as (props: { size: number; active: boolean }) => ReactElement)({
  size: 20,
  active: true,
});
assert.equal(icon.type, 'svg');
assert.equal((icon.props as { width: number }).width, 20);
assert.equal((icon.props as { viewBox: string }).viewBox, '0 0 16 16');
assert.equal((icon.props as { stroke: string }).stroke, 'currentColor');
assert.equal((icon.props as { strokeWidth: number }).strokeWidth, 1.3);
const idleIcon = (sidebar.component as (props: { size: number; active: boolean }) => ReactElement)({
  size: 16,
  active: false,
});
assert.equal((idleIcon.props as { strokeWidth: number }).strokeWidth, 1);

const main = registrations[1];
assert.equal(main.options.name, 'main');
assert.equal(main.options.key, 'dsh-markdown-studio');
assert.equal(typeof main.component, 'function');

// Also verify the lazy studio chunk registers full zh & en dictionaries when materialized
const studioLocaleRegistrations: Array<{ ns: string; id: string; dict: Record<string, string> }> = [];
const studioPlugin = loadedStudio.factory(makeRequire(false));
studioPlugin.apply({
  get<T>(name: string): T | undefined {
    if (name !== 'locale') return undefined;
    return {
      ...fakeLocale,
      register(ns: string, id: string, dict: Record<string, string>) {
        studioLocaleRegistrations.push({ ns, id, dict });
        return () => {};
      },
    } as T;
  },
  effect(fn) {
    const dispose = fn();
    if (typeof dispose === 'function') effects.push(dispose);
  },
  slots: {
    inject() {},
    register() {
      return () => {};
    },
  },
});
assert.deepEqual(studioLocaleRegistrations.map((entry) => entry.id).sort(), ['en', 'zh', 'zh-CN']);
assert.equal(studioLocaleRegistrations.find((entry) => entry.id === 'zh')?.dict.copy, '复制到公众号');
assert.equal(studioLocaleRegistrations.find((entry) => entry.id === 'en')?.dict.copy, 'Copy for WeChat');

for (const dispose of effects) dispose();

assert.equal(resolveActiveLocaleId(null), 'zh');
assert.equal(resolveActiveLocaleId({ ...fakeLocale, getLocale: () => 'en' as never }), 'en');
assert.equal(resolveActiveLocaleId({ ...fakeLocale, getLocale: () => ({ id: 'en-US' }) as never }), 'en-US');
assert.equal(
  resolveActiveLocaleId({
    ...fakeLocale,
    getLocale: () => {
      throw new Error('offline');
    },
  }),
  'zh',
);

console.log('ok - client shell & lazy studio chunk register sidebar entry, main panel, and locale dictionaries');

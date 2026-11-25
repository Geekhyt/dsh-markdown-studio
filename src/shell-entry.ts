import type * as ReactNamespace from 'react';
import type { ComponentType } from 'react';
import { useExternalStore, useLazyChunkReady } from './runtime/react-lifecycle';
import type { ClientContext, ClientPlugin, LocaleService } from './types/dsh';
import type { DshPrimitivesModule } from './types/dsh-primitives';
import { SidebarPanelIcon } from './ui/brand-mark';
import { mountPluginStyles, unmountPluginStyles } from './ui/style-lifecycle';

const PANEL_ID = 'dsh-markdown-studio';
const SHELL_LOCALE_NS = 'dsh-markdown-studio.shell';
const SHELL_DICT_EN: Record<string, string> = {
  'panel.label': 'Markdown Studio',
  'shell.loading': 'Loading Markdown Studio…',
  'shell.failed': 'Markdown Studio failed to load',
  'shell.retry': 'Retry',
};
const SHELL_DICT_ZH: Record<string, string> = {
  'panel.label': 'Markdown Studio',
  'shell.loading': '正在加载 Markdown Studio…',
  'shell.failed': 'Markdown Studio 加载失败',
  'shell.retry': '重试',
};

export type StudioChunkLoader = () => Promise<ClientPlugin>;

function registerShellLocale(locale: LocaleService): () => void {
  const disposers: Array<() => void> = [];
  const ids = new Set<string>(['en', 'zh', 'zh-CN']);
  try {
    locale.getSnapshot().locales.forEach((entry) => {
      ids.add(entry.id);
    });
  } catch (_err) {
    /* keep base locales */
  }
  ids.forEach((id) => {
    try {
      const dict = /^zh/i.test(id) ? SHELL_DICT_ZH : SHELL_DICT_EN;
      const dispose = locale.register(SHELL_LOCALE_NS, id, dict);
      if (typeof dispose === 'function') disposers.push(dispose);
    } catch (_err) {
      /* ignore duplicate registration */
    }
  });
  return () => {
    disposers.forEach((dispose) => {
      try {
        dispose();
      } catch (_err) {
        /* ignore */
      }
    });
  };
}

function runDisposers(list: Array<() => void>): void {
  while (list.length > 0) {
    const dispose = list.pop();
    if (dispose) {
      try {
        dispose();
      } catch (_err) {
        /* ignore */
      }
    }
  }
}

function bindStudioPluginToContext(
  studio: ClientPlugin,
  ctx: ClientContext,
  disposers: Array<() => void>,
): ComponentType<Record<string, unknown>> | null {
  let capturedMain: ComponentType<Record<string, unknown>> | null = null;
  const localDisposers: Array<() => void> = [];
  const proxyCtx: ClientContext = {
    get: (name) => ctx.get(name),
    effect: (setup) => {
      const cleanup = setup();
      if (typeof cleanup === 'function') localDisposers.push(cleanup);
    },
    slots: {
      inject: (key, callback) => {
        if (key === 'main') callback();
        return () => {};
      },
      register: (options, component) => {
        if (options.name === 'main') capturedMain = component;
        return () => {};
      },
    },
  };
  try {
    studio.apply(proxyCtx);
  } catch (err) {
    runDisposers(localDisposers);
    throw err;
  }
  if (!capturedMain) {
    runDisposers(localDisposers);
    return null;
  }
  disposers.push(...localDisposers);
  return capturedMain;
}

export function create(
  React: typeof ReactNamespace,
  _primitives?: DshPrimitivesModule | null,
  loadStudioChunk?: StudioChunkLoader,
): ClientPlugin {
  const h = React.createElement;
  const loader: StudioChunkLoader = loadStudioChunk || (() => Promise.reject(new Error('studio chunk loader missing')));

  let activeCtx: ClientContext | null = null;
  let activeLocale: LocaleService | null = null;
  let activeDisposers: Array<() => void> = [];
  let cachedMain: ComponentType<Record<string, unknown>> | null = null;
  let cachedPlugin: ClientPlugin | null = null;
  let inflight: Promise<ComponentType<Record<string, unknown>>> | null = null;
  let activeTranslate: ((key: string) => string) | null = null;
  let ctxGen = 0;

  function shellText(key: string): string {
    if (activeTranslate) {
      try {
        const value = activeTranslate(key);
        if (value && value !== key) return value;
      } catch (_err) {
        /* fallback */
      }
    }
    return SHELL_DICT_EN[key] || key;
  }

  function materializeMain(plugin: ClientPlugin, expectedGen: number): ComponentType<Record<string, unknown>> {
    if (!activeCtx || expectedGen !== ctxGen) throw new Error('Markdown Studio context is inactive');
    if (cachedMain) return cachedMain;
    const main = bindStudioPluginToContext(plugin, activeCtx, activeDisposers);
    if (!main) throw new Error('Markdown Studio chunk did not register a main view');
    cachedPlugin = plugin;
    cachedMain = main;
    return cachedMain;
  }

  function ensureStudioMain(): Promise<ComponentType<Record<string, unknown>>> {
    if (cachedMain) return Promise.resolve(cachedMain);
    const gen = ctxGen;
    if (cachedPlugin && activeCtx) {
      const plugin = cachedPlugin;
      return Promise.resolve().then(() => materializeMain(plugin, gen));
    }
    if (!inflight) {
      inflight = Promise.resolve()
        .then(() => loader())
        .then(
          (plugin) => {
            inflight = null;
            return materializeMain(plugin, gen);
          },
          (err) => {
            inflight = null;
            throw err;
          },
        );
    }
    return inflight;
  }

  function PanelIcon(props?: { size?: number; active?: boolean }) {
    return SidebarPanelIcon({
      React,
      size: props && props.size ? props.size : 16,
      active: Boolean(props && props.active),
    });
  }

  function LazyStudioView(props: Record<string, unknown>) {
    useExternalStore(
      React,
      (listener) =>
        activeLocale && typeof activeLocale.subscribe === 'function' ? activeLocale.subscribe(listener) : () => {},
      () => {
        try {
          return activeLocale?.getSnapshot().revision ?? 0;
        } catch (_err) {
          return 0;
        }
      },
    );
    const { error: loadError, retry } = useLazyChunkReady(
      React,
      () => Boolean(cachedMain),
      () => ensureStudioMain(),
    );

    if (cachedMain) return h(cachedMain, props);
    if (loadError !== null) {
      return h(
        'div',
        {
          role: 'alert',
          style: { padding: '32px', color: 'var(--dsw-alias-label-primary, currentColor)', fontSize: '14px' },
        },
        h('p', { style: { margin: '0 0 12px', fontWeight: 600 } }, shellText('shell.failed')),
        h(
          'button',
          {
            type: 'button',
            onClick: retry,
            style: {
              padding: '6px 14px',
              borderRadius: '8px',
              border: '0.5px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.35))',
              background: 'var(--dsw-alias-bg-layer-2, transparent)',
              color: 'var(--dsw-alias-label-primary, currentColor)',
              cursor: 'pointer',
            },
          },
          shellText('shell.retry'),
        ),
      );
    }
    return h(
      'div',
      {
        role: 'status',
        'aria-live': 'polite',
        style: {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          color: 'var(--dsw-alias-label-secondary, currentColor)',
          fontSize: '13px',
        },
      },
      shellText('shell.loading'),
    );
  }

  function apply(ctx: ClientContext): void {
    const gen = ++ctxGen;
    activeCtx = ctx;
    const locale = ctx.get<LocaleService>('locale') || null;
    activeLocale = locale;

    ctx.effect(() => {
      const disposers: Array<() => void> = [];
      const cleanup = (): void => {
        if (ctxGen === gen) {
          activeDisposers = [];
          activeCtx = null;
          activeLocale = null;
          activeTranslate = null;
          cachedMain = null;
        }
        runDisposers(disposers);
        if (ctxGen === gen) unmountPluginStyles();
      };
      try {
        mountPluginStyles();
        activeDisposers = disposers;
        if (locale) {
          disposers.push(registerShellLocale(locale));
          try {
            activeTranslate = locale.bind(SHELL_LOCALE_NS);
          } catch (_err) {
            activeTranslate = null;
          }
        }
        if (cachedPlugin) {
          const rebound = bindStudioPluginToContext(cachedPlugin, ctx, disposers);
          if (rebound) cachedMain = rebound;
        }
      } catch (err) {
        cleanup();
        throw err;
      }
      return cleanup;
    });

    ctx.slots.inject('sidebar.panellist', () =>
      ctx.slots.register(
        {
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: 40,
          label: () => shellText('panel.label'),
        },
        PanelIcon,
      ),
    );

    ctx.slots.inject('main', () =>
      ctx.slots.register(
        {
          name: 'main',
          key: PANEL_ID,
        },
        LazyStudioView,
      ),
    );
  }

  return { inject: ['slots'], apply };
}

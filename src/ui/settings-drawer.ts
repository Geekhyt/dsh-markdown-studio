import type * as ReactNamespace from 'react';
import type { ReactNode } from 'react';
import { CODE_THEMES } from '../code-themes';
import { MAX_CUSTOM_THEMES } from '../domain/custom-themes';
import { useMountDisposable } from '../runtime/react-lifecycle';
import type { CustomTheme, ThemeSettings } from '../themes';
import * as themes from '../themes';
import type { IconName } from './icons';
import { buildSlashHelpRows } from './shortcut-model';
import { ACCENT_PRESETS, renderCustomThemeSwatch, renderThemeSwatch } from './theme-swatches';
import type { UiKit } from './ui-kit';

const FONT_SIZE_PRESETS = [14, 15, 16, 17, 18, 19, 20] as const;
const LINE_HEIGHT_PRESETS = [1.6, 1.75, 1.85, 2.0] as const;

function clampLineHeight(value: number): number {
  return Math.round(Math.min(2.4, Math.max(1.4, value)) * 100) / 100;
}

function formatLineHeightPreset(preset: number): string {
  return preset === 1.6 || preset === 2 ? preset.toFixed(1) : preset.toFixed(2);
}

export interface SettingsThemeActions {
  onSettings: (patch: Partial<ThemeSettings>) => void;
  onPickTheme: (id: string) => void;
  onCreateCustomTheme: () => void;
  onEditCustomTheme: (theme: CustomTheme) => void;
  onResetStyles: () => void;
  onExportTheme: () => void;
  onImportTheme: (file: File | null | undefined) => void;
}

export interface SettingsDrawerProps {
  React: typeof ReactNamespace;
  t: (key: string) => string;
  ui: UiKit;
  open: boolean;
  initialTab: 'theme' | 'help';
  settings: ThemeSettings;
  shortcuts: Array<[string, string]>;
  onClose: () => void;
  themeActions: SettingsThemeActions;
}

function renderTypographyControls(props: SettingsDrawerProps): ReactNode {
  const h = props.React.createElement;
  const t = props.t;
  const settings = props.settings;
  return h(
    'section',
    { className: 'mdstudio-section mdstudio-tab-theme' },
    h('div', { className: 'mdstudio-section-title' }, t('drawer.typography')),
    h(
      'div',
      { className: 'mdstudio-row' },
      h('span', { className: 'mdstudio-row-label' }, t('drawer.accent')),
      h(
        'span',
        { className: 'mdstudio-accent-row' },
        h('input', {
          className: 'mdstudio-color',
          type: 'color',
          value: settings.accent,
          'aria-label': t('drawer.accent'),
          onChange: function (event) {
            props.themeActions.onSettings({ accent: event.target.value });
          },
        }),
        h('span', { className: 'mdstudio-hex' }, settings.accent),
      ),
    ),
    h(
      'div',
      { className: 'mdstudio-presets' },
      ACCENT_PRESETS.map(function (color) {
        const active = settings.accent.toLowerCase() === color.toLowerCase();
        return h('button', {
          type: 'button',
          key: color,
          className: 'mdstudio-preset' + (active ? ' is-active' : ''),
          style: { backgroundColor: color },
          title: color,
          'aria-label': color,
          onClick: function () {
            props.themeActions.onSettings({ accent: color });
          },
        });
      }),
    ),
    h(
      'div',
      { className: 'mdstudio-control-group' },
      h(
        'div',
        { className: 'mdstudio-row' },
        h('span', { className: 'mdstudio-row-label' }, t('drawer.fontSize')),
        h('span', { className: 'mdstudio-value' }, settings.fontSize + ' px'),
      ),
      h(
        'div',
        { className: 'mdstudio-capsule-track', role: 'group', 'aria-label': t('drawer.fontSize') },
        FONT_SIZE_PRESETS.map(function (size) {
          const active = settings.fontSize === size;
          return h(
            'button',
            {
              type: 'button',
              key: size,
              className: 'mdstudio-capsule-seg' + (active ? ' is-active' : ''),
              'aria-pressed': active,
              'aria-label': size + ' px',
              onClick: function () {
                props.themeActions.onSettings({ fontSize: size });
              },
            },
            String(size),
          );
        }),
      ),
    ),
    h(
      'div',
      { className: 'mdstudio-control-group' },
      h(
        'div',
        { className: 'mdstudio-row' },
        h('span', { className: 'mdstudio-row-label' }, t('drawer.lineHeight')),
        h('span', { className: 'mdstudio-value' }, settings.lineHeight.toFixed(2)),
      ),
      h(
        'div',
        { className: 'mdstudio-capsule-track is-stepper', role: 'group', 'aria-label': t('drawer.lineHeight') },
        h(
          'button',
          {
            type: 'button',
            className: 'mdstudio-capsule-step',
            disabled: settings.lineHeight <= 1.401,
            'aria-label': t('drawer.lineHeight') + ' -',
            onClick: function () {
              props.themeActions.onSettings({ lineHeight: clampLineHeight(settings.lineHeight - 0.05) });
            },
          },
          '−',
        ),
        LINE_HEIGHT_PRESETS.map(function (preset) {
          const active = Math.abs(settings.lineHeight - preset) < 0.005;
          const label = formatLineHeightPreset(preset);
          return h(
            'button',
            {
              type: 'button',
              key: preset,
              className: 'mdstudio-capsule-seg' + (active ? ' is-active' : ''),
              'aria-pressed': active,
              'aria-label': t('drawer.lineHeight') + ' ' + label,
              onClick: function () {
                props.themeActions.onSettings({ lineHeight: preset });
              },
            },
            label,
          );
        }),
        h(
          'button',
          {
            type: 'button',
            className: 'mdstudio-capsule-step',
            disabled: settings.lineHeight >= 2.399,
            'aria-label': t('drawer.lineHeight') + ' +',
            onClick: function () {
              props.themeActions.onSettings({ lineHeight: clampLineHeight(settings.lineHeight + 0.05) });
            },
          },
          '+',
        ),
      ),
    ),
  );
}

function renderThemePresetsSection(props: SettingsDrawerProps): ReactNode {
  const h = props.React.createElement;
  const t = props.t;
  const settings = props.settings;
  const customList = settings.customThemes || [];
  return h(
    'section',
    { className: 'mdstudio-section mdstudio-tab-theme' },
    h(
      'div',
      { className: 'mdstudio-section-head' },
      h('div', { className: 'mdstudio-section-title' }, t('drawer.theme')),
      h(
        props.ui.Button,
        {
          variant: 'outline',
          size: 'sm',
          icon: h(props.ui.Icon, { name: 'filePlus', size: 12 }),
          className: 'mdstudio-section-action',
          disabled: customList.length >= MAX_CUSTOM_THEMES,
          onClick: props.themeActions.onCreateCustomTheme,
        },
        t('drawer.newCustomTheme'),
      ),
    ),
    h(
      'div',
      { className: 'mdstudio-theme-grid' },
      themes.THEMES.map(function (theme) {
        const active = theme.id === settings.theme;
        return h(
          'button',
          {
            type: 'button',
            key: theme.id,
            className: 'mdstudio-theme-card' + (active ? ' is-active' : ''),
            title: t('theme.' + theme.id + '.desc'),
            'aria-pressed': active,
            onClick: function () {
              props.themeActions.onPickTheme(theme.id);
            },
          },
          renderThemeSwatch(props.React, theme.id, theme.defaultAccent),
          h('span', { className: 'mdstudio-theme-name' }, t('theme.' + theme.id + '.name')),
        );
      }),
      customList.map(function (custom) {
        const active = custom.id === settings.theme;
        const editLabel = t('drawer.editCustomTheme') + ' ' + custom.name;
        return h(
          'div',
          { className: 'mdstudio-theme-card-wrap', key: custom.id },
          h(
            'button',
            {
              type: 'button',
              className: 'mdstudio-theme-card' + (active ? ' is-active' : ''),
              title: custom.name,
              'aria-pressed': active,
              onClick: function () {
                props.themeActions.onPickTheme(custom.id);
              },
            },
            renderCustomThemeSwatch(props.React, custom.css, settings.accent),
            h('span', { className: 'mdstudio-theme-name' }, custom.name),
          ),
          h(props.ui.Tooltip, {
            label: t('drawer.editCustomTheme'),
            side: 'top',
            children: h(
              'button',
              {
                type: 'button',
                className: 'mdstudio-theme-card-edit',
                'aria-label': editLabel,
                onClick: function () {
                  props.themeActions.onEditCustomTheme(custom);
                },
              },
              h(props.ui.Icon, { name: 'pencil', size: 11 }),
            ),
          }),
        );
      }),
    ),
  );
}

export function SettingsDrawer(props: SettingsDrawerProps): ReactNode {
  if (!props.open) return null;
  return props.React.createElement(SettingsDrawerContent, props);
}

function SettingsDrawerContent(props: SettingsDrawerProps): ReactNode {
  const h = props.React.createElement;
  const t = props.t;
  const settings = props.settings;
  const themeFileRef = props.React.useRef<HTMLInputElement | null>(null);
  const bodyRef = props.React.useRef<HTMLDivElement | null>(null);
  const [tab, setTab] = props.React.useState<'theme' | 'help'>(props.initialTab);

  useMountDisposable(props.React, function () {
    const previous = document.activeElement as HTMLElement | null;
    const focusTimer = window.setTimeout(function () {
      document.getElementById('mdstudio-tab-' + props.initialTab)?.focus();
    }, 0);
    return function () {
      window.clearTimeout(focusTimer);
      if (previous && document.contains(previous)) previous.focus();
    };
  });

  function selectTab(id: 'theme' | 'help', focus: boolean): void {
    setTab(id);
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
    if (focus)
      window.setTimeout(function () {
        document.getElementById('mdstudio-tab-' + id)?.focus();
      }, 0);
  }

  function onTabKeyDown(event: ReactNamespace.KeyboardEvent<HTMLDivElement>): void {
    const order: Array<'theme' | 'help'> = ['theme', 'help'];
    const current = order.indexOf(tab);
    let next = current;
    if (event.key === 'ArrowRight') next = (current + 1) % order.length;
    else if (event.key === 'ArrowLeft') next = (current - 1 + order.length) % order.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = order.length - 1;
    else return;
    event.preventDefault();
    selectTab(order[next], true);
  }

  const tabs: Array<{ id: 'theme' | 'help'; label: string; icon: IconName }> = [
    { id: 'theme', label: t('drawer.tabTheme'), icon: 'palette' },
    { id: 'help', label: t('drawer.tabHelp'), icon: 'help' },
  ];

  return h(
    'aside',
    { className: 'mdstudio-drawer', 'aria-label': t('drawer.title'), 'data-mdstudio-tab': tab },
    h(
      'div',
      { className: 'mdstudio-drawer-head' },
      h('strong', { className: 'mdstudio-drawer-title' }, t('drawer.title')),
      h(props.ui.Tooltip, {
        label: t('close'),
        side: 'bottom',
        children: h(
          'button',
          {
            type: 'button',
            className: 'mdstudio-icon-btn',
            'aria-label': t('close'),
            onClick: props.onClose,
          },
          h(props.ui.Icon, { name: 'close' }),
        ),
      }),
    ),
    h(
      'div',
      {
        className: 'mdstudio-drawer-tabs',
        role: 'tablist',
        'aria-label': t('drawer.title'),
        'aria-orientation': 'horizontal',
        onKeyDown: onTabKeyDown,
      },
      tabs.map(function (item) {
        return h(
          'button',
          {
            type: 'button',
            key: item.id,
            role: 'tab',
            id: 'mdstudio-tab-' + item.id,
            'aria-selected': tab === item.id,
            'aria-controls': 'mdstudio-drawer-panel',
            tabIndex: tab === item.id ? 0 : -1,
            className: 'mdstudio-drawer-tab' + (tab === item.id ? ' is-active' : ''),
            onClick: function () {
              selectTab(item.id, false);
            },
          },
          h(props.ui.Icon, { name: item.icon, size: 14 }),
          item.label,
        );
      }),
    ),
    h(
      'div',
      {
        className: 'mdstudio-drawer-body',
        id: 'mdstudio-drawer-panel',
        role: 'tabpanel',
        'aria-labelledby': 'mdstudio-tab-' + tab,
        tabIndex: 0,
        ref: bodyRef,
      },
      renderThemePresetsSection(props),
      renderTypographyControls(props),
      h(
        'section',
        { className: 'mdstudio-section mdstudio-tab-theme' },
        h('div', { className: 'mdstudio-section-title' }, t('drawer.code')),
        h(
          'div',
          { className: 'mdstudio-code-grid' },
          (function () {
            const followPreview = themes.themeCodePreview(settings);
            return CODE_THEMES.map(function (codeTheme) {
              const active = codeTheme.id === settings.codeTheme;
              const swatch = codeTheme.id === 'theme' ? followPreview : codeTheme.preview;
              return h(
                'button',
                {
                  type: 'button',
                  key: codeTheme.id,
                  className: 'mdstudio-code-card' + (active ? ' is-active' : ''),
                  title: t('code.' + codeTheme.id + '.name'),
                  'aria-pressed': active,
                  onClick: function () {
                    props.themeActions.onSettings({ codeTheme: codeTheme.id });
                  },
                },
                h(
                  'span',
                  {
                    className: 'mdstudio-code-swatch',
                    'aria-hidden': true,
                    style: { backgroundColor: swatch.bg },
                  },
                  h('span', {
                    className: 'mdstudio-code-swatch-dot',
                    style: { backgroundColor: swatch.accent },
                  }),
                  h('span', {
                    className: 'mdstudio-code-swatch-line',
                    style: { backgroundColor: swatch.fg, width: '42%' },
                  }),
                  h('span', {
                    className: 'mdstudio-code-swatch-line',
                    style: { backgroundColor: swatch.fg, opacity: 0.55, width: '68%' },
                  }),
                ),
                h('span', { className: 'mdstudio-code-name' }, t('code.' + codeTheme.id + '.name')),
              );
            });
          })(),
        ),
      ),
      h(
        'section',
        { className: 'mdstudio-section mdstudio-tab-theme' },
        h('div', { className: 'mdstudio-section-title' }, t('drawer.copy')),
        h(props.ui.ToggleRow, {
          label: t('drawer.linkFootnotes'),
          checked: settings.linkFootnotes,
          onChange: function (value) {
            props.themeActions.onSettings({ linkFootnotes: value });
          },
        }),
        h(props.ui.ToggleRow, {
          label: t('drawer.imagePlaceholders'),
          checked: settings.imagePlaceholders,
          onChange: function (value) {
            props.themeActions.onSettings({ imagePlaceholders: value });
          },
        }),
        h(props.ui.ToggleRow, {
          label: t('drawer.codeNbsp'),
          checked: settings.codeNbsp,
          onChange: function (value) {
            props.themeActions.onSettings({ codeNbsp: value });
          },
        }),
      ),
      h(
        'section',
        { className: 'mdstudio-section mdstudio-tab-theme' },
        h('div', { className: 'mdstudio-section-title' }, t('drawer.themeActions')),
        h(
          'div',
          { className: 'mdstudio-css-actions' },
          h(
            props.ui.Button,
            { variant: 'outline', size: 'sm', onClick: props.themeActions.onExportTheme },
            t('drawer.exportTheme'),
          ),
          h(
            props.ui.Button,
            {
              variant: 'outline',
              size: 'sm',
              onClick: function () {
                if (themeFileRef.current) themeFileRef.current.click();
              },
            },
            t('drawer.importTheme'),
          ),
          h('input', {
            type: 'file',
            ref: themeFileRef,
            className: 'mdstudio-hidden-input',
            accept: '.json,application/json',
            onChange: function (event) {
              props.themeActions.onImportTheme(event.target.files && event.target.files[0]);
              event.target.value = '';
            },
          }),
          h('div', { className: 'mdstudio-spacer' }),
          h(
            props.ui.Button,
            { variant: 'ghost', size: 'sm', onClick: props.themeActions.onResetStyles },
            t('drawer.reset'),
          ),
        ),
      ),
      h(
        'section',
        { className: 'mdstudio-section mdstudio-tab-help' },
        h('div', { className: 'mdstudio-section-title' }, t('slashHelp.title')),
        h('p', { className: 'mdstudio-help-desc' }, t('slashHelp.desc')),
        h(
          'div',
          { className: 'mdstudio-shortcuts' },
          buildSlashHelpRows(t).map(function (row) {
            return h(
              'div',
              { className: 'mdstudio-shortcut', key: row[0] + row[1] },
              h('span', null, row[1]),
              h('kbd', null, row[0]),
            );
          }),
        ),
      ),
      h(
        'section',
        { className: 'mdstudio-section mdstudio-tab-help' },
        h('div', { className: 'mdstudio-section-title' }, t('shortcuts.title')),
        h(
          'div',
          { className: 'mdstudio-shortcuts' },
          props.shortcuts.map(function (row) {
            return h(
              'div',
              { className: 'mdstudio-shortcut', key: row[0] + row[1] },
              h('span', null, row[1]),
              h('kbd', null, row[0]),
            );
          }),
        ),
      ),
    ),
  );
}

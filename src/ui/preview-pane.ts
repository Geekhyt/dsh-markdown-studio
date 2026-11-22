import type * as ReactNamespace from 'react';
import type { ReactNode } from 'react';
import { applyDarkPreview, cleanupDarkPreview } from '../adapters/dark-preview';
import type { RenderedArticle } from '../adapters/render-article';
import { useHostDarkTheme, usePreviewHtmlSurface } from '../runtime/dom-surfaces';
import { DARK_STAGE_DEFAULT, DARK_STAGE_PAPER } from '../theme-system/color';
import type { UiKit } from './ui-kit';

export interface PreviewPaneProps {
  React: typeof ReactNamespace;
  t: (key: string) => string;
  ui: UiKit;
  rendered: RenderedArticle;
  empty: boolean;
  previewMode: 'mobile' | 'desktop';
  onPreviewMode: (mode: 'mobile' | 'desktop') => void;
  scrollSyncEnabled: boolean;
  onToggleSync: () => void;
  previewScrollRef: ReactNamespace.RefObject<HTMLDivElement | null>;
  onPreviewScroll: () => void;
  onPreviewClick: (event: ReactNamespace.MouseEvent<HTMLElement>) => void;
}

export function PreviewPane(props: PreviewPaneProps): ReactNode {
  const h = props.React.createElement;
  const t = props.t;
  const dark = useHostDarkTheme(props.React);
  const previewTheme: 'light' | 'dark' = dark ? 'dark' : 'light';
  const surfaceBg = dark
    ? props.rendered.paper
      ? DARK_STAGE_PAPER
      : DARK_STAGE_DEFAULT
    : props.rendered.paper
      ? props.rendered.stageBg
      : props.rendered.bg;
  const articleRef = props.React.useRef<HTMLDivElement | null>(null);

  usePreviewHtmlSurface(props.React, articleRef, {
    html: props.rendered.html,
    surfaceBg,
    darkFallbackBg: DARK_STAGE_DEFAULT,
    paper: props.rendered.paper,
    dark,
    previewMode: props.previewMode,
    empty: props.empty,
    applyDark: applyDarkPreview,
    cleanupDark: cleanupDarkPreview,
  });

  return h(
    'div',
    {
      className:
        'mdstudio-pane mdstudio-preview-pane' +
        (previewTheme === 'dark' ? ' is-preview-dark' : '') +
        (props.rendered.paper ? ' is-paper' : ''),
    },
    h(
      'div',
      { className: 'mdstudio-preview-head' },
      h(
        'div',
        { className: 'mdstudio-preview-tools' },
        h(props.ui.Tooltip, {
          label: t('preview.sync'),
          side: 'bottom',
          children: h(
            'button',
            {
              type: 'button',
              className: 'mdstudio-sync-btn' + (props.scrollSyncEnabled ? ' is-active' : ''),
              'aria-pressed': props.scrollSyncEnabled,
              'aria-label': t('preview.sync'),
              onClick: props.onToggleSync,
            },
            h(props.ui.Icon, { name: 'scrollSync', size: 13 }),
            h('span', { className: 'mdstudio-sync-label' }, t('preview.sync')),
          ),
        }),
        h(
          'div',
          { className: 'mdstudio-device-switch', role: 'group', 'aria-label': t('preview.deviceMode') },
          h(
            'button',
            {
              type: 'button',
              className: 'mdstudio-device-btn' + (props.previewMode === 'mobile' ? ' is-active' : ''),
              'aria-pressed': props.previewMode === 'mobile',
              onClick: function () {
                props.onPreviewMode('mobile');
              },
            },
            t('preview.mobile'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'mdstudio-device-btn' + (props.previewMode === 'desktop' ? ' is-active' : ''),
              'aria-pressed': props.previewMode === 'desktop',
              onClick: function () {
                props.onPreviewMode('desktop');
              },
            },
            t('preview.desktop'),
          ),
        ),
      ),
    ),
    h(
      'div',
      {
        className: 'mdstudio-stage' + (props.previewMode === 'desktop' ? ' is-desktop' : ''),
        style: props.previewMode === 'desktop' ? { backgroundColor: surfaceBg } : undefined,
      },
      props.empty
        ? null
        : h(
            'div',
            {
              className: 'mdstudio-device' + (props.previewMode === 'desktop' ? ' is-desktop' : ''),
              style: { backgroundColor: surfaceBg },
            },
            h(
              'div',
              {
                className: 'mdstudio-device-screen',
                ref: props.previewScrollRef,
                onScroll: props.onPreviewScroll,
                style: { backgroundColor: surfaceBg },
              },
              h('div', {
                className: 'mdstudio-preview-article',
                ref: articleRef,
                onClick: props.onPreviewClick,
              }),
            ),
          ),
    ),
  );
}

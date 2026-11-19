import type * as ReactNamespace from 'react';
import type { ReactNode } from 'react';
import { useWindowEvent } from '../runtime/react-lifecycle';
import type { UiKit } from './ui-kit';

export type ImmersiveMode = 'write' | 'preview' | null;

export function useImmersiveShortcuts(
  React: typeof ReactNamespace,
  immersive: ImmersiveMode,
  onEnter: () => void,
  onExit: () => void,
): void {
  useWindowEvent(
    React,
    'keydown',
    function (event: KeyboardEvent) {
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.shiftKey && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        event.stopPropagation();
        if (immersive) onExit();
        else onEnter();
        return;
      }
      if (event.key === 'Escape' && immersive) {
        event.preventDefault();
        event.stopPropagation();
        onExit();
      }
    },
    true,
    true,
  );
}

export interface ImmersiveDockProps {
  React: typeof ReactNamespace;
  t: (key: string) => string;
  ui: UiKit;
  mode: 'write' | 'preview';
  onSwitch: (next: 'write' | 'preview') => void;
  onExit: () => void;
}

export function ImmersiveDock(props: ImmersiveDockProps): ReactNode {
  const h = props.React.createElement;
  const { t, ui: uiKit, mode } = props;
  return h(
    'div',
    { className: 'mdstudio-immersive-dock', role: 'toolbar', 'aria-label': t('immersive.controls') },
    h(
      'div',
      { className: 'mdstudio-immersive-modes', role: 'group', 'aria-label': t('immersive.controls') },
      h(
        'button',
        {
          type: 'button',
          className: 'mdstudio-immersive-mode' + (mode === 'write' ? ' is-active' : ''),
          'aria-pressed': mode === 'write',
          onClick: function () {
            props.onSwitch('write');
          },
        },
        t('immersive.write'),
      ),
      h(
        'button',
        {
          type: 'button',
          className: 'mdstudio-immersive-mode' + (mode === 'preview' ? ' is-active' : ''),
          'aria-pressed': mode === 'preview',
          onClick: function () {
            props.onSwitch('preview');
          },
        },
        t('immersive.preview'),
      ),
    ),
    h('span', { className: 'mdstudio-immersive-sep', 'aria-hidden': 'true' }),
    h(uiKit.Tooltip, {
      label: t('immersive.exitHint'),
      side: 'bottom',
      children: h(
        'button',
        {
          type: 'button',
          className: 'mdstudio-immersive-exit',
          'aria-label': t('immersive.exitHint'),
          onClick: props.onExit,
        },
        h(uiKit.Icon, { name: 'collapse', size: 14 }),
        t('immersive.exit'),
      ),
    }),
  );
}

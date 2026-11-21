import type * as ReactNamespace from 'react';
import type { ReactNode } from 'react';
import type { DshPrimitivesModule } from '../types/dsh-primitives';
import { createDshBridge } from './dsh-primitives';

export function createUiKit(React: typeof ReactNamespace, primitives?: DshPrimitivesModule | null) {
  const h = React.createElement;
  const bridge = createDshBridge(React, primitives);

  interface ToolButtonProps {
    title: string;
    active?: boolean;
    disabled?: boolean;
    ariaExpanded?: boolean;
    onClick?: () => void;
    children?: ReactNode;
  }

  function ToolButton(props: ToolButtonProps) {
    return h(bridge.Tooltip, {
      label: props.title,
      side: 'bottom',
      disabled: !!props.disabled,
      children: h(
        'button',
        {
          type: 'button',
          className: 'mdstudio-tool' + (props.active ? ' is-active' : ''),
          'aria-label': props.title,
          'aria-expanded': props.ariaExpanded,
          disabled: !!props.disabled,
          onMouseDown: function (event: ReactNamespace.MouseEvent<HTMLButtonElement>) {
            event.preventDefault();
          },
          onClick: props.onClick,
        },
        props.children,
      ),
    });
  }

  interface SwitchProps {
    label: string;
    checked: boolean;
    onChange: (value: boolean) => void;
    disabled?: boolean;
    title?: string;
  }

  function Switch(props: SwitchProps) {
    return h(bridge.Switch, {
      checked: props.checked,
      onChange: props.onChange,
      label: props.label,
      disabled: props.disabled,
      title: props.title,
    });
  }

  interface ToggleRowProps extends SwitchProps {
    description?: string;
  }

  function ToggleRow(props: ToggleRowProps) {
    return h(
      'div',
      { className: 'mdstudio-toggle-row' },
      h('div', { className: 'mdstudio-toggle-copy' }, h('div', { className: 'mdstudio-row-label' }, props.label)),
      h(Switch, {
        checked: props.checked,
        onChange: props.onChange,
        label: props.label,
        disabled: props.disabled,
        title: props.title,
      }),
    );
  }

  return {
    bridge,
    Icon: bridge.Icon,
    ToolButton,
    Switch,
    ToggleRow,
    Button: bridge.Button,
    Checkbox: bridge.Checkbox,
    Input: bridge.Input,
    Pill: bridge.Pill,
    Tag: bridge.Tag,
    StateDot: bridge.StateDot,
    Tooltip: bridge.Tooltip,
    Toast: bridge.Toast,
    Modal: bridge.Modal,
    Menu: bridge.Menu,
  };
}

export type UiKit = ReturnType<typeof createUiKit>;

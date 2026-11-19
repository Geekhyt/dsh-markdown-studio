import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import type * as ReactNamespace from 'react';
import type { Root } from 'react-dom/client';
import { observeHostTitlebarInset } from '../src/adapters/host-shell';
import type {
  DshButtonProps,
  DshCheckboxProps,
  DshIconProps,
  DshInputProps,
  DshMenuProps,
  DshModalProps,
  DshPrimitivesModule,
  DshToastProps,
  DshTooltipProps,
} from '../src/types/dsh-primitives';
import { type DialogHostApi, useDialogHost } from '../src/ui/dialog-host';
import { createDshBridge, trapModalTab } from '../src/ui/dsh-primitives';
import { toMenuShortcut } from '../src/ui/shortcut-model';
import { createUiKit } from '../src/ui/ui-kit';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
});
const win = dom.window;
function setGlobal(name: string, value: unknown): void {
  try {
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  } catch (_error) {
    (globalThis as Record<string, unknown>)[name] = value;
  }
}
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
setGlobal('window', win);
setGlobal('document', win.document);
setGlobal('navigator', win.navigator);
setGlobal('HTMLElement', win.HTMLElement);
setGlobal('SVGElement', win.SVGElement);
setGlobal('HTMLInputElement', win.HTMLInputElement);
setGlobal('HTMLButtonElement', win.HTMLButtonElement);
setGlobal('Node', win.Node);
setGlobal('Event', win.Event);
setGlobal('MouseEvent', win.MouseEvent);
setGlobal('KeyboardEvent', win.KeyboardEvent);
setGlobal('FocusEvent', win.FocusEvent);

const React: typeof ReactNamespace = (await import('react')).default;
const ReactDOM = await import('react-dom/client');
const { act } = React;
const h = React.createElement;

// 1. Host titlebar inset observer
{
  let resizeCallback: () => void = () => {};
  let disconnected = false;
  class MockResizeObserver {
    constructor(cb: () => void) {
      resizeCallback = cb;
    }
    observe(): void {}
    disconnect(): void {
      disconnected = true;
    }
  }
  (globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver = MockResizeObserver;
  Object.defineProperty(win, 'innerWidth', { value: 1280, configurable: true });
  const target = document.createElement('div');
  let rectLeft = 40;
  target.getBoundingClientRect = () => ({
    left: rectLeft,
    top: 0,
    right: rectLeft + 800,
    bottom: 600,
    width: 800,
    height: 600,
    x: rectLeft,
    y: 0,
    toJSON() {
      return {};
    },
  });
  const dispose = observeHostTitlebarInset(target);
  assert.equal(target.style.getPropertyValue('--mdstudio-host-inset'), '120px');
  assert.equal(target.hasAttribute('data-mdstudio-host-titlebar'), true);

  rectLeft = 220;
  resizeCallback();
  assert.equal(target.style.getPropertyValue('--mdstudio-host-inset'), '0px');
  assert.equal(target.hasAttribute('data-mdstudio-host-titlebar'), false);

  rectLeft = 20;
  Object.defineProperty(win, 'innerWidth', { value: 640, configurable: true });
  win.dispatchEvent(new win.Event('resize'));
  assert.equal(target.style.getPropertyValue('--mdstudio-host-inset'), '0px');

  // Desktop Electron (html[data-platform="darwin"]) keeps 160px clearance even at <= 720px narrow window!
  rectLeft = 0;
  document.documentElement.setAttribute('data-platform', 'darwin');
  win.dispatchEvent(new win.Event('resize'));
  assert.equal(target.style.getPropertyValue('--mdstudio-host-inset'), '160px');
  assert.equal(target.hasAttribute('data-mdstudio-host-titlebar'), true);

  // Fullscreen macOS uses 84px clearance (no traffic lights, only DSH reopen + new session buttons)
  document.documentElement.setAttribute('data-fullscreen', '');
  win.dispatchEvent(new win.Event('resize'));
  assert.equal(target.style.getPropertyValue('--mdstudio-host-inset'), '84px');

  // Windows/Linux desktop uses 84px clearance
  document.documentElement.removeAttribute('data-fullscreen');
  document.documentElement.setAttribute('data-platform', 'win32');
  win.dispatchEvent(new win.Event('resize'));
  assert.equal(target.style.getPropertyValue('--mdstudio-host-inset'), '84px');

  // Authoritative --dsh-frame-leading-clearance published by DSH frame takes precedence
  target.style.setProperty('--dsh-frame-leading-clearance', '48px');
  win.dispatchEvent(new win.Event('resize'));
  assert.equal(target.style.getPropertyValue('--mdstudio-host-inset'), '48px');
  target.style.removeProperty('--dsh-frame-leading-clearance');
  document.documentElement.removeAttribute('data-platform');
  rectLeft = 20;

  dispose();
  assert.equal(disconnected, true);
  assert.equal(target.style.getPropertyValue('--mdstudio-host-inset'), '');

  delete (globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver;
  Object.defineProperty(win, 'innerWidth', { value: 1280, configurable: true });
  const disposeNoObserver = observeHostTitlebarInset(target);
  assert.equal(target.style.getPropertyValue('--mdstudio-host-inset'), '140px');
  disposeNoObserver();
  console.log('ok - observeHostTitlebarInset tracks host frame inset and cleans up');
}

// 2. Fallback DSH bridge + UI kit
{
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root | null = null;
  const kit = createUiKit(React, null);
  assert.equal(kit.bridge.hasNativePrimitives, false);

  let switched = false;
  let checkedBox = false;
  let selectedMenu = '';
  let menuClosed = false;
  let modalClosed = false;
  let toastDone = false;
  let toolClicked = false;

  await act(async () => {
    root = ReactDOM.createRoot(container);
    root.render(
      h(
        'div',
        null,
        h(kit.Icon, { name: 'folder' }),
        h(kit.Icon, { name: 'copy' }),
        h(kit.Icon, { name: 'sliders' }),
        h(kit.Icon, { name: 'more' }),
        h(kit.Icon, { name: 'close' }),
        h(kit.Icon, { name: 'split' }),
        h(kit.Icon, { name: 'eye' }),
        h(kit.Icon, { name: 'link' }),
        h(kit.Icon, { name: 'image' }),
        h(kit.Icon, { name: 'listTree' }),
        h(kit.Icon, { name: 'table' }),
        h(kit.Icon, { name: 'save' }),
        h(kit.Icon, { name: 'check' }),
        h(kit.Icon, { name: 'undo' }),
        h(kit.Icon, { name: 'redo' }),
        h(kit.Button, { variant: 'primary', size: 'md', icon: h('span', null, '*') }, 'Primary'),
        h(kit.Button, { variant: 'outline', size: 'sm', disabled: true }, 'Outline'),
        h(kit.Button, { variant: 'ghost' }, 'Ghost'),
        h(kit.Button, { variant: 'toolbar' }, 'Toolbar'),
        h(kit.Checkbox, {
          checked: false,
          label: 'Merge import',
          className: 'fb-check',
          onChange: (next) => {
            checkedBox = next;
          },
        }),
        h(kit.Input, { defaultValue: 'plain', className: 'fb-plain-input' }),
        h(kit.Input, {
          defaultValue: 'with-icon',
          icon: h('span', null, '?'),
          className: 'fb-icon-input',
          wrapClassName: 'fb-icon-wrap',
        }),
        h(kit.Pill, { active: true }, 'Active Pill'),
        h(kit.Pill, { active: false }, 'Idle Pill'),
        h(kit.Tag, { tone: 'success' }, 'Applied'),
        h(kit.Tag, { tone: 'warning' }, 'Dirty'),
        h(kit.Tag, { tone: 'danger' }, 'Error'),
        h(kit.Tag, { tone: 'info' }, 'Info'),
        h(kit.Tag, {}, 'Default'),
        h(kit.StateDot, { state: 'done', size: 8 }),
        h(kit.StateDot, { state: 'warning' }),
        h(kit.ToggleRow, {
          label: 'Toggle feature',
          checked: false,
          onChange: (next) => {
            switched = next;
          },
        }),
        h(
          kit.ToolButton,
          {
            title: 'Bold tool',
            active: true,
            onClick: () => {
              toolClicked = true;
            },
          },
          'B',
        ),
        h(kit.Tooltip, {
          label: () => 'Top dynamic tip',
          side: 'top',
          maxWidth: 200,
          children: h('button', { type: 'button', id: 'dyn-tip-btn' }, 'Hover me'),
        }),
        h(kit.Toast, {
          text: 'Saved',
          tone: 'info',
          holdMs: 20,
          onDone: () => {
            toastDone = true;
          },
        }),
        h(kit.Toast, { text: 'Failed', tone: 'error', icon: h('span', null, '!'), holdMs: 500, onDone: () => {} }),
        h(kit.Menu, {
          open: true,
          align: 'start',
          listClassName: 'custom-menu-list',
          ariaLabel: 'Actions',
          selectedId: 'a',
          selectedIds: ['b'],
          items: [
            { type: 'label', id: 'lbl', text: 'Group' },
            { id: 'a', label: 'Item A', icon: h('span', null, 'A'), shortcut: toMenuShortcut(['Ctrl+', '', 'S']) },
            { id: 'b', label: 'Item B', shortcut: toMenuShortcut(['⌘', 'B']) },
            { type: 'separator', id: 'sep' },
            { id: 'c', label: 'Danger C', danger: true },
          ],
          footer: [{ id: 'foot', label: 'Footer action' }],
          anchor: h('button', { type: 'button', id: 'menu-anchor' }, 'More'),
          onSelect: (id) => {
            selectedMenu = id;
          },
          onClose: () => {
            menuClosed = true;
          },
        }),
        h(
          kit.Modal,
          {
            open: true,
            tone: 'warning',
            title: 'Test Modal',
            description: 'Modal description',
            closeLabel: 'Close modal',
            onClose: () => {
              modalClosed = true;
            },
            footer: h('button', { type: 'button', id: 'modal-second-btn' }, 'Confirm'),
          },
          h('button', { type: 'button', id: 'modal-first-btn' }, 'Inside'),
        ),
      ),
    );
  });

  await act(async () => {
    await new Promise((r) => setTimeout(r, 40));
  });
  assert.equal(toastDone, true, 'FallbackToast fires onDone after holdMs');
  assert.ok(container.querySelector('[role="alert"]'), 'error toast uses alert role');
  assert.ok(container.querySelector('.fb-plain-input'), 'FallbackInput renders plain input');
  assert.ok(container.querySelector('.fb-icon-wrap .fb-icon-input'), 'FallbackInput wraps input when icon is provided');
  assert.ok(
    container.querySelector('.mdstudio-fallback-modal.is-warning .mdstudio-modal-warn-icon'),
    'FallbackModal renders warning icon when tone="warning"',
  );

  const checkInput = container.querySelector<HTMLInputElement>('.fb-check input[type="checkbox"]');
  assert.ok(checkInput);
  await act(async () => {
    checkInput.click();
  });
  assert.equal(checkedBox, true, 'FallbackCheckbox toggles value');

  const switchEl = container.querySelector<HTMLButtonElement>('[role="switch"]');
  assert.ok(switchEl);
  await act(async () => {
    switchEl.click();
  });
  assert.equal(switched, true, 'Switch toggles value');

  const toolBtn = container.querySelector<HTMLButtonElement>('.mdstudio-tool');
  assert.ok(toolBtn);
  await act(async () => {
    toolBtn.dispatchEvent(new win.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    toolBtn.focus();
  });
  assert.ok(container.querySelector('.mdstudio-tooltip'), 'focus opens FallbackTooltip');
  await act(async () => {
    toolBtn.click();
  });
  assert.equal(toolClicked, true, 'ToolButton click fires');
  assert.equal(container.querySelector('.mdstudio-tooltip'), null, 'click hides FallbackTooltip');

  const dynBtn = container.querySelector<HTMLButtonElement>('#dyn-tip-btn');
  assert.ok(dynBtn);
  await act(async () => {
    dynBtn.dispatchEvent(new win.MouseEvent('mouseover', { bubbles: true }));
  });
  await act(async () => {
    dynBtn.focus();
  });
  assert.equal(container.querySelector('.mdstudio-tooltip')?.textContent, 'Top dynamic tip');
  await act(async () => {
    dynBtn.blur();
  });
  assert.equal(container.querySelector('.mdstudio-tooltip'), null);

  const menuEl = container.querySelector<HTMLDivElement>('.mdstudio-menu');
  assert.ok(menuEl);
  const menuItems = Array.from(menuEl.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
  assert.equal(menuItems.length, 4);
  menuItems[0].focus();
  await act(async () => {
    menuEl.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  });
  assert.equal(document.activeElement, menuItems[1]);
  await act(async () => {
    menuEl.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'End', bubbles: true }));
  });
  assert.equal(document.activeElement, menuItems[3]);
  await act(async () => {
    menuEl.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
  });
  assert.equal(document.activeElement, menuItems[0]);
  await act(async () => {
    menuEl.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
  });
  assert.equal(document.activeElement, menuItems[3]);
  await act(async () => {
    menuItems[1].click();
  });
  assert.equal(selectedMenu, 'b');
  await act(async () => {
    menuEl.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  assert.equal(menuClosed, true);

  const modalEl = container.querySelector<HTMLDivElement>('.mdstudio-modal');
  assert.ok(modalEl);
  const closeBtn = modalEl.querySelector<HTMLButtonElement>('.mdstudio-modal-close');
  const confirmBtn = modalEl.querySelector<HTMLButtonElement>('#modal-second-btn');
  assert.ok(closeBtn && confirmBtn);
  confirmBtn.focus();
  trapModalTab({
    key: 'Tab',
    shiftKey: false,
    currentTarget: modalEl,
    preventDefault() {},
  } as unknown as ReactNamespace.KeyboardEvent<HTMLDivElement>);
  assert.equal(document.activeElement, closeBtn, 'Tab at end wraps to first modal button');
  closeBtn.focus();
  trapModalTab({
    key: 'Tab',
    shiftKey: true,
    currentTarget: modalEl,
    preventDefault() {},
  } as unknown as ReactNamespace.KeyboardEvent<HTMLDivElement>);
  assert.equal(document.activeElement, confirmBtn, 'Shift+Tab at start wraps to last modal button');

  await act(async () => {
    document.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  assert.equal(modalClosed, true);
  await act(async () => {
    root?.unmount();
  });
  container.remove();
  console.log('ok - fallback DSH bridge components and keyboard navigation pass');
}

// 3. Native DSH primitives delegation (including React.forwardRef Button & Input)
{
  const calls: string[] = [];
  const ForwardRefButton = React.forwardRef<HTMLButtonElement, DshButtonProps>(function NativeBtn(props, ref) {
    calls.push('ForwardRefButton:' + String(props.variant || 'default'));
    return h('button', { ref, 'data-native-btn': 'true', onClick: props.onClick }, props.children);
  });
  const ForwardRefInput = React.forwardRef<HTMLInputElement, DshInputProps>(function NativeInput(props, ref) {
    const { icon, className, ...rest } = props;
    calls.push('ForwardRefInput:' + String(className));
    return h('span', { className }, icon, h('input', { ref, ...rest }));
  });
  const mockPrimitives: DshPrimitivesModule = {
    IconCopyOutline16: (props: DshIconProps) => {
      calls.push('IconCopy:' + String(props.size));
      return h('svg', { 'data-native': 'copy' });
    },
    IconCodeOutlineRegular: () => {
      calls.push('WrongHashtagIcon');
      return h('svg', { 'data-native': 'wrong-hashtag' });
    },
    IconInspectOutlineRegular: (props: DshIconProps) => {
      calls.push('IconInspect:' + String(props.size));
      return h('svg', { 'data-native': 'inspect-code' });
    },
    IconBrowseOutlineRegular: (props: DshIconProps) => {
      calls.push('IconBrowse:' + String(props.size));
      return h('svg', { 'data-native': 'browse-doc' });
    },
    IconWorkspaceTreeOutlineRegular: (props: DshIconProps) => {
      calls.push('IconWorkspaceTree:' + String(props.size));
      return h('svg', { 'data-native': 'workspace-tree' });
    },
    IconCompactOutlineRegular: () => {
      calls.push('WrongCompactArc');
      return h('svg', { 'data-native': 'wrong-compact' });
    },
    IconPersonalizationOutlineRegular: () => {
      calls.push('WrongSlidersIcon');
      return h('svg', { 'data-native': 'wrong-sliders' });
    },
    IconInfoOutlineRegular: (props: DshIconProps) => {
      calls.push('IconInfo:' + String(props.size));
      return h('svg', { 'data-native': 'info' });
    },
    Button: ForwardRefButton,
    Input: ForwardRefInput,
    Checkbox: (props: DshCheckboxProps) => {
      calls.push('Checkbox:' + props.label);
      return h('label', null, props.label);
    },
    Switch: (props) => {
      calls.push('Switch');
      return h('button', { onClick: () => props.onChange(!props.checked) });
    },
    Pill: (props) => {
      calls.push('Pill');
      return h('button', null, props.children);
    },
    Tag: (props) => {
      calls.push('Tag');
      return h('span', null, props.children);
    },
    StateDot: () => {
      calls.push('StateDot');
      return h('span', null);
    },
    Tooltip: (props: DshTooltipProps) => {
      calls.push('Tooltip:' + String(props.side));
      return props.children;
    },
    Toast: (props: DshToastProps) => {
      calls.push('Toast:' + props.text + ':' + String(props.tone || 'none') + ':' + String(Boolean(props.icon)));
      return h('div', null, props.icon, props.text);
    },
    Modal: (props: DshModalProps) => {
      calls.push('Modal:' + String(props.className) + ':' + String(props.tone || 'none'));
      return props.open ? h('div', { className: props.className }, props.children, props.footer) : null;
    },
    Menu: (props: DshMenuProps) => {
      calls.push('Menu:' + String(props.className));
      return h('div', { className: props.className }, props.anchor);
    },
  };
  const bridge = createDshBridge(React, mockPrimitives);
  assert.equal(bridge.hasNativePrimitives, true);
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root | null = null;
  await act(async () => {
    root = ReactDOM.createRoot(container);
    root.render(
      h(
        'div',
        null,
        h(bridge.Icon, { name: 'copy', size: 18 }),
        h(bridge.Icon, { name: 'eye', size: 15 }),
        h(bridge.Icon, { name: 'code', size: 15 }),
        h(bridge.Icon, { name: 'fileText', size: 14 }),
        h(bridge.Icon, { name: 'workspaceTree', size: 16 }),
        h(bridge.Icon, { name: 'listTree', size: 15 }),
        h(bridge.Icon, { name: 'collapse', size: 14 }),
        h(bridge.Icon, { name: 'palette', size: 14 }),
        h(bridge.Icon, { name: 'books', size: 16 }),
        h(bridge.Icon, { name: 'scrollSync', size: 13 }),
        h(bridge.Button, { variant: 'primary' }, 'Native Btn'),
        h(bridge.Input, { wrapClassName: 'search-wrap', className: 'search-input', defaultValue: 'q' }),
        h(bridge.Checkbox, { checked: true, label: 'Merge', onChange: () => {} }),
        h(bridge.Switch, { label: 'Toggle', checked: true, onChange: () => {} }),
        h(bridge.Pill, {}, 'Native Pill'),
        h(bridge.Tag, {}, 'Native Tag'),
        h(bridge.StateDot, { state: 'done' }),
        h(bridge.Tooltip, {
          label: 'Tip',
          children: h('span', { id: 'native-tip-target', title: 'Duplicate native tip' }, 'Target'),
        }),
        h(bridge.Toast, { text: 'Hi', tone: 'success', onDone: () => {} }),
        h(bridge.Toast, { text: 'Oops', tone: 'error', onDone: () => {} }),
        h(bridge.Toast, { text: 'FYI', tone: 'info', onDone: () => {} }),
        h(
          bridge.Modal,
          { open: true, tone: 'warning', title: 'M', closeLabel: 'X', className: 'extra', onClose: () => {} },
          'Body',
        ),
        h(bridge.Menu, {
          open: false,
          items: [],
          anchor: h('button', null, 'M'),
          onSelect: () => {},
          onClose: () => {},
          ariaLabel: 'More',
        }),
      ),
    );
  });
  assert.ok(calls.includes('IconCopy:18'));
  assert.ok(calls.includes('IconInspect:15'), 'code icon maps to IconInspectOutlineRegular </>');
  assert.equal(calls.includes('WrongHashtagIcon'), false, 'code icon never maps to hashtag IconCodeOutlineRegular');
  assert.ok(calls.includes('IconBrowse:14'), 'fileText icon maps to IconBrowseOutlineRegular');
  assert.ok(calls.includes('IconWorkspaceTree:16'), 'workspaceTree maps to IconWorkspaceTreeOutlineRegular');
  assert.equal(calls.includes('WrongCompactArc'), false, 'collapse icon never maps to chat IconCompactOutlineRegular');
  assert.equal(
    calls.includes('WrongSlidersIcon'),
    false,
    'palette icon never maps to sliders IconPersonalizationOutlineRegular',
  );
  assert.ok(calls.includes('ForwardRefButton:primary'), 'React.forwardRef Button resolves to native DSH Button');
  assert.ok(
    calls.includes('ForwardRefInput:mdstudio-dsh-input-wrap search-wrap'),
    'React.forwardRef Input resolves to native DSH Input',
  );
  assert.ok(calls.includes('Checkbox:Merge'));
  assert.ok(calls.includes('Tooltip:bottom'));
  assert.equal(
    container.querySelector('#native-tip-target')?.getAttribute('title'),
    null,
    'Tooltip strips native title attribute from trigger child to avoid double tooltips',
  );
  assert.ok(calls.includes('Toast:Hi:success:false'), 'success toast forwards tone="success"');
  assert.ok(calls.includes('Toast:Oops:none:true'), 'error toast injects warning icon for native DSH Toast');
  assert.ok(
    calls.includes('Toast:FYI:none:true') && calls.includes('IconInfo:15'),
    'info toast injects IconInfoOutlineRegular',
  );
  assert.ok(
    calls.includes('Modal:mdstudio-modal extra:warning'),
    'warning modal forwards tone="warning" without fallback modal class',
  );
  assert.ok(calls.includes('Menu:mdstudio-menu-wrap'));
  assert.ok(container.querySelector('button[data-native-btn="true"]'));
  assert.ok(container.querySelector('svg[data-native="copy"]'));
  assert.ok(container.querySelector('svg[data-native="inspect-code"]'));
  const customFallbackIcon = container.querySelector('svg.mdstudio-icon[viewBox="0 0 16 16"]');
  assert.ok(customFallbackIcon, 'custom DSH-grid icons render on a 16x16 viewBox');
  await act(async () => {
    root?.unmount();
  });
  container.remove();
  console.log('ok - native DSH primitives bridge delegates per export (including forwardRef) with icon fallback');
}

// 4. Async useDialogHost confirm + prompt flows
{
  const bridge = createDshBridge(React, null);
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root | null = null;
  let api: DialogHostApi | null = null;
  const dict: Record<string, string> = {
    close: '关闭',
    'dialog.confirm': '确认',
    'dialog.cancel': '取消',
    'dialog.delete': '删除',
  };
  function Harness() {
    api = useDialogHost(React, (k) => dict[k] || k, bridge);
    return h('div', null, api.node);
  }
  await act(async () => {
    root = ReactDOM.createRoot(container);
    root.render(h(Harness));
  });
  assert.ok(api);

  let confirmResult: boolean | null = null;
  await act(async () => {
    void api!.confirm({ title: 'Delete item?', description: 'Irreversible', danger: true }).then((res) => {
      confirmResult = res;
    });
  });
  assert.ok(container.querySelector('.mdstudio-dialog-submit.is-danger-fill'));
  await act(async () => {
    container.querySelector<HTMLButtonElement>('.mdstudio-dialog-submit')!.click();
  });
  assert.equal(confirmResult, true);

  let cancelResult: boolean | null = null;
  await act(async () => {
    void api!.confirm({ title: 'Cancel me?' }).then((res) => {
      cancelResult = res;
    });
  });
  await act(async () => {
    container.querySelector<HTMLButtonElement>('.mdstudio-dialog-cancel')!.click();
  });
  assert.equal(cancelResult, false);

  let promptResult: string | null | undefined;
  await act(async () => {
    void api!.prompt({ title: 'New file', defaultValue: '   ', placeholder: 'name.md' }).then((res) => {
      promptResult = res;
    });
  });
  const submitBtn = container.querySelector<HTMLButtonElement>('.mdstudio-dialog-submit')!;
  assert.equal(submitBtn.disabled, true, 'whitespace-only input disables submit when allowEmpty is false');
  const input = container.querySelector<HTMLInputElement>('.mdstudio-dialog-input')!;
  const valueSetter = Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    valueSetter.call(input, '  chapter-1.md  ');
    input.dispatchEvent(new win.Event('input', { bubbles: true }));
  });
  await act(async () => {
    input.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
  assert.equal(promptResult, '  chapter-1.md  ', 'Enter submits prompt value');

  let emptyPromptResult: string | null | undefined;
  await act(async () => {
    void api!.prompt({ title: 'Move to root', defaultValue: '', allowEmpty: true }).then((res) => {
      emptyPromptResult = res;
    });
  });
  await act(async () => {
    container.querySelector<HTMLButtonElement>('.mdstudio-dialog-submit')!.click();
  });
  assert.equal(emptyPromptResult, '', 'allowEmpty permits empty string submission');

  await act(async () => {
    root?.unmount();
  });
  container.remove();
  console.log('ok - useDialogHost confirm and prompt flows pass');
}

win.close();

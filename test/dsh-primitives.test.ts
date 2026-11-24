import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import type * as ReactNamespace from 'react';
import type { Root } from 'react-dom/client';
import { observeHostTitlebarInset } from '../src/adapters/host-shell';
import { isElementVisible, resolveSafeFocusTarget } from '../src/runtime/dom-surfaces';
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
import { computeMinimalChange } from '../src/ui/codemirror-core';
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
  } catch {
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

  // onResize callback fires only when clientWidth changes (never spuriously on mount)
  let mockClientW = 640;
  Object.defineProperty(target, 'clientWidth', { get: () => mockClientW, configurable: true });
  const observedWidths: number[] = [];
  const disposeResize = observeHostTitlebarInset(target, (w) => observedWidths.push(w));
  assert.deepEqual(observedWidths, [], 'onResize does not fire spuriously on initial mount');
  mockClientW = 1040;
  win.dispatchEvent(new win.Event('resize'));
  assert.deepEqual(observedWidths, [1040], 'onResize notifies when container width changes');
  disposeResize();

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

  function FallbackHarness() {
    const [openMenu, setOpenMenu] = React.useState(true);
    return h(
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
      h(kit.Input, { defaultValue: 'plain', className: 'fb-plain-input', wrapClassName: 'fb-plain-wrap' }),
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
        open: openMenu,
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
          setOpenMenu(false);
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
    );
  }

  await act(async () => {
    root = ReactDOM.createRoot(container);
    root.render(h(FallbackHarness));
  });

  await act(async () => {
    await new Promise((r) => setTimeout(r, 40));
  });
  assert.equal(toastDone, true, 'FallbackToast fires onDone after holdMs');
  assert.ok(container.querySelector('[role="alert"]'), 'error toast uses alert role');
  assert.ok(
    container.querySelector('.fb-plain-input.fb-plain-wrap'),
    'FallbackInput preserves wrapClassName even when icon is omitted',
  );
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
  const mdEvt = new win.MouseEvent('mousedown', { bubbles: true, cancelable: true });
  await act(async () => {
    toolBtn.dispatchEvent(mdEvt);
  });
  assert.equal(mdEvt.defaultPrevented, true, 'ToolButton mousedown preserves editor selection');
  await act(async () => {
    document.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    toolBtn.focus();
  });
  assert.ok(container.querySelector('.mdstudio-tooltip'), 'keyboard focus opens FallbackTooltip');
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
  // Clicking a non-focusable group header drops focus out of menuitems; capture-phase Escape must still
  // close ONLY the open menu without leaking through to close the underlying modal (LIFO).
  const groupLabel = menuEl.querySelector<HTMLElement>('.mdstudio-menu-group');
  assert.ok(groupLabel);
  await act(async () => {
    groupLabel.click();
    (document.activeElement as HTMLElement | null)?.blur?.();
    document.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  });
  assert.equal(menuClosed, true, 'capture-phase Escape closes FallbackMenu even when focus leaves menuitems');
  assert.equal(modalClosed, false, 'first Escape consumes FallbackMenu without dismissing underlying modal');

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

  // Escape already consumed by an inner menu (defaultPrevented) must NOT also dismiss FallbackModal
  await act(async () => {
    const preHandledEsc = new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    preHandledEsc.preventDefault();
    document.dispatchEvent(preHandledEsc);
  });
  assert.equal(modalClosed, false, 'FallbackModal respects event.defaultPrevented on Escape');

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

// --- 7. FallbackMenu fixed viewport positioning (below & flipped above) ---
{
  const kit = createUiKit(React, null);
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root | null = null;
  const origInnerHeight = win.innerHeight;
  const origInnerWidth = win.innerWidth;
  Object.defineProperty(win, 'innerWidth', { value: 1200, configurable: true });
  Object.defineProperty(win, 'innerHeight', { value: 800, configurable: true });

  let rectMock = { left: 40, right: 120, top: 60, bottom: 92, width: 80, height: 32 };
  const origRect = win.HTMLElement.prototype.getBoundingClientRect;
  win.HTMLElement.prototype.getBoundingClientRect = function () {
    return { ...rectMock, x: rectMock.left, y: rectMock.top, toJSON: () => ({}) } as DOMRect;
  };
  try {
    await act(async () => {
      root = ReactDOM.createRoot(container);
      root.render(
        h(kit.Menu, {
          open: true,
          align: 'start',
          ariaLabel: 'Format',
          items: [{ id: 'p', label: 'Paragraph' }],
          anchor: h('button', { type: 'button' }, 'Format'),
          onSelect: () => {},
          onClose: () => {},
        }),
      );
    });
    const belowMenu = container.querySelector<HTMLElement>('[role="menu"]')!;
    assert.equal(belowMenu.style.left, '40px', 'start-aligned fixed menu anchors to trigger left edge');
    assert.equal(belowMenu.style.top, '96px', 'fixed menu opens 4px below trigger when viewport has space');
    assert.equal(belowMenu.style.bottom, 'auto');

    // Flip above when trigger sits near viewport bottom
    rectMock = { left: 1080, right: 1180, top: 720, bottom: 752, width: 100, height: 32 };
    await act(async () => {
      root!.render(
        h(kit.Menu, {
          open: true,
          align: 'end',
          ariaLabel: 'BottomMenu',
          items: [{ id: 'x', label: 'Action' }],
          anchor: h('button', { type: 'button' }, 'More'),
          onSelect: () => {},
          onClose: () => {},
        }),
      );
    });
    const aboveMenu = container.querySelector<HTMLElement>('[role="menu"]')!;
    assert.equal(aboveMenu.style.top, 'auto', 'fixed menu flips above when space below is tight');
    assert.equal(aboveMenu.style.bottom, '84px', 'flipped menu anchors 4px above trigger top');
    assert.equal(aboveMenu.style.left, '936px', 'end-aligned menu clamps inside right viewport edge');

    // Respect explicit side='top' even when space below is ample, and live-reposition on window resize
    rectMock = { left: 780, right: 880, top: 320, bottom: 352, width: 100, height: 32 };
    await act(async () => {
      root!.render(
        h(kit.Menu, {
          open: true,
          align: 'end',
          side: 'top',
          ariaLabel: 'TopPreferredMenu',
          items: [{ id: 'x', label: 'Action' }],
          anchor: h('button', { type: 'button' }, 'Up'),
          onSelect: () => {},
          onClose: () => {},
        }),
      );
    });
    const topMenu = container.querySelector<HTMLElement>('[role="menu"]')!;
    assert.equal(topMenu.style.top, 'auto', 'side="top" opens above trigger when space above is sufficient');
    Object.defineProperty(win, 'innerWidth', { value: 640, configurable: true });
    rectMock = { left: 520, right: 620, top: 320, bottom: 352, width: 100, height: 32 };
    await act(async () => {
      win.dispatchEvent(new win.Event('resize'));
    });
    assert.equal(topMenu.style.left, '376px', 'open FallbackMenu repositions cleanly on window resize');
  } finally {
    win.HTMLElement.prototype.getBoundingClientRect = origRect;
    Object.defineProperty(win, 'innerWidth', { value: origInnerWidth, configurable: true });
    Object.defineProperty(win, 'innerHeight', { value: origInnerHeight, configurable: true });
    await act(async () => {
      root?.unmount();
    });
    container.remove();
  }
  console.log('ok - FallbackMenu fixed viewport positioning escapes overflow containers');
}

// 9. FallbackTooltip scroll dismissal, scroll-quiet suppression, and containing-block/viewport alignment
{
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root | null = null;
  const kit = createUiKit(React, null);
  const origRect = win.HTMLElement.prototype.getBoundingClientRect;
  const origInnerWidth = win.innerWidth;
  const origInnerHeight = win.innerHeight;
  Object.defineProperty(win, 'innerWidth', { value: 1000, configurable: true });
  Object.defineProperty(win, 'innerHeight', { value: 700, configurable: true });
  let simulateTrappedContainingBlock = false;
  win.HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement): DOMRect {
    if (this.classList.contains('mdstudio-tooltip')) {
      const styleLeft = Number.parseFloat(this.style.left || '0');
      const styleTop = Number.parseFloat(this.style.top || '0');
      const offsetX = simulateTrappedContainingBlock ? 400 : 0;
      const offsetY = simulateTrappedContainingBlock ? 12 : 0;
      const width = 120;
      const height = 26;
      const left = styleLeft - width / 2 + offsetX;
      const top = styleTop + offsetY;
      return {
        left,
        right: left + width,
        top,
        bottom: top + height,
        width,
        height,
        x: left,
        y: top,
        toJSON: () => ({}),
      } as DOMRect;
    }
    return {
      left: 930,
      right: 990,
      top: 12,
      bottom: 44,
      width: 60,
      height: 32,
      x: 930,
      y: 12,
      toJSON: () => ({}),
    } as DOMRect;
  };
  try {
    simulateTrappedContainingBlock = true;
    await act(async () => {
      root = ReactDOM.createRoot(container);
      root.render(
        h(
          'div',
          null,
          h(kit.Tooltip, {
            label: 'Exit immersive · Esc',
            side: 'bottom',
            children: h('button', { type: 'button', id: 'scroll-tip-a' }, 'Exit'),
          }),
          h(kit.Tooltip, {
            label: 'Delete row',
            side: 'top',
            children: h('button', { type: 'button', id: 'scroll-tip-b' }, 'Delete'),
          }),
        ),
      );
    });
    const btnA = container.querySelector<HTMLButtonElement>('#scroll-tip-a')!;
    const btnB = container.querySelector<HTMLButtonElement>('#scroll-tip-b')!;
    await act(async () => {
      btnA.dispatchEvent(new win.MouseEvent('mouseover', { bubbles: true }));
    });
    const tip = container.querySelector<HTMLElement>('.mdstudio-tooltip')!;
    assert.ok(tip, 'tooltip renders on hover');
    const adjustedLeft = Number.parseFloat(tip.style.left);
    assert.ok(adjustedLeft < 600, `alignFixedTooltip compensates trapped containing block (left=${adjustedLeft})`);

    // Capture-phase scroll dismisses open tooltip and suppresses synthetic post-scroll mouseenter
    await act(async () => {
      win.dispatchEvent(new win.Event('scroll'));
    });
    assert.equal(container.querySelector('.mdstudio-tooltip'), null, 'window capture scroll dismisses tooltip');
    await act(async () => {
      btnB.dispatchEvent(new win.MouseEvent('mouseover', { bubbles: true }));
    });
    assert.equal(
      container.querySelector('.mdstudio-tooltip'),
      null,
      'synthetic mouseenter immediately after scroll does not strobe a new tooltip',
    );
    // Keyboard focus still opens tooltip immediately even inside the scroll-quiet window
    simulateTrappedContainingBlock = false;
    await act(async () => {
      document.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
      btnB.focus();
    });
    assert.ok(container.querySelector('.mdstudio-tooltip'), 'keyboard focus opens tooltip immediately');

    // Non-keyboard programmatic focus restoration after a pointer interaction does not pop up a phantom tooltip
    await act(async () => {
      btnB.blur();
      btnA.dispatchEvent(new win.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      btnA.focus();
    });
    assert.equal(
      container.querySelector('.mdstudio-tooltip'),
      null,
      'non-keyboard programmatic focus restoration (:focus-visible=false) does not show phantom tooltip',
    );

    // Keyboard focus on A then B -> exact measured edge alignment & strictly 1 active tooltip at a time
    await act(async () => {
      btnA.blur();
      document.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
      btnA.focus();
    });
    const edgeTip = container.querySelector<HTMLElement>('.mdstudio-tooltip')!;
    assert.ok(edgeTip, 'keyboard focus opens edge tooltip');
    // btnA center = 960, width = 120 (half = 60), vw = 1000 -> clamped center = 1000 - 60 - 8 = 932
    assert.equal(
      Number.parseFloat(edgeTip.style.left),
      932,
      'alignFixedTooltip clamps short edge tooltip to measured half-width + 8px margin',
    );
    await act(async () => {
      document.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
      btnB.focus();
    });
    assert.equal(
      container.querySelectorAll('.mdstudio-tooltip').length,
      1,
      'opening a second FallbackTooltip dismisses any previously active tooltip (never dual tooltips)',
    );
    assert.equal(container.querySelector('.mdstudio-tooltip')?.textContent, 'Delete row');
  } finally {
    win.HTMLElement.prototype.getBoundingClientRect = origRect;
    Object.defineProperty(win, 'innerWidth', { value: origInnerWidth, configurable: true });
    Object.defineProperty(win, 'innerHeight', { value: origInnerHeight, configurable: true });
    await act(async () => {
      root?.unmount();
    });
    container.remove();
  }
  console.log('ok - FallbackTooltip scroll dismissal, quiet window, and viewport alignment');
}

// 10. Portal layer escape for FallbackMenu + FallbackTooltip & vertical viewport flip clamping
{
  const reactDomLegacy = await import('react-dom');
  const prevGlobalDom = (globalThis as { ReactDOM?: unknown }).ReactDOM;
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root | null = null;
  const kit = createUiKit(React, null);
  const origRect = win.HTMLElement.prototype.getBoundingClientRect;
  const origInnerWidth = win.innerWidth;
  const origInnerHeight = win.innerHeight;
  Object.defineProperty(win, 'innerWidth', { value: 800, configurable: true });
  Object.defineProperty(win, 'innerHeight', { value: 400, configurable: true });
  let mockAnchorTop = 365;
  let mockAnchorBottom = 395;
  win.HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement): DOMRect {
    if (this.classList.contains('mdstudio-tooltip')) {
      const styleLeft = Number.parseFloat(this.style.left || '0');
      const styleTop = Number.parseFloat(this.style.top || '0');
      const w = 100;
      const ht = 28;
      return {
        left: styleLeft - w / 2,
        right: styleLeft + w / 2,
        top: styleTop,
        bottom: styleTop + ht,
        width: w,
        height: ht,
        x: styleLeft - w / 2,
        y: styleTop,
        toJSON: () => ({}),
      } as DOMRect;
    }
    return {
      left: 300,
      right: 360,
      top: mockAnchorTop,
      bottom: mockAnchorBottom,
      width: 60,
      height: 30,
      x: 300,
      y: mockAnchorTop,
      toJSON: () => ({}),
    } as DOMRect;
  };
  let scrimClosed = false;
  (globalThis as { ReactDOM?: unknown }).ReactDOM = { createPortal: reactDomLegacy.createPortal };
  try {
    await act(async () => {
      root = ReactDOM.createRoot(container);
      root.render(
        h(
          'div',
          { id: 'portal-host-wrap' },
          h(kit.Menu, {
            open: true,
            items: [{ id: 'x', label: 'Portal item' }],
            anchor: h('button', { type: 'button' }, 'Open'),
            onSelect: () => {},
            onClose: () => {
              scrimClosed = true;
            },
          }),
          h(kit.Tooltip, {
            label: 'Bottom flip tip',
            side: 'bottom',
            children: h('button', { type: 'button', id: 'bottom-tip-btn' }, 'Bottom'),
          }),
          h(kit.Tooltip, {
            label: 'Top flip tip',
            side: 'top',
            children: h('button', { type: 'button', id: 'top-tip-btn' }, 'Top'),
          }),
        ),
      );
    });
    const portaledMenu = document.body.querySelector<HTMLElement>('.mdstudio-menu');
    assert.ok(portaledMenu && portaledMenu.parentElement === document.body, 'FallbackMenu portals to document.body');
    const scrim = document.body.querySelector<HTMLElement>('.mdstudio-menu-scrim');
    assert.ok(scrim && scrim.parentElement === document.body, 'FallbackMenu scrim portals to document.body');
    await act(async () => {
      scrim.click();
    });
    assert.equal(scrimClosed, true, 'portaled scrim click triggers onClose');

    // Bottom-edge tooltip flips above anchor
    await act(async () => {
      document.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
      container.querySelector<HTMLButtonElement>('#bottom-tip-btn')!.focus();
    });
    const bottomTip = document.body.querySelector<HTMLElement>('.mdstudio-tooltip');
    assert.ok(bottomTip && bottomTip.parentElement === document.body, 'FallbackTooltip portals to document.body');
    assert.ok(Number.parseFloat(bottomTip.style.top) < mockAnchorTop, 'bottom-edge tooltip flips above anchor');
    await act(async () => {
      container.querySelector<HTMLButtonElement>('#bottom-tip-btn')!.blur();
    });

    // Top-edge side='top' tooltip flips below anchor
    mockAnchorTop = 6;
    mockAnchorBottom = 34;
    await act(async () => {
      document.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
      container.querySelector<HTMLButtonElement>('#top-tip-btn')!.focus();
    });
    const topTip = document.body.querySelector<HTMLElement>('.mdstudio-tooltip');
    assert.ok(topTip && Number.parseFloat(topTip.style.top) > mockAnchorBottom, 'top-edge tooltip flips below anchor');
    await act(async () => {
      container.querySelector<HTMLButtonElement>('#top-tip-btn')!.blur();
    });

    // FallbackModal and FallbackToast portal to document.body to escape host stacking contexts
    await act(async () => {
      root!.render(
        h(
          'div',
          { id: 'portal-host-wrap' },
          h(kit.Modal, { open: true, title: 'Portal Modal', closeLabel: 'Close', onClose: () => {} }, 'Modal body'),
          h(kit.Toast, { text: 'Portal Toast', tone: 'success', holdMs: 60_000, onDone: () => {} }),
        ),
      );
    });
    const portaledModal = document.body.querySelector<HTMLElement>('.mdstudio-modal-scrim');
    assert.ok(portaledModal && portaledModal.parentElement === document.body, 'FallbackModal portals to document.body');
    const portaledToast = document.body.querySelector<HTMLElement>('.mdstudio-toast');
    assert.ok(portaledToast && portaledToast.parentElement === document.body, 'FallbackToast portals to document.body');

    // 8c. FallbackTooltip clears stale tip state when target flips disabled -> enabled without mouseleave
    {
      function DisabledFlipHarness() {
        const [disabled, setDisabled] = React.useState(false);
        return h(
          'div',
          null,
          h('button', { type: 'button', id: 'flip-disabled-toggle', onClick: () => setDisabled((v) => !v) }, 'Toggle'),
          h(kit.Tooltip, {
            label: 'Undo action',
            disabled,
            children: h('button', { type: 'button', id: 'flip-tip-btn', disabled }, 'Undo'),
          }),
        );
      }
      await act(async () => {
        root?.render(h(DisabledFlipHarness));
      });
      const tipBtn = container.querySelector<HTMLButtonElement>('#flip-tip-btn')!;
      const toggleBtn = container.querySelector<HTMLButtonElement>('#flip-disabled-toggle')!;
      await act(async () => {
        tipBtn.dispatchEvent(new win.MouseEvent('mouseover', { bubbles: true }));
      });
      assert.equal(document.querySelectorAll('.mdstudio-tooltip').length, 1, 'tooltip opens on hover before disable');
      // Disable without firing mouseleave (simulates Mod+Z disabling Undo under pointer)
      await act(async () => {
        toggleBtn.click();
      });
      assert.equal(document.querySelectorAll('.mdstudio-tooltip').length, 0, 'tooltip hides when disabled');
      // Re-enable without hovering again -> must NOT spontaneously pop up stale tooltip
      await act(async () => {
        toggleBtn.click();
      });
      assert.equal(
        document.querySelectorAll('.mdstudio-tooltip').length,
        0,
        're-enabling tooltip target after disabled flip does not show stale ghost tooltip',
      );
    }
  } finally {
    (globalThis as { ReactDOM?: unknown }).ReactDOM = prevGlobalDom;
    win.HTMLElement.prototype.getBoundingClientRect = origRect;
    Object.defineProperty(win, 'innerWidth', { value: origInnerWidth, configurable: true });
    Object.defineProperty(win, 'innerHeight', { value: origInnerHeight, configurable: true });
    await act(async () => {
      root?.unmount();
    });
    container.remove();
  }
  console.log('ok - FallbackMenu/FallbackTooltip/FallbackModal/FallbackToast portal escape and vertical flip clamping');
}

// 9. Safe focus visibility & minimal CodeMirror text diff
{
  const scope = document.createElement('div');
  const hiddenWrap = document.createElement('div');
  hiddenWrap.style.display = 'none';
  const hiddenBtn = document.createElement('button');
  hiddenBtn.className = 'hidden-trigger';
  hiddenWrap.appendChild(hiddenBtn);
  const visibleBtn = document.createElement('button');
  visibleBtn.className = 'visible-trigger';
  const disabledBtn = document.createElement('button');
  disabledBtn.disabled = true;
  const menuItem = document.createElement('button');
  menuItem.setAttribute('role', 'menuitem');
  scope.append(hiddenWrap, visibleBtn, disabledBtn, menuItem);
  document.body.appendChild(scope);
  try {
    assert.equal(isElementVisible(null), false);
    assert.equal(isElementVisible(document.body), false, 'document.body is never a valid interactive focus target');
    assert.equal(isElementVisible(document.documentElement), false, 'documentElement is never a valid focus target');
    assert.equal(isElementVisible(hiddenBtn), false, 'element inside display:none ancestor is not visible');
    assert.equal(isElementVisible(disabledBtn), false, 'disabled button is not focusable visible');
    assert.equal(isElementVisible(visibleBtn), true);
    assert.equal(
      resolveSafeFocusTarget(document.body, scope, ['.hidden-trigger', '.visible-trigger']),
      visibleBtn,
      'falls back past document.body and hidden triggers to first visible target',
    );
    assert.equal(
      resolveSafeFocusTarget(menuItem, scope, ['.visible-trigger']),
      visibleBtn,
      'menu items resolve to visible fallback trigger',
    );
    assert.equal(resolveSafeFocusTarget(visibleBtn, scope, []), visibleBtn, 'visible preferred target is kept');
  } finally {
    scope.remove();
  }

  assert.equal(computeMinimalChange('same', 'same'), null, 'identical text emits no change');
  assert.deepEqual(
    computeMinimalChange('line1\nline2\n\n', 'line1\nline2'),
    { from: 11, to: 13, insert: '' },
    'trailing trim produces minimal suffix deletion',
  );
  assert.deepEqual(
    computeMinimalChange('  hello world', 'hello world'),
    { from: 0, to: 2, insert: '' },
    'leading trim produces minimal prefix deletion',
  );
  assert.deepEqual(
    computeMinimalChange('alpha beta gamma', 'alpha BETA gamma'),
    { from: 6, to: 10, insert: 'BETA' },
    'mid-string replacement isolates changed slice',
  );
  console.log('ok - safe visible focus resolution and CodeMirror minimal text diff');
}

// 10. G8 regressions: FallbackModal drag-out scrim guard & FallbackMenuPanel Tab trap
{
  const bridge = createDshBridge(React, null);
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root | null = null;
  let modalCloses = 0;
  let menuOpen = true;
  let triggerFocused = false;

  function TrapHarness() {
    const [open, setOpen] = React.useState(true);
    return h(
      bridge.Modal,
      {
        open: true,
        title: 'Drag Guard',
        closeLabel: 'Close',
        onClose: () => {
          modalCloses++;
        },
      },
      h(
        'div',
        null,
        h('input', { id: 'modal-draft-input', defaultValue: 'keep me' }),
        h(bridge.Menu, {
          open,
          ariaLabel: 'More',
          items: [{ id: 'a', label: 'Action A' }],
          onSelect: () => {},
          onClose: () => {
            menuOpen = false;
            setOpen(false);
          },
          anchor: h(
            'button',
            {
              id: 'modal-menu-trigger',
              type: 'button',
              onFocus: () => {
                triggerFocused = true;
              },
            },
            'Menu',
          ),
        }),
      ),
    );
  }

  await act(async () => {
    root = ReactDOM.createRoot(container);
    root.render(h(TrapHarness));
  });

  const scrim = document.querySelector<HTMLElement>('.mdstudio-modal-scrim')!;
  const input = document.querySelector<HTMLInputElement>('#modal-draft-input')!;
  // Mousedown inside input, mouseup/click on scrim (drag-out text selection) MUST NOT close modal
  await act(async () => {
    input.dispatchEvent(new win.MouseEvent('mousedown', { bubbles: true }));
    scrim.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  });
  assert.equal(modalCloses, 0, 'dragging selection from inside FallbackModal onto scrim does not close modal');

  // Genuine mousedown + click on scrim DOES close modal
  await act(async () => {
    scrim.dispatchEvent(new win.MouseEvent('mousedown', { bubbles: true }));
    scrim.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  });
  assert.equal(modalCloses, 1, 'genuine click starting on scrim closes FallbackModal');

  // Bare synthetic click without preceding mousedown (assistive tech / legacy DOM callers) ALSO closes modal
  await act(async () => {
    scrim.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  });
  assert.equal(modalCloses, 2, 'bare synthetic scrim click without mousedown still closes FallbackModal');

  // Pressing Tab inside FallbackMenuPanel closes menu and restores focus to trigger
  const menuPanel = document.querySelector<HTMLElement>('.mdstudio-menu')!;
  await act(async () => {
    menuPanel.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 25));
  });
  assert.equal(menuOpen, false, 'Tab closes FallbackMenuPanel');
  assert.equal(triggerFocused, true, 'Tab restores focus to FallbackMenuPanel trigger inside modal');

  await act(async () => {
    root?.unmount();
  });
  container.remove();

  // G6 regression: FallbackMenu ArrowUp from container focuses last item & FallbackTooltip supports side="right"
  const navContainer = document.createElement('div');
  document.body.appendChild(navContainer);
  let navRoot: Root | null = null;
  await act(async () => {
    navRoot = ReactDOM.createRoot(navContainer);
    navRoot.render(
      h(
        React.Fragment,
        null,
        h(bridge.Menu, {
          open: true,
          autoFocus: false,
          ariaLabel: 'Actions',
          items: [
            { id: 'one', label: 'One' },
            { id: 'two', label: 'Two' },
            { id: 'three', label: 'Three' },
          ],
          onSelect: () => {},
          onClose: () => {},
          anchor: h('button', { type: 'button' }, 'Open'),
        }),
        h(bridge.Tooltip, {
          label: 'Right tip',
          side: 'right',
          children: h('button', { type: 'button', id: 'right-tip-btn' }, 'Hover'),
        }),
      ),
    );
  });
  const navMenu = document.querySelector<HTMLElement>('.mdstudio-menu')!;
  navMenu.tabIndex = -1;
  navMenu.focus();
  await act(async () => {
    navMenu.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
  });
  const navItems = Array.from(navMenu.querySelectorAll<HTMLElement>('[role="menuitem"]'));
  assert.equal(document.activeElement, navItems[2], 'ArrowUp from menu container focuses last menuitem');
  const rightBtn = document.getElementById('right-tip-btn')!;
  await act(async () => {
    rightBtn.dispatchEvent(new win.MouseEvent('mouseover', { bubbles: true }));
    rightBtn.dispatchEvent(new win.MouseEvent('mouseenter', { bubbles: false }));
  });
  await act(async () => {
    navRoot?.unmount();
  });
  navContainer.remove();
  console.log('ok - FallbackModal drag-out scrim guard, FallbackMenu ArrowUp/Tab, and right-side Tooltip');
}

win.close();

import type * as ReactNamespace from 'react';
import type { ReactNode } from 'react';

export interface BrandMarkProps {
  React: typeof ReactNamespace;
  size?: number;
}

export interface SidebarPanelIconProps {
  React: typeof ReactNamespace;
  size?: number;
  active?: boolean;
}

/**
 * Header brand tile drawn on a crisp 26x26 pixel grid using DSH surface tokens.
 */
export function BrandMark(props: BrandMarkProps): ReactNode {
  const h = props.React.createElement;
  const size = props.size || 26;
  return h(
    'svg',
    {
      width: size,
      height: size,
      viewBox: '0 0 26 26',
      fill: 'none',
      'aria-hidden': 'true',
    },
    h('rect', {
      x: 1.5,
      y: 1.5,
      width: 23,
      height: 23,
      rx: 6,
      fill: 'var(--mdstudio-ui-bg-2, #fbfaf7)',
      stroke: 'var(--mdstudio-ui-border-3, #ddd7cb)',
      strokeWidth: 1,
    }),
    h('path', {
      d: 'M7 18V9.2c0-.7.5-1.2 1.2-1.2l3.8 3.8 1 1 1-1L17.8 8c.7 0 1.2.5 1.2 1.2V18',
      fill: 'none',
      stroke: 'var(--mdstudio-ui-fg-1, #1d1d1f)',
      strokeWidth: 1.75,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    }),
  );
}

/**
 * Monochrome `currentColor` 16x16 outline glyph for DSH's `sidebar.panellist`
 * slot, matching `PluginsPanelIcon` and `TaskManagerIcon` (`1` regular / `1.3` active).
 */
export function SidebarPanelIcon(props: SidebarPanelIconProps): ReactNode {
  const h = props.React.createElement;
  const size = props.size || 16;
  return h(
    'svg',
    {
      width: size,
      height: size,
      viewBox: '0 0 16 16',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: props.active ? 1.3 : 1,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': 'true',
    },
    h('rect', { x: 2, y: 2, width: 12, height: 12, rx: 2.6 }),
    h('path', { d: 'M5 10.8V5.6l3 2.9 3-2.9v5.2' }),
  );
}

import type * as ReactNamespace from 'react';

type IconShape =
  | { readonly tag: 'path'; readonly d: string; readonly strokeWidth?: number }
  | { readonly tag: 'circle'; readonly cx: number; readonly cy: number; readonly r: number; readonly fill?: string }
  | {
      readonly tag: 'rect';
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
      readonly rx?: number;
    };

/**
 * Custom & fallback icon set drawn on DeepSeek Harness's native 16x16 optical grid
 * (`viewBox="0 0 16 16"`, `stroke-width="1"` regular hairline, `rx="1.5"` rounded sheets).
 */
const ICONS: Record<string, readonly IconShape[]> = {
  books: [
    { tag: 'rect', x: 4.5, y: 1.8, width: 9, height: 10.7, rx: 1.5 },
    { tag: 'path', d: 'M6.8 5.2h4.4M6.8 7.8h2.8' },
    { tag: 'path', d: 'M2.5 4.6v7.9a1.8 1.8 0 0 0 1.8 1.8h7.1' },
  ],
  workspaceTree: [
    {
      tag: 'path',
      d: 'M2 4a1.5 1.5 0 0 1 1.5-1.5h2.4c.5 0 .9.2 1.2.6l.5.7c.3.4.7.7 1.2.7h3.7A1.5 1.5 0 0 1 14 6v6a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12z',
    },
    { tag: 'path', d: 'M8.7 8.1v3M11.3 9.1v2' },
  ],
  folder: [
    {
      tag: 'path',
      d: 'M2 4a1.5 1.5 0 0 1 1.5-1.5h2.4c.5 0 .9.2 1.2.6l.5.7c.3.4.7.7 1.2.7h3.7A1.5 1.5 0 0 1 14 6v6a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12z',
    },
  ],
  folderOpen: [
    {
      tag: 'path',
      d: 'M2 12V4a1.5 1.5 0 0 1 1.5-1.5h2.3c.5 0 .9.2 1.2.6l.5.7c.3.4.7.7 1.2.7h3.3A1.5 1.5 0 0 1 13.5 6v1.2',
    },
    { tag: 'path', d: 'M2.3 13.5h10.2l1.8-6.3H4.1z' },
  ],
  fileText: [
    { tag: 'rect', x: 2.5, y: 1.8, width: 11, height: 12.4, rx: 1.5 },
    { tag: 'path', d: 'M5.2 5.8h5.6M5.2 8.8h3.5' },
  ],
  filePlus: [{ tag: 'path', d: 'M8 2.8v10.4M2.8 8h10.4' }],
  fileOutput: [
    { tag: 'path', d: 'M13 6.2V3.3a1.5 1.5 0 0 0-1.5-1.5h-7A1.5 1.5 0 0 0 3 3.3v9.4a1.5 1.5 0 0 0 1.5 1.5h4.2' },
    { tag: 'path', d: 'M5.5 5.5h4.5M5.5 8.2h2.5' },
    { tag: 'path', d: 'M9.5 11.2h4.7M12.2 9.2l2 2-2 2' },
  ],
  download: [
    { tag: 'path', d: 'M8 2.2v8.2M5.2 7.8L8 10.6l2.8-2.8' },
    { tag: 'path', d: 'M2.5 10.8v1.7a1.5 1.5 0 0 0 1.5 1.5h8a1.5 1.5 0 0 0 1.5-1.5v-1.7' },
  ],
  fileCode: [
    { tag: 'rect', x: 2.5, y: 1.8, width: 11, height: 12.4, rx: 1.5 },
    { tag: 'path', d: 'M6.6 6.4L4.8 8.2 6.6 10M9.4 6.4l1.8 1.8-1.8 1.8' },
  ],
  fileInput: [
    { tag: 'path', d: 'M8 10.4V2.2M5.2 5L8 2.2 10.8 5' },
    { tag: 'path', d: 'M2.5 10.8v1.7a1.5 1.5 0 0 0 1.5 1.5h8a1.5 1.5 0 0 0 1.5-1.5v-1.7' },
  ],
  save: [
    { tag: 'path', d: 'M2.5 2h8.2l2.8 2.8v8.2a1 1 0 0 1-1 1h-10a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z' },
    { tag: 'path', d: 'M4.8 2v3.6h5.4V2M4.5 14V8.8h7V14' },
  ],
  archive: [
    { tag: 'rect', x: 1.8, y: 2.5, width: 12.4, height: 3, rx: 1 },
    { tag: 'path', d: 'M2.8 5.5v7a1.5 1.5 0 0 0 1.5 1.5h7.4a1.5 1.5 0 0 0 1.5-1.5v-7M6.3 8.5h3.4' },
  ],
  copy: [
    { tag: 'rect', x: 5.5, y: 5.5, width: 8.2, height: 8.2, rx: 1.6 },
    { tag: 'path', d: 'M3.5 10.5H3a1.5 1.5 0 0 1-1.5-1.5V3.5A1.5 1.5 0 0 1 3 2h5.5A1.5 1.5 0 0 1 10 3.5V4' },
  ],
  palette: [
    {
      tag: 'path',
      d: 'M8 1.8a6.2 6.2 0 1 0 0 12.4h.9a1.4 1.4 0 0 0 1.3-2 1.3 1.3 0 0 1 1.2-1.9h.8a2 2 0 0 0 2-2A6.2 6.2 0 0 0 8 1.8z',
    },
    { tag: 'circle', cx: 5.3, cy: 6.3, r: 0.85, fill: 'currentColor' },
    { tag: 'circle', cx: 8, cy: 4.8, r: 0.85, fill: 'currentColor' },
    { tag: 'circle', cx: 10.7, cy: 6.3, r: 0.85, fill: 'currentColor' },
  ],
  sliders: [
    { tag: 'path', d: 'M2.3 5h5.8M12 5h1.7M2.3 11H4M7.8 11h5.9' },
    { tag: 'circle', cx: 10, cy: 5, r: 1.45 },
    { tag: 'circle', cx: 5.8, cy: 11, r: 1.45 },
  ],
  keyboard: [
    { tag: 'rect', x: 1.8, y: 3.5, width: 12.4, height: 9, rx: 1.6 },
    { tag: 'path', d: 'M4.4 6.5h.01M6.8 6.5h.01M9.2 6.5h.01M11.6 6.5h.01M4.4 9h.01M11.6 9h.01M6.2 9.8h3.6' },
  ],
  search: [
    { tag: 'circle', cx: 7.2, cy: 7.2, r: 4.4 },
    { tag: 'path', d: 'M10.5 10.5L13.8 13.8' },
  ],
  listTree: [
    { tag: 'path', d: 'M2.5 3.5h11M6.5 8h7M6.5 12.5h7' },
    { tag: 'path', d: 'M3.5 6v5.3c0 .7.5 1.2 1.2 1.2h.3M3.5 8h1.5' },
  ],
  listBullet: [
    { tag: 'path', d: 'M6 3.5h7.5M6 8h7.5M6 12.5h7.5' },
    { tag: 'circle', cx: 3, cy: 3.5, r: 0.8, fill: 'currentColor' },
    { tag: 'circle', cx: 3, cy: 8, r: 0.8, fill: 'currentColor' },
    { tag: 'circle', cx: 3, cy: 12.5, r: 0.8, fill: 'currentColor' },
  ],
  listOrdered: [
    { tag: 'path', d: 'M6.8 4h6.7M6.8 8h6.7M6.8 12h6.7' },
    { tag: 'path', d: 'M2.6 3.2h1v3.2M2.2 6.4h1.8M2.3 9.8h1.5c.5 0 .8.3.8.7 0 .3-.2.6-.5.7l-1.8 1.4h2.3' },
  ],
  checkSquare: [
    { tag: 'rect', x: 2.3, y: 2.3, width: 11.4, height: 11.4, rx: 1.8 },
    { tag: 'path', d: 'M5.2 8.2l2 2 3.8-3.8' },
  ],
  image: [
    { tag: 'rect', x: 2, y: 2.5, width: 12, height: 11, rx: 1.6 },
    { tag: 'circle', cx: 5.5, cy: 5.8, r: 1 },
    { tag: 'path', d: 'M2.5 11.8l3.2-3.2 2.8 2.8 2-2 3 2.8' },
  ],
  table: [
    { tag: 'rect', x: 2, y: 2.5, width: 12, height: 11, rx: 1.5 },
    { tag: 'path', d: 'M2 6.2h12M2 9.8h12M6.2 6.2v7.3M9.8 6.2v7.3' },
  ],
  link: [
    { tag: 'path', d: 'M6.7 9.3a2.7 2.7 0 0 0 3.8 0l2-2a2.7 2.7 0 0 0-3.8-3.8l-.8.8' },
    { tag: 'path', d: 'M9.3 6.7a2.7 2.7 0 0 0-3.8 0l-2 2a2.7 2.7 0 0 0 3.8 3.8l.8-.8' },
  ],
  bookmarkLink: [
    { tag: 'path', d: 'M4 2.2h6.5a1.5 1.5 0 0 1 1.5 1.5v10.1L8 11.3l-4 2.5V3.7A1.5 1.5 0 0 1 5.5 2.2z' },
    { tag: 'path', d: 'M6.5 5.8h3' },
  ],
  more: [
    { tag: 'circle', cx: 3.5, cy: 8, r: 1, fill: 'currentColor' },
    { tag: 'circle', cx: 8, cy: 8, r: 1, fill: 'currentColor' },
    { tag: 'circle', cx: 12.5, cy: 8, r: 1, fill: 'currentColor' },
  ],
  close: [{ tag: 'path', d: 'M4 4l8 8M12 4l-8 8' }],
  check: [{ tag: 'path', d: 'M3.2 8.3l3.1 3.1 6.5-6.5' }],
  alert: [
    { tag: 'circle', cx: 8, cy: 8, r: 6 },
    { tag: 'path', d: 'M8 5.2v3.3M8 10.8h.01' },
  ],
  info: [
    { tag: 'circle', cx: 8, cy: 8, r: 6 },
    { tag: 'path', d: 'M8 7.2v3.6M8 5.1h.01' },
  ],
  undo: [
    { tag: 'path', d: 'M5.5 3.5L2.5 6.5l3 3' },
    { tag: 'path', d: 'M2.8 6.5h6.7a3.5 3.5 0 0 1 0 7H7.5' },
  ],
  redo: [
    { tag: 'path', d: 'M10.5 3.5l3 3-3 3' },
    { tag: 'path', d: 'M13.2 6.5H6.5a3.5 3.5 0 0 0 0 7h2' },
  ],
  bold: [
    {
      tag: 'path',
      d: 'M4.5 3h4.2a2.4 2.4 0 0 1 0 4.8H4.5V3zM4.5 7.8h4.8a2.6 2.6 0 0 1 0 5.2H4.5V7.8z',
      strokeWidth: 1.35,
    },
  ],
  italic: [{ tag: 'path', d: 'M6.8 3h4.4M4.8 13h4.4M9.2 3L6.8 13' }],
  strikethrough: [
    { tag: 'path', d: 'M2.5 8h11' },
    {
      tag: 'path',
      d: 'M10.8 4.6c-.4-.9-1.4-1.6-2.8-1.6-1.7 0-2.8.9-2.8 2.1 0 1.1.8 1.8 2.4 2.2M5 11.2c.4 1 1.5 1.8 3.1 1.8 1.8 0 3-.9 3-2.2 0-.7-.3-1.3-.9-1.7',
    },
  ],
  underline: [{ tag: 'path', d: 'M4.5 3v4.5a3.5 3.5 0 0 0 7 0V3M3.5 13.2h9' }],
  highlight: [
    { tag: 'path', d: 'M9.8 2.8l3.4 3.4-5.4 5.4H4.4V8.2l5.4-5.4z' },
    { tag: 'path', d: 'M3 13.5h10' },
  ],
  paragraph: [{ tag: 'path', d: 'M11.5 3v10M8.5 3v10M12.5 3H6.8a2.6 2.6 0 0 0 0 5.2h1.7' }],
  split: [
    { tag: 'rect', x: 2, y: 2.5, width: 12, height: 11, rx: 1.6 },
    { tag: 'path', d: 'M8 2.5v11' },
  ],
  pencil: [
    { tag: 'path', d: 'M8.8 2.8H3.8A1.5 1.5 0 0 0 2.3 4.3v8a1.5 1.5 0 0 0 1.5 1.5h8a1.5 1.5 0 0 0 1.5-1.5V7.8' },
    { tag: 'path', d: 'M11.6 2.2a1.4 1.4 0 0 1 2 2L8.2 9.6l-2.5.6.6-2.5z' },
  ],
  eye: [
    { tag: 'path', d: 'M1.6 8s2.4-4.2 6.4-4.2S14.4 8 14.4 8s-2.4 4.2-6.4 4.2S1.6 8 1.6 8z' },
    { tag: 'circle', cx: 8, cy: 8, r: 1.8 },
  ],
  history: [
    { tag: 'circle', cx: 8, cy: 8, r: 5.8 },
    { tag: 'path', d: 'M8 4.8V8l2.2 1.4' },
  ],
  help: [
    { tag: 'circle', cx: 8, cy: 8, r: 5.8 },
    { tag: 'path', d: 'M6.4 6.2a1.7 1.7 0 1 1 2.4 1.5c-.5.3-.8.7-.8 1.2M8 11.2h.01' },
  ],
  trash: [
    {
      tag: 'path',
      d: 'M2.8 4.5h10.4M6.5 7.2v4.2M9.5 7.2v4.2M4.2 4.5l.6 8.5a1 1 0 0 0 1 1h4.4a1 1 0 0 0 1-1l.6-8.5M6 4.5V2.8h4v1.7',
    },
  ],
  code: [{ tag: 'path', d: 'M4.8 4.5L1.8 8l3 3.5M11.2 4.5L14.2 8l-3 3.5M9.3 3.5L6.7 12.5' }],
  codeBlock: [
    { tag: 'rect', x: 2, y: 2.5, width: 12, height: 11, rx: 1.6 },
    { tag: 'path', d: 'M6.4 6L4.6 8l1.8 2M9.6 6l1.8 2-1.8 2' },
  ],
  quote: [{ tag: 'path', d: 'M3.2 5.2h3.3v3.3H4.6c0 1.4.7 2.1 2 2.3M9.5 5.2h3.3v3.3h-1.9c0 1.4.7 2.1 2 2.3' }],
  minus: [{ tag: 'path', d: 'M2.8 8h10.4' }],
  sparkles: [
    {
      tag: 'path',
      d: 'M8 2l1 3.2L12.2 6.2 9 7.2 8 10.4 7 7.2 3.8 6.2 7 5.2zM12.3 10.2l.5 1.5 1.5.5-1.5.5-.5 1.5-.5-1.5-1.5-.5 1.5-.5z',
    },
  ],
  sigma: [{ tag: 'path', d: 'M12 3.2H4.2L8.6 8l-4.4 4.8H12' }],
  mathBlock: [
    { tag: 'rect', x: 2, y: 2.5, width: 12, height: 11, rx: 1.6 },
    { tag: 'path', d: 'M10.2 5.2H5.8L8.3 8l-2.5 2.8h4.4' },
  ],
  refresh: [
    {
      tag: 'path',
      d: 'M13.5 7.2A5.6 5.6 0 0 0 3.4 4.5M2.8 2.5v2.8h2.8M2.5 8.8a5.6 5.6 0 0 0 10.1 2.7M13.2 13.5v-2.8h-2.8',
    },
  ],
  scrollSync: [{ tag: 'path', d: 'M5.2 12.8V3.2M3.2 5.2l2-2 2 2M10.8 3.2v9.6M8.8 10.8l2 2 2-2' }],
  scrollY: [
    { tag: 'rect', x: 2.2, y: 2, width: 11.6, height: 12, rx: 1.6 },
    { tag: 'path', d: 'M8 4.6v6.8M6.2 6.4L8 4.6l1.8 1.8M6.2 9.6L8 11.4l1.8-1.8' },
  ],
  scrollX: [
    { tag: 'rect', x: 2, y: 2.5, width: 12, height: 11, rx: 1.6 },
    { tag: 'path', d: 'M4.6 8h6.8M6.4 6.2L4.6 8l1.8 1.8M9.6 6.2L11.4 8l-1.8 1.8' },
  ],
  focus: [{ tag: 'path', d: 'M9.6 2h4.4v4.4M14 2L9.4 6.6M6.4 14H2V9.6M2 14l4.6-4.6' }],
  collapse: [{ tag: 'path', d: 'M9.4 2.4v4.2h4.2M13.8 2.2L9.4 6.6M6.6 13.6V9.4H2.4M2.2 13.8l4.4-4.4' }],
  chevronDown: [{ tag: 'path', d: 'M4 6l4 4 4-4' }],
  chevronRight: [{ tag: 'path', d: 'M6 4l4 4-4 4' }],
  arrowLeft: [{ tag: 'path', d: 'M13.2 8H2.8M6.5 4.2L2.8 8l3.7 3.8' }],
  dragHandle: [{ tag: 'path', d: 'M4 5h8M4 8h8M4 11h8' }],
  cloudCheck: [
    { tag: 'path', d: 'M4.6 12.2a2.7 2.7 0 0 1-.2-5.4A3.7 3.7 0 0 1 11.4 7.8a2.4 2.4 0 0 1-.2 4.4z' },
    { tag: 'path', d: 'M6 9.2l1.4 1.4 2.8-2.8' },
  ],
} as const;

export type IconName =
  | 'books'
  | 'workspaceTree'
  | 'folder'
  | 'folderOpen'
  | 'fileText'
  | 'filePlus'
  | 'fileOutput'
  | 'download'
  | 'fileCode'
  | 'fileInput'
  | 'save'
  | 'archive'
  | 'copy'
  | 'palette'
  | 'sliders'
  | 'keyboard'
  | 'search'
  | 'listTree'
  | 'listBullet'
  | 'listOrdered'
  | 'checkSquare'
  | 'image'
  | 'table'
  | 'link'
  | 'bookmarkLink'
  | 'more'
  | 'close'
  | 'check'
  | 'alert'
  | 'info'
  | 'undo'
  | 'redo'
  | 'bold'
  | 'italic'
  | 'strikethrough'
  | 'underline'
  | 'highlight'
  | 'paragraph'
  | 'split'
  | 'pencil'
  | 'eye'
  | 'history'
  | 'help'
  | 'trash'
  | 'code'
  | 'codeBlock'
  | 'quote'
  | 'minus'
  | 'sparkles'
  | 'sigma'
  | 'mathBlock'
  | 'refresh'
  | 'scrollSync'
  | 'scrollY'
  | 'scrollX'
  | 'focus'
  | 'collapse'
  | 'chevronDown'
  | 'chevronRight'
  | 'arrowLeft'
  | 'dragHandle'
  | 'cloudCheck';

interface IconProps {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
}

export function createIcon(React: typeof ReactNamespace) {
  const h = React.createElement;

  function Icon(props: IconProps) {
    const size = props.size || 16;
    const shapes = ICONS[props.name];
    return h(
      'svg',
      {
        width: size,
        height: size,
        viewBox: '0 0 16 16',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: props.strokeWidth || 1,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': 'true',
        className: 'mdstudio-icon' + (props.className ? ' ' + props.className : ''),
      },
      shapes.map(function (shape, index) {
        if (shape.tag === 'path') {
          return h('path', { key: index, d: shape.d, strokeWidth: shape.strokeWidth });
        }
        if (shape.tag === 'circle') {
          return h('circle', {
            key: index,
            cx: shape.cx,
            cy: shape.cy,
            r: shape.r,
            fill: shape.fill || 'none',
            stroke: shape.fill ? 'none' : undefined,
          });
        }
        return h('rect', {
          key: index,
          x: shape.x,
          y: shape.y,
          width: shape.width,
          height: shape.height,
          rx: shape.rx,
        });
      }),
    );
  }

  return Icon;
}

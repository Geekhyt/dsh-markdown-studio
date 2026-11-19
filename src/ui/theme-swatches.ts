import type * as ReactNamespace from 'react';
import type { ReactNode } from 'react';
import { extractCustomThemePreview } from '../domain/custom-themes';

export interface ThemeSwatchSpec {
  bg: string;
  fg: string;
  line: string;
  border?: string;
  head: 'bar' | 'gallery' | 'index' | 'pill' | 'chip' | 'bracket' | 'badge' | 'stub';
  body: 'lines' | 'gallery' | 'code' | 'card' | 'seal' | 'brief' | 'pop';
}

export const THEME_SWATCH: Record<string, ThemeSwatchSpec> = {
  classic: { bg: '#ffffff', fg: '#1f2329', line: '#dfe3e8', head: 'bar', body: 'lines' },
  gallery: { bg: '#f4f3ef', fg: '#141414', line: '#d4d0c5', head: 'gallery', body: 'gallery' },
  tech: { bg: '#ffffff', fg: '#0f172a', line: '#d8dee4', head: 'index', body: 'code' },
  warm: { bg: '#faf7ef', fg: '#24332a', line: '#dcd4bf', head: 'pill', body: 'card' },
  night: {
    bg: '#16171b',
    fg: '#f3eee4',
    line: '#2d2e35',
    border: 'rgba(255, 255, 255, 0.12)',
    head: 'chip',
    body: 'lines',
  },
  ink: { bg: '#f5f9f8', fg: '#17272a', line: '#c8dcdc', head: 'bracket', body: 'seal' },
  ruby: { bg: '#ffffff', fg: '#14171c', line: '#e5e7eb', head: 'badge', body: 'brief' },
  poster: { bg: '#ffffff', fg: '#18181b', line: '#e4e4e7', head: 'stub', body: 'pop' },
};

export const ACCENT_PRESETS: string[] = [
  '#c01b1b',
  '#ae3a0b',
  '#c2410c',
  '#e3b25c',
  '#27694c',
  '#146c78',
  '#3d57e6',
  '#6d28d9',
  '#db2777',
  '#18181b',
];

type CreateEl = typeof ReactNamespace.createElement;

const HEAD_RENDERERS: Record<
  ThemeSwatchSpec['head'],
  (h: CreateEl, spec: ThemeSwatchSpec, accent: string) => ReactNode
> = {
  bar: (h, spec, accent) =>
    h(
      'span',
      { className: 'mdstudio-swatch-row' },
      h('span', { className: 'mdstudio-swatch-vbar', style: { backgroundColor: accent } }),
      h('span', { className: 'mdstudio-swatch-hbar', style: { backgroundColor: spec.fg, width: '48%' } }),
    ),
  gallery: (h, spec, accent) =>
    h(
      'span',
      {
        className: 'mdstudio-swatch-row',
        style: { borderTop: '1.5px solid ' + spec.fg, paddingTop: '3px' },
      },
      h('span', { className: 'mdstudio-swatch-badge', style: { backgroundColor: spec.fg, borderRadius: '1.5px' } }),
      h('span', { className: 'mdstudio-swatch-hbar', style: { backgroundColor: spec.fg, width: '44%' } }),
      h('span', {
        className: 'mdstudio-swatch-seal',
        style: { backgroundColor: accent, marginLeft: 'auto', borderRadius: '1px' },
      }),
    ),
  index: (h, spec, accent) =>
    h(
      'span',
      { className: 'mdstudio-swatch-row' },
      h('span', {
        className: 'mdstudio-swatch-index',
        style: { borderColor: accent, backgroundColor: 'rgba(109, 40, 217, 0.13)' },
      }),
      h('span', { className: 'mdstudio-swatch-hbar', style: { backgroundColor: spec.fg, width: '46%' } }),
    ),
  pill: (h, _spec, accent) =>
    h(
      'span',
      { className: 'mdstudio-swatch-row' },
      h(
        'span',
        { className: 'mdstudio-swatch-pill', style: { backgroundColor: 'rgba(35, 120, 87, 0.14)' } },
        h('span', { className: 'mdstudio-swatch-hbar', style: { backgroundColor: accent, width: '68%' } }),
      ),
    ),
  chip: (h, spec, accent) =>
    h(
      'span',
      { className: 'mdstudio-swatch-row' },
      h(
        'span',
        {
          className: 'mdstudio-swatch-chip',
          style: { borderLeftColor: accent, backgroundColor: 'rgba(245, 158, 11, 0.16)' },
        },
        h('span', { className: 'mdstudio-swatch-hbar', style: { backgroundColor: spec.fg, width: '66%' } }),
      ),
    ),
  bracket: (h, spec, accent) =>
    h(
      'span',
      { className: 'mdstudio-swatch-row' },
      h('span', { className: 'mdstudio-swatch-corner is-tl', style: { borderColor: accent } }),
      h('span', { className: 'mdstudio-swatch-hbar', style: { backgroundColor: spec.fg, width: '40%' } }),
      h('span', { className: 'mdstudio-swatch-corner is-br', style: { borderColor: accent } }),
    ),
  badge: (h, spec, accent) =>
    h(
      'span',
      { className: 'mdstudio-swatch-row' },
      h('span', { className: 'mdstudio-swatch-badge', style: { backgroundColor: accent } }),
      h('span', { className: 'mdstudio-swatch-hbar', style: { backgroundColor: spec.fg, width: '46%' } }),
    ),
  stub: (h, spec, accent) =>
    h(
      'span',
      { className: 'mdstudio-swatch-row' },
      h('span', { className: 'mdstudio-swatch-stub', style: { backgroundColor: accent } }),
      h('span', {
        className: 'mdstudio-swatch-hbar',
        style: { backgroundColor: spec.fg, width: '50%', height: '4.5px' },
      }),
    ),
};

const BODY_RENDERERS: Record<
  ThemeSwatchSpec['body'],
  (h: CreateEl, spec: ThemeSwatchSpec, accent: string) => ReactNode
> = {
  lines: (h, spec) =>
    h(
      'span',
      { className: 'mdstudio-swatch-lines' },
      h('span', { className: 'mdstudio-theme-swatch-line', style: { backgroundColor: spec.line, width: '88%' } }),
      h('span', { className: 'mdstudio-theme-swatch-line', style: { backgroundColor: spec.line, width: '64%' } }),
    ),
  gallery: (h, spec, accent) =>
    h(
      'span',
      { className: 'mdstudio-swatch-lines' },
      h('span', { className: 'mdstudio-theme-swatch-line', style: { backgroundColor: spec.line, width: '86%' } }),
      h('span', {
        className: 'mdstudio-theme-swatch-line',
        style: { backgroundColor: spec.line, width: '72%', borderLeft: '14px solid ' + accent, borderRadius: '0' },
      }),
    ),
  code: (h) =>
    h(
      'span',
      { className: 'mdstudio-swatch-code' },
      h('span', { className: 'mdstudio-swatch-token', style: { backgroundColor: '#c4b5fd', width: '26%' } }),
      h('span', { className: 'mdstudio-swatch-token', style: { backgroundColor: '#79c0ff', width: '44%' } }),
    ),
  card: (h, spec, accent) =>
    h(
      'span',
      { className: 'mdstudio-swatch-card', style: { backgroundColor: '#eaf4ee', borderLeftColor: accent } },
      h('span', { className: 'mdstudio-theme-swatch-line', style: { backgroundColor: spec.line, width: '78%' } }),
    ),
  seal: (h, spec, accent) =>
    h(
      'span',
      { className: 'mdstudio-swatch-lines' },
      h('span', { className: 'mdstudio-theme-swatch-line', style: { backgroundColor: spec.line, width: '84%' } }),
      h(
        'span',
        { className: 'mdstudio-swatch-seal-row' },
        h('span', { className: 'mdstudio-theme-swatch-line', style: { backgroundColor: spec.line, width: '54%' } }),
        h('span', { className: 'mdstudio-swatch-seal', style: { backgroundColor: accent } }),
      ),
    ),
  brief: (h, spec, accent) =>
    h(
      'span',
      { className: 'mdstudio-swatch-brief', style: { borderTopColor: accent, backgroundColor: '#fdf2f4' } },
      h('span', { className: 'mdstudio-theme-swatch-line', style: { backgroundColor: spec.line, width: '74%' } }),
    ),
  pop: (h) =>
    h(
      'span',
      { className: 'mdstudio-swatch-pop' },
      h('span', {
        className: 'mdstudio-theme-swatch-line',
        style: { backgroundColor: '#713f12', width: '68%', opacity: 0.45 },
      }),
    ),
};

export function renderThemeSwatch(React: typeof ReactNamespace, themeId: string, defaultAccent: string): ReactNode {
  const h = React.createElement;
  const spec = THEME_SWATCH[themeId] || THEME_SWATCH.classic;
  return h(
    'span',
    {
      className: 'mdstudio-theme-swatch',
      'aria-hidden': true,
      style: { backgroundColor: spec.bg, borderColor: spec.border },
    },
    HEAD_RENDERERS[spec.head](h, spec, defaultAccent),
    BODY_RENDERERS[spec.body](h, spec, defaultAccent),
  );
}

export function renderCustomThemeSwatch(React: typeof ReactNamespace, css: string, fallbackAccent: string): ReactNode {
  const h = React.createElement;
  const p = extractCustomThemePreview(css, fallbackAccent);
  return h(
    'span',
    {
      className: 'mdstudio-theme-swatch',
      'aria-hidden': true,
      style: { backgroundColor: p.bg, borderColor: p.border },
    },
    h(
      'span',
      { className: 'mdstudio-swatch-row' },
      h('span', { className: 'mdstudio-swatch-vbar', style: { backgroundColor: p.accent } }),
      h('span', { className: 'mdstudio-swatch-hbar', style: { backgroundColor: p.fg, width: '46%' } }),
      h('span', { className: 'mdstudio-swatch-custom-dot', style: { borderColor: p.accent } }),
    ),
    h(
      'span',
      { className: 'mdstudio-swatch-lines' },
      h('span', { className: 'mdstudio-theme-swatch-line', style: { backgroundColor: p.line, width: '86%' } }),
      h('span', { className: 'mdstudio-theme-swatch-line', style: { backgroundColor: p.line, width: '60%' } }),
    ),
  );
}

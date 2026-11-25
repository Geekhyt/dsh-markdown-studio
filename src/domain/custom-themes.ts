import { isDark, mix } from '../theme-system/color';
import { isRootThemeSelector, parseCssRules } from './custom-css';

export const CUSTOM_THEME_PREFIX = 'custom:';
export const MAX_CUSTOM_THEMES = 24;
export const MAX_CUSTOM_CSS_CHARS = 60000;
export const MAX_CUSTOM_NAME_CHARS = 24;

export interface CustomTheme {
  id: string;
  name: string;
  css: string;
}

export interface CustomThemePreview {
  bg: string;
  fg: string;
  accent: string;
  line: string;
  border?: string;
}

export function isCustomThemeId(id: string): boolean {
  return /^custom:[a-z0-9_-]{1,40}$/i.test(id);
}

export function createCustomThemeId(): string {
  return CUSTOM_THEME_PREFIX + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
}

function nextFallbackCustomId(index: number, used: Set<string>): string {
  for (let n = index + 1; ; n++) {
    const candidate = CUSTOM_THEME_PREFIX + 'theme-' + n;
    if (!used.has(candidate)) return candidate;
  }
}

function normalizeCustomId(raw: unknown, index: number, reserved: Set<string>, seen: Set<string>): string {
  if (typeof raw === 'string' && isCustomThemeId(raw)) return raw;
  const slug =
    typeof raw === 'string'
      ? raw
          .replace(/^custom:/i, '')
          .replace(/[^a-z0-9_-]+/gi, '')
          .slice(0, 32)
      : '';
  if (slug) {
    const candidate = CUSTOM_THEME_PREFIX + slug;
    if (!reserved.has(candidate) && !seen.has(candidate)) return candidate;
  }
  const used = new Set<string>([...reserved, ...seen]);
  return nextFallbackCustomId(index, used);
}

function parseEntry(raw: unknown, index: number, reserved: Set<string>, seen: Set<string>): CustomTheme | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const css = typeof record.css === 'string' ? record.css.slice(0, MAX_CUSTOM_CSS_CHARS) : '';
  if (!css.trim()) return null;
  const rawName = typeof record.name === 'string' ? record.name.trim().slice(0, MAX_CUSTOM_NAME_CHARS) : '';
  return {
    id: normalizeCustomId(record.id, index, reserved, seen),
    name: rawName || '自定义主题 ' + (index + 1),
    css,
  };
}

export function sanitizeCustomThemes(input: unknown): CustomTheme[] {
  if (!Array.isArray(input)) return [];
  const reserved = new Set<string>();
  for (const raw of input) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const id = (raw as Record<string, unknown>).id;
    if (typeof id === 'string' && isCustomThemeId(id)) reserved.add(id);
  }
  const list: CustomTheme[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < input.length && list.length < MAX_CUSTOM_THEMES; i++) {
    const parsed = parseEntry(input[i], i, reserved, seen);
    if (parsed && !seen.has(parsed.id)) {
      seen.add(parsed.id);
      list.push(parsed);
    }
  }
  return list;
}

export function findCustomTheme(themes: readonly CustomTheme[] | undefined, id: string): CustomTheme | null {
  if (!themes || !id) return null;
  return (
    themes.find(function (item) {
      return item.id === id;
    }) || null
  );
}

export function nextCustomThemeName(themes: readonly CustomTheme[] | undefined, baseLabel = '自定义主题'): string {
  const existing = new Set(
    (themes || []).map(function (item) {
      return item.name.trim();
    }),
  );
  for (let n = 1; n <= MAX_CUSTOM_THEMES + 1; n++) {
    const candidate = baseLabel + ' ' + n;
    if (!existing.has(candidate)) return candidate;
  }
  return baseLabel;
}

export function upsertCustomTheme(themes: readonly CustomTheme[] | undefined, entry: CustomTheme): CustomTheme[] {
  const base = themes ? themes.slice() : [];
  const index = base.findIndex(function (item) {
    return item.id === entry.id;
  });
  if (index >= 0) {
    base[index] = entry;
    return base;
  }
  return base.concat(entry).slice(0, MAX_CUSTOM_THEMES);
}

export function removeCustomTheme(themes: readonly CustomTheme[] | undefined, id: string): CustomTheme[] {
  return (themes || []).filter(function (item) {
    return item.id !== id;
  });
}

export function mergeCustomThemes(
  current: readonly CustomTheme[] | undefined,
  incoming: readonly CustomTheme[] | undefined,
): CustomTheme[] {
  let result = current ? current.slice() : [];
  for (const entry of incoming || []) {
    result = upsertCustomTheme(result, entry);
  }
  return result;
}

export function normalizeHexColor(value: string): string {
  const trimmed = String(value || '')
    .trim()
    .toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(trimmed)) return trimmed;
  if (/^#[0-9a-f]{3}$/.test(trimmed)) {
    return '#' + trimmed[1] + trimmed[1] + trimmed[2] + trimmed[2] + trimmed[3] + trimmed[3];
  }
  return '';
}

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function rgbTripleToHex(r: number, g: number, b: number): string {
  return (
    '#' +
    clampByte(r).toString(16).padStart(2, '0') +
    clampByte(g).toString(16).padStart(2, '0') +
    clampByte(b).toString(16).padStart(2, '0')
  );
}

function hslToHex(hDeg: number, sPct: number, lPct: number): string {
  const h = (((hDeg % 360) + 360) % 360) / 360;
  const s = Math.max(0, Math.min(1, sPct / 100));
  const l = Math.max(0, Math.min(1, lPct / 100));
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number): number => {
    const x = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return rgbTripleToHex(channel(h + 1 / 3) * 255, channel(h) * 255, channel(h - 1 / 3) * 255);
}

function parseRgbOrHslHex(value: string): string {
  if (/(?:gradient|url)\s*\(/i.test(value)) return '';
  const rgb = /\brgba?\(\s*([\d.]+%?)[,\s]+([\d.]+%?)[,\s]+([\d.]+%?)(?:\s*[,/]\s*([\d.]+%?))?\s*\)/i.exec(value);
  if (rgb) {
    const alpha = rgb[4] ? (rgb[4].endsWith('%') ? parseFloat(rgb[4]) / 100 : parseFloat(rgb[4])) : 1;
    if (alpha <= 0.1) return '';
    const ch = (raw: string) => (raw.endsWith('%') ? (parseFloat(raw) / 100) * 255 : parseFloat(raw));
    return rgbTripleToHex(ch(rgb[1]), ch(rgb[2]), ch(rgb[3]));
  }
  const hsl = /\bhsla?\(\s*([\d.+-]+)(?:deg)?[,\s]+([\d.]+)%[,\s]+([\d.]+)%(?:\s*[,/]\s*([\d.]+%?))?\s*\)/i.exec(value);
  if (hsl) {
    const alpha = hsl[4] ? (hsl[4].endsWith('%') ? parseFloat(hsl[4]) / 100 : parseFloat(hsl[4])) : 1;
    if (alpha <= 0.1) return '';
    return hslToHex(parseFloat(hsl[1]), parseFloat(hsl[2]), parseFloat(hsl[3]));
  }
  return '';
}

const COMMON_NAMED_HEX: Record<string, string> = {
  black: '#000000',
  white: '#ffffff',
  navy: '#000080',
  midnightblue: '#191970',
  darkslategray: '#2f4f4f',
  darkslategrey: '#2f4f4f',
  dimgray: '#696969',
  dimgrey: '#696969',
  gray: '#808080',
  grey: '#808080',
  darkgray: '#a9a9a9',
  lightgray: '#d3d3d3',
  silver: '#c0c0c0',
  whitesmoke: '#f5f5f5',
  ivory: '#fffff0',
  linen: '#faf0e6',
  beige: '#f5f5dc',
  snow: '#fffafa',
  red: '#ff0000',
  blue: '#0000ff',
  green: '#008000',
  crimson: '#dc143c',
  coral: '#ff7f50',
  teal: '#008080',
  indigo: '#4b0082',
  purple: '#800080',
  orange: '#ffa500',
  gold: '#ffd700',
  royalblue: '#4169e1',
  steelblue: '#4682b4',
  forestgreen: '#228b22',
  maroon: '#800000',
};

function extractSolidHex(value: string): string {
  const raw = String(value || '');
  const outsideParens = raw.replace(/\([^()]*\)/g, ' ').replace(/\([^()]*\)/g, ' ');
  const hex8 = /(?:^|\s)#([0-9a-f]{6})([0-9a-f]{2})(?=$|[\s;!])/i.exec(outsideParens);
  if (hex8 && parseInt(hex8[2], 16) > 25) return normalizeHexColor('#' + hex8[1]);
  const match = /(?:^|\s)(#[0-9a-f]{3}(?:[0-9a-f]{3})?)(?=$|[\s;!])/i.exec(outsideParens);
  if (match) return normalizeHexColor(match[1]);
  const rgbOrHsl = parseRgbOrHslHex(raw);
  if (rgbOrHsl) return rgbOrHsl;
  const word = /(?:^|\s)([a-z]+)(?=$|[\s;!])/i.exec(outsideParens);
  return word ? COMMON_NAMED_HEX[word[1].toLowerCase()] || '' : '';
}

function resolveSimpleCssVar(value: string, vars: Record<string, string>, depth = 0): string {
  if (depth > 6 || !value.includes('var(')) return value;
  return value.replace(/var\(\s*(--[^\s,)]+)(?:\s*,\s*([^)]+))?\s*\)/gi, (_, name: string, fallback?: string) => {
    const raw = Object.hasOwn(vars, name) ? vars[name] : '';
    if (raw) return resolveSimpleCssVar(raw, vars, depth + 1);
    return fallback ? resolveSimpleCssVar(fallback.trim(), vars, depth + 1) : '';
  });
}

const PREVIEW_VAR_NAMES = new Set(['--mdstudio-bg', '--mdstudio-accent', '--mdstudio-heading', '--mdstudio-text']);

function collectThemeColorTokens(
  rules: ReturnType<typeof parseCssRules>,
  rawVarDefs: Record<string, string>,
): {
  rootVars: Record<string, string>;
  anyVars: Record<string, string>;
  rootBg: string;
  rootColor: string;
  anchorColor: string;
} {
  const rootVars: Record<string, string> = {};
  const anyVars: Record<string, string> = {};
  let rootBg = '';
  let rootColor = '';
  let anchorColor = '';
  for (const rule of rules) {
    const isRoot = rule.selectors.some(isRootThemeSelector);
    const isAnchor = !isRoot && rule.selectors.some((sel) => /(?:^|[\s>+~])a(?:$|[\s.:#[>+~])/i.test(sel.trim()));
    for (const decl of rule.declarations) {
      const hex = extractSolidHex(resolveSimpleCssVar(decl.value, rawVarDefs));
      if (!hex) continue;
      if (PREVIEW_VAR_NAMES.has(decl.prop)) {
        (isRoot ? rootVars : anyVars)[decl.prop] = hex;
      } else if (isRoot && (decl.prop === 'background-color' || decl.prop === 'background')) rootBg = hex;
      else if (isRoot && decl.prop === 'color') rootColor = hex;
      else if (isAnchor && decl.prop === 'color' && !anchorColor) anchorColor = hex;
    }
  }
  return { rootVars, anyVars, rootBg, rootColor, anchorColor };
}

export function extractCustomThemePreview(css: string, fallbackAccent = '#3d57e6'): CustomThemePreview {
  const rules = parseCssRules(css);
  const rawVarDefs: Record<string, string> = {};
  for (const rule of rules) {
    for (const decl of rule.declarations) {
      if (decl.prop.startsWith('--')) rawVarDefs[decl.prop] = decl.value;
    }
  }
  const { rootVars, anyVars, rootBg, rootColor, anchorColor } = collectThemeColorTokens(rules, rawVarDefs);
  const pickVar = (name: string): string => rootVars[name] || anyVars[name] || '';
  const bg = pickVar('--mdstudio-bg') || rootBg || '#ffffff';
  const accent = pickVar('--mdstudio-accent') || anchorColor || normalizeHexColor(fallbackAccent) || '#3d57e6';
  const dark = isDark(bg);
  const fg = pickVar('--mdstudio-heading') || pickVar('--mdstudio-text') || rootColor || (dark ? '#f3f4f6' : '#1f2328');
  return {
    bg,
    fg,
    accent,
    line: mix(fg, bg, dark ? 0.78 : 0.86),
    ...(dark ? { border: 'rgba(255, 255, 255, 0.14)' } : {}),
  };
}

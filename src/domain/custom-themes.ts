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

function extractSolidHex(value: string): string {
  // Remove parenthesized functions (e.g. `linear-gradient(...)`, `url(...)`) so gradient stops aren't mistaken for solid bg.
  const outsideParens = String(value || '')
    .replace(/\([^()]*\)/g, ' ')
    .replace(/\([^()]*\)/g, ' ');
  const match = /(?:^|\s)(#[0-9a-f]{3}(?:[0-9a-f]{3})?)(?=$|[\s;!])/i.exec(outsideParens);
  return match ? normalizeHexColor(match[1]) : '';
}

export function extractCustomThemePreview(css: string, fallbackAccent = '#3d57e6'): CustomThemePreview {
  const rules = parseCssRules(css);
  let varBg = '';
  let varAccent = '';
  let varHeading = '';
  let varText = '';
  let rootBg = '';
  let rootColor = '';
  for (const rule of rules) {
    const isRoot = rule.selectors.some(isRootThemeSelector);
    for (const decl of rule.declarations) {
      const hex = extractSolidHex(decl.value);
      if (!hex) continue;
      if (decl.prop === '--mdstudio-bg') varBg = hex;
      else if (decl.prop === '--mdstudio-accent') varAccent = hex;
      else if (decl.prop === '--mdstudio-heading') varHeading = hex;
      else if (decl.prop === '--mdstudio-text') varText = hex;
      else if (isRoot && (decl.prop === 'background-color' || decl.prop === 'background')) rootBg = hex;
      else if (isRoot && decl.prop === 'color') rootColor = hex;
    }
  }
  const bg = varBg || rootBg || '#ffffff';
  const accent = varAccent || normalizeHexColor(fallbackAccent) || '#3d57e6';
  const dark = isDark(bg);
  const fg = varHeading || varText || rootColor || (dark ? '#f3f4f6' : '#1f2328');
  return {
    bg,
    fg,
    accent,
    line: mix(fg, bg, dark ? 0.78 : 0.86),
    ...(dark ? { border: 'rgba(255, 255, 255, 0.14)' } : {}),
  };
}

import { isDark, mix } from '../theme-system/color';

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

function normalizeCustomId(raw: unknown, index: number): string {
  if (typeof raw === 'string' && isCustomThemeId(raw)) return raw;
  const slug =
    typeof raw === 'string'
      ? raw
          .replace(/^custom:/i, '')
          .replace(/[^a-z0-9_-]+/gi, '')
          .slice(0, 32)
      : '';
  return CUSTOM_THEME_PREFIX + (slug || 'theme-' + (index + 1));
}

function parseEntry(raw: unknown, index: number): CustomTheme | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const css = typeof record.css === 'string' ? record.css.slice(0, MAX_CUSTOM_CSS_CHARS) : '';
  if (!css.trim()) return null;
  const rawName = typeof record.name === 'string' ? record.name.trim().slice(0, MAX_CUSTOM_NAME_CHARS) : '';
  return {
    id: normalizeCustomId(record.id, index),
    name: rawName || '自定义主题 ' + (index + 1),
    css,
  };
}

export function sanitizeCustomThemes(input: unknown): CustomTheme[] {
  if (!Array.isArray(input)) return [];
  const list: CustomTheme[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < input.length && list.length < MAX_CUSTOM_THEMES; i++) {
    const parsed = parseEntry(input[i], i);
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

function lastCssHex(cleanCss: string, variableName: string): string {
  const pattern = new RegExp(variableName + '\\s*:\\s*(#[0-9a-f]{3}(?:[0-9a-f]{3})?)\\b', 'gi');
  let found = '';
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(cleanCss))) {
    found = normalizeHexColor(match[1]) || found;
  }
  return found;
}

function rootPropertyHex(cleanCss: string, prop: string): string {
  const rootMatch = /(?:#mdstudio|\.mdstudio-content)\s*\{([^}]*)\}/i.exec(cleanCss);
  if (!rootMatch) return '';
  const propMatch = new RegExp(`(?:^|;|\\s)${prop}\\s*:\\s*(#[0-9a-fA-F]{3,6})\\b`).exec(rootMatch[1]);
  return propMatch ? normalizeHexColor(propMatch[1]) : '';
}

export function extractCustomThemePreview(css: string, fallbackAccent = '#3d57e6'): CustomThemePreview {
  const clean = String(css || '').replace(/\/\*[\s\S]*?\*\//g, '');
  const bg = lastCssHex(clean, '--mdstudio-bg') || rootPropertyHex(clean, 'background-color') || '#ffffff';
  const accent = lastCssHex(clean, '--mdstudio-accent') || normalizeHexColor(fallbackAccent) || '#3d57e6';
  const dark = isDark(bg);
  const fg =
    lastCssHex(clean, '--mdstudio-heading') ||
    lastCssHex(clean, '--mdstudio-text') ||
    rootPropertyHex(clean, 'color') ||
    (dark ? '#f3f4f6' : '#1f2328');
  return {
    bg,
    fg,
    accent,
    line: mix(fg, bg, dark ? 0.78 : 0.86),
    ...(dark ? { border: 'rgba(255, 255, 255, 0.14)' } : {}),
  };
}

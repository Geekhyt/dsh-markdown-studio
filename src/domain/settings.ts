import { CODE_THEMES } from '../code-themes';
import * as themes from '../themes';
import { type CustomTheme, extractCustomThemePreview, findCustomTheme, sanitizeCustomThemes } from './custom-themes';

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function isValidHex6(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
}

function resolveThemeSelection(
  rawTheme: string,
  rawAccent: unknown,
  customThemes: readonly CustomTheme[],
): { theme: string; accent: string } {
  const custom = findCustomTheme(customThemes, rawTheme);
  if (custom) {
    const accent = isValidHex6(rawAccent) ? rawAccent : extractCustomThemePreview(custom.css).accent;
    return { theme: custom.id, accent };
  }
  const theme = themes.isBuiltinThemeId(rawTheme) ? rawTheme : themes.DEFAULT_SETTINGS.theme;
  const accent = isValidHex6(rawAccent) ? rawAccent : themes.getTheme(theme).defaultAccent;
  return { theme, accent };
}

function parseNumeric(raw: unknown, fallback: number): number {
  if (typeof raw === 'number' || typeof raw === 'string') return Number(raw) || fallback;
  return fallback;
}

/**
 * `allowExternalCssResources` is intentionally NOT read from persisted or imported data:
 * there is no UI to grant it, so honouring it from theme JSON / library backups would let an
 * untrusted file silently enable remote `url(...)` beacons in the preview. It stays a
 * programmatic opt-in on `ThemeSettings` for `buildCss` callers only.
 */
function applyBooleanFlags(target: Partial<themes.ThemeSettings>, source: Record<string, unknown>): void {
  if (typeof source.linkFootnotes === 'boolean') target.linkFootnotes = source.linkFootnotes;
  if (typeof source.imagePlaceholders === 'boolean') target.imagePlaceholders = source.imagePlaceholders;
  if (typeof source.codeNbsp === 'boolean') target.codeNbsp = source.codeNbsp;
}

export function sanitizeSettings(input: unknown): themes.ThemeSettings {
  const source = asRecord(input) || {};
  const customThemes = sanitizeCustomThemes(source.customThemes);
  const rawTheme = typeof source.theme === 'string' ? source.theme : '';
  const selected = resolveThemeSelection(rawTheme, source.accent, customThemes);
  const base: themes.ThemeSettings = {
    ...themes.DEFAULT_SETTINGS,
    customThemes,
    theme: selected.theme,
    accent: selected.accent,
    fontSize: clamp(parseNumeric(source.fontSize, 16), 14, 20),
    lineHeight: clamp(parseNumeric(source.lineHeight, 1.75), 1.4, 2.4),
  };
  if (typeof source.codeTheme === 'string' && CODE_THEMES.some((item) => item.id === source.codeTheme)) {
    base.codeTheme = source.codeTheme;
  }
  applyBooleanFlags(base, source);
  return base;
}

function resolvePatchTheme(rawTheme: unknown, customThemes: readonly CustomTheme[] | undefined): string {
  if (typeof rawTheme !== 'string') return '';
  if (findCustomTheme(customThemes, rawTheme)) return rawTheme;
  return themes.isBuiltinThemeId(rawTheme) ? rawTheme : '';
}

/** Parse an imported theme file's optional fields into a settings patch. */
export function parseThemePatch(input: unknown): Partial<themes.ThemeSettings> | null {
  const record = asRecord(input);
  if (!record) return null;
  const sourceValue = asRecord(record.settings) || record;
  const patch: Partial<themes.ThemeSettings> = {};
  if (Array.isArray(sourceValue.customThemes)) {
    patch.customThemes = sanitizeCustomThemes(sourceValue.customThemes);
  }
  const patchTheme = resolvePatchTheme(sourceValue.theme, patch.customThemes);
  if (patchTheme) patch.theme = patchTheme;
  if (typeof sourceValue.codeTheme === 'string' && CODE_THEMES.some((item) => item.id === sourceValue.codeTheme)) {
    patch.codeTheme = sourceValue.codeTheme;
  }
  if (isValidHex6(sourceValue.accent)) patch.accent = sourceValue.accent;
  if (typeof sourceValue.fontSize === 'number' && Number.isFinite(sourceValue.fontSize)) {
    patch.fontSize = clamp(sourceValue.fontSize, 14, 20);
  }
  if (typeof sourceValue.lineHeight === 'number' && Number.isFinite(sourceValue.lineHeight)) {
    patch.lineHeight = clamp(sourceValue.lineHeight, 1.4, 2.4);
  }
  applyBooleanFlags(patch, sourceValue);
  return Object.keys(patch).length ? patch : null;
}

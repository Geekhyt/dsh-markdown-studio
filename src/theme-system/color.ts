/*
 * Colour math for the theme system. Everything here is deterministic and
 * hex-based so the inline engine always receives concrete colour values.
 */

export function parseHex(hex: string): [number, number, number] {
  let value = String(hex || '')
    .replace('#', '')
    .trim();
  if (/^[0-9a-f]{3}$/i.test(value)) {
    value = value
      .split('')
      .map(function (ch) {
        return ch + ch;
      })
      .join('');
  }
  if (!/^[0-9a-f]{6}$/i.test(value)) value = '4d6bfe';
  return [parseInt(value.slice(0, 2), 16), parseInt(value.slice(2, 4), 16), parseInt(value.slice(4, 6), 16)];
}

export const DARK_STAGE_DEFAULT = '#191919';
export const DARK_STAGE_PAPER = '#0e1013';

function toHex(channel: number): string {
  const value = Math.max(0, Math.min(255, Math.round(channel))).toString(16);
  return value.length === 1 ? '0' + value : value;
}

export function rgbToHex(r: number, g: number, b: number): string {
  return '#' + toHex(r) + toHex(g) + toHex(b);
}

/** Move `hex` towards `target` by `amount` (0 = hex, 1 = target). */
export function mix(hex: string, target: string, amount?: number): string {
  const a = parseHex(hex);
  const b = parseHex(target);
  const ratio = Math.max(0, Math.min(1, amount == null ? 0.5 : amount));
  return (
    '#' +
    a
      .map(function (channel, index) {
        return toHex(channel + (b[index] - channel) * ratio);
      })
      .join('')
  );
}

export function rgba(hex: string, alpha: number): string {
  const value = parseHex(hex);
  return 'rgba(' + value[0] + ',' + value[1] + ',' + value[2] + ',' + alpha + ')';
}

/** WCAG relative luminance. */
export function luminance(hex: string): number {
  const channels = parseHex(hex).map(function (channel) {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

export function contrast(a: string, b: string): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

export function isDark(hex: string): boolean {
  return luminance(hex) < 0.2;
}

/**
 * Darken (on light paper) or lighten (on dark paper) a colour until it reaches
 * the requested contrast ratio. Keeps the hue family of user-picked accents
 * while guaranteeing readable text.
 */
export function ensureContrast(color: string, background: string, minimum: number): string {
  const target = readableOn(background, '#000000', '#ffffff');
  let current = color;
  for (let step = 1; step <= 20 && contrast(current, background) < minimum; step++) {
    current = mix(color, target, step * 0.05);
  }
  return current;
}

/** Pick whichever of `dark` / `light` reads better on `background`. */
export function readableOn(background: string, dark: string, light: string): string {
  return contrast(dark, background) >= contrast(light, background) ? dark : light;
}

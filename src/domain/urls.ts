const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
// Browsers ignore ASCII whitespace/control characters inside URL schemes
// (e.g. `java\tscript:`), so schemes are always checked on a stripped probe.
const URL_NOISE = /[\u0000-\u0020\u007f-\u009f]/g;
const DUMMY_ORIGIN = 'https://dsh.invalid';

function schemeProbe(value: string): string {
  return value.replace(URL_NOISE, '');
}

/**
 * Reject protocol-relative and backslash-relative prefixes (`//`, `\\`, `/\`, `\/`)
 * as well as any relative input that WHATWG URL resolution interprets as leaving the base origin.
 */
function escapesBaseOrigin(probe: string): boolean {
  if (/^[/\\]{2}/.test(probe)) return true;
  try {
    return new URL(probe, DUMMY_ORIGIN + '/').origin !== DUMMY_ORIGIN;
  } catch {
    return true;
  }
}

/** Allow safe article links; reject script/data/file schemes and protocol-relative bypasses. */
export function sanitizeLinkUrl(raw: string): string | null {
  const value = String(raw || '').trim();
  if (!value) return null;
  if (value.startsWith('#')) return value;
  const probe = schemeProbe(value);
  if (!SCHEME.test(probe)) return escapesBaseOrigin(probe) ? null : value;
  if (/^(https?:|mailto:)/i.test(probe)) return value;
  return null;
}

/** Allow article images from local assets, HTTP(S), or raster image data URLs. */
export function sanitizeImageUrl(raw: string): string | null {
  const value = String(raw || '').trim();
  if (!value) return null;
  const probe = schemeProbe(value);
  if (!SCHEME.test(probe)) return escapesBaseOrigin(probe) ? null : value;
  if (/^https?:/i.test(probe)) return value;
  if (/^data:image\/(?:png|jpe?g|gif|webp);base64,/i.test(probe)) return value;
  return null;
}

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
// Browsers ignore ASCII whitespace/control characters inside URL schemes
// (e.g. `java\tscript:`), so schemes are always checked on a stripped probe.
const URL_NOISE = /[\u0000-\u0020\u007f-\u009f]/g;

function schemeProbe(value: string): string {
  return value.replace(URL_NOISE, '');
}

/** Allow safe article links; reject script/data/file schemes. */
export function sanitizeLinkUrl(raw: string): string | null {
  const value = String(raw || '').trim();
  if (!value) return null;
  if (value.startsWith('#')) return value;
  const probe = schemeProbe(value);
  if (probe.startsWith('//') || probe.startsWith('\\\\') || probe.startsWith('/\\')) return null;
  if (!SCHEME.test(probe)) return value;
  if (/^(https?:|mailto:)/i.test(value)) return value;
  return null;
}

/** Allow article images from local assets, HTTP(S), or raster image data URLs. */
export function sanitizeImageUrl(raw: string): string | null {
  const value = String(raw || '').trim();
  if (!value) return null;
  const probe = schemeProbe(value);
  if (probe.startsWith('//') || probe.startsWith('\\\\') || probe.startsWith('/\\')) return null;
  if (!SCHEME.test(probe)) return value;
  if (/^https?:/i.test(value)) return value;
  if (/^data:image\/(?:png|jpe?g|gif|webp);base64,/i.test(value)) return value;
  return null;
}

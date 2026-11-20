const CSS_FUNCTION_CALL = /(?:url|image-set|-webkit-image-set|image|cross-fade|src)\s*\(/i;
const NETWORK_REFERENCE = /(?:https?:)?\/\//i;

/** Decode CSS escapes (`\68ttps`, `u\72l`) and CSS string line continuations (`\<newline>`). */
function decodeCssEscapes(value: string): string {
  return value
    .replace(/\\(?:\r\n|\r|\n|\f)/g, '')
    .replace(/\\([0-9a-f]{1,6})[ \t\r\n\f]?/gi, function (_match, hex: string) {
      const code = parseInt(hex, 16);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '\ufffd';
    })
    .replace(/\\([\s\S])/g, '$1');
}

export function hasExternalCssUrl(value: string): boolean {
  const probe = decodeCssEscapes(String(value || '').replace(/\/\*[\s\S]*?\*\//g, ''));
  return /@import\b/i.test(probe) || (CSS_FUNCTION_CALL.test(probe) && NETWORK_REFERENCE.test(probe));
}

/**
 * Remove external CSS `@import` rules and network `url(...)` / `image-set(...)` references
 * while keeping local and `data:` URLs. Declarations that only reveal a network reference after
 * decoding CSS escapes are dropped entirely, so shared themes can never act as tracking beacons.
 */
export function stripExternalCssUrls(css: string): string {
  // Strip comments first so comment-embedded semicolons (e.g. `url(/*;*/"https://...")`) cannot split checks.
  return String(css || '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/@import\b[^;\r\n{}]*;?/gi, '')
    .replace(/url\(\s*['"]?\s*(?:https?:)?\/\/[^)]*\)/gi, 'none')
    .replace(/[^;{}]+/g, function (segment) {
      return hasExternalCssUrl(segment) ? '' : segment;
    });
}

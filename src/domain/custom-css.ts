const CSS_FUNCTION_CALL = /(?:url|image-set|-webkit-image-set|image|cross-fade|src)\s*\(/i;
const NETWORK_REFERENCE = /(?:https?:)?\/\//i;

/** Decode CSS escapes (`\68ttps`, `u\72l`) so obfuscated network references are still detected. */
function decodeCssEscapes(value: string): string {
  return value
    .replace(/\\([0-9a-f]{1,6})[ \t\r\n\f]?/gi, function (_match, hex: string) {
      const code = parseInt(hex, 16);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '\ufffd';
    })
    .replace(/\\([\s\S])/g, '$1');
}

function loadsNetworkResource(segment: string): boolean {
  const probe = decodeCssEscapes(segment.replace(/\/\*[\s\S]*?\*\//g, ''));
  return /@import\b/i.test(probe) || (CSS_FUNCTION_CALL.test(probe) && NETWORK_REFERENCE.test(probe));
}

/**
 * Remove external CSS `@import` rules and network `url(...)` / `image-set(...)` references
 * while keeping local and `data:` URLs. Declarations that only reveal a network reference after
 * decoding CSS escapes are dropped entirely, so shared themes can never act as tracking beacons.
 */
export function stripExternalCssUrls(css: string): string {
  return String(css || '')
    .replace(/@import\b[^;\r\n{}]*;?/gi, '')
    .replace(/url\(\s*['"]?\s*(?:https?:)?\/\/[^)]*\)/gi, 'none')
    .replace(/[^;{}]+/g, function (segment) {
      return loadsNetworkResource(segment) ? '' : segment;
    });
}

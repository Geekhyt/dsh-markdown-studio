export type WechatHtmlIssueCode =
  | 'root-not-section'
  | 'style-tag'
  | 'css-variable'
  | 'css-calc'
  | 'local-image'
  | 'katex-html'
  | 'nested-list'
  | 'fragment-link'
  | 'line-height-zero'
  | 'height-zero'
  | 'font-size-zero'
  | 'font-family'
  | 'unsupported-layout'
  | 'gradient-background';

export interface WechatHtmlIssue {
  code: WechatHtmlIssueCode;
  message: string;
}

const PATTERN_RULES: ReadonlyArray<readonly [RegExp, WechatHtmlIssueCode, string]> = [
  [/<style\b/i, 'style-tag', '复制 HTML 仍包含 style 标签'],
  [/var\(\s*--/i, 'css-variable', '复制 HTML 仍包含未解析的 CSS 变量'],
  [/calc\(/i, 'css-calc', '复制 HTML 仍包含 calc()，微信可能丢弃'],
  [
    /src\s*=\s*["']https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\//i,
    'local-image',
    '复制 HTML 包含仅本机可访问的图片地址',
  ],
  [/class\s*=\s*["'][^"']*\bkatex\b/i, 'katex-html', '复制 HTML 仍包含 KaTeX HTML，而不是公式 SVG'],
  [/<li\b[^>]*>(?:(?!<\/li>)[\s\S])*?<(?:ul|ol)\b/i, 'nested-list', '复制 HTML 可能包含嵌套列表'],
  [/href\s*=\s*["']#/i, 'fragment-link', '复制 HTML 包含页内锚点链接'],
  [/line-height\s*:\s*0(?:\.0+)?(?:px|em|rem|%)?(?=\s*[;"'])/i, 'line-height-zero', '复制 HTML 包含 line-height:0'],
  [/height\s*:\s*0(?:\.0+)?(?:px|em|rem|%)?(?=\s*[;"'])/i, 'height-zero', '复制 HTML 包含 height:0'],
  [/font-size\s*:\s*0(?:\.0+)?(?:px|em|rem|%)?(?=\s*[;"'])/i, 'font-size-zero', '复制 HTML 包含 font-size:0'],
  [/font-family\s*:/i, 'font-family', '复制 HTML 仍设置 font-family'],
  [
    /(?:display\s*:\s*(?:inline-)?grid\b|float\s*:\s*(?:left|right)\b|position\s*:\s*(?:absolute|fixed|sticky)\b)/i,
    'unsupported-layout',
    '复制 HTML 包含微信不支持的 grid/float/绝对定位布局',
  ],
  [/(?:linear|radial)-gradient\s*\(/i, 'gradient-background', '复制 HTML 包含渐变背景，微信暗色模式下可能导致反色异常'],
];

/**
 * Checks the clipboard HTML only. It intentionally does not reject local images:
 * the local showcase server is a supported product choice, but the user should
 * know that WeChat's servers cannot fetch 127.0.0.1.
 */
export function inspectWechatHtml(html: string): WechatHtmlIssue[] {
  const issues: WechatHtmlIssue[] = [];
  const text = String(html || '');
  if (!/^\s*<section\b[^>]*\bid="mdstudio"/i.test(text)) {
    issues.push({ code: 'root-not-section', message: '文章根节点不是 section#mdstudio' });
  }
  for (const [pattern, code, message] of PATTERN_RULES) {
    if (pattern.test(text)) issues.push({ code, message });
  }
  return issues;
}

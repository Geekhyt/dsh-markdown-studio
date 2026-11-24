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

const PATTERN_RULES: ReadonlyArray<
  readonly ['html' | 'style', RegExp | ((value: string) => boolean), WechatHtmlIssueCode, string]
> = [
  ['html', /<style\b/i, 'style-tag', '复制 HTML 仍包含 style 标签'],
  ['style', /var\(\s*--/i, 'css-variable', '复制 HTML 仍包含未解析的 CSS 变量'],
  ['style', /calc\(/i, 'css-calc', '复制 HTML 仍包含 calc()，微信可能丢弃'],
  [
    'html',
    /src\s*=\s*["']https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?\//i,
    'local-image',
    '复制 HTML 包含仅本机可访问的图片地址',
  ],
  [
    'html',
    /class\s*=\s*["'](?:[^"']*\s)?katex(?:-(?:display|html|mathml))?(?:\s|["'])/i,
    'katex-html',
    '复制 HTML 仍包含 KaTeX HTML，而不是公式 SVG',
  ],
  ['html', hasDirectNestedList, 'nested-list', '复制 HTML 可能包含嵌套列表'],
  ['html', /href\s*=\s*["']#/i, 'fragment-link', '复制 HTML 包含页内锚点链接'],
  [
    'style',
    /(?:^|[;\s])line-height\s*:\s*0(?:\.0+)?(?:px|em|rem|%)?(?:\s*!\s*important)?(?=\s*[;]|$)/i,
    'line-height-zero',
    '复制 HTML 包含 line-height:0',
  ],
  [
    'style',
    /(?:^|[;\s])height\s*:\s*0(?:\.0+)?(?:px|em|rem|%)?(?:\s*!\s*important)?(?=\s*[;]|$)/i,
    'height-zero',
    '复制 HTML 包含 height:0',
  ],
  [
    'style',
    /(?:^|[;\s])font-size\s*:\s*0(?:\.0+)?(?:px|em|rem|%)?(?:\s*!\s*important)?(?=\s*[;]|$)/i,
    'font-size-zero',
    '复制 HTML 包含 font-size:0',
  ],
  ['style', /(?:^|[;\s])font-family\s*:/i, 'font-family', '复制 HTML 仍设置 font-family'],
  [
    'style',
    /(?:^|[;\s])(?:display\s*:\s*(?:inline-)?grid\b|float\s*:\s*(?:left|right)\b|position\s*:\s*(?:absolute|fixed|sticky)\b)/i,
    'unsupported-layout',
    '复制 HTML 包含微信不支持的 grid/float/绝对定位布局',
  ],
  [
    'style',
    /(?:linear|radial|conic)-gradient\s*\(/i,
    'gradient-background',
    '复制 HTML 包含渐变背景，微信暗色模式下可能导致反色异常',
  ],
];

function collectInlineStyles(html: string): string {
  const styles: string[] = [];
  const pattern = /(?:^|[\s<])style\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html))) {
    styles.push(match[1] ?? match[2] ?? '');
  }
  return styles.join(';');
}

function stripCodeElementBodies(html: string): string {
  return html.replace(/(<code\b[^>]*>)[\s\S]*?(<\/code>)/gi, '$1$2');
}

/**
 * Checks the clipboard HTML only. It intentionally does not reject local images:
 * the local showcase server is a supported product choice, but the user should
 * know that WeChat's servers cannot fetch 127.0.0.1.
 */
function hasDirectNestedList(html: string): boolean {
  const stack: string[] = [];
  const tagRe = /<(\/?)(li|blockquote|section|table|ul|ol)\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = tagRe.exec(html))) {
    const closing = Boolean(match[1]);
    const tag = match[2].toLowerCase();
    if (!closing) {
      if ((tag === 'ul' || tag === 'ol') && stack[stack.length - 1] === 'li') return true;
      stack.push(tag);
    } else {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i] === tag) {
          stack.length = i;
          break;
        }
      }
    }
  }
  return false;
}

export function inspectWechatHtml(html: string): WechatHtmlIssue[] {
  const issues: WechatHtmlIssue[] = [];
  const text = String(html || '');
  if (!/^\s*<section\b[^>]*\bid="mdstudio"/i.test(text)) {
    issues.push({ code: 'root-not-section', message: '文章根节点不是 section#mdstudio' });
  }
  const markupOutsideCode = stripCodeElementBodies(text);
  const inlineStyles = collectInlineStyles(markupOutsideCode);
  for (const [scope, matcher, code, message] of PATTERN_RULES) {
    const target = scope === 'style' ? inlineStyles : markupOutsideCode;
    const matched = typeof matcher === 'function' ? matcher(target) : matcher.test(target);
    if (matched) issues.push({ code, message });
  }
  return issues;
}

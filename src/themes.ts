/*
 * Theme and sample content definitions for Markdown Studio.
 *
 * Every theme compiles to plain CSS that the inline engine converts into
 * element style attributes, so WeChat keeps the typography after paste.
 */

import { codeThemeCss } from './code-themes';
import { isRootThemeSelector, parseCssRules, stripExternalCssUrls } from './domain/custom-css';
import { type CustomTheme, extractCustomThemePreview, findCustomTheme, isCustomThemeId } from './domain/custom-themes';
import { mix, rgba } from './theme-system/color';
import { composeRecipe, type Recipe, recipePalette } from './theme-system/compose';
import { RECIPES } from './theme-system/recipes';

export type { CustomTheme };

export interface ThemeSettings {
  theme: string;
  codeTheme: string;
  accent: string;
  fontSize: number;
  lineHeight: number;
  customThemes?: CustomTheme[];
  allowExternalCssResources: boolean;
  linkFootnotes: boolean;
  imagePlaceholders: boolean;
  codeNbsp: boolean;
}

export interface ThemeDefinition {
  id: string;
  defaultAccent: string;
  build: (settings: ThemeSettings) => string;
}

function definitionFor(recipe: Recipe): ThemeDefinition {
  return {
    id: recipe.id,
    defaultAccent: recipe.accent,
    build: function (settings: ThemeSettings): string {
      return composeRecipe(recipe, settings);
    },
  };
}

/** Built-in themes, compiled from the declarative recipes in theme-system/. */
export const THEMES: ThemeDefinition[] = RECIPES.map(definitionFor);

export function isBuiltinThemeId(themeId: string): boolean {
  return THEMES.some((theme) => theme.id === themeId);
}

export const DEFAULT_SETTINGS: ThemeSettings = {
  theme: 'classic',
  codeTheme: 'theme',
  accent: '#3d57e6',
  fontSize: 16,
  lineHeight: 1.75,
  customThemes: [],
  allowExternalCssResources: false,
  linkFootnotes: true,
  imagePlaceholders: true,
  codeNbsp: true,
};

const CSS_SECTIONS: Record<string, string> = {
  variables: '主题变量',
  root: '全局排版',
  opening: '开场与扫读',
  text: '段落与行内文本',
  headings: '标题',
  lists: '列表与任务',
  quotes: '引用与金句',
  alerts: '提示块',
  code: '代码',
  table: '表格',
  media: '图片与分割线',
  notes: '收尾与参考资料',
  tokens: '语法高亮',
  misc: '其他',
};

const CSS_SECTIONS_EN: Record<string, string> = {
  variables: 'Theme Variables',
  root: 'Global Typography',
  opening: 'Opening & Summary',
  text: 'Paragraphs & Inline',
  headings: 'Headings',
  lists: 'Lists & Tasks',
  quotes: 'Quotes & Pull Quotes',
  alerts: 'Callouts',
  code: 'Code Blocks',
  table: 'Tables',
  media: 'Images & Dividers',
  notes: 'Sign-off & References',
  tokens: 'Syntax Highlighting',
  misc: 'Other',
};

const SECTION_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\.mdstudio-tok-/, 'tokens'],
  [/\.mdstudio-(?:footnote|ref|references|notes|sign)/, 'notes'],
  [/\.mdstudio-(?:meta|lead|tldr)\b/, 'opening'],
  [/\.mdstudio-alert/, 'alerts'],
  [/\.mdstudio-task/, 'lists'],
  [/h[1-6]\b|\.mdstudio-heading-(?:prefix|suffix|content)\b/, 'headings'],
  [/blockquote|\.mdstudio-pull\b/, 'quotes'],
  [/\b(?:pre|code)\b/, 'code'],
  [/\b(?:table|th|td)\b/, 'table'],
  [/\b(?:img|hr)\b|img-placeholder|\.mdstudio-(?:figure|caption)\b/, 'media'],
  [/\b(?:ul|ol|li)\b/, 'lists'],
  [/\b(?:p|a|strong|em|del|mark|u|sup)\b|mdstudio-link/, 'text'],
];

function cssSection(selector: string, body: string): string {
  if (/(?:^|;)\s*--mdstudio-[\w-]+\s*:/.test(body)) return 'variables';
  if (
    selector === '.mdstudio-content' ||
    selector.indexOf('.mdstudio-content *') === 0 ||
    selector.indexOf('.mdstudio-content > :first-child') === 0 ||
    selector.indexOf('.mdstudio-content > :last-child') === 0
  ) {
    return 'root';
  }
  for (const [pattern, section] of SECTION_PATTERNS) {
    if (pattern.test(selector)) return section;
  }
  return 'misc';
}

function cssDeclarations(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quote) {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    else if (ch === ';' && depth === 0) {
      const part = body.slice(start, i).trim();
      if (part) parts.push(part);
      start = i + 1;
    }
  }
  const tail = body.slice(start).trim();
  if (tail) parts.push(tail);
  return parts;
}

function variableGroup(declaration: string): string {
  const name = declaration.slice(0, declaration.indexOf(':')).trim();
  if (
    name.indexOf('--mdstudio-token') === 0 ||
    name.indexOf('--mdstudio-code') === 0 ||
    name.indexOf('--mdstudio-inline') === 0
  )
    return 'code';
  if (/font|line-height|radius|justify|spacing|padding|width|weight|style|underline/.test(name)) return 'type';
  return 'color';
}

const COMPONENT_PATTERNS: ReadonlyArray<readonly [RegExp, string, string]> = [
  [/\.mdstudio-meta\b/, '眉题', 'Eyebrow'],
  [/\.mdstudio-lead\b/, '导语', 'Lead'],
  [/\.mdstudio-tldr\b/, '速览卡', 'TL;DR'],
  [/\bstrong\b/, '加粗', 'Bold'],
  [/\bem\b/, '斜体', 'Italic'],
  [/\bdel\b/, '删除线', 'Strikethrough'],
  [/\bmark\b/, '高亮', 'Highlight'],
  [/\bu\b/, '下划线', 'Underline'],
  [/mdstudio-link|\ba\b/, '链接', 'Link'],
  [/\.mdstudio-pull\b/, '金句', 'Pull Quote'],
  [/blockquote/, '引用块', 'Blockquote'],
  [/\bpre\b/, '代码块', 'Code Block'],
  [/\bcode\b/, '行内代码', 'Inline Code'],
  [/\bth\b/, '表头', 'Table Header'],
  [/\btd\b/, '单元格', 'Table Cell'],
  [/\btable\b/, '表格', 'Table'],
  [/\.mdstudio-caption\b/, '图片说明', 'Caption'],
  [/\.mdstudio-figure\b/, '图片', 'Figure'],
  [/\bimg\b/, '图片', 'Image'],
  [/\bhr\b/, '分割线', 'Divider'],
  [/\.mdstudio-alert/, '提示块', 'Callout'],
  [/\.mdstudio-task/, '任务列表', 'Task List'],
  [/\.mdstudio-sign\b/, '落款', 'Sign-off'],
  [/\.mdstudio-footnote/, '脚注', 'Footnotes'],
  [/\.mdstudio-(?:ref|references|notes)/, '参考资料', 'References'],
  [/\b(?:ul|ol|li)\b/, '列表', 'List'],
  [/\bp\b/, '段落', 'Paragraph'],
  [/\.mdstudio-tok-/, '语法高亮', 'Syntax Tokens'],
];

function componentLabel(selector: string, locale: 'zh' | 'en' = 'zh'): string {
  for (const [pattern, label, enLabel] of COMPONENT_PATTERNS) {
    if (pattern.test(selector)) return locale === 'en' ? enLabel : label;
  }
  return '';
}

/** Pretty-print theme CSS with section comments and one declaration per line. */
export function formatCssSource(css: string, locale: 'zh' | 'en' = 'zh'): string {
  const source = String(css || '');
  const sections = locale === 'en' ? CSS_SECTIONS_EN : CSS_SECTIONS;
  const groupLabels =
    locale === 'en'
      ? { color: 'Colors', type: 'Typography', code: 'Code & Syntax' }
      : { color: '色彩', type: '排版', code: '代码与语法' };
  const blocks: string[] = [];
  const seen = new Set<string>();
  let lastComponent = '';
  let at = 0;
  while (at < source.length) {
    const open = source.indexOf('{', at);
    if (open === -1) break;
    const selector = source.slice(at, open).trim();
    const close = source.indexOf('}', open);
    if (!selector || close === -1) break;
    const body = source.slice(open + 1, close);
    const section = cssSection(selector, body);
    if (!seen.has(section)) {
      seen.add(section);
      blocks.push('/* ---- ' + sections[section] + ' ---- */');
    }
    const component = componentLabel(selector, locale);
    if (component && component !== lastComponent) {
      blocks.push('/* ' + component + ' */');
      lastComponent = component;
    } else if (!component) {
      lastComponent = '';
    }
    const selectors = selector
      .split(',')
      .map(function (part) {
        return part.trim();
      })
      .join(',\n');
    const declarations = cssDeclarations(body);
    const lines: string[] = [];
    if (section === 'variables') {
      const groups: Record<string, string[]> = { color: [], type: [], code: [] };
      const extra: string[] = [];
      declarations.forEach(function (declaration) {
        if (declaration.indexOf('--mdstudio-') === 0) groups[variableGroup(declaration)].push(declaration);
        else extra.push(declaration);
      });
      (['color', 'type', 'code'] as const).forEach(function (group) {
        if (!groups[group].length) return;
        if (lines.length) lines.push('');
        lines.push('  /* ' + groupLabels[group] + ' */');
        groups[group].forEach(function (declaration) {
          lines.push('  ' + declaration + ';');
        });
      });
      if (extra.length) {
        if (lines.length) lines.push('');
        extra.forEach(function (declaration) {
          lines.push('  ' + declaration + ';');
        });
      }
    } else {
      declarations.forEach(function (declaration) {
        lines.push('  ' + declaration + ';');
      });
    }
    blocks.push(selectors + ' {\n' + lines.join('\n') + '\n}');
    at = close + 1;
  }
  return blocks.join('\n\n');
}

/**
 * The editable example shown in the Custom CSS tab. It is the complete source
 * of the first built-in theme (Classic), so applying it must reproduce the
 * same preview as selecting Classic from the theme picker.
 */
export function exampleCss(locale: 'zh' | 'en' = 'zh'): string {
  const first = THEMES[0];
  const formatted = formatCssSource(
    first.build({ ...DEFAULT_SETTINGS, theme: first.id, accent: first.defaultAccent }),
    locale,
  );
  if (locale === 'en') {
    return [
      '/* Default example: full source of the ' + first.id + ' theme. */',
      '/* Enter a theme name, edit variables or selectors below, then click "Save & apply". */',
      '/*',
      ' * Common component variables:',
      ' *   Blockquote --mdstudio-quote-bg / --mdstudio-quote-border / --mdstudio-quote-radius',
      ' *   Bold       --mdstudio-strong-color',
      ' *   Italic     --mdstudio-em-color / --mdstudio-em-style',
      ' *   Underline  --mdstudio-u-color / --mdstudio-u-width / --mdstudio-u-weight',
      ' *   Links      --mdstudio-link-color / --mdstudio-link-underline',
      ' *   Divider    --mdstudio-hr-color / --mdstudio-hr-width',
      ' *   Images     --mdstudio-image-radius / --mdstudio-image-border',
      ' *   Palette    --mdstudio-accent / --mdstudio-accent-2 / --mdstudio-ink',
      ' *   Counters   counter-reset / counter-increment & content: counter(name, decimal-leading-zero)',
      ' */',
      '',
      formatted,
    ].join('\n');
  }
  return [
    '/* 默认示例：' + first.id + ' 主题完整源码。 */',
    '/* 填写主题名称、修改这里的变量或选择器，然后点“保存并启用”。 */',
    '/*',
    ' * 常用组件变量：',
    ' *   引用块  --mdstudio-quote-bg / --mdstudio-quote-border / --mdstudio-quote-radius',
    ' *   加粗    --mdstudio-strong-color',
    ' *   斜体    --mdstudio-em-color / --mdstudio-em-style',
    ' *   下划线  --mdstudio-u-color / --mdstudio-u-width / --mdstudio-u-weight',
    ' *   链接    --mdstudio-link-color / --mdstudio-link-underline',
    ' *   分割线  --mdstudio-hr-color / --mdstudio-hr-width',
    ' *   图片    --mdstudio-image-radius / --mdstudio-image-border',
    ' *   主题色  --mdstudio-accent / --mdstudio-accent-2（第二点睛色） / --mdstudio-ink（结构墨色）',
    ' *   自动序号 支持 counter-reset / counter-increment 与 content: counter(name, decimal-leading-zero)',
    ' */',
    '',
    formatted,
  ].join('\n');
}

export const SAMPLE_TITLE = '常用 Markdown 语法速查';

export const SAMPLE_MARKDOWN: string = [
  '---',
  'title: 常用 Markdown 语法速查',
  'description: 左侧看语法，右侧看效果，一篇示例覆盖常用 Markdown 排版。',
  'tags: markdown, syntax, wechat',
  '---',
  '',
  '# 常用 Markdown 语法速查',
  '',
  '这是一篇功能示例。左侧是可以直接编辑的 Markdown 源码，右侧是实时排版效果；每一节先给语法，再给对应样式，方便你一一对照。',
  '',
  '文件顶部的 `---` 之间是文章元信息，正文从一级标题开始。',
  '',
  '## 标题层级',
  '',
  '标题用 1–6 个 `#`。本文的一级标题用 `#`，当前这一节用 `##`；下面继续演示其余四级：',
  '',
  '### 三级标题',
  '',
  '语法：`### 三级标题`',
  '',
  '#### 四级标题',
  '',
  '语法：`#### 四级标题`',
  '',
  '##### 五级标题',
  '',
  '语法：`##### 五级标题`',
  '',
  '###### 六级标题',
  '',
  '语法：`###### 六级标题`',
  '',
  '## 段落与行内格式',
  '',
  '普通段落直接写，回车一次即可换行；',
  '空出一行则会开始新段落。',
  '',
  '- **加粗**：用两个星号包住，源码是 `**加粗**`。',
  '- *斜体*：用一个星号包住，源码是 `*斜体*`。',
  '- ~~删除线~~：用两个波浪线包住，源码是 `~~删除线~~`。',
  '- ==高亮==：用两个等号包住，源码是 `==高亮==`。',
  '- ++下划线++：用两个加号包住，源码是 `++下划线++`。',
  '- 行内代码：用反引号包住，例如 `npm run dev`。',
  '',
  '## 引用',
  '',
  '> 引用用 `>` 开始。',
  '>',
  '> 多段引用可以留一个空行继续。',
  '',
  '## 列表',
  '',
  '- 无序列表',
  '  - 嵌套列表',
  '  - 第二项',
  '- 回到上一层',
  '',
  '1. 有序列表',
  '2. 第二步',
  '3. 第三步',
  '',
  '- [x] 打开编辑器',
  '- [ ] 写一篇自己的文章',
  '- [ ] 复制到公众号草稿',
  '',
  '## 提示块',
  '',
  '> [!NOTE] 说明',
  '> 用 `> [!NOTE]` 开始的提示块。',
  '',
  '---',
  '',
  '> [!TIP] 技巧',
  '> 五种提示块分别是 NOTE、TIP、IMPORTANT、WARNING、CAUTION。',
  '',
  '---',
  '',
  '> [!IMPORTANT] 重要',
  '> 重要信息可以用 IMPORTANT 强调。',
  '',
  '---',
  '',
  '> [!WARNING] 注意',
  '> 需要读者留意的地方用 WARNING。',
  '',
  '---',
  '',
  '> [!CAUTION] 警告',
  '> 可能导致错误操作的内容用 CAUTION。',
  '',
  '## 链接、引用与脚注',
  '',
  '[DeepSeek Harness](https://example.com/harness) 会显示文字和角标；自动链接 <https://example.com/guide> 和裸链接 https://example.com/changelog 只显示角标，完整地址会进入「参考资料」。',
  '',
  '脚注用 `[^id]` 标记，定义写在正文后面：这是第一条脚注[^syntax]，这是第二条脚注[^copy]。',
  '',
  '[^syntax]: 脚注定义写成 `[^id]: 内容`，正文会出现对应角标。',
  '[^copy]: 复制到公众号后，脚注会变成文末说明。',
  '',
  '## 表格',
  '',
  '| 左对齐 | 居中 | 右对齐 |',
  '| :--- | :---: | ---: |',
  '| Markdown | 表格 | 3 |',
  '| 语法 | 对齐 | 120 |',
  '',
  '表格用 `|` 分隔单元格；第二行的 `:---`、`:---:`、`---:` 分别控制左对齐、居中和右对齐。',
  '',
  '## 代码',
  '',
  '行内代码：`npm run dev`',
  '',
  '```js',
  'export function greet(name) {',
  '  const message = `你好，${name}`;',
  '  return message;',
  '}',
  '```',
  '',
  '```css',
  '.mdstudio-content h2 {',
  '  letter-spacing: 0.02em;',
  '}',
  '```',
  '',
  '## 公式',
  '',
  '行内公式可以直接写：$a^2 + b^2 = c^2$，以及 $E = mc^2$。',
  '',
  '块级公式用两对美元符号包住：',
  '',
  '$$',
  '\\frac{a}{b} = \\frac{c}{d}',
  '$$',
  '',
  '$$',
  '\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}',
  '$$',
  '',
  '## 图表',
  '',
  'Mermaid 用代码块生成流程图：',
  '',
  '```mermaid',
  'flowchart LR',
  '  A[写作] --> B[预览]',
  '  B --> C[复制]',
  '  C --> D[公众号]',
  '```',
  '',
  '## 图片与分割线',
  '',
  '![Markdown Studio 示例](assets/f59d29cfbd29d8d1a9d7284f.jpg)',
  '',
  '图片写法和普通 Markdown 一致，`assets/...` 会由本地图片服务器托管。',
  '',
  '---',
  '',
  '三条短横线会生成一条分割线。',
  '',
  '## 滑动容器',
  '',
  '长提示词、更新日志或补充长文可以用 `:::scroll` 包成竖向滚动框（也可写 `:::scroll 220` 指定高度）：',
  '',
  ':::scroll 200',
  '**公众号排版发稿前自检清单**',
  '',
  '1. 标题层级：全文一级标题仅保留文首 1 处，小节统一用 `##` 与 `###`。',
  '2. 行内重点：每段加粗或高亮控制在 1–2 处，避免满屏重色。',
  '3. 外链处理：开启「外链转文末参考」，自动汇总站外链接与角标。',
  '4. 代码与公式：核对长代码折行或滚动，行内与块级公式矢量清晰。',
  '5. 深色适配：切换预览夜间模式，确认底色、边框与提示块对比度自然。',
  '6. 手机实测：切到「手机」视图通读一遍首屏节奏与段间呼吸感。',
  ':::',
  '',
  '多张独立图片可以用 `:::scroll-x` 包成横向滚动图集（方括号文字自动居中显示为底部图注，留空则不显示图注）：',
  '',
  ':::scroll-x',
  '![01 · 本地优先双栏写作](assets/f59d29cfbd29d8d1a9d7284f.jpg)',
  '![02 · 八套主题与实时 CSS 工作台](assets/f59d29cfbd29d8d1a9d7284f.jpg)',
  '![03 · 一键内联复制到公众号草稿](assets/f59d29cfbd29d8d1a9d7284f.jpg)',
  ':::',
  '',
  '## 主题与自定义主题',
  '',
  '右侧设置里可以切换经典、画廊、新知、森系、黑金、文集、简报、海报八套主题；字号、行高、主题色与代码配色都可以调整。',
  '',
  '在设置中点「新建主题」即可在左栏打开自定义 CSS 工作台，边改样式边看右侧实时预览，保存后会直接显示在「主题预设」中，例如：',
  '',
  '```css',
  '.mdstudio-content {',
  '  --mdstudio-accent: #4d6bfe;',
  '  --mdstudio-text: #1f2328;',
  '  --mdstudio-bg: #ffffff;',
  '}',
  '```',
  '',
  '---',
  '',
  '照着左侧语法改一行，右侧就会同步变化。把这篇示例当成速查表，然后写下你自己的文章。',
].join('\n');

export const SAMPLE_TITLE_EN = 'Markdown Quick Reference';

export const SAMPLE_MARKDOWN_EN: string = [
  '---',
  'title: Markdown Quick Reference',
  'description: Edit Markdown on the left and preview publication-ready formatting on the right.',
  'tags: markdown, syntax, wechat',
  '---',
  '',
  ':::meta Feature Guide · 3 min read',
  '',
  '# Markdown Quick Reference',
  '',
  ':::lead',
  'Write plain Markdown on the left and watch publication-ready formatting update live on the right. Every block below pairs standard syntax with inline-styled HTML ready for WeChat Official Accounts.',
  ':::',
  '',
  ':::tldr',
  '- **Local-first studio**: Drafts, deduplicated images, and custom CSS themes stay on your machine',
  '- **One-click WeChat copy**: Inline CSS, vector formulas, and automatic reference footnotes',
  ':::',
  '',
  '## Inline Formatting & Lists',
  '',
  'Combine **bold**, *italic*, ~~strikethrough~~, ==highlight==, ++underline++, and inline code like `npm run dev`.',
  '',
  '- Bullet list item',
  '  - Nested item',
  '- [x] Open Markdown Studio',
  '- [ ] Draft an article and copy for WeChat',
  '',
  ':::pull Great typesetting never locks in your prose—it lets clean Markdown speak with clarity.',
  '',
  '## Callouts, Links & Footnotes',
  '',
  '> [!NOTE] Tip',
  '> Five callout styles are built in: `NOTE`, `TIP`, `IMPORTANT`, `WARNING`, and `CAUTION`.',
  '',
  '[DeepSeek Harness](https://example.com/harness) renders text with a numbered marker, and footnote markers[^copy] collect definitions cleanly at the bottom.',
  '',
  '[^copy]: Footnotes and external URLs compile into WeChat-compatible endnotes automatically.',
  '',
  '## Tables, Code & Math',
  '',
  '| Left | Center | Right |',
  '| :--- | :---: | ---: |',
  '| Markdown | Table | 3 |',
  '| Themes | Custom CSS | 8 |',
  '',
  '```js',
  'export function greet(name) {',
  '  return `Hello, ${name}`;',
  '}',
  '```',
  '',
  'Inline math like $a^2 + b^2 = c^2$ and display equations render as sharp vector SVG:',
  '',
  '$$',
  '\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}',
  '$$',
  '',
  '## Diagrams, Media & Scroll Containers',
  '',
  '```mermaid',
  'flowchart LR',
  '  A[Write] --> B[Preview]',
  '  B --> C[Copy]',
  '  C --> D[Publish]',
  '```',
  '',
  '![Markdown Studio Sample](assets/f59d29cfbd29d8d1a9d7284f.jpg)',
  '',
  ':::scroll 180',
  '**Pre-publish Checklist**',
  '',
  '1. Keep a single `#` title at the top and structure sections with `##` and `###`.',
  '2. Turn on external link footnotes when targeting WeChat Official Accounts.',
  '3. Switch between Mobile and PC widths or toggle dark mode to check contrast.',
  ':::',
  '',
  ':::scroll-x',
  '![01 · Local-first Split Studio](assets/f59d29cfbd29d8d1a9d7284f.jpg)',
  '![02 · 8 Themes & Live Custom CSS](assets/f59d29cfbd29d8d1a9d7284f.jpg)',
  ':::',
  '',
  ':::sign',
  'Edit any line on the left to try it live—or type `/` at the start of a line to insert blocks.',
  ':::',
].join('\n');

export function sampleArticleFor(locale?: string): { title: string; markdown: string } {
  return locale && /^en/i.test(locale)
    ? { title: SAMPLE_TITLE_EN, markdown: SAMPLE_MARKDOWN_EN }
    : { title: SAMPLE_TITLE, markdown: SAMPLE_MARKDOWN };
}

export function getTheme(id: string): ThemeDefinition {
  for (var i = 0; i < THEMES.length; i++) {
    if (THEMES[i].id === id) return THEMES[i];
  }
  return THEMES[0];
}

export function isPaperTheme(id: string): boolean {
  return RECIPES.some(function (recipe) {
    return recipe.id === id && recipe.paper;
  });
}

function paperCardRules(id: string): string {
  if (!isPaperTheme(id)) return '';
  return '.mdstudio-content { padding: 1.5em 1.15em; border-radius: var(--mdstudio-paper-radius); }';
}

function resolveUserCss(settings: ThemeSettings): string {
  const custom = findCustomTheme(settings.customThemes, settings.theme);
  return custom ? custom.css : '';
}

function parseCustomBasePragma(css: string): 'standalone' | 'classic' | null {
  const match = /\/\*\s*@base\s*:\s*(standalone|classic)\s*\*\//i.exec(css);
  if (!match) return null;
  return match[1].toLowerCase() === 'standalone' ? 'standalone' : 'classic';
}

function isStandaloneCustomCss(css: string): boolean {
  const pragma = parseCustomBasePragma(css);
  if (pragma) return pragma === 'standalone';
  const rules = parseCssRules(css);
  const selectors = rules.flatMap((rule) => rule.selectors).join(', ');
  const rootRules = rules.filter((rule) => rule.selectors.some(isRootThemeSelector));
  const hasRoot = rootRules.length > 0;
  const hasProse = /(?:^|[,\s>+~])p(?=$|[\s,:{.#[])/im.test(selectors);
  const headingMatches = selectors.match(/\bh[1-6]\b/gi) || [];
  const headingCount = new Set(headingMatches.map((h) => h.toLowerCase())).size;
  const hasBlocks = /\b(?:blockquote|pre|code|ul|ol|table)\b/i.test(selectors);
  if (!(hasRoot && hasProse && headingCount >= 1 && (headingCount >= 2 || hasBlocks))) return false;
  // Distinguish full standalone themes from short override snippets that only tweak accent/spacing or comments.
  const rootDecls = rootRules.flatMap((rule) => rule.declarations);
  const hasSurface = rootDecls.some(
    (d) => d.prop === 'background' || d.prop === 'background-color' || d.prop === '--mdstudio-bg',
  );
  const hasTextTone = rootDecls.some((d) => d.prop === 'color' || d.prop === '--mdstudio-text');
  return hasSurface && hasTextTone;
}

export function buildCss(settings: ThemeSettings): string {
  var userCss = resolveUserCss(settings);
  var standalone = isCustomThemeId(settings.theme) && Boolean(userCss.trim()) && isStandaloneCustomCss(userCss);
  var theme = getTheme(settings.theme);
  var css = standalone ? '' : theme.build(settings);
  var flushSel =
    '.mdstudio-content > h1:first-child, .mdstudio-content > h2:first-child, .mdstudio-content > h3:first-child, .mdstudio-content > h4:first-child, .mdstudio-content > h5:first-child, .mdstudio-content > h6:first-child';
  // Built-in themes flush leading headings cleanly; standalone custom themes use :where() so user heading margins always win.
  css += '\n' + (standalone ? ':where(' + flushSel + ')' : flushSel) + ' { margin: 0 0 0.8em; }';
  if (!standalone) {
    var paper = paperCardRules(theme.id);
    if (paper) css += '\n' + paper;
  }
  if (userCss.trim()) {
    css += '\n/* user styles */\n' + (settings.allowExternalCssResources ? userCss : stripExternalCssUrls(userCss));
  }
  // Apply independent code theme overrides after custom theme CSS so selecting a code theme works on custom themes too.
  var codeCss = codeThemeCss(settings.codeTheme);
  if (codeCss) css += '\n' + codeCss;
  return css;
}

/**
 * Mermaid diagrams are rasterised to PNG for WeChat, so their colours must be
 * baked in at render time. The theme palette is passed through a Mermaid init
 * directive (theme "base" + themeVariables); the directive also keys the
 * diagram cache so switching themes re-renders diagrams in matching colours.
 */
export interface MermaidTheme {
  directive: string;
  background: string;
}

function hexOr(value: string, fallback: string): string {
  return /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

function mermaidPaletteColors(
  settings: Pick<ThemeSettings, 'theme' | 'accent' | 'fontSize' | 'lineHeight'> & { customThemes?: CustomTheme[] },
): { bg: string; accent: string; accent2: string; ink: string } {
  var custom = findCustomTheme(settings.customThemes, settings.theme);
  if (custom) {
    var preview = extractCustomThemePreview(custom.css, settings.accent);
    return { bg: preview.bg, accent: preview.accent, accent2: preview.accent, ink: preview.fg };
  }
  var recipe =
    RECIPES.filter(function (item) {
      return item.id === settings.theme;
    })[0] || RECIPES[0];
  var p = recipePalette(recipe, {
    accent: settings.accent || recipe.accent,
    fontSize: settings.fontSize,
    lineHeight: settings.lineHeight,
  });
  return {
    bg: hexOr(p.bg, '#ffffff'),
    accent: hexOr(p.accent, '#3d57e6'),
    accent2: hexOr(p.accent2, '#3d57e6'),
    ink: hexOr(p.ink, '#1f2329'),
  };
}

export function mermaidThemeFor(
  settings: Pick<ThemeSettings, 'theme' | 'accent' | 'fontSize' | 'lineHeight'> & { customThemes?: CustomTheme[] },
): MermaidTheme {
  var c = mermaidPaletteColors(settings);
  var node = mix(c.accent, c.bg, 0.86);
  var variables = {
    background: c.bg,
    mainBkg: node,
    primaryColor: node,
    primaryTextColor: c.ink,
    primaryBorderColor: c.accent,
    secondaryColor: mix(c.accent2, c.bg, 0.8),
    tertiaryColor: mix(c.ink, c.bg, 0.94),
    lineColor: mix(c.ink, c.bg, 0.4),
    textColor: c.ink,
    nodeBorder: c.accent,
    clusterBkg: mix(c.accent, c.bg, 0.94),
    clusterBorder: mix(c.accent, c.bg, 0.6),
    edgeLabelBackground: c.bg,
    titleColor: c.ink,
  };
  return {
    directive: '%%{init: ' + JSON.stringify({ theme: 'base', themeVariables: variables }) + '}%%',
    background: c.bg,
  };
}

/** Live preview colors for the "Follow theme" (`codeTheme === 'theme'`) swatch card. */
export function themeCodePreview(
  settings: Pick<ThemeSettings, 'theme' | 'accent' | 'fontSize' | 'lineHeight'> & { customThemes?: CustomTheme[] },
): { bg: string; fg: string; accent: string } {
  var custom = findCustomTheme(settings.customThemes, settings.theme);
  if (custom) {
    var cleanCustomCss = custom.css.replace(/\/\*[\s\S]*?\*\//g, '');
    var lastHex = function (prop: string): string {
      var re = new RegExp(prop + '\\s*:\\s*(#[0-9a-f]{3}(?:[0-9a-f]{3})?)\\b', 'gi');
      var found = '';
      var m: RegExpExecArray | null;
      while ((m = re.exec(cleanCustomCss))) found = m[1];
      return found;
    };
    var codeBg = lastHex('--mdstudio-code-bg');
    var codeFg = lastHex('--mdstudio-code-text');
    var preview = extractCustomThemePreview(custom.css, settings.accent);
    return {
      bg: codeBg || preview.bg,
      fg: codeFg || preview.fg,
      accent: preview.accent,
    };
  }
  var recipe =
    RECIPES.filter(function (item) {
      return item.id === settings.theme;
    })[0] || RECIPES[0];
  var p = recipePalette(recipe, {
    accent: settings.accent || recipe.accent,
    fontSize: settings.fontSize,
    lineHeight: settings.lineHeight,
  });
  return {
    bg: p.codeBg,
    fg: p.codeText,
    accent: p.tokens.keyword,
  };
}

/** Cache key for a Mermaid block rendered under a given theme. */
export function mermaidCacheKey(code: string, theme: MermaidTheme): string {
  return theme.directive + '\n' + code;
}

export { mix, rgba };

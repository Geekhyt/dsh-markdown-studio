# 主题 CSS 与定制契约

## 来源

Markdown Studio 的八套主题都定义在 `src/theme-system/` 与 `src/themes.ts` 中，不复制 `github-markdown-css`、Tailwind、第三方公众号样式表、付费主题或其他完整第三方样式表。插件没有主题依赖。

共享的 `core()` 渲染器和各主题覆盖，是为本插件的内联复制约束编写的。参考点包括：

- **GitHub Light 和 Primer 风格的语法颜色**：代码 token 使用接近 Primer 的色值（`#cf222e`、`#0a3069`、`#0550ae`、`#8250df` 等）。完整色板见 [Primer 色彩基础](https://primer.style/foundations/color)。
- **中文公众号常见排版**：系统中文字体栈、16 px 正文、1.75 标准行高（森系/文集为 1.85 舒朗行高）、点缀色标题、柔和引用和易读的表格 / 代码样式。
- **微信内联样式约束**：可预测的属性集，不依赖外部样式表，不使用媒体查询或 `@font-face`。
- **八套主题身份**：经典（Classic, `classic`）、画廊（Gallery, `gallery`）、新知（Insight, `tech`）、森系（Botanical, `warm`）、黑金（Noir Gold, `night`）、文集（Anthology, `ink`）、简报（Briefing, `ruby`）、海报（Poster, `poster`）是在共享核心上的原创配色与排版配方。
- **信纸型主题**：画廊（`gallery`）、森系（`warm`）、黑金（`night`）、文集（`ink`）在 `.mdstudio-content` 内置 `1.5em 1.15em` 安全内边距，并按主题使用各自的纸张圆角（画廊 `2px`、森系 `18px`、黑金 `16px`、文集 `4px`），保留纸张卡片的留白感。

如果在其他项目复用这些语法颜色，请保留上面的 Primer 署名。仓库没有内置完整的第三方 CSS 文件。

## 暴露的定制面

自定义 CSS 可以覆盖两层。

### 1. 主题 token

在 `#mdstudio` 或 `.mdstudio-content` 上定义这些变量。复制管线会在写入内联样式前解析 `var()`，因此结果能承受微信粘贴。

| 分组 | Token |
| --- | --- |
| 颜色 | `--mdstudio-accent`、`--mdstudio-accent-deep`、`--mdstudio-accent-soft`、`--mdstudio-accent-faint`、`--mdstudio-text`、`--mdstudio-heading`、`--mdstudio-muted`、`--mdstudio-bg`、`--mdstudio-soft`、`--mdstudio-border`、`--mdstudio-border-strong`、`--mdstudio-table-head` |
| 排版 | `--mdstudio-font-family`、`--mdstudio-heading-font`、`--mdstudio-font-size`、`--mdstudio-line-height`、`--mdstudio-radius`、`--mdstudio-justify` |
| 代码 | `--mdstudio-code-bg`、`--mdstudio-code-text`、`--mdstudio-inline-bg`、`--mdstudio-inline-text`、`--mdstudio-token-keyword`、`--mdstudio-token-string`、`--mdstudio-token-comment`、`--mdstudio-token-number`、`--mdstudio-token-function`、`--mdstudio-token-tag`、`--mdstudio-token-attr`、`--mdstudio-token-literal` |
| 行内组件 | `--mdstudio-strong-color`、`--mdstudio-em-color`、`--mdstudio-em-style`、`--mdstudio-del-color`、`--mdstudio-mark-bg`、`--mdstudio-mark-text`、`--mdstudio-mark-border`、`--mdstudio-link-color`、`--mdstudio-link-underline` |
| 引用 | `--mdstudio-quote-bg`、`--mdstudio-quote-border`、`--mdstudio-quote-radius`、`--mdstudio-quote-padding` |
| 块级元素 | `--mdstudio-hr-color`、`--mdstudio-hr-width`、`--mdstudio-ordered-bg` |
| 表格 / 图片 | `--mdstudio-table-border`、`--mdstudio-image-radius` |
| 段落 | `--mdstudio-paragraph-spacing`、`--mdstudio-paragraph-letter-spacing` |

Token 作用于整篇文章，不按元素单独生效。内置代码配色（`github`、`one-dark` 等）在主题之后应用；需要不同代码表面时，覆盖对应组件选择器。

### 2. 结构选择器

```text
#mdstudio
#mdstudio h1 … h6
#mdstudio h2 .mdstudio-heading-prefix / .mdstudio-heading-content / .mdstudio-heading-suffix
#mdstudio p, a, blockquote, ul, ol, li
#mdstudio .mdstudio-task
#mdstudio pre, code
#mdstudio table, th, td
#mdstudio img, .mdstudio-figure, .mdstudio-caption, hr
#mdstudio .mdstudio-meta, .mdstudio-lead, .mdstudio-tldr, .mdstudio-pull, .mdstudio-sign
#mdstudio .mdstudio-alert, .mdstudio-alert-title
#mdstudio .mdstudio-references
#mdstudio .mdstudio-footnotes
```

复制时 `::before` 和 `::after` 会物化为真实 span，`:root`、`html`、`body` 与 `#mdstudio` 选择器会归一化到复制根节点。

## 不暴露的面

- Harness / 编辑器 chrome 变量（`--dsw-*`）和面板布局。
- 内联复制内部实现、剪贴板、图片 host URL、Mermaid / MathJax 运行时。
- 微信无法内联的 CSS：`@media`、`@font-face`、`:hover` / `:focus` 等状态伪类，以及按元素定义的自定义属性（注：`counter-reset` / `counter-increment` / `counter()` 会在复制前静态求值并注入文本 span）。
- 任意 HTML / script。Markdown 清洗器仍是边界。

## 起始模板

右侧样式设置抽屉有两个 Tab：**主题**和**帮助**。点击 **主题预设** 中的 **+ 新建主题**（或已保存自定义主题卡片右上角的编辑图标），会在左侧面板打开 **自定义主题 CSS 工作台**，右侧同步实时预览。新建主题时默认载入第一套内置主题（Classic）的完整源码，包括全部 `--mdstudio-*` token 和结构规则，方便一次看到所有可定制项。

示例经过格式化：带分节注释、分组 token 注释、逐组件中文注释（引用、粗体、斜体、链接、列表、代码、表格、图片、分割线）、规则之间空行和一行一个声明。填写主题名称并编辑后点击 **保存并启用**，即可保存或更新该自定义主题并应用到当前文章；在文章库切换文章时，所有已保存的自定义主题都会共享保留。**恢复示例**会放回 Classic 源码，**删除**会移除当前自定义主题。

`::marker` 和状态伪类不会被内联；普通选择器上的 `::before` / `::after` 会物化为 span。自定义 CSS 中的外部 `url(http/https)` 资源与 `@import` 规则始终会被剥离；该限制不提供界面开关，导入的主题 JSON 或文章库备份也无法关闭它，避免不可信文件在预览中触发外部追踪请求。


## 微信规范校验

复制 HTML 已按微信公众平台编辑器插件开发规范检查：不使用 `!important`、`font-family`、`opacity`、`height:0`、`font-size:0`、伪元素内容和不支持的选择器；行内代码、高亮与提示块标题完整保留预览底色与显式文字对比色，避免 `color: inherit` 在微信 Dark Mode 下触发低对比度。8 套主题的复制结果均通过官方 `verify-article-structure-spec` 与 `mp-darkmode` 校验，0 条违规。


## 列表标记

列表标记只使用原生 `list-style-type`：经典（`classic`）、新知（`tech`）、黑金（`night`）、文集（`ink`）使用核心默认的 `disc → circle → square` 与 `decimal`；画廊（`gallery`）为 `square → circle → disc` 与 `decimal-leading-zero`；森系（`warm`）为 `circle → disc → square` 与 `decimal`；简报（`ruby`）为 `disc → circle → square` 与 `decimal-leading-zero`；海报（`poster`）为 `square → circle → square` 与 `decimal`。不使用 `::marker`、伪元素或 `list-style-image`，保证复制到公众号后仍是原生列表。

# 公众号 HTML 结构规范

微信官方规范：[微信公众平台编辑器插件开发规范](https://developers.weixin.qq.com/doc/service/guide/product/plugin_spec.html)

官方检测工具：[verify-article-structure-spec](https://github.com/wechatjs/verify-article-structure-spec)

Markdown Studio 生成的复制 HTML 需要同时满足两层要求：

1. 微信编辑器的结构校验，不出现行高叠字、`height: 0`、固定宽度溢出、`pre` 滥用等问题。
2. 公众号阅读端的显示约束，不依赖外部字体、`<style>`、CSS 变量或 KaTeX 字体。

## 排版与复制结构约束

- **行高**：引用编号和脚注编号统一使用 `line-height: 1.2`（避免 `line-height: 0` 导致多行文字重叠）。
- **零高度容器**：复制前剔除空段落保护节点、空标题装饰 span、空任务框和 MathJax SVG 内部的空 `<g>`，确保复制 HTML 中计算高度为 0 的节点数为 0。
- **分割线**：`hr` 采用 1px 或 2px 实体高度渲染（不使用 `height: 0`）。
- **字体**：复制前移除所有 `font-family`，交给微信默认字体栈，避免 iOS 和编辑器字体不一致。
- **公式**：预览和复制统一使用 MathJax SVG；复制时删除 SVG 的 `width`/`height` 属性，把宽高写入 `style`，并用 `mdstudio-math-block` / `mdstudio-math-inline` 容器承载。
- **列表**：复制时拆平嵌套 `ul/ol`，避免微信重置列表层级。
- **根节点**：复制 HTML 统一以 `section#mdstudio` 作为根节点。

## 官方检测命令

```bash
git clone https://github.com/wechatjs/verify-article-structure-spec.git
cd verify-article-structure-spec/cli
npm install
PUPPETEER_EXECUTABLE_PATH=/path/to/chrome npm run check ./article.html
```

也可以用官方 CLI 的 `--json` 输出结构化结果，或 `dedupe` 清理冗余嵌套。

## 本地图片限制

图片走本机 `127.0.0.1:4010` 只读回环服务。图片、Mermaid 图在公众号发布端可能无法显示，这是当前产品的已知限制；复制时会由 `inspectWechatHtml` 检测并在控制台输出本地图片兼容性告警。结构校验不会把本地 URL 当成 HTML 结构错误，但图片可达性需要单独解决。

## 当前检测结果

对验证样张实际复制出的 HTML 运行官方规范检测：

```text
isValid：true（无违规）
```

官方 CLI 尚未覆盖字体检测和 `span[leaf]` / `section[nodeleaf]` 结构检测；本项目另外在复制时移除了 `font-family`，并保持不生成这两类特殊节点。

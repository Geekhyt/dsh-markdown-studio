# 设计参考

Markdown Studio 的代码为原创。以下项目和视觉惯例只用于交互模式和颜色参考；没有复制任何源码、样式表、组件或主题文件（随包内置的 Humanizer-zh 规则原文与第三方依赖库除外，见 [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)）。

## 代码块配色

内置代码配色使用常见编辑器色彩惯例：

- GitHub Light / GitHub Dark：GitHub 的编辑器配色。
- One Dark：Atom / One Dark 配色惯例。
- Dracula：Dracula 配色惯例。
- Nord：Nord 配色惯例。
- Solarized Light / Solarized Dark：Solarized 配色惯例。
- Monokai：Monokai 配色惯例。

`src/code-themes.ts` 中的 CSS 为本项目编写。配色名称只用于标识视觉惯例，相关项目保留各自商标。

## 交互参考

早期设计研究参考过公开的 Markdown 转公众号编辑器的布局、快捷键和图片流；没有复制实现。当前实现、测试、主题和复制管线均在本仓库编写；第三方库列在 `THIRD_PARTY_NOTICES.md`。

# 安全策略 / Security Policy

## 支持版本 / Supported Versions

| Version | Supported |
| :--- | :--- |
| `0.1.x` | Yes |

## 安全边界设计 / Security Model

`dsh-markdown-studio` 是运行在本机的本地优先写作与排版工作台，不提供自有云账号、遥测或远程图床上传：

1. **原始 HTML 转义与协议白名单**：Markdown 渲染引擎默认转义内联原始 HTML，链接仅放行 `https://`、`http://`、`mailto:`、相对路径与 `#` 锚点，图片额外放行本机可移植 `assets/<hash>.(png|jpg)` 引用与 `data:image/(png|jpeg|gif|webp);base64`；协议判断前先剔除空白与控制字符（防止 `java\tscript:` 之类的混淆），拦截 `javascript:`、`vbscript:`、`data:text/html` 等危险协议。TeX 公式不加载 MathJax `html` 扩展（`\href` / `\style` / `\class` / `\cssId`），渲染结果中的 SVG 链接一律剥离。
2. **Mermaid 严格沙箱与 DOMPurify 净化**：Mermaid 图表强制运行在 `securityLevel: 'strict'` 且关闭 `htmlLabels`，渲染结果经过 `DOMPurify` 净化后再光栅化用于预览与复制。
3. **本机图片双通道隔离**：
   - **写入路由**（`POST /api/markdown-studio/wechat`）挂载于受鉴权的宿主 Web 服务内，强制要求本机回环地址（`127.0.0.1` / `::1`）、`Content-Type` 主类型严格为 `application/json`，并校验来源：http(s) `Origin` 必须与 `Host` 一致；缺失 Origin 与桌面端自定义 scheme 放行，`null` Origin 仅在 `Sec-Fetch-Site: same-origin/none` 时放行；并校验 PNG / JPEG 文件头魔数与 `1 MB` 单图上限。
   - **只读预览路由**（`127.0.0.1:4010-4019/uploads/<24-hex>.(png|jpg)`）仅绑定回环网卡、仅响应 `GET / HEAD / OPTIONS`，采用 24 位内容哈希正则白名单读取文件并附带 `X-Content-Type-Options: nosniff`，不暴露任何写入接口、目录列表或配置。
4. **按需触发的同源回环 AI 写作路由**（`POST /api/markdown-studio/ai`）：
   - 默认编辑、预览与复制过程**零模型调用、零文本外发**；仅当用户主动选中文本并点击执行写作 Skill 时，才将当前选中文本与对应 Skill 指令转发给用户在 DeepSeek Harness 宿主中自行配置的 `llm` 服务（不附带整库文章或本地图片）。
   - 接口采用与写入路由一致的回环源 IP、来源与 `application/json` 校验，并限制 `512 KiB` 请求体；流式输出未正常结束或达到模型长度上限时直接报错，不会把半截结果当作改写建议；未采纳的行内 AI 建议严格与剪贴板/导出结果隔离。
5. **自定义 CSS 与归档解压边界**：
   - 自定义主题 CSS 仅在文章容器 `#mdstudio` 作用域内解析并转换为内联样式；外部 `url(...)`、`image-set(...)` 资源与 `@import` 规则始终被剥离（解码 CSS 转义后再判断），导入的主题 JSON 或文章库备份无法关闭这一限制。
   - `.zip` 导入与导出强制执行统一预算（最多 `4096` 个条目、单条目 `50 MiB`、累计解压上限 `256 MiB`），防范压缩炸弹与路径穿越。

## 不在范围内 / Out of Scope

- DeepSeek Harness 宿主本身、用户自行配置的第三方模型服务商、操作系统或宿主浏览器的漏洞。
- 第三方平台（如微信公众号后台）对粘贴富文本的二次清洗或改写行为。
- 具备同一台本机系统用户权限的本地进程访问浏览器存储或 `$DSH_HOME` 数据目录。

## 报告安全漏洞 / Reporting a Vulnerability

请勿在公开 Issue 中披露未修复的安全漏洞。请直接通过 GitHub 私密安全通告提交报告：

https://github.com/Geekhyt/dsh-markdown-studio/security/advisories/new

请在报告中附上受影响版本、操作系统、DeepSeek Harness 版本及最小复现步骤（请勿包含个人草稿、私钥或真实凭证）。我们会在收到报告后尽快确认并推进修复。

# 领域术语

- **Article**：一篇 Markdown 文档，包含 id、标题、源码、设置和更新时间。
- **Library**：本地有序的文章集合，持久化在一个 v2 key 下。
- **DocumentStore**：活动文章、文章库、设置和视图的唯一写入方。
- **DocumentRef**：活动文章的来源，可能是文章库条目、单个文件句柄或文件夹工作区中的文件。联合类型让文章库 / 文件 / 文件夹状态不会混用。
- **Workspace**：本地文件夹句柄及其 Markdown 文件目录树（递归遍历子目录，最多 8 层深度，支持新建/重命名/删除文件与目录，并自动管理旁路 `assets/` 资源目录）。
- **Asset**：本地图片服务保存的图片，按内容哈希寻址。标准引用是 `assets/<hash>.<ext>`。
- **StoredAsset / AssetItem**：Host 保存或列出图片后返回的 domain 值（`src/domain/images.ts`），包含可移植路径、本地 URL、MIME 类型和字节数。
- **Portable asset path**：Markdown 中唯一持久化的图片引用形式 `assets/<hash>.<ext>`。base64 和本地回环 URL 只是传输或渲染形态，加载时会被 `portableizeAssetUrls` 迁移回可移植路径。
- **Local URL**：渲染时由可移植路径派生出的回环 URL（`resolveArticleImageSrc`），用于预览和剪贴板 HTML，不写进 Markdown。
- **Asset GC**：彻底删除文章或清空回收站时，`createAssetGarbageCollector` 按文章库与回收站的引用计数回收不再被引用的本地图片。
- **Public URL**：未来可选的外部 URL，不属于默认本地模式。
- **Article bundle**：包含 `article.md` 和 `assets/` 的 ZIP。
- **Theme**：不可变 CSS 构建器，加上 id 和默认主题色。
- **Settings**：校验后的文章展示设置。解析后不会留下非法主题 id。
- **Use case**：协调 domain 规则和 port 的 application 函数，例如渲染文章、插入图片、导出 / 导入 bundle、保存文档。
- **Port**：由 application / domain 一侧持有的窄接口。
- **Adapter**：port 在 DSH、浏览器存储、文件、剪贴板、CodeMirror、MathJax、Mermaid 或 HTTP 上的具体实现。
- **Render result**：文章 HTML、纯文本、背景色、引用数量和展示所需资源。

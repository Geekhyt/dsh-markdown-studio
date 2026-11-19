# 持久化数据格式

本页列出所有持久化格式、版本和兼容规则。把这些格式当作迁移边界。

| 数据 | 存储 | 当前版本 | 向后兼容 |
| --- | --- | --- | --- |
| 文章库 | `dsh.markdown-studio.library.v2` localStorage | `schemaVersion: 2` | 没有 schemaVersion 的 v2 数据按 v2 读取 |
| last-good 文章库 | `...backup.v2` localStorage | `schemaVersion: 2` | 与文章库相同 |
| 文章库 JSON 备份 | 下载的 `library.json` | format 1 + `schemaVersion: 2` | 没有 schemaVersion 的备份按 schema 1 读取 |
| 完整文章库归档 | `library.json` + `manifest.json` | archive 1 + `schemaVersion: 2` | 没有 schemaVersion 的 manifest 可以接受 |
| 工作区文件句柄 | IndexedDB `mdstudio-files` | store v1 | 句柄是浏览器不透明值 |
| 本地图片 | `$DSH_HOME/storages/dsh-markdown-studio/assets/` + `assets.json` | service v5 | 内容寻址文件 |

## 规则

1. 不读取比当前构建更新的 schema 版本；直接拒绝，不要部分解析。
2. 没有 schema 字段的旧备份按 schema 1 处理。
3. 结构变化需要：
   - 提升 `LIBRARY_SCHEMA_VERSION`、`BACKUP_SCHEMA_VERSION` 或 `ARCHIVE_SCHEMA_VERSION`；
   - 提供迁移或明确拒绝的测试；
   - 保留一个仍可读取的旧 fixture；
   - 在 `CHANGELOG.md` 和本文中记录。
4. 不承诺向下兼容。应用会拒绝未来 schema，并保持原文件不变。
5. `schemaVersion` 是元数据，不替代字段级校验；每条导入记录仍要通过类型化解析器。

相关实现位于 `src/domain/schema.ts`；解析器集成在 `src/domain/library-backup.ts`、`src/adapters/storage.ts` 和 `src/application/use-library-archive.ts`。

## 数据完整性与容量

- 文章与回收站数量不设上限，正文完整读取。实际容量由浏览器存储配额决定；保存失败时显示提示，编辑内容保留在当前页面中，关闭前应先导出。
- 文章库按“整库快照”保存，同一浏览器配置下同时在多个窗口 / 标签页编辑时以最后一次保存为准；请在单个窗口中使用工作台。
- 自定义主题在存储中只完整保存一份（首篇文章），其余文章仅保留各自正在使用的主题，加载时自动合并为共享主题预设。
- 批量替换/合并导入先验证持久化成功，再替换当前内存文章库；失败时保持原库可用。
- 主库含未来 schema 时，工作台不挂载可写编辑器、不降级到旧备份，提供原始存储导出。保存入口也拒绝覆盖未来格式。
- 主库损坏但 last-good 可读取时继续支持恢复；写回前将损坏原文保存在 `dsh.markdown-studio.library.unreadable.v2`。主库和备份均无法读取时保留数据并显示恢复说明。

## ZIP 资源预算

导入、流式导出和 Blob 导出共用 `ZIP_LIMITS`：最多 4096 个条目、单条目 50 MiB、解压数据合计 256 MiB，输入归档最多 300 MiB。条目包括 `library.json`、`manifest.json` 与素材。超过预算时明确报错，不生成显示成功但无法恢复的备份；流式写入失败会终止写入。

解压过程中累计实际输出，拒绝伪造长度、损坏内容和重复文件名；最多 4096 个条目的合规归档均可完整读取。相关回归覆盖在 `test/data-integrity.test.ts`、`test/zip.test.ts`、`test/zip-stream.test.ts` 和实际挂载测试中。

## 文件关联与跨会话冲突保护

IndexedDB 中 `document-ref` 的文件/文件夹关联记录包含可选的 `articleId` 和 `version`（SHA-256 正文指纹、文件修改时间与大小）。关联只恢复到所属文章；记录无指纹时，先比较当前草稿与磁盘正文，一致才建立基准。不同内容或无法读取的文件会进入冲突状态。

成功读取/保存才更新内容基准，关联写入按顺序执行。异步重载会校验文章、关联代次、请求序号及读取期间的正文；过期结果不更新任何文章。

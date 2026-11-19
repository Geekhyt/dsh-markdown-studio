# 本地图片服务

**Markdown Studio** 的 Host 半部分。它把粘贴 / 拖入的图片存到插件数据目录，让 Markdown 使用可移植的 `assets/<hash>.png` 引用，并通过回环服务器为预览和剪贴板 HTML 提供图片。没有图片 host、微信凭据、素材库上传或公网 base URL。

服务与编辑器在同一个 bundle 中。修改 Host 代码后需要重新安装 / 重启 bundle；客户端通过同源 JSON 路由调用它。

## HTTP 路由

```http
POST /api/markdown-studio/wechat
Content-Type: application/json
Origin: http://127.0.0.1:52359          # 或桌面 shell scheme
```

动作：

| Action | 用途 |
| --- | --- |
| `health` | 就绪检查；返回 `{ service, version: 5, assets, loopbackOnly, localServerUrl, localServerPort }` |
| `asset.store` | 保存 `{ dataUrl, filename }`；返回 `{ assetPath, url, assetUrl, localUrl, filename, id, mime, bytes }` |
| `asset.list` | 列出本地图片及大小、本地 URL |
| `asset.delete` | 按 `{ filename }` 删除一张图片 |

本地图片也通过认证路由访问：

```http
GET /api/markdown-studio/assets/<24-hex>.(png|jpg)
```

该路由受 DSH Web cookie 保护，对普通图片请求返回 401，因此编辑器使用下面的只读回环服务。action 路由拒绝非 POST、主类型不是 `application/json` 的请求和外部 Web origin；桌面 shell 的自定义 scheme origin 与缺失 origin 允许通过，`null` origin 仅在 `Sec-Fetch-Site: same-origin/none` 时允许通过。图片以“临时文件写入 + 原子重命名”落盘，避免中断写入留下残缺文件。

## 本地图片服务

预览和复制使用回环端口 `4010` 至 `4019` 上的**只读**服务（取第一个可用端口）：

```http
GET http://127.0.0.1:4010/uploads/<hash>.(png|jpg)
GET http://127.0.0.1:4010/health
```

它只提供内容寻址的图片文件，响应头包含 `Access-Control-Allow-Origin: *` 和 immutable 缓存。没有上传接口、目录列表或密钥。action 路由是唯一的写入方。Markdown 保持可移植，每个 `assets/<hash>.png` 在预览和剪贴板 HTML 中解析到这个本地 URL。

## 存储与安全

- 本地图片：`$DSH_HOME/storages/dsh-markdown-studio/assets/<hash>.(png|jpg)`
- Manifest：`assets.json`（MIME、字节数、保存时间）
- 图片服务绑定 `127.0.0.1`，只读
- 图片以 `0644` 写入 `0700` 目录；图片不离开本机
- action 路由只接受回环 JSON；图片为 JPG / PNG，最大 1 MB
- 服务没有 AppID、AppSecret、访问令牌、公网 base URL 或素材库上传

## 图片流程

```text
粘贴 / 拖入
  → 浏览器 data URL
  → POST asset.store（内容哈希，写入 assets/<hash>.png）
  → Markdown：![alt](assets/<hash>.png)     ← 可移植，不含 base64

预览 / 复制
  → 解析 assets/<hash>.png
  → http://127.0.0.1:4010/uploads/<hash>.png
  → 剪贴板 HTML 保留这个本地 URL

导出 bundle
  → article.md + assets/<hash>.png，放进同一个 .zip
```

编辑器加载时会把已有的 `data:` 图片和旧的 `/api/markdown-studio/assets/...` 或 localhost `/uploads/...` URL 迁移到可移植的 `assets/` 路径。

## 开发

```sh
npx tsx test/host.test.ts
```

在用户保存图片之前，默认文章会使用内置示例 JPG；它不会出现在 `asset.list` 中。测试覆盖内容寻址的保存 / 去重 / 列表 / 删除、内置示例、1 MB / 格式限制、本地服务与 CORS、origin / Content-Type 拒绝和认证图片路由。

文件：

```text
index.ts                        Host 组合：路由 + 本地服务
host/application/image-store.ts 内容寻址图片存储与 manifest 校验
host/application/ai-service.ts  宿主默认模型回环 AI 写作服务
host/http/routes.ts             action 路由与认证图片路由
host/http/ai-route.ts           同源回环 AI 写作流式路由
host/local-server.ts            4010+ 的只读 /uploads 服务
dist/index.js               生成的 Host bundle
cordis.patch.yml            profile 配置行
locale/{zh-CN,zh,en}.json   插件管理器元数据
assets/icon.svg             原创插件图标
test/host.test.ts           Host TypeScript 测试
```

## 不包含

- 草稿箱推送（`/cgi-bin/draft/add`）和封面 `thumb_media_id`。
- 公网图床、微信素材库上传、AppID / AppSecret 配置。
- 重新上传远程 `https` 图片；这些图片保持原样。
- GIF / 视频素材；文章图片只支持 JPG / PNG。

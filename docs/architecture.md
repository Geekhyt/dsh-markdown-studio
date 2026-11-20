# Markdown Studio 架构

`dsh-markdown-studio` 是一个单包双端的 DeepSeek Harness 插件，由两部分组成：

- **客户端（Client）**：基于 React + CodeMirror 6 构建的写作与排版工作台，接入宿主侧栏与主视图槽位，并桥接 `@deepseek-ai/dsh-client-ui-primitives` 原生设计体系。
- **服务端（Host）**：运行在宿主 Node 进程中的内容寻址本地图片存储、只读回环图片服务，以及按需复用宿主默认模型的同源回环 AI 写作路由。

全程无自有云端服务、无账号体系、无遥测请求。

## 运行时流程

```text
Harness Web / Desktop
  └─ window.__ModuleLoader__.load(dist/client.js)
       └─ shell-entry.ts (冷启动 4.8 KiB 壳：注册侧栏、多语言与按需视图)
            └─ require.async('./client.studio.js')
                 └─ plugin-entry.ts → app.ts
                      ├─ runtime/             底层 React 生命周期与命令式 DOM 内核（唯一允许 useEffect 的分层）
                      ├─ locales/             中英双语界面字典与宿主语言同步控制器 (ui-strings.ts)
                      ├─ domain/              文章、自定义主题、写作 Skill、行内 Diff、设置、文章库、图片路径、编辑器契约、微信 HTML 门禁纯业务规则
                      ├─ theme-system/        Tone × Rhythm × Atoms 主题组合与 WCAG 对比度收敛
                      ├─ engine.ts            编译门面：markdown-parser.ts (Markdown → 语义 HTML) + css-inliner.ts (CSS 变量与级联内联)
                      ├─ application/         DocumentStore、真响应式业务 hooks (use-*.ts) 与无状态命令工厂
                      ├─ adapters/            DSH 桥、文件工作区、图片编码、回环 AI 流式客户端、微信剪贴板 DOM 清理、深色预览
                      └─ ui/                  原生 DSH 组件桥接、CodeMirror 内核、可逆样式生命周期、顶栏、编辑器、选区气泡、沉浸式底栏、CSS 工作台、行内 Diff 审阅、预览画布、设置抽屉

Harness Host
  └─ index.ts → host/               内容寻址图片存储 + 鉴权写入路由 + 只读回环图片服务 + 同源回环 AI 流式路由
       └─ dist/index.js
```

## 依赖方向

```text
UI → application → domain
  ↘       ↘
   runtime (底层生命周期原语)
       ↑
    adapters → 平台 API
```

架构边界由 `test/architecture.test.ts` 在每次测试中自动校验：

- `domain`、`theme-system`、`engine.ts`（含 `markdown-parser.ts` 与 `css-inliner.ts`）不依赖 React、框架状态、存储或网络。
- **业务层全面封禁 `useEffect` / `useLayoutEffect`**：全仓仅 `src/runtime/` 允许封装底层 React 生命周期与外部订阅原语（`useExternalStore`、`useMountDisposable`、`useWindowEvent`、`usePreviewHtmlSurface` 等）；`application`、`ui`、`adapters` 与入口层一律禁止直接调用 `useEffect` / `useLayoutEffect`。
- **真 Hook 命名契约**：`src/application/use-*.ts` 仅用于真正持有 React/runtime 状态的响应式 Hook；纯命令组装模块统一采用无状态工厂（如 `article-exporter.ts`、`editor-formatting.ts`、`file-commands.ts`）。
- `application` 通过窄接口协调用例，`DocumentStore` 是文档库与自定义主题的唯一写入源。
- `adapters` 封装 DSH 宿主交互、文件系统、剪贴板、HTTP 与渲染器清理逻辑。
- `ui` 专注状态呈现与事件转发，在真实 DSH 内优先渲染宿主原生组件，在独立测试环境无缝回退内置无障碍组件。
- `host` 与客户端源码严格隔离，不反向引用 `src/` 实现。

## 持久化边界

| 数据 | 存储位置 |
| --- | --- |
| 文章库、排版设置与自定义主题 | `localStorage` 的 `dsh.markdown-studio.library.v2` 及 `last-good` 备份 |
| 自定义写作 Skill 与最近选择项 | `localStorage` 的 `dsh.markdown-studio.skills.v1` |
| 本地工作区文件 / 目录句柄 | IndexedDB `mdstudio-files` |
| 本地内容寻址图片 | `$DSH_HOME/storages/dsh-markdown-studio/assets/`（PNG / JPG，魔数校验） |
| 图片元数据清单 | `$DSH_HOME/storages/dsh-markdown-studio/assets.json` |
| 预览与剪贴板本地图片服务 | 只读回环服务 `127.0.0.1:4010` 至 `4019` |

详细 schema 版本与迁移规则见[持久化数据格式](schema.md)。

## 五产物按需分包设计

- `dist/client.js`：客户端冷启动壳（约 `4.8 KiB` / `2.3 KiB` gzip，预算 `50.0 KiB`），宿主冷启动零重依赖解析。
- `dist/client.studio.js`：打开工作台时通过 `require.async('./client.studio.js')` 按需加载的核心工作台与 CodeMirror 6 编辑器（约 `1223.2 KiB` / `382.5 KiB` gzip，预算 `1280.0 KiB`，React 保持 external 由宿主提供）。
- `dist/index.js`：Host 服务端 ESM 产物（约 `103.1 KiB` / `54.0 KiB` gzip，预算 `150.0 KiB`，零外部 npm 运行时依赖）。
- `dist/math.js`：遇到公式时按需加载的 MathJax 3 TeX → 内联路径 SVG 引擎（约 `1761.7 KiB` / `593.2 KiB` gzip，预算 `2048.0 KiB`）。
- `dist/mermaid.js`：遇到图表时按需加载的 Mermaid 11 严格沙箱图表引擎（约 `3413.6 KiB` / `955.5 KiB` gzip，预算 `4096.0 KiB`）。

各包体积上限由 `npm run budget` 门禁强制守卫。

## 质量门槛

- `npm run lint`：Biome 静态检查零报错零警告。
- `tsc --noEmit`：开启 `strict: true` 与 `noImplicitAny: true`。
- `npm test`：覆盖引擎、领域模型、存储迁移、主题配方、多套自定义主题、微信复制规范、可逆样式生命周期、打包契约、DOM 与 Host 路由。
- `npm run quality`：Node 源码测试与 Chromium 源码映射覆盖率合并，完整运行时源码清单独立审计；语句/函数/行覆盖率 >= 90%、分支 >= 65%，所有源码 AST 函数纳入 `CRAP <= 30`，未匹配项逐项记录并按零覆盖计分，五产物满足体积预算。
- `npm run mutation`：杀死关键安全与边界变异。
- `npm run check:host-api`：比对本地 DeepSeek Harness `app.asar` 宿主白名单与原语接口漂移。
- `npm run test:browser`：真实 Chromium 交互、`axe-core` WCAG 2 AA 无障碍审计与 macOS 像素级基线比对。
- `npm run test:dsh`：独立临时 profile 下的真实 DeepSeek Harness 端到端回归测试。

### 覆盖率清单与函数计数对账机制

- `.c8rc.json` 覆盖 `src/`、`host/` 与 `index.ts` 下全部运行时 TypeScript 源码，仅排除类型声明与纯类型模块；`scripts/crap.ts` 会通过 TypeScript AST 独立扫描可执行模块并在缺失时直接失败，防止通过排除规则静默绕过门禁。
- `test/app-dom.test.ts` 直接执行 TypeScript 源码入口；`scripts/build-test.ts` 在 `.testdeps/coverage/` 生成带源码映射的浏览器专用测试产物，由 Chromium 烟雾测试输出 V8 覆盖率并与 Node 覆盖率在 c8 中合并，与 `dist/` 生产构建严格隔离。
- Node 与 Chromium 对同一匿名函数可能给出不同的推断名称；`scripts/coverage-check.ts` 仅在 V8 覆盖块精确匹配整个函数源码范围时才对账函数调用次数（内部块命中绝不外推为函数已调用），原始报告保留在 `coverage/coverage-raw.json`，每条对账记录写入 `coverage/function-entry-reconciliation.json`，全部 AST 函数（含未匹配项按零覆盖计分）写入 `coverage/crap-report.json`。

import fs from 'node:fs';
import path from 'node:path';
import { CODE_THEMES, codeThemeCss } from '../src/code-themes';
import { engine } from '../src/engine';
import { buildCss, THEMES, type ThemeSettings } from '../src/themes';

const root = path.resolve(import.meta.dirname, '..');

const THEME_LABELS: Record<string, { zh: string; en: string; desc: string }> = {
  classic: { zh: '经典', en: 'Classic', desc: '导语蓝起笔线 · 小号章题编号' },
  gallery: { zh: '画廊', en: 'Gallery', desc: '美术馆石纸 · 白展签与卡纸画框' },
  tech: { zh: '新知', en: 'Insight', desc: '紫侧线 TL;DR · 01 / 序号章题' },
  warm: { zh: '森系', en: 'Botanical', desc: '燕麦信纸 · 蜂蜜手划线与便签' },
  night: { zh: '黑金', en: 'Noir Gold', desc: '曜石暗底 · 香槟金居中片头章题' },
  ink: { zh: '文集', en: 'Anthology', desc: '天青线装书页 · 「」章题与三线表' },
  ruby: { zh: '简报', en: 'Briefing', desc: '红顶线简报 · 本期要点与红字结论' },
  poster: { zh: '海报', en: 'Poster', desc: '明黄贴纸导语 · 硬阴影速览与金句' },
};

const SAMPLE_MD = [
  ':::meta 深度特稿 · 约 4 分钟阅读',
  '',
  '# 专注 Markdown 写作，公众号精美版式一键直出',
  '',
  ':::lead',
  '在 **DeepSeek Harness** 中使用 `dsh-markdown-studio` 本地创作：左侧保持纯净 Markdown 源码，右侧实时渲染出符合**微信公众号**内联规范的出版级版式。支持 ==重点高亮==、++下划线++ 与自动外链角注收集。',
  ':::',
  '',
  ':::tldr',
  '- **零云端锁仓**：所有 `.md` 文稿、SHA-256 去重图片与自定义主题均保存在本机',
  '- **全光谱 8 套主题**：内置独立跟随主题代码表面与 8 套经典代码高亮配色',
  ':::',
  '',
  '## 核心排版原子速览',
  '',
  ':::pull 真正优秀的排版工具不绑架你的原始文稿，只放大文字本身的质感。',
  '',
  '> [!TIP] 自定义主题能力',
  '> 支持创建并命名多套自定义 CSS 主题，保存后自动提取色彩缩略卡进入主题预设网格。',
  '',
  '### 代码高亮与防吞空格保护',
  '',
  '```ts',
  'export function compileForWeChat(markdown: string, themeId: string): string {',
  '  const html = renderMarkdown(markdown, { linkFootnotes: true });',
  '  return inlineCascadeStyles(html, buildThemeCss(themeId));',
  '}',
  '```',
  '',
  '### 结构化数据表格与清单',
  '',
  '| 产物模块 | 冷启动 / 按需加载 | 核心职责 |',
  '| :--- | :---: | :--- |',
  '| `dist/client.js` | **4.2 KiB 冷启动壳** | 注册侧边栏入口与多语言，零编辑器阻塞 |',
  '| `dist/client.studio.js` | 按需懒加载 | CodeMirror 6 + 8 套主题 + 微信深色仿真 |',
  '| `dist/math.js` / `mermaid.js` | 按需懒加载 | MathJax 矢量路径公式与 Mermaid 严格沙箱 |',
  '',
  '- [x] 8 套全光谱内置主题（经典 / 画廊 / 新知 / 森系 / 黑金 / 文集 / 简报 / 海报）',
  '- [x] 跟随主题代码表面 + 8 套独立代码块高亮配色',
  '- [ ] 在编辑器行首输入 `/` 唤出斜杠命令面板，或选中段落按 `⌘/Ctrl + J` 润色',
  '',
  '了解更多设计细节请访问 [dsh-markdown-studio 开源主页](https://github.com/Geekhyt/dsh-markdown-studio)。',
  '',
  ':::sign 2026 · Markdown Studio 编辑部',
].join('\n');

const renderedArticle = engine.renderMarkdown(SAMPLE_MD, { linkFootnotes: true }).html;

const themePayloads = THEMES.map((theme) => {
  const baseSettings: ThemeSettings = {
    theme: theme.id,
    codeTheme: 'theme',
    accent: theme.defaultAccent,
    fontSize: 16,
    lineHeight: 1.75,
    allowExternalCssResources: false,
    linkFootnotes: true,
    imagePlaceholders: true,
    codeNbsp: true,
  };
  const meta = THEME_LABELS[theme.id] || { zh: theme.id, en: theme.id, desc: '' };
  return {
    id: theme.id,
    accent: theme.defaultAccent,
    zh: meta.zh,
    en: meta.en,
    desc: meta.desc,
    baseCss: buildCss(baseSettings),
  };
});

const codeCssMap: Record<string, string> = {};
for (const ct of CODE_THEMES) {
  codeCssMap[ct.id] = codeThemeCss(ct.id);
}

const codePaletteOptions = [
  { id: 'theme', label: '跟随文章主题 (Follow Theme)' },
  ...CODE_THEMES.map((c) => ({ id: c.id, label: c.id })),
];

const galleryHtml = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>dsh-markdown-studio · 8 套全光谱主题交互式预览画廊</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: #0b1020;
      --panel: #12192e;
      --border: rgba(148, 163, 184, 0.18);
      --text: #f1f5f9;
      --muted: #94a3b8;
      --brand: #3b82f6;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Segoe UI", sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      display: grid;
      grid-template-columns: 320px 1fr;
    }
    aside {
      background: var(--panel);
      border-right: 1px solid var(--border);
      padding: 24px 20px;
      display: flex;
      flex-direction: column;
      gap: 20px;
      position: sticky;
      top: 0;
      height: 100vh;
      overflow-y: auto;
    }
    .brand { display: flex; flex-direction: column; gap: 4px; }
    .brand h1 { margin: 0; font-size: 17px; letter-spacing: -0.01em; }
    .brand p { margin: 0; font-size: 12px; color: var(--muted); line-height: 1.5; }
    .section-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); margin-bottom: 8px; }
    .theme-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .theme-btn {
      appearance: none;
      text-align: left;
      padding: 10px 11px;
      border-radius: 10px;
      border: 1px solid var(--border);
      background: rgba(255, 255, 255, 0.03);
      color: var(--text);
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .theme-btn:hover { border-color: rgba(96, 165, 250, 0.5); background: rgba(59, 130, 246, 0.08); }
    .theme-btn.is-active { border-color: #60a5fa; background: rgba(59, 130, 246, 0.16); box-shadow: 0 0 0 1px rgba(96, 165, 250, 0.4); }
    .theme-head { display: flex; align-items: center; gap: 7px; font-weight: 600; font-size: 13px; }
    .swatch { width: 10px; height: 10px; border-radius: 999px; flex-shrink: 0; }
    .theme-sub { display: block; font-size: 11px; color: var(--muted); margin-top: 4px; line-height: 1.35; }
    select, .seg-btn {
      width: 100%;
      padding: 8px 10px;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: rgba(15, 23, 42, 0.8);
      color: var(--text);
      font-size: 13px;
    }
    .seg { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
    .seg-btn { cursor: pointer; font-weight: 500; }
    .seg-btn.is-active { background: #2563eb; border-color: #3b82f6; color: #fff; }
    main {
      padding: 36px 24px 64px;
      display: flex;
      justify-content: center;
      align-items: flex-start;
      background: radial-gradient(circle at top, #172038 0%, #0b1020 70%);
      overflow-y: auto;
    }
    .device-shell {
      width: 100%;
      max-width: 430px;
      background: #ffffff;
      color: #1f2328;
      border-radius: 22px;
      padding: 28px 22px;
      box-shadow: 0 24px 60px rgba(0, 0, 0, 0.45);
      transition: max-width 0.2s ease, border-radius 0.2s ease;
    }
    .device-shell.is-desktop { max-width: 760px; border-radius: 14px; padding: 36px 42px; }
    .device-shell.is-night { background: #141418; }
    @media (max-width: 860px) {
      body { grid-template-columns: 1fr; }
      aside { position: static; height: auto; }
    }
  </style>
  <style id="dynamic-theme-css"></style>
</head>
<body>
  <aside>
    <div class="brand">
      <h1>dsh-markdown-studio</h1>
      <p>8 套全光谱原创主题 × 独立代码高亮交互式画廊（由真实 <code>engine.ts</code> 编译生成）</p>
    </div>
    <div>
      <div class="section-label">主题预设 / Theme Presets (8)</div>
      <div class="theme-grid" id="theme-grid"></div>
    </div>
    <div>
      <div class="section-label">代码块配色 / Code Palette</div>
      <select id="code-select"></select>
    </div>
    <div>
      <div class="section-label">预览画布宽度 / Viewport</div>
      <div class="seg">
        <button type="button" class="seg-btn is-active" data-width="mobile">手机卡片 (430px)</button>
        <button type="button" class="seg-btn" data-width="desktop">桌面阅读 (760px)</button>
      </div>
    </div>
  </aside>
  <main>
    <div class="device-shell" id="device-shell">
      <section id="mdstudio" class="mdstudio-content">${renderedArticle}</section>
    </div>
  </main>
  <script>
    const THEMES = ${JSON.stringify(themePayloads)};
    const CODE_CSS = ${JSON.stringify(codeCssMap)};
    const CODE_OPTIONS = ${JSON.stringify(codePaletteOptions)};
    let activeTheme = THEMES[0].id;
    let activeCode = 'theme';

    const gridEl = document.getElementById('theme-grid');
    const selectEl = document.getElementById('code-select');
    const styleEl = document.getElementById('dynamic-theme-css');
    const shellEl = document.getElementById('device-shell');

    CODE_OPTIONS.forEach((opt) => {
      const el = document.createElement('option');
      el.value = opt.id;
      el.textContent = opt.label;
      selectEl.appendChild(el);
    });

    function renderControls() {
      gridEl.innerHTML = '';
      THEMES.forEach((t) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'theme-btn' + (t.id === activeTheme ? ' is-active' : '');
        btn.innerHTML =
          '<span class="theme-head"><span class="swatch" style="background:' + t.accent + '"></span>' +
          t.zh + ' · ' + t.en + '</span><span class="theme-sub">' + t.desc + '</span>';
        btn.onclick = () => { activeTheme = t.id; update(); };
        gridEl.appendChild(btn);
      });
    }

    function update() {
      renderControls();
      const found = THEMES.find((t) => t.id === activeTheme) || THEMES[0];
      const extraCode = activeCode === 'theme' ? '' : ('\\n' + (CODE_CSS[activeCode] || ''));
      styleEl.textContent = found.baseCss + extraCode;
      shellEl.classList.toggle('is-night', found.id === 'night');
    }

    selectEl.onchange = (e) => { activeCode = e.target.value; update(); };
    document.querySelectorAll('[data-width]').forEach((btn) => {
      btn.onclick = () => {
        document.querySelectorAll('[data-width]').forEach((b) => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        shellEl.classList.toggle('is-desktop', btn.dataset.width === 'desktop');
      };
    });

    update();
  </script>
</body>
</html>
`;

const outPath = path.join(root, 'docs/theme-gallery.html');
fs.writeFileSync(outPath, galleryHtml);
console.log(`built docs/theme-gallery.html (${(fs.statSync(outPath).size / 1024).toFixed(1)} KiB)`);

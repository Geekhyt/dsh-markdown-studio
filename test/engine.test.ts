import assert from 'node:assert/strict';
import { extractMermaidBlocks, prependMermaidDirective } from '../src/application/use-mermaid-assets';
import { engine } from '../src/engine';
import { buildCss, DEFAULT_SETTINGS, SAMPLE_MARKDOWN, THEMES } from '../src/themes';

let checks = 0;
function check(name: string, fn: () => void): void {
  fn();
  checks++;
  console.log('ok -', name);
}

check('headings keep the WeChat-ready mdstudio-heading-prefix/content/suffix structure', () => {
  const { html } = engine.renderMarkdown('# 标题\n\n## 二级 **重点**');
  assert.match(
    html,
    /<h1><span class="mdstudio-heading-prefix"><\/span><span class="mdstudio-heading-content">标题<\/span><span class="mdstudio-heading-suffix"><\/span><\/h1>/,
  );
  assert.match(
    html,
    /<h2><span class="mdstudio-heading-prefix"><\/span><span class="mdstudio-heading-content">二级 <strong>重点<\/strong><\/span>/,
  );
});

check('paragraphs, inline code, emphasis, strike, mark, underline and hard breaks', () => {
  const { html } = engine.renderMarkdown('a **b** *c* ~~d~~ ==e== ++f++ `g`\nsecond line');
  assert.match(html, /<strong>b<\/strong>/);
  assert.match(html, /<em>c<\/em>/);
  assert.match(html, /<del>d<\/del>/);
  assert.match(html, /<mark>e<\/mark>/);
  assert.match(html, /<u>f<\/u>/);
  assert.match(html, /<code>g<\/code>/);
  assert.match(html, /<br>second line/);
});

check('external links become numbered references, WeChat links stay anchors', () => {
  const { html, refs } = engine.renderMarkdown(
    'see [docs](https://example.com/a) and [公众号](https://mp.weixin.qq.com/s/abc)',
  );
  assert.equal(refs.length, 1);
  assert.match(html, /<span class="mdstudio-link">docs<sup class="mdstudio-ref">\[1\]<\/sup><\/span>/);
  assert.match(html, /<a href="https:\/\/mp\.weixin\.qq\.com\/s\/abc">公众号<\/a>/);
  assert.match(html, /<section class="mdstudio-references">/);
  assert.match(html, /https:\/\/example\.com\/a/);
});

check('bare URLs keep only a reference marker in the body', () => {
  const { html, refs } = engine.renderMarkdown('See https://example.com/guide and <https://example.com/auto>');
  assert.equal(refs.length, 2);
  assert.match(
    html,
    /See <span class="mdstudio-link"><sup class="mdstudio-ref">\[1\]<\/sup><\/span> and <span class="mdstudio-link"><sup class="mdstudio-ref">\[2\]<\/sup><\/span>/,
  );
  assert.equal(
    html.slice(0, html.indexOf('<section class="mdstudio-references">')).includes('https://example.com/'),
    false,
  );
  assert.match(html, /<section class="mdstudio-references">/);
});

check('tables parse alignment and cells', () => {
  const { html } = engine.renderMarkdown('| a | b |\n| --- | :---: |\n| 1 | 2 |');
  assert.match(html, /<table><thead><tr><th>a<\/th><th style="text-align:center">b<\/th><\/tr><\/thead>/);
  assert.match(html, /<td>1<\/td><td style="text-align:center">2<\/td>/);
});

check('lists, ordered start and task items', () => {
  const { html } = engine.renderMarkdown('- a\n- [x] done\n- [ ] todo\n\n3. three\n4. four');
  assert.match(
    html,
    /<ul><li>a<\/li><li class="mdstudio-task is-checked"><span class="mdstudio-task-box is-checked">✓<\/span><span class="mdstudio-task-text">done<\/span><\/li>/,
  );
  assert.match(
    html,
    /<li class="mdstudio-task"><span class="mdstudio-task-box">\u00a0<\/span><span class="mdstudio-task-text">todo<\/span><\/li><\/ul>/,
  );
  assert.match(html, /<ol start="3"><li>three<\/li><li>four<\/li><\/ol>/);

  const pureTasks = engine.renderMarkdown('- [x] first\n- [ ] second\n- [x]');
  assert.match(pureTasks.html, /^<ul class="mdstudio-task-list">/);
  assert.match(
    pureTasks.html,
    /<li class="mdstudio-task is-checked"><span class="mdstudio-task-box is-checked">✓<\/span><\/li>/,
  );

  const looseTasks = engine.renderMarkdown('- [x] first\n\n  detail\n\n- [ ]\n  ```js\n  1\n  ```');
  assert.match(
    looseTasks.html,
    /<li class="mdstudio-task is-checked"><p><span class="mdstudio-task-box is-checked">✓<\/span><span class="mdstudio-task-text">first<\/span><\/p><p>detail<\/p><\/li>/,
  );
  assert.match(
    looseTasks.html,
    /<li class="mdstudio-task"><p><span class="mdstudio-task-box">\u00a0<\/span><\/p><pre>/,
  );
});

check('plain blockquotes keep paragraphs and blank-line boundaries', () => {
  const single = engine.renderMarkdown('> first\n> second');
  assert.match(single.html, /<blockquote><p>first<br>second<\/p><\/blockquote>/);
  const separated = engine.renderMarkdown('> first\n\n> second');
  assert.equal((separated.html.match(/<blockquote>/g) || []).length, 1);
  assert.match(separated.html, /first[\s\S]*second/);
});

check('alerts use default titles and tolerate empty content', () => {
  const defaultTitle = engine.renderMarkdown('> [!TIP]\n>\n> body');
  assert.match(defaultTitle.html, /mdstudio-alert-tip/);
  assert.match(defaultTitle.html, /mdstudio-alert-title/);
  assert.match(defaultTitle.html, /<p>body<\/p>/);
  const directBody = engine.renderMarkdown('> [!NOTE]\n> direct body without blank quote line');
  assert.match(directBody.html, /mdstudio-alert-note/);
  assert.match(directBody.html, /<p>direct body without blank quote line<\/p>/);
  const consecutive = engine.renderMarkdown('> plain quote\n\n> [!NOTE]\n> first\n\n> [!WARNING]\n> second');
  assert.match(consecutive.html, /<blockquote><p>plain quote<\/p><\/blockquote>/);
  assert.match(consecutive.html, /mdstudio-alert-note[\s\S]*<p>first<\/p>/);
  assert.match(consecutive.html, /mdstudio-alert-warning[\s\S]*<p>second<\/p>/);
  const empty = engine.renderMarkdown('> [!NOTE]');
  assert.match(empty.html, /mdstudio-alert-note/);
  assert.match(empty.html, /mdstudio-alert-title/);
});

check('blockquotes render nested lists and code', () => {
  const html = engine.renderMarkdown('> intro\n>\n> - one\n> - two\n>\n> `code`').html;
  assert.match(html, /<blockquote>/);
  assert.match(html, /<ul><li>one<\/li><li>two<\/li><\/ul>/);
  assert.match(html, /<code>code<\/code>/);
});

check('blockquote alert syntax produces a titled callout', () => {
  const { html } = engine.renderMarkdown('> [!WARNING] 慢一点\n> 注意保存。');
  assert.match(html, /<section class="mdstudio-alert mdstudio-alert-warning">/);
  assert.match(html, /<p class="mdstudio-alert-title">慢一点<\/p>/);
  assert.match(html, /<p>注意保存。<\/p>/);
});

check('fenced code keeps the language and highlights tokens', () => {
  const { html } = engine.renderMarkdown('```js\nconst x = "hi"; // note\n```');
  assert.match(html, /<pre><code class="mdstudio-lang-js">/);
  assert.match(html, /mdstudio-tok-keyword">const<\/span>/);
  assert.match(html, /mdstudio-tok-comment">\/\/ note<\/span>/);
});

check('frontmatter is extracted instead of rendered', () => {
  const { html, meta } = engine.renderMarkdown('---\ntitle: 标题\nauthor: 我\n---\n\n正文');
  assert.equal(meta.title, '标题');
  assert.equal(meta.author, '我');
  assert.equal(html, '<p>正文</p>');
});

check('triple emphasis and nested emphasis parse', () => {
  const { html } = engine.renderMarkdown('***强烈强调*** and **外 *内* 外**');
  assert.match(html, /<strong><em>强烈强调<\/em><\/strong>/);
  assert.match(html, /<strong>外 <em>内<\/em> 外<\/strong>/);
});

check('ordered starts, mixed markers and loose list items', () => {
  const ordered = engine.renderMarkdown('3. three\n4. four');
  assert.match(ordered.html, /<ol start="3"><li>three<\/li><li>four<\/li><\/ol>/);
  const mixed = engine.renderMarkdown('- a\n1. b');
  assert.match(mixed.html, /<ul><li>a<\/li><\/ul>/);
  assert.match(mixed.html, /<ol><li>b<\/li><\/ol>/);
  const loose = engine.renderMarkdown('- a\n\n  continuation\n\n- b');
  assert.match(loose.html, /<p>continuation<\/p>/);
  const fenced = engine.renderMarkdown('- item\n  ```js\n  const x = 1;\n  ```');
  assert.match(fenced.html, /<pre><code class="mdstudio-lang-js">/);
  for (const source of ['* a\n* b', '+ a\n+ b', '1) one\n2) two', '- [X] done', '- a\n\n- b']) {
    assert.match(engine.renderMarkdown(source).html, /<(ul|ol)\b/);
  }
  const terminated = engine.renderMarkdown('- a\n\nparagraph');
  assert.match(terminated.html, /<ul><li>a<\/li><\/ul>/);
  assert.match(terminated.html, /<p>paragraph<\/p>/);
  const nested = engine.renderMarkdown('- a\n  - b');
  assert.match(nested.html, /<ul><li>a<ul><li>b<\/li><\/ul><\/li><\/ul>/);
  assert.match(engine.renderMarkdown('  - a\n  - b').html, /<ul><li>a<\/li><li>b<\/li><\/ul>/);
  assert.match(engine.renderMarkdown('- a\n\n\n- b').html, /<li><p>a<\/p><\/li>/);
  assert.match(engine.renderMarkdown('- a\n  continued').html, /continued/);
});

check('lists keep lazy continuation lines', () => {
  const lazy = engine.renderMarkdown('- first line\nsecond line');
  assert.match(lazy.html, /first line[\s\S]*second line/);
});

check('lists keep loose items and mixed markers', () => {
  const loose = engine.renderMarkdown('- a\n\n- b');
  assert.match(loose.html, /<li><p>a<\/p>/);
  assert.match(loose.html, /<li><p>b<\/p><\/li>/);
});

check('nested lists and multi-paragraph items', () => {
  const { html } = engine.renderMarkdown('- 一级\n  - 二级 A\n  - 二级 B\n- 一级二\n\n1. 第一段\n\n   第二段');
  assert.match(html, /<ul><li>一级<ul><li>二级 A<\/li><li>二级 B<\/li><\/ul><\/li><li>一级二<\/li><\/ul>/);
  assert.match(html, /<ol><li><p>第一段<\/p><p>第二段<\/p><\/li><\/ol>/);
});

check('alerts keep their body blocks and ordered list support', () => {
  const { html } = engine.renderMarkdown('> [!NOTE] 注意事项\n> 第一行\n>\n> - 列表项');
  assert.match(html, /mdstudio-alert-note/);
  assert.match(html, /<p class="mdstudio-alert-title">[\s\S]*注意事项<\/p>/);
  assert.match(html, /<p>第一行<\/p><ul><li>列表项<\/li><\/ul>/);
});

check('raw HTML in markdown is escaped', () => {
  const { html } = engine.renderMarkdown('<script>alert(1)</script>');
  assert.equal(html, '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
});

check('images are self closing and escaped', () => {
  const { html } = engine.renderMarkdown('![封面](https://x.test/a.png "t")');
  assert.match(html, /<img src="https:\/\/x\.test\/a\.png" alt="封面" title="t">/);
});

check('css rules parse into selectors, declarations and important flags', () => {
  const rules = engine.parseRules(`
    /* comment */
    @charset "UTF-8";
    @import "https://example.com/theme.css";
    #mdstudio h2, .mdstudio-heading-prefix::before { color: #fff !important; background: url("a;b.png") }
    @media (max-width: 600px) { body { color: red } }
    p { margin: 0; }
  `);
  assert.equal(rules.length, 2);
  assert.deepEqual(rules[0].selectors, ['#mdstudio h2', '.mdstudio-heading-prefix::before']);
  assert.equal(rules[0].decls[0].prop, 'color');
  assert.equal(rules[0].decls[0].important, true);
  assert.equal(rules[0].decls[1].value, 'url("a;b.png")');
});

check('selector normalization maps html/body/:root to #mdstudio', () => {
  assert.equal(engine.normalizeSelector(':root'), '#mdstudio');
  assert.equal(engine.normalizeSelector('body p'), '#mdstudio p');
  assert.equal(engine.normalizeSelector('html body .mdstudio-heading-content'), '#mdstudio .mdstudio-heading-content');
  assert.equal(engine.normalizeSelector('#mdstudio h2'), '#mdstudio h2');
  assert.equal(engine.normalizeSelector('.mdstudio-content h2'), '.mdstudio-content h2');
});

check('specificity ordering is stable', () => {
  assert.ok(engine.selectorSpecificity('#mdstudio h2') > engine.selectorSpecificity('h2'));
  assert.ok(engine.selectorSpecificity('.mdstudio-content h2') > engine.selectorSpecificity('.mdstudio-content'));
});

check('css variables resolve with fallbacks and nesting', () => {
  const vars = { '--a': '#123456', '--b': 'var(--a)' };
  assert.equal(engine.resolveVars('var(--b)', vars), '#123456');
  assert.equal(engine.resolveVars('1px solid var(--missing, red)', vars), '1px solid red');
  assert.equal(engine.resolveVars('var(--a) var( --a )', vars), '#123456 #123456');
});

check('every theme compiles to balanced CSS with real values', () => {
  for (const theme of THEMES) {
    const settings = {
      ...DEFAULT_SETTINGS,
      theme: theme.id,
      accent: theme.defaultAccent,
      fontSize: 16,
      lineHeight: 1.85,
    };
    const css = buildCss(settings);
    assert.ok(css.includes('.mdstudio-content'), `${theme.id} has root rule`);
    assert.ok(!css.includes('undefined'), `${theme.id} has no undefined values`);
    assert.ok(!css.includes('NaN'), `${theme.id} has no NaN values`);
    let depth = 0;
    for (const char of css) {
      if (char === '{') depth++;
      if (char === '}') depth--;
      assert.ok(depth >= 0, `${theme.id} braces stay balanced`);
    }
    assert.equal(depth, 0, `${theme.id} braces close`);
  }
});

check('custom css is appended after the theme', () => {
  const css = buildCss({
    ...DEFAULT_SETTINGS,
    theme: 'custom:test',
    customThemes: [{ id: 'custom:test', name: 'Test', css: '#mdstudio h2 { color: red; }' }],
  });
  assert.ok(css.trimEnd().endsWith('#mdstudio h2 { color: red; }'));
});

check('sample markdown renders every featured block', () => {
  const { html, refs } = engine.renderMarkdown(SAMPLE_MARKDOWN);
  assert.match(html, /<h1>/);
  assert.match(html, /<h2>/);
  assert.match(html, /<blockquote>/);
  assert.match(html, /mdstudio-alert-note/);
  assert.match(html, /mdstudio-alert-tip/);
  assert.match(html, /mdstudio-alert-important/);
  assert.match(html, /mdstudio-alert-warning/);
  assert.match(html, /mdstudio-alert-caution/);
  assert.match(html, /<pre><code class="mdstudio-lang-js">/);
  assert.match(html, /<table>/);
  assert.match(
    html,
    /<li class="mdstudio-task is-checked"><span class="mdstudio-task-box is-checked">✓<\/span><span class="mdstudio-task-text">打开编辑器<\/span><\/li>/,
  );
  assert.match(
    html,
    /<li class="mdstudio-task"><span class="mdstudio-task-box">\u00a0<\/span><span class="mdstudio-task-text">写一篇自己的文章<\/span><\/li>/,
  );
  assert.match(html, /mdstudio-math/);
  assert.match(html, /data-mdstudio-display="1"/);
  assert.match(html, /mdstudio-lang-mermaid/);
  assert.match(html, /<img src="assets\/f59d29cfbd29d8d1a9d7284f\.jpg"/);
  assert.match(html, /<h4>/);
  assert.match(html, /<h5>/);
  assert.match(html, /<h6>/);
  assert.match(html, /<ol>/);
  assert.match(html, /mdstudio-footnotes/);
  assert.match(html, /class="mdstudio-scroll"/);
  assert.match(html, /class="mdstudio-scroll-x"/);
  assert.match(html, /class="mdstudio-scroll-media"/);
  assert.match(html, /class="mdstudio-scroll-caption"/);
  assert.equal(refs.length, 3);
  assert.ok(html.length > 1800);
});

check('unsafe link and image schemes are neutralized', () => {
  const unsafe = engine.renderMarkdown(
    '[x](javascript:alert(1)) ![a](javascript:alert(1)) [d](data:text/html,x) ![f](file:///tmp/x.png) ![s](data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=)',
  );
  assert.equal(unsafe.html.includes('<a '), false, 'javascript/data links are not anchors');
  assert.equal(unsafe.html.includes('<img'), false, 'javascript/file images are not emitted');
  assert.ok(unsafe.html.includes('x'), 'unsafe link label is preserved as text');
  const obfuscated = engine.renderMarkdown(
    '[t](<java\tscript:alert(1)>) [c](\u0001javascript:alert(2)) [n](<java\nscript:alert(3)>) ![i](<java\tscript:x.png>)',
  );
  assert.equal(obfuscated.html.includes('<a '), false, 'control/whitespace-obfuscated schemes are not anchors');
  assert.equal(obfuscated.html.includes('<img'), false, 'control/whitespace-obfuscated image schemes are dropped');
  const safe = engine.renderMarkdown('[m](mailto:a@b.test) [r](/docs) ![d](data:image/png;base64,AAAA)');
  assert.ok(safe.html.includes('href="mailto:a@b.test"'), 'mailto is allowed');
  assert.ok(safe.html.includes('href="/docs"'), 'relative links are allowed');
  assert.ok(safe.html.includes('src="data:image/png;base64,AAAA"'), 'image data URLs are allowed');
});

check('markdown footnotes render and number in reference order', () => {
  const { html } = engine.renderMarkdown('A[^b] and B[^a].\n\n[^a]: first note\n[^b]: second note');
  assert.match(html, /A<sup class="mdstudio-footnote-ref">\[1\]<\/sup>/);
  assert.match(html, /B<sup class="mdstudio-footnote-ref">\[2\]<\/sup>/);
  assert.match(html, /mdstudio-footnotes/);
  assert.match(
    html,
    /id="mdstudio-fn-1">\[1\] second note<\/p><p class="mdstudio-footnote-item" id="mdstudio-fn-2">\[2\] first note/,
  );
  assert.ok(!html.includes('[^a]:'));
  assert.ok(!html.includes('[^b]:'));
  const enRefs = engine.renderMarkdown('[DeepSeek](https://example.com) and note[^copy].\n\n[^copy]: Endnote body.', {
    locale: 'en',
    linkFootnotes: true,
    referencesTitle: 'References',
  });
  assert.match(enRefs.html, /<p class="mdstudio-refs-title">References<\/p>/);
  assert.match(enRefs.html, /<sup class="mdstudio-ref">\[1\]<\/sup>/);
  assert.match(enRefs.html, /<sup class="mdstudio-footnote-ref">\[n1\]<\/sup>/);
  assert.match(enRefs.html, /id="mdstudio-fn-1">\[n1\] Endnote body\.<\/p>/);

  const zhRefs = engine.renderMarkdown('[DeepSeek](https://example.com) 与脚注[^copy]。\n\n[^copy]: 脚注说明。', {
    locale: 'zh',
    linkFootnotes: true,
  });
  assert.match(zhRefs.html, /<sup class="mdstudio-ref">\[1\]<\/sup>/);
  assert.match(zhRefs.html, /<sup class="mdstudio-footnote-ref">\[注1\]<\/sup>/);
  assert.match(zhRefs.html, /id="mdstudio-fn-1">\[注1\] 脚注说明。<\/p>/);
});

check('vertical and horizontal scroll containers render cleanly', () => {
  const vertical = engine.renderMarkdown(
    '导语段落\n:::scroll 320\n**第一段**\n\n```txt\n:::\n```\n:::\n\n:::scroll 80px\n短高度下限\n:::',
    { scrollVerticalHint: '上下滑动 ↕' },
  );
  assert.match(vertical.html, /<p>导语段落<\/p><section class="mdstudio-scroll">/);
  assert.match(vertical.html, /<p class="mdstudio-scroll-hint">上下滑动 ↕<\/p>/);
  assert.match(vertical.html, /class="mdstudio-scroll-body" style="max-height: 320px;"/);
  assert.match(vertical.html, /class="mdstudio-scroll-body" style="max-height: 120px;"/);
  assert.match(vertical.html, /<pre><code class="mdstudio-lang-txt">:::<\/code><\/pre>/);

  const horizontalCards = engine.renderMarkdown(':::scroll-x\n**卡片一**\n\n```md\n---\n```\n---\n**卡片二**\n:::', {
    scrollHorizontalHint: '左右滑动 ↔',
  });
  assert.match(horizontalCards.html, /class="mdstudio-scroll-x"/);
  assert.match(horizontalCards.html, /class="mdstudio-scroll-track"/);
  assert.equal((horizontalCards.html.match(/class="mdstudio-scroll-slide"/g) || []).length, 2);
  assert.match(horizontalCards.html, /<p class="mdstudio-scroll-x-hint">左右滑动 ↔<\/p>/);

  const horizontalGallery = engine.renderMarkdown(
    ':::scroll-x\n![机位 A](https://example.com/a.png)\n![机位 B](https://example.com/b.png)\n![](https://example.com/c.png)\n:::\n\n:::scroll-x\n第一段\n\n第二段\n:::',
  );
  assert.equal((horizontalGallery.html.match(/class="mdstudio-scroll-media"/g) || []).length, 3);
  assert.equal((horizontalGallery.html.match(/class="mdstudio-scroll-caption"/g) || []).length, 2);
  assert.equal((horizontalGallery.html.match(/class="mdstudio-scroll-slide"/g) || []).length, 5);
});

check('multiline display math, table pipes inside math/code, and mermaid frontmatter directives', () => {
  const mathDoc = engine.renderMarkdown(
    [
      '$$x = 1$$',
      '',
      '$$',
      'f(x) = \\begin{cases}',
      '-x^2, & x < 0 \\\\',
      '',
      '> 0 \\text{ branch}, & x > 0',
      '\\end{cases}',
      '$$',
      '',
      '$$',
      '$$',
      '',
      '| 名称 | 公式 | 类型 |',
      '| :--- | :---: | ---: |',
      '| 贝叶斯 | $P(A|B)$ | `a | b` |',
      '| 转义 | a \\| b | $\\|x\\|_2$ |',
      '',
      '$$unclosed',
      'still prose',
    ].join('\n'),
  );
  const displayMatches = mathDoc.html.match(/class="mdstudio-math" data-mdstudio-display="1"/g) || [];
  assert.equal(
    displayMatches.length,
    2,
    'renders single-line and multiline display math while falling back on unclosed/empty $$',
  );
  assert.equal(mathDoc.html.includes('<blockquote>'), false, '> inside $$ block is not parsed as blockquote');
  assert.equal(mathDoc.html.includes('<ul>'), false, '- inside $$ block is not parsed as list');
  assert.match(mathDoc.html, /&#10;/, 'preserves newlines as HTML entities inside data-mdstudio-tex');
  assert.equal(
    (mathDoc.html.match(/<td/g) || []).length,
    6,
    'table cells preserve | inside inline math, inline code, and \\| escapes',
  );
  assert.match(mathDoc.html, /data-mdstudio-display="0" data-mdstudio-tex="P\(A\|B\)"/);
  assert.match(mathDoc.html, /data-mdstudio-display="0" data-mdstudio-tex="\\\|x\\\|_2"/);
  assert.match(mathDoc.html, />a \| b<\/td>/);
  assert.match(mathDoc.html, /<code>a \| b<\/code>/);

  const mermaidBlocks = extractMermaidBlocks(
    '```mermaid\nflowchart LR\n  A-->B\n```\n\n~~~mermaid\npie\n  "A": 1\n~~~',
  );
  assert.deepEqual(mermaidBlocks, ['flowchart LR\n  A-->B', 'pie\n  "A": 1']);
  const withFm = prependMermaidDirective('---\ntitle: Demo\n---\nflowchart LR\n  A-->B', '%%{init: {}}%%');
  assert.ok(
    withFm.startsWith('---\ntitle: Demo\n---\n%%{init: {}}%%\nflowchart LR'),
    'keeps YAML frontmatter on line 1',
  );
  const withoutFm = prependMermaidDirective('flowchart LR\n  A-->B', '%%{init: {}}%%');
  assert.equal(withoutFm, '%%{init: {}}%%\nflowchart LR\n  A-->B');

  const underscores = engine.renderMarkdown(
    '标识符 QUANTUM_MATRIX_2026 与 foo__bar__baz 保持原样，而 _foo_bar_ 与 __bold_snake__ 正常强调。',
  );
  assert.ok(underscores.html.includes('QUANTUM_MATRIX_2026'), 'intraword single underscores stay literal');
  assert.ok(underscores.html.includes('foo__bar__baz'), 'intraword double underscores stay literal');
  assert.ok(underscores.html.includes('<em>foo_bar</em>'), 'boundary _..._ allows intraword underscores inside');
  assert.ok(
    underscores.html.includes('<strong>bold_snake</strong>'),
    'boundary __...__ allows intraword underscores inside',
  );
});

check('CommonMark and GFM specification edge cases hold across inline and block constructs', () => {
  // §6.1 Backslash escapes (all 32 ASCII punctuation including \$) & §6.7 hard line breaks
  assert.equal(
    engine.renderMarkdown('Price \\$10 to \\$20, \\<tag>, \\^sup, \\notpunct').html,
    '<p>Price $10 to $20, &lt;tag&gt;, ^sup, \\notpunct</p>',
  );
  assert.match(
    engine.renderMarkdown('cost is $x = \\$5$ inline').html,
    /data-mdstudio-display="0" data-mdstudio-tex="x = \\\$5"/,
  );
  assert.equal(engine.renderMarkdown('line1  \nline2\\\nline3').html, '<p>line1<br>line2<br>line3</p>');

  // §6.2 HTML character entities & numeric references (XSS-safe)
  assert.equal(
    engine.renderMarkdown('A &copy; 2026 &mdash; &#65; &#x42; &#0; &#xD800; &#x110000; &#60;b&#62; &unknownEntity;')
      .html,
    '<p>A © 2026 — A B \ufffd \ufffd \ufffd &lt;b&gt; &amp;unknownEntity;</p>',
  );

  // §6.3 Code spans: exact backtick run length, single padding space stripping, all-space preservation, unclosed runs
  assert.equal(
    engine.renderMarkdown('`` ` `` and `` `code` `` and `foo `` bar` and `   ` and ``unclosed `x`').html,
    '<p><code>`</code> and <code>`code`</code> and <code>foo `` bar</code> and <code>   </code> and ``unclosed <code>x</code></p>',
  );
  // §4.5 Single-line triple-backtick code span does not open an unclosed fenced code block
  assert.equal(
    engine.renderMarkdown('```inline code```\n\nNext paragraph').html,
    '<p><code>inline code</code></p><p>Next paragraph</p>',
  );

  // §6.4 Emphasis flanking whitespace, code/math precedence, and *outer **inner** outer*
  assert.equal(
    engine.renderMarkdown('2 * 3 * 4 = 24 and a ** b ** c and a == b == c').html,
    '<p>2 * 3 * 4 = 24 and a ** b ** c and a == b == c</p>',
  );
  assert.equal(
    engine.renderMarkdown('**a `**` b** and *外 **内** 外*').html,
    '<p><strong>a <code>**</code> b</strong> and <em>外 <strong>内</strong> 外</em></p>',
  );

  // §4.3 Setext headings (H1 === and H2 ---) without breaking === into <mark>
  const setext = engine.renderMarkdown('Setext H1\n=========\n\nSetext H2\n---------');
  assert.match(
    setext.html,
    /<h1><span class="mdstudio-heading-prefix"><\/span><span class="mdstudio-heading-content">Setext H1<\/span><span class="mdstudio-heading-suffix"><\/span><\/h1>/,
  );
  assert.match(
    setext.html,
    /<h2><span class="mdstudio-heading-prefix"><\/span><span class="mdstudio-heading-content">Setext H2<\/span><span class="mdstudio-heading-suffix"><\/span><\/h2>/,
  );

  // §4.7 Reference-style links ([text][id], [text][], [shortcut]) and reference images
  const refLinks = engine.renderMarkdown(
    '[OpenAI][ai], [Guide][], [Shortcut], ![Logo][img], [Unresolved][none]\n\n[ai]: https://openai.com "AI"\n[guide]: https://mp.weixin.qq.com/s/guide\n[shortcut]: /local\n[img]: assets/f59d29cfbd29d8d1a9d7284f.jpg "Pic"',
  );
  assert.match(refLinks.html, /mdstudio-link">OpenAI<sup class="mdstudio-ref">\[1\]<\/sup>/);
  assert.match(refLinks.html, /<a href="https:\/\/mp\.weixin\.qq\.com\/s\/guide">Guide<\/a>/);
  assert.match(refLinks.html, /<a href="\/local">Shortcut<\/a>/);
  assert.match(refLinks.html, /<img src="assets\/f59d29cfbd29d8d1a9d7284f\.jpg" alt="Logo" title="Pic">/);
  assert.ok(refLinks.html.includes('[Unresolved][none]'));

  // GFM §6.9 Bare autolink trailing punctuation & balanced parens + GFM §4.10 table column mismatch + §5.1/5.2 quote/list
  const gfm = engine.renderMarkdown(
    '括号：(https://example.com/b)，词条：https://en.wikipedia.org/wiki/Markdown_(markup) 结尾 https://example.com/a。\n\na | b\n--- | --- | ---\n1 | 2\n\n> q1\nq2\n\n-\n- item2',
  );
  assert.ok(
    gfm.html.includes('括号：(<span class="mdstudio-link"><sup class="mdstudio-ref">[1]</sup></span>)，词条：'),
  );
  assert.ok(gfm.html.includes('1. https://example.com/b</p>'));
  assert.ok(gfm.html.includes('2. https://en.wikipedia.org/wiki/Markdown_(markup)</p>'));
  assert.ok(gfm.html.includes('3. https://example.com/a</p>'));
  assert.equal(gfm.html.includes('<table>'), false, 'mismatched header/delimiter column count does not form a table');
  assert.ok(gfm.html.includes('<blockquote><p>q1<br>q2</p></blockquote>'), 'blockquote supports lazy continuation');
  assert.ok(gfm.html.includes('<ul><li></li><li>item2</li></ul>'), 'empty list item renders cleanly');
});

check('v2 editorial containers (tldr, pull, sign, meta), frontmatter eyebrow, and standalone image captions', () => {
  const rich = engine.renderMarkdown(
    [
      '---',
      'category: AI 写作',
      '---',
      '',
      '# 标题',
      '',
      ':::lead',
      '五分钟，讲一个**今天就能照做**的写法。',
      ':::',
      '',
      ':::lead 单行导语写法',
      '',
      ':::tldr 本期速览',
      '- 要点一',
      '- 要点二',
      ':::',
      '',
      ':::tldr',
      '- 默认标题',
      ':::',
      '',
      ':::pull',
      '给一个例子，胜过十句要求。',
      ':::',
      '',
      '![图：把目标挪到第一行之后](https://example.com/a.png)',
      '',
      '![image.png](https://example.com/b.png)',
      '',
      ':::sign',
      '写于一个不赶时间的下午。',
      '觉得有用，就点个「在看」吧。',
      ':::',
    ].join('\n'),
  );
  assert.match(rich.html, /<p class="mdstudio-meta">AI 写作 · 约 1 分钟读完<\/p><h1/);
  assert.match(rich.html, /<p class="mdstudio-lead">五分钟，讲一个<strong>今天就能照做<\/strong>的写法。<\/p>/);
  assert.match(rich.html, /<p class="mdstudio-lead">单行导语写法<\/p>/);
  assert.match(rich.html, /<section class="mdstudio-tldr"><p class="mdstudio-tldr-title">本期速览<\/p><ul>/);
  assert.match(rich.html, /<p class="mdstudio-tldr-title" data-mdstudio-default-tldr="1">30 秒速览<\/p>/);
  assert.match(rich.html, /<section class="mdstudio-pull">给一个例子，胜过十句要求。<\/section>/);
  assert.match(rich.html, /<p class="mdstudio-figure"><img src="https:\/\/example\.com\/a\.png"/);
  assert.match(rich.html, /<p class="mdstudio-caption">图：把目标挪到第一行之后<\/p>/);
  assert.equal(rich.html.includes('>image.png</p>'), false, 'bare filename alt does not emit redundant caption');
  assert.match(rich.html, /<p class="mdstudio-sign">写于一个不赶时间的下午。<br>觉得有用，就点个「在看」吧。<\/p>/);

  const customMeta = engine.renderMarkdown('---\nmeta: 专栏特稿 · 5 分钟\n---\n\n正文');
  assert.match(customMeta.html, /^<p class="mdstudio-meta">专栏特稿 · 5 分钟<\/p><p>正文<\/p>$/);

  const blockMeta = engine.renderMarkdown(
    ':::meta\n深度观察\n约 4 分钟\n:::\n\n:::meta 单行眉题\n\n:::pull 单行金句写法\n\n后续正文',
  );
  assert.match(blockMeta.html, /<p class="mdstudio-meta">深度观察 · 约 4 分钟<\/p>/);
  assert.match(blockMeta.html, /<p class="mdstudio-meta">单行眉题<\/p>/);
  assert.match(blockMeta.html, /<section class="mdstudio-pull">单行金句写法<\/section><p>后续正文<\/p>/);
});

check('TeX math delimiters \\(...\\) and \\[...\\] render natively while preserving escapes and code', () => {
  const doc = engine.renderMarkdown(
    [
      '行内公式 \\(E = mc^2\\) 与带空格的 \\( S = \\alpha R + \\beta C \\)，且强调 **粗体 \\(a * b\\) 保持完整**。',
      '',
      '带链接 [\\(a[0]\\)](https://example.com/math) 与代码 `\\(code\\)` 与转义 \\\\(literal\\\\) 与空 \\(\\) 与 \\[note] 与未闭合 \\(open。',
      '',
      '\\[ \\text{ROI} = \\frac{1}{2} \\]',
      '',
      '\\[',
      'f(x) = \\begin{cases}',
      '-x^2, & x < 0 \\\\',
      '> 0, & x > 0',
      '\\end{cases}',
      '\\]',
      '',
      '段内展示公式 \\[a + b = c\\] 后接正文。',
      '',
      '| 公式 | 说明 |',
      '| :--- | :--- |',
      '| \\(P(A|B)\\) | 条件概率 |',
      '',
      '```ts',
      'const raw = "\\(not math\\)";',
      '```',
      '',
      '\\[',
      'unclosed display',
    ].join('\n'),
  );

  assert.match(doc.html, /data-mdstudio-display="0" data-mdstudio-tex="E = mc\^2"/);
  assert.match(doc.html, /data-mdstudio-display="0" data-mdstudio-tex="S = \\alpha R \+ \\beta C"/);
  assert.match(
    doc.html,
    /<strong>粗体 <span class="mdstudio-math" data-mdstudio-display="0" data-mdstudio-tex="a \* b"><\/span> 保持完整<\/strong>/,
  );
  assert.match(doc.html, /data-mdstudio-display="0" data-mdstudio-tex="a\[0\]"/);
  assert.match(doc.html, /<code>\\\(code\\\)<\/code>/);
  assert.match(doc.html, /\\\(literal\\\)/);
  assert.match(doc.html, /与空 \(\) 与 \[note\] 与未闭合 \(open。/);
  assert.match(
    doc.html,
    /<p><span class="mdstudio-math" data-mdstudio-display="1" data-mdstudio-tex="\\text\{ROI\} = \\frac\{1\}\{2\}"><\/span><\/p>/,
  );
  assert.match(
    doc.html,
    /data-mdstudio-display="1" data-mdstudio-tex="f\(x\) = \\begin\{cases\}&#10;-x\^2, &amp; x &lt; 0 \\\\&#10;&gt; 0, &amp; x &gt; 0&#10;\\end\{cases\}"/,
  );
  assert.match(
    doc.html,
    /段内展示公式 <span class="mdstudio-math" data-mdstudio-display="1" data-mdstudio-tex="a \+ b = c"><\/span> 后接正文。/,
  );
  assert.equal((doc.html.match(/<td/g) || []).length, 2, 'table cell preserves | inside \\(P(A|B)\\)');
  assert.match(doc.html, /data-mdstudio-display="0" data-mdstudio-tex="P\(A\|B\)"/);
  assert.equal(doc.html.includes('data-mdstudio-tex="not math"'), false, 'fenced code skips \\(...\\)');
  assert.equal(doc.html.includes('<blockquote>'), false, '> inside \\[...\\] is not parsed as blockquote');
  assert.match(doc.html, /unclosed display/);
});

check('regression: apostrophe tables, currency $, intraword ++/==, nested scroll :::, and CSS $ selectors', () => {
  const tbl = engine.renderMarkdown("| Col A | Col B |\n| --- | --- |\n| It's fine | (open |\n");
  assert.equal((tbl.html.match(/<td/g) || []).length, 2, 'unmatched apostrophe or paren does not merge table cells');
  assert.match(tbl.html, /It&#39;s fine/);

  const cur = engine.renderMarkdown('Price is $10 and $20, while $x + 1$ is math.');
  assert.equal(cur.html.includes('data-mdstudio-tex="10'), false, 'currency $10 and $20 stays plain text');
  assert.match(cur.html, /\$10 and \$20/);
  assert.match(cur.html, /data-mdstudio-tex="x \+ 1"/);

  const intra = engine.renderMarkdown('Use C++17 and a==b==c with ++underline++ and ==mark==.');
  assert.equal(intra.html.includes('C<u>'), false, 'C++17 does not become underline');
  assert.equal(intra.html.includes('a<mark>'), false, 'a==b==c does not become mark');
  assert.match(intra.html, /<u>underline<\/u>/);
  assert.match(intra.html, /<mark>mark<\/mark>/);

  const nestedScroll = engine.renderMarkdown(':::scroll\nOuter\n:::pull\nInner quote\n:::\nAfter\n:::\n');
  assert.match(nestedScroll.html, /mdstudio-scroll-body/);
  assert.match(nestedScroll.html, /mdstudio-pull/);
  assert.match(nestedScroll.html, /After/);

  const singleLineLeadInScroll = engine.renderMarkdown(
    ':::scroll\n:::lead Intro sentence\n\nBody text\n:::\n\nOutside text\n',
  );
  assert.match(
    singleLineLeadInScroll.html,
    /<\/section><\/section><p>Outside text<\/p>/,
    'single-line :::lead inside :::scroll does not swallow outer closing :::',
  );

  assert.equal(
    engine.renderMarkdown('**a ***b*** c**').html,
    '<p><strong>a <strong><em>b</em></strong> c</strong></p>',
  );
  assert.equal(engine.renderMarkdown('*a ***b*** c*').html, '<p><em>a <strong><em>b</em></strong> c</em></p>');
  assert.equal(engine.renderMarkdown('**foo***').html, '<p><strong>foo</strong>*</p>');
  assert.equal(engine.renderMarkdown('**bold and *italic***').html, '<p><strong>bold and <em>italic</em></strong></p>');
  assert.equal(engine.renderMarkdown('*italic and **bold***').html, '<p><em>italic and <strong>bold</strong></em></p>');

  const mixedCurMath = engine.renderMarkdown('原价$100，现价$50，公式$x+1$结束');
  assert.match(mixedCurMath.html, /原价\$100，现价\$50，公式<span class="mdstudio-math"[^>]*data-mdstudio-tex="x\+1"/);

  const curTable = engine.renderMarkdown('| Plan | A | B |\n| --- | --- | --- |\n| Pro | $100 | $50 |\n');
  assert.equal((curTable.html.match(/<td/g) || []).length, 3, 'currency $ cells do not merge table columns');

  const suffixed = engine.renderMarkdown('==API==s and ++UI++s and ==高亮==词');
  assert.equal(suffixed.html, '<p><mark>API</mark>s and <u>UI</u>s and <mark>高亮</mark>词</p>');
});

console.log(`\n${checks} engine checks passed.`);

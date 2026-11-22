/*
 * Optional real-DSH E2E.
 *
 * Requires DSH_CLI to point at @deepseek-ai/dsh/lib/bin.js. A dedicated web
 * profile is created in DSH_HOME/profiles, the CLI prints its authenticated URL,
 * and Playwright drives that page. The profile is removed afterwards.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { resolveChromiumExecutable } from './chromium-executable';

const root = path.resolve(import.meta.dirname, '..');
const realHome = path.join(os.homedir(), '.dsh');
const isolatedHome = process.env.DSH_HOME ? '' : fs.mkdtempSync(path.join(os.tmpdir(), 'mdstudio-dsh-e2e-'));
const home = process.env.DSH_HOME || isolatedHome;
if (isolatedHome) {
  fs.mkdirSync(path.join(isolatedHome, 'profiles'), { recursive: true });
  const sharedNodeModules = path.join(realHome, 'profiles', 'node_modules');
  if (fs.existsSync(sharedNodeModules)) {
    fs.symlinkSync(sharedNodeModules, path.join(isolatedHome, 'profiles', 'node_modules'), 'dir');
  }
}
const macAppCli = '/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh';
const cli =
  process.env.DSH_CLI ||
  (fs.existsSync(macAppCli)
    ? macAppCli
    : path.join(home, 'profiles', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'));
const profile = 'mdstudio-e2e-' + process.pid;
const profileDir = path.join(home, 'profiles', profile);

if (!fs.existsSync(cli)) {
  console.error('DSH_CLI is required: point it at the dsh CLI or @deepseek-ai/dsh/lib/bin.js');
  process.exit(2);
}
fs.mkdirSync(path.join(profileDir, 'node_modules'), { recursive: true });
fs.writeFileSync(
  path.join(profileDir, 'package.json'),
  JSON.stringify(
    {
      name: 'dsh-profile-' + profile,
      private: true,
      dependencies: { 'dsh-markdown-studio': 'link:' + root },
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-markdown-studio'] } },
    },
    null,
    2,
  ) + '\n',
);
fs.writeFileSync(path.join(profileDir, 'cordis.yml'), '[]\n');
fs.writeFileSync(path.join(profileDir, 'cordis.patch.yml'), '# generated for mdstudio e2e\n[]\n');
fs.writeFileSync(path.join(profileDir, 'pnpm-workspace.yaml'), 'packages:\n  - .\n');
const link = path.join(profileDir, 'node_modules', 'dsh-markdown-studio');
fs.symlinkSync(root, link, 'dir');

const cliArgs = ['--profile', profile, '--no-open', '--port', '0'];
const child = cli.endsWith('.js')
  ? spawn(process.execPath, [cli, ...cliArgs], {
      cwd: root,
      env: { ...process.env, DSH_HOME: home },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  : spawn(cli, cliArgs, {
      cwd: root,
      env: { ...process.env, DSH_HOME: home },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
let output = '';
let url = '';
child.stdout.setEncoding('utf8');
child.stderr.setEncoding('utf8');
child.stdout.on('data', (chunk: string) => {
  output += chunk;
  const match = /dsh web: (http:\/\/[^\s]+)/.exec(output);
  if (match) url = match[1];
});
child.stderr.on('data', (chunk: string) => {
  output += chunk;
});

async function waitForUrl(): Promise<string> {
  const started = Date.now();
  while (!url && Date.now() - started < 30_000) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    if (child.exitCode !== null) break;
  }
  if (!url) {
    console.error(output.slice(-4000));
    throw new Error('DSH web did not print an authenticated URL');
  }
  return url;
}

let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
try {
  const authenticatedUrl = await waitForUrl();
  const executablePath = resolveChromiumExecutable();
  browser = await chromium.launch({ headless: true, executablePath });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(authenticatedUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForTimeout(2000);
  for (let attempt = 0; attempt < 4; attempt++) {
    const dialogBtn = page.locator('[role="dialog"] button, [role="alertdialog"] button');
    if ((await dialogBtn.count()) > 0) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(250);
      if ((await dialogBtn.count()) > 0) {
        await dialogBtn.last().click({ force: true });
        await page.waitForTimeout(300);
      }
    } else {
      break;
    }
  }
  const entry = page.getByRole('button', { name: 'Markdown Studio' });
  try {
    await entry.first().waitFor({ timeout: 20000 });
  } catch (error) {
    console.error('PAGE_ERRORS', errors);
    console.error('DSH_OUTPUT', output.slice(-6000));
    console.error('BODY_TEXT', (await page.locator('body').innerText()).slice(0, 2000));
    throw error;
  }
  await entry.first().click();
  await page.waitForSelector('.mdstudio-root', { timeout: 15_000 });
  assert.equal(
    await page.locator('.mdstudio-header').getAttribute('data-window-drag'),
    'true',
    'header opts into the DSH native window drag contract',
  );
  assert.equal(
    await page.locator('.mdstudio-focus-btn svg').getAttribute('width'),
    '16',
    'immersive entry uses the 16px icon size',
  );
  await page.waitForSelector('.cm-editor', { timeout: 15_000 });
  await page.waitForSelector('.mdstudio-preview-article .mdstudio-math svg', { timeout: 15_000 });
  await page.waitForTimeout(1200);
  assert.ok(
    (await page.locator('.mdstudio-preview-article img[alt="Mermaid diagram"]').count()) > 0,
    'Mermaid renders in DSH',
  );

  // Verify default sidebar-expanded DSH window (1280x800 -> ~1024px studio width) keeps toolbar pure and free of overflow
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(250);
  const expandedToolbarCheck = await page.evaluate(() => {
    const toolbar = document.querySelector('.mdstudio-toolbar') as HTMLElement | null;
    const fmt = document.querySelector('.mdstudio-format-trigger') as HTMLElement | null;
    const toolbarSkill = document.querySelector('.mdstudio-toolbar .mdstudio-skill-split');
    const floatingSkill = document.querySelector('.mdstudio-skill-split.is-floating');
    if (!toolbar || !fmt) return null;
    return {
      toolbarScroll: toolbar.scrollWidth,
      toolbarClient: toolbar.clientWidth,
      hasToolbarSkill: toolbarSkill !== null,
      hasFloatingSkillWithoutSelection: floatingSkill !== null,
    };
  });
  assert.ok(expandedToolbarCheck, 'toolbar exists in sidebar-expanded DSH');
  assert.equal(expandedToolbarCheck.hasToolbarSkill, false, 'formatting toolbar contains no AI button');
  assert.equal(
    expandedToolbarCheck.hasFloatingSkillWithoutSelection,
    false,
    'floating AI pill stays hidden until text is selected',
  );
  assert.ok(
    expandedToolbarCheck.toolbarScroll <= expandedToolbarCheck.toolbarClient + 1,
    `sidebar-expanded toolbar does not overflow horizontally (${expandedToolbarCheck.toolbarScroll} vs ${expandedToolbarCheck.toolbarClient})`,
  );
  if (process.env.DSH_E2E_EXPANDED_SCREENSHOT) {
    await page.screenshot({ path: process.env.DSH_E2E_EXPANDED_SCREENSHOT });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(200);

  const collapseBtn = page.getByRole('button', { name: /^(Collapse sidebar|收起侧边栏)$/ });
  if (await collapseBtn.count()) {
    await collapseBtn.first().click();
    await page.waitForTimeout(500);
    const collapsedLayout = await page.evaluate(() => {
      const header = document.querySelector('.mdstudio-header') as HTMLElement | null;
      const body = document.querySelector('.mdstudio-body') as HTMLElement | null;
      const root = document.querySelector('.mdstudio-root') as HTMLElement | null;
      if (!header || !body || !root) return null;
      return {
        headerBottom: header.getBoundingClientRect().bottom,
        bodyTop: body.getBoundingClientRect().top,
        bodyBottom: body.getBoundingClientRect().bottom,
        rootBottom: root.getBoundingClientRect().bottom,
        rootScroll: root.scrollHeight,
        rootClient: root.clientHeight,
      };
    });
    assert.ok(collapsedLayout, 'layout metrics exist after collapsing the DSH sidebar');
    assert.ok(
      collapsedLayout.headerBottom <= collapsedLayout.bodyTop + 1,
      'plugin header does not overlap the body after sidebar collapse',
    );
    assert.ok(
      collapsedLayout.bodyBottom <= collapsedLayout.rootBottom + 1,
      'plugin body fits the root after sidebar collapse',
    );
    assert.ok(
      collapsedLayout.rootScroll <= collapsedLayout.rootClient + 1,
      'plugin root does not overflow after sidebar collapse',
    );
    const headerInset = await page.evaluate(() =>
      parseFloat(getComputedStyle(document.querySelector('.mdstudio-header') as HTMLElement).paddingLeft),
    );
    assert.ok(
      headerInset >= 100,
      `plugin header reserves the host titlebar inset after sidebar collapse (${headerInset}px)`,
    );
    const headerTransition = await page.evaluate(
      () => getComputedStyle(document.querySelector('.mdstudio-header') as HTMLElement).transitionProperty,
    );
    assert.ok(!headerTransition.includes('padding-left'), 'titlebar inset is applied synchronously in DSH');

    // Regression: shrinking macOS desktop window <= 720px (e.g. 720px split-view & 451px narrow window) must never overlap traffic lights + DSH leading controls
    await page.evaluate(() => document.documentElement.setAttribute('data-platform', 'darwin'));
    for (const narrowW of [720, 451]) {
      await page.setViewportSize({ width: narrowW, height: 800 });
      await page.waitForTimeout(160);
      const narrowCheck = await page.evaluate(() => {
        const root = document.querySelector('.mdstudio-root') as HTMLElement;
        const header = document.querySelector('.mdstudio-header') as HTMLElement;
        const titleInput = document.querySelector('.mdstudio-title-input') as HTMLElement;
        const maxHostRight = Array.from(document.querySelectorAll('button'))
          .filter((el) => !root.contains(el))
          .map((el) => el.getBoundingClientRect())
          .filter((r) => r.width > 0 && r.top >= 0 && r.top < 52 && r.left >= 0 && r.right <= 240)
          .reduce((m, r) => Math.max(m, Math.round(r.right)), 72);
        return {
          paddingLeft: parseFloat(getComputedStyle(header).paddingLeft),
          maxHostRight,
          titleLeft: Math.round(titleInput.getBoundingClientRect().left),
          scrollW: header.scrollWidth,
          clientW: header.clientWidth,
        };
      });
      assert.ok(
        narrowCheck.paddingLeft >= 160 && narrowCheck.titleLeft >= narrowCheck.maxHostRight + 8,
        `narrow macOS desktop (${narrowW}px) clears traffic lights & host buttons (${JSON.stringify(narrowCheck)})`,
      );
      assert.ok(
        narrowCheck.scrollW <= narrowCheck.clientW + 1,
        `narrow macOS desktop (${narrowW}px) header does not overflow (${narrowCheck.scrollW} vs ${narrowCheck.clientW})`,
      );
    }
    await page.evaluate(() => document.documentElement.removeAttribute('data-platform'));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(200);
  }
  await page.locator('.mdstudio-device-btn', { hasText: 'PC' }).click();
  const pcScroll = await page.evaluate(() => {
    const screen = document.querySelector('.mdstudio-device-screen') as HTMLElement | null;
    if (!screen) return null;
    screen.scrollTop = 180;
    return { top: screen.scrollTop, height: screen.scrollHeight, client: screen.clientHeight };
  });
  assert.ok(pcScroll && pcScroll.height > pcScroll.client && pcScroll.top > 0, 'real DSH PC preview scrolls');
  await page.locator('.mdstudio-device-btn', { hasText: '手机' }).click();

  await page.locator('.cm-content').click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.type('# DSH E2E\n\n**ok** and $a^2+b^2=c^2$');
  await page.waitForFunction(
    () => document.querySelector('.mdstudio-preview-article h1')?.textContent === 'DSH E2E',
    undefined,
    { timeout: 8000 },
  );
  await page.locator('.mdstudio-header button[aria-label="更多"]').click();
  await page.waitForSelector('.mdstudio-header-menu', { timeout: 3000 });
  if (process.env.DSH_E2E_HEADER_MENU_SCREENSHOT)
    await page.screenshot({ path: process.env.DSH_E2E_HEADER_MENU_SCREENSHOT });
  const headerMenuSurface = await page.evaluate(() => {
    const menu = document.querySelector('.mdstudio-header-menu') as HTMLElement | null;
    const mat = menu?.querySelector('[class*="_material_"]') as HTMLElement | null;
    const item = menu?.querySelector('button[role="menuitem"]') as HTMLElement | null;
    if (!menu || !mat || !item) return null;
    const menuStyle = getComputedStyle(menu);
    const matStyle = getComputedStyle(mat);
    const itemStyle = getComputedStyle(item);
    return {
      material: menu.getAttribute('data-menu-material'),
      fill: matStyle.backgroundColor,
      backdrop: matStyle.backdropFilter,
      opacity: menuStyle.opacity,
      borderRadius: menuStyle.borderRadius,
      boxShadow: menuStyle.boxShadow,
      itemMinHeight: itemStyle.minHeight,
      itemPadding: itemStyle.padding,
    };
  });
  await page.keyboard.press('Escape');
  await page.waitForSelector('.mdstudio-header-menu', { state: 'detached', timeout: 3000 });

  await page.locator('.cm-line').first().click();
  await page.locator('.mdstudio-format-trigger').click();
  await page.waitForSelector('.mdstudio-format-menu', { timeout: 3000 });
  if (process.env.DSH_E2E_FORMAT_MENU_SCREENSHOT)
    await page.screenshot({ path: process.env.DSH_E2E_FORMAT_MENU_SCREENSHOT });
  assert.equal(
    await page.locator('.mdstudio-format-menu [role="menuitem"]').count(),
    33,
    'format menu lists headings and every format command (including v2 editorial directives)',
  );
  const formatMenuSurface = await page.evaluate(() => {
    const trigger = document.querySelector('.mdstudio-format-trigger') as HTMLElement | null;
    const menu = document.querySelector('.mdstudio-format-menu') as HTMLElement | null;
    const mat = menu?.querySelector('[class*="_material_"]') as HTMLElement | null;
    const item = menu?.querySelector('button[role="menuitem"]') as HTMLElement | null;
    if (!trigger || !menu || !mat || !item) return null;
    const triggerRect = trigger.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const menuStyle = getComputedStyle(menu);
    const matStyle = getComputedStyle(mat);
    const itemStyle = getComputedStyle(item);
    return {
      material: menu.getAttribute('data-menu-material'),
      fill: matStyle.backgroundColor,
      backdrop: matStyle.backdropFilter,
      opacity: menuStyle.opacity,
      borderRadius: menuStyle.borderRadius,
      boxShadow: menuStyle.boxShadow,
      itemMinHeight: itemStyle.minHeight,
      itemPadding: itemStyle.padding,
      belowTrigger: menuRect.top >= triggerRect.bottom,
    };
  });
  assert.ok(headerMenuSurface && formatMenuSurface, 'both header and format menus mount native DSH MenuSurface');
  assert.equal(formatMenuSurface.material, 'translucent', 'format menu uses genuine DSH translucent MenuSurface');
  assert.equal(
    formatMenuSurface.belowTrigger,
    true,
    'format menu anchors cleanly below the format trigger without covering the toolbar',
  );
  assert.equal(
    formatMenuSurface.material,
    headerMenuSurface.material,
    'format and header menus share identical DSH MenuSurface material',
  );
  assert.equal(
    formatMenuSurface.fill,
    headerMenuSurface.fill,
    'format and header menus share identical inner _material_ background fill & alpha',
  );
  assert.equal(
    formatMenuSurface.backdrop,
    headerMenuSurface.backdrop,
    'format and header menus share identical inner _material_ backdropFilter',
  );
  assert.equal(
    formatMenuSurface.opacity,
    headerMenuSurface.opacity,
    'format and header menus share identical surface opacity',
  );
  assert.equal(
    formatMenuSurface.borderRadius,
    headerMenuSurface.borderRadius,
    'format and header menus share identical DSH borderRadius',
  );
  assert.equal(
    formatMenuSurface.boxShadow,
    headerMenuSurface.boxShadow,
    'format and header menus share identical DSH boxShadow',
  );
  assert.equal(
    formatMenuSurface.itemMinHeight,
    headerMenuSurface.itemMinHeight,
    'format and header menus share identical DSH item minHeight',
  );
  assert.equal(
    formatMenuSurface.itemPadding,
    headerMenuSurface.itemPadding,
    'format and header menus share identical DSH item padding',
  );
  await page.getByRole('menuitem', { name: /五级标题/ }).click();
  await page.waitForFunction(
    () => document.querySelector('.cm-line')?.textContent?.startsWith('##### DSH E2E'),
    undefined,
    { timeout: 3000 },
  );
  for (let level = 1; level <= 6; level++) {
    await page.locator('.cm-line').first().click();
    await page.keyboard.press((process.platform === 'darwin' ? 'Meta+' : 'Control+') + String(level));
    await page.waitForFunction(
      (expected) => document.querySelector('.cm-line')?.textContent?.startsWith(expected),
      '#'.repeat(level) + ' DSH E2E',
      { timeout: 3000 },
    );
  }
  const boldTool = page.locator('.mdstudio-tool[aria-label^="加粗"]');
  await boldTool.hover();
  await page.waitForSelector('[role="tooltip"], .mdstudio-tooltip', { timeout: 3000 });
  assert.ok(
    ((await page.locator('[role="tooltip"], .mdstudio-tooltip').first().textContent()) || '').includes('加粗'),
    'toolbar hover shows a named tooltip',
  );
  await page.locator('.mdstudio-focus-btn').click();
  await page.waitForSelector('.mdstudio-immersive-dock', { timeout: 3000 });
  assert.equal(
    await page.locator('.mdstudio-root').getAttribute('data-mdstudio-immersive'),
    'write',
    'focus button enters immersive writing in DSH',
  );
  assert.equal(
    await page.locator('.mdstudio-header').evaluate((el) => getComputedStyle(el).display),
    'none',
    'immersive mode hides the DSH header',
  );
  assert.equal(
    await page.locator('.mdstudio-toolbar').evaluate((el) => getComputedStyle(el).display),
    'none',
    'immersive writing hides the format toolbar in DSH',
  );
  assert.ok(
    ((await page.locator('.cm-content').textContent()) || '').includes('##### DSH E2E'),
    'immersive writing keeps the Markdown source visible',
  );
  if (process.env.DSH_E2E_IMMERSIVE_SCREENSHOT)
    await page.screenshot({ path: process.env.DSH_E2E_IMMERSIVE_SCREENSHOT });
  await page.locator('.mdstudio-immersive-mode', { hasText: '预览' }).click();
  await page.waitForTimeout(100);
  assert.equal(
    await page.locator('.mdstudio-root').getAttribute('data-mdstudio-immersive'),
    'preview',
    'dock switches to immersive preview in DSH',
  );
  assert.equal(
    await page.locator('.mdstudio-preview-head').evaluate((el) => getComputedStyle(el).display),
    'none',
    'immersive preview hides preview controls in DSH',
  );
  if (process.env.DSH_E2E_IMMERSIVE_PREVIEW_SCREENSHOT)
    await page.screenshot({ path: process.env.DSH_E2E_IMMERSIVE_PREVIEW_SCREENSHOT });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  assert.equal(
    await page.locator('.mdstudio-root').getAttribute('data-mdstudio-immersive'),
    null,
    'Escape exits immersive mode in DSH',
  );

  const lightPreview = await page.evaluate(() => {
    const screen = document.querySelector('.mdstudio-device-screen');
    const article = document.querySelector('.mdstudio-preview-article #mdstudio');
    return {
      screen: screen ? getComputedStyle(screen).backgroundColor : '',
      color: article ? getComputedStyle(article).color : '',
    };
  });
  await page.evaluate(() => document.body.setAttribute('data-ds-dark-theme', ''));
  await page.waitForFunction(
    (previous) => {
      const screen = document.querySelector('.mdstudio-device-screen');
      const article = document.querySelector('.mdstudio-preview-article #mdstudio');
      return (
        !!screen &&
        !!article &&
        getComputedStyle(screen).backgroundColor !== previous.screen &&
        getComputedStyle(article).color !== previous.color
      );
    },
    lightPreview,
    { timeout: 8000 },
  );
  const darkPreview = await page.evaluate(() => {
    const screen = document.querySelector('.mdstudio-device-screen');
    const article = document.querySelector('.mdstudio-preview-article #mdstudio');
    return {
      screen: screen ? getComputedStyle(screen).backgroundColor : '',
      color: article ? getComputedStyle(article).color : '',
    };
  });
  assert.notEqual(darkPreview.screen, lightPreview.screen, 'official Dark Mode preview changes the paper background');
  assert.notEqual(darkPreview.color, lightPreview.color, 'official Dark Mode preview changes article text');
  await page.evaluate(() => document.body.removeAttribute('data-ds-dark-theme'));
  await page.waitForFunction(
    (previous) => {
      const screen = document.querySelector('.mdstudio-device-screen');
      const article = document.querySelector('.mdstudio-preview-article #mdstudio');
      return (
        !!screen &&
        !!article &&
        getComputedStyle(screen).backgroundColor === previous.screen &&
        getComputedStyle(article).color === previous.color
      );
    },
    lightPreview,
    { timeout: 5000 },
  );
  await page.locator('.mdstudio-style-btn').click();
  await page.waitForSelector('.mdstudio-drawer', { timeout: 3000 });
  const dshDocked = await page.evaluate(() => {
    const editor = document.querySelector('.mdstudio-editor-pane') as HTMLElement | null;
    const preview = document.querySelector('.mdstudio-preview-pane') as HTMLElement | null;
    const drawer = document.querySelector('.mdstudio-drawer') as HTMLElement | null;
    if (!editor || !preview || !drawer) return null;
    return {
      editorVisible: getComputedStyle(editor).display === 'flex',
      previewVisible: getComputedStyle(preview).display === 'flex',
      drawerWidth: Math.round(drawer.getBoundingClientRect().width),
      capsules: drawer.querySelectorAll('.mdstudio-capsule-track').length,
    };
  });
  assert.ok(
    dshDocked && dshDocked.editorVisible && dshDocked.previewVisible,
    'editor and preview stay visible beside right-docked settings in DSH',
  );
  assert.ok(
    dshDocked && Math.abs(dshDocked.drawerWidth - 336) <= 2,
    `settings inspector docks at 336px in DSH (${dshDocked?.drawerWidth}px)`,
  );
  assert.equal(
    dshDocked?.capsules,
    2,
    'settings inspector renders capsule controls for fontSize and lineHeight in DSH',
  );
  // Verify 2-tab settings drawer (主题 | 帮助) and all 8 built-in v2 themes + theme-linked code swatch
  const drawerTabLabels = await page
    .locator('.mdstudio-drawer [role="tab"]')
    .evaluateAll((els) => els.map((el) => (el.textContent || '').trim()));
  assert.deepEqual(drawerTabLabels, ['主题', '帮助'], 'settings drawer exposes cleanly 2 tabs (主题, 帮助)');
  for (const themeLabel of ['经典', '画廊', '新知', '森系', '黑金', '文集', '简报', '海报']) {
    const card = page.locator('.mdstudio-theme-card', { hasText: themeLabel }).first();
    assert.equal(await card.count(), 1, `built-in v2 theme card "${themeLabel}" exists in DSH`);
    await card.click();
  }
  await page.locator('.mdstudio-theme-card', { hasText: '经典' }).first().click();
  await page.locator('.mdstudio-style-btn').click();
  await page.waitForSelector('.mdstudio-drawer', { state: 'detached' });

  // Verify Host local image service (health + asset.store + loopback /uploads/<hash>.png) in real DSH
  const hostAssetCheck = await page.evaluate(async () => {
    const tinyPngDataUrl =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl9sAAAAASUVORK5CYII=';
    const healthRes = await fetch('/api/markdown-studio/wechat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'health' }),
    });
    const health = (await healthRes.json()) as { ok?: boolean; localServerUrl?: string };
    const storeRes = await fetch('/api/markdown-studio/wechat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'asset.store', filename: 'e2e.png', dataUrl: tinyPngDataUrl }),
    });
    const stored = (await storeRes.json()) as { ok?: boolean; localUrl?: string; assetPath?: string };
    let loopbackStatus = 0;
    if (stored.localUrl) {
      const imgRes = await fetch(stored.localUrl);
      loopbackStatus = imgRes.status;
    }
    return { healthOk: health.ok, storeOk: stored.ok, assetPath: stored.assetPath, loopbackStatus };
  });
  assert.equal(hostAssetCheck.healthOk, true, 'real DSH host /api/markdown-studio/wechat health ok');
  assert.equal(hostAssetCheck.storeOk, true, 'real DSH host stores PNG asset');
  assert.match(hostAssetCheck.assetPath || '', /^assets\/[a-f0-9]{24}\.png$/, 'stored asset uses 24-hex SHA-256 path');
  assert.equal(hostAssetCheck.loopbackStatus, 200, 'read-only loopback server serves stored PNG with 200 OK');

  assert.equal(
    await page.locator('.mdstudio-focus-btn svg').getAttribute('data-icon'),
    'dsw-icon-fullscreen-outline-regular',
    'immersive button renders native DSH sprite icon',
  );
  assert.equal(
    await page.locator('.mdstudio-tool[aria-label^="行内代码"] svg').getAttribute('data-icon'),
    'dsw-icon-inspect-outline-regular',
    'inline code button renders native DSH </> inspect icon instead of hashtag',
  );
  assert.equal(
    await page.locator('.mdstudio-format-trigger .mdstudio-heading-caret svg').getAttribute('data-icon'),
    'dsw-icon-chevron-down-outline-regular',
    'format trigger renders native DSH chevron-down icon',
  );
  assert.equal(
    await page.locator('.mdstudio-outline-anchor svg').getAttribute('viewBox'),
    '0 0 16 16',
    'document outline button renders 16x16 heading hierarchy icon instead of folder',
  );
  const sidebarEntrySvg = await page
    .locator('nav [aria-current="page"] svg')
    .first()
    .evaluate((el) => ({
      viewBox: el.getAttribute('viewBox'),
      stroke: el.getAttribute('stroke'),
      strokeWidth: el.getAttribute('stroke-width'),
    }));
  assert.equal(sidebarEntrySvg.viewBox, '0 0 16 16', 'DSH sidebar entry uses native 16x16 viewBox');
  assert.equal(sidebarEntrySvg.stroke, 'currentColor', 'DSH sidebar entry uses monochrome currentColor outline');
  assert.equal(sidebarEntrySvg.strokeWidth, '1.3', 'active DSH sidebar entry uses 1.3 medium stroke weight');
  const bodyTokenCheck = await page.evaluate(() => {
    const bodyStyle = getComputedStyle(document.body);
    return {
      mdsBgBase: bodyStyle.getPropertyValue('--mdstudio-ui-bg-base').trim(),
      dswBgBase: bodyStyle.getPropertyValue('--dsw-alias-bg-base').trim(),
    };
  });
  assert.ok(
    bodyTokenCheck.mdsBgBase && bodyTokenCheck.mdsBgBase === bodyTokenCheck.dswBgBase,
    'body-portaled surfaces inherit live --dsw-alias-* tokens on document.body',
  );

  await page.locator('button[aria-label="文章库"]').click();
  await page.waitForSelector('[role="dialog"].mdstudio-library-modal', { timeout: 3000 });
  const nativeLibraryPrimitives = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"].mdstudio-library-modal') as HTMLElement | null;
    const row = dialog?.querySelector('.mdstudio-library-row') as HTMLElement | null;
    if (!dialog || !row) return null;
    const style = getComputedStyle(dialog);
    const rowStyle = getComputedStyle(row);
    return {
      paddingTop: style.paddingTop,
      borderRadius: style.borderRadius,
      headlessNoH2: dialog.querySelector('h2') === null,
      rowBorderTop: rowStyle.borderTopWidth,
      nativeButtons: dialog.querySelectorAll('button[class*="_button_"]').length,
      nativeInputWrap: dialog.querySelectorAll('span[class*="_wrap_"] input').length,
      noRawSelect: dialog.querySelectorAll('select').length === 0,
    };
  });
  assert.ok(nativeLibraryPrimitives, 'library modal opens in real DSH');
  assert.equal(nativeLibraryPrimitives.paddingTop, '0px', 'headless native DSH Modal keeps 0px top padding');
  assert.equal(
    nativeLibraryPrimitives.borderRadius,
    '28px',
    'native DSH Modal keeps its 28px --dsw-radius-panel corner',
  );
  assert.equal(
    nativeLibraryPrimitives.headlessNoH2,
    true,
    'LibraryDialog uses headless DSH Modal without redundant header h2',
  );
  assert.equal(
    nativeLibraryPrimitives.rowBorderTop,
    '0px',
    'LibraryDialog rows use borderless native DSH session-row styling',
  );
  assert.ok(nativeLibraryPrimitives.nativeButtons >= 1, 'LibraryDialog renders genuine DSH forwardRef Button');
  assert.equal(nativeLibraryPrimitives.nativeInputWrap, 1, 'LibraryDialog renders genuine DSH forwardRef Input');
  assert.equal(nativeLibraryPrimitives.noRawSelect, true, 'LibraryDialog contains zero raw HTML select elements');
  await page.locator('.mdstudio-library-more-btn').click();
  await page.waitForSelector('[data-menu-material].mdstudio-library-menu', { timeout: 3000 });
  await page.keyboard.press('Escape');
  await page.waitForSelector('[data-menu-material].mdstudio-library-menu', { state: 'detached', timeout: 3000 });
  assert.equal(
    await page.locator('[role="dialog"].mdstudio-library-modal').count(),
    1,
    'Escape while library more-menu is open closes only the menu',
  );
  await page.evaluate(() => {
    delete (window as unknown as Record<string, unknown>).showSaveFilePicker;
  });
  await page.locator('.mdstudio-library-more-btn').click();
  await page.waitForSelector('[data-menu-material].mdstudio-library-menu', { timeout: 3000 });
  const [e2eArchiveDl] = await Promise.all([
    page.waitForEvent('download', { timeout: 8000 }),
    page.getByRole('menuitem', { name: '导出文章库备份 (.zip)' }).click(),
  ]);
  assert.ok(
    e2eArchiveDl.suggestedFilename().endsWith('.zip'),
    'clicking portaled menuitem inside native DSH Modal triggers action without premature unmount',
  );
  await page.keyboard.press('Escape');
  await page.waitForSelector('[role="dialog"]', { state: 'detached', timeout: 3000 });

  await page.locator('.mdstudio-header button[aria-label="更多"]').click();
  await page.getByRole('menuitem', { name: '清空当前文章' }).click();
  await page.waitForSelector('[role="dialog"]', { timeout: 3000 });
  const dangerModalCheck = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement | null;
    return {
      hasWarnIcon: Boolean(dialog?.querySelector('svg[data-icon*="warning"]')),
      nativeFooterButtons: dialog ? dialog.querySelectorAll('button[class*="_button_"]').length : 0,
    };
  });
  assert.equal(
    dangerModalCheck.hasWarnIcon,
    true,
    'danger confirm dialog renders native DSH Modal tone="warning" icon',
  );
  assert.equal(dangerModalCheck.nativeFooterButtons, 2, 'danger confirm dialog renders native DSH footer Buttons');
  await page.keyboard.press('Escape');
  await page.waitForSelector('[role="dialog"]', { state: 'detached', timeout: 3000 });

  // Real DSH AI route + Writing Skill Manager verification
  const aiStatusRes = await page.evaluate(async () => {
    const res = await fetch('/api/markdown-studio/ai', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'ai.status' }),
    });
    return { status: res.status, json: (await res.json()) as { ok?: boolean; available?: boolean } };
  });
  assert.equal(aiStatusRes.status, 200, 'real DSH host serves /api/markdown-studio/ai');
  assert.equal(aiStatusRes.json.ok, true, 'real DSH AI status endpoint responds with ok: true');

  // Verify mouse drag (including backwards right-to-left) places floating AI pill right at the final mouse release point
  const targetLineBox = await page.locator('.cm-line').nth(2).boundingBox();
  assert.ok(targetLineBox, 'editor prose line has measurable bounding box');
  const dragStartX = Math.round(targetLineBox.x + 150);
  const dragEndX = Math.round(targetLineBox.x + 28);
  const dragY = Math.round(targetLineBox.y + 10);
  await page.mouse.move(dragStartX, dragY);
  await page.mouse.down();
  await page.mouse.move(dragEndX, dragY, { steps: 5 });
  await page.waitForTimeout(60);
  assert.equal(
    await page.locator('.mdstudio-skill-split.is-floating').count(),
    0,
    'floating AI pill stays hidden while mouse button is still held down during drag',
  );
  await page.mouse.up();
  await page.waitForSelector('.mdstudio-skill-split.is-floating', { timeout: 3000 });
  const runBtnBox = await page.locator('.mdstudio-skill-split.is-floating .mdstudio-skill-run-btn').boundingBox();
  assert.ok(runBtnBox, 'floating AI run button has bounding box');
  assert.ok(
    Math.abs(runBtnBox.x + 24 - dragEndX) <= 32,
    `floating AI button anchors horizontally at mouse release X (${Math.round(runBtnBox.x + 24)} vs ${dragEndX})`,
  );
  assert.ok(
    Math.abs(runBtnBox.y - (dragY + 6)) <= 16,
    `floating AI button anchors immediately beneath mouse release Y (${Math.round(runBtnBox.y)} vs ${dragY + 6})`,
  );
  if (process.env.DSH_E2E_SELECTION_PILL_SCREENSHOT) {
    await page.screenshot({ path: process.env.DSH_E2E_SELECTION_PILL_SCREENSHOT });
  }
  if (process.env.DSH_E2E_DIFF_SCREENSHOT) {
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    await page.keyboard.type(
      '# Markdown Studio 示例\n\n右侧设置里可以切换经典、画廊、新知、森系、黑金、文集、简报、海报八套主题；字号、行高、主题色与代码配色都可以调整。\n\n在设置中点「新建主题」即可在左栏打开自定义 CSS 工作台，边改样式边看右侧实时预览，保存后会直接显示在「主题预设」中，例如：\n\n## 标题与公式\n\n支持行内公式 $a^2+b^2=c^2$。',
    );
    await page.waitForSelector('.mdstudio-preview-article .mdstudio-math svg', { timeout: 8000 });
    const firstPara = page.locator('.cm-line', { hasText: '右侧设置里可以切换经典' }).first();
    const secondPara = page.locator('.cm-line', { hasText: '在设置中点「新建主题」' }).first();
    const b1 = await firstPara.boundingBox();
    const b2 = await secondPara.boundingBox();
    assert.ok(b1 && b2, 'multi-paragraph lines are measurable');
    await page.mouse.move(Math.round(b1.x + 2), Math.round(b1.y + 8));
    await page.mouse.down();
    await page.mouse.move(Math.round(b2.x + b2.width - 4), Math.round(b2.y + b2.height - 6), { steps: 6 });
    await page.mouse.up();
    await page.waitForSelector('.mdstudio-skill-split.is-floating', { timeout: 3000 });
    await page.route('**/api/markdown-studio/ai', async (route) => {
      const body = [
        JSON.stringify({
          type: 'delta',
          text: '右侧设置里可以切换八套主题：经典、画廊、新知、森系、黑金、文集、简报、海报；字号、行高、主题色与代码配色也都能调整。\n\n在设置中点「新建主题」，左栏会打开自定义 CSS 工作台，改动样式的同时右侧实时预览，保存后直接出现在「主题预设」里，例如：',
        }),
        JSON.stringify({ type: 'done', provider: 'deepseek', model: 'deepseek-flash' }),
        '',
      ].join('\n');
      await route.fulfill({
        status: 200,
        headers: { 'content-type': 'application/x-ndjson; charset=utf-8' },
        body,
      });
    });
    await page.locator('.mdstudio-skill-split.is-floating .mdstudio-skill-run-btn').click();
    await page.waitForSelector('.cm-editor .mdstudio-ai-inline-card.is-ready', { timeout: 5000 });
    const multiLineDiffCheck = await page.evaluate(() => {
      const lines = Array.from(document.querySelectorAll<HTMLElement>('.cm-editor .mdstudio-cm-ai-del-line'));
      const btns = Array.from(
        document.querySelectorAll<HTMLButtonElement>('.cm-editor .mdstudio-ai-inline-btns button'),
      );
      return {
        lineCount: lines.length,
        middleRadius: lines[1] ? getComputedStyle(lines[1]).borderTopLeftRadius : '',
        labels: btns.map((b) => (b.textContent || '').trim()),
      };
    });
    assert.equal(multiLineDiffCheck.lineCount, 3, 'all 3 selected lines (2 paragraphs + blank line) are unified');
    assert.equal(multiLineDiffCheck.middleRadius, '0px', 'middle red diff lines have zero corner notch');
    assert.deepEqual(
      multiLineDiffCheck.labels,
      ['拒绝', '采纳'],
      'diff buttons show clean 拒绝 / 采纳 without Esc/Tab text',
    );
    await page.waitForTimeout(150);
    await page.screenshot({ path: process.env.DSH_E2E_DIFF_SCREENSHOT });
    await page.keyboard.press('Escape');
    await page.unroute('**/api/markdown-studio/ai');
  }
  await page.keyboard.press('ArrowRight');
  await page.waitForSelector('.mdstudio-skill-split.is-floating', { state: 'detached', timeout: 3000 });

  await page.locator('.mdstudio-header button[aria-label="更多"]').click();
  await page.getByRole('menuitem', { name: /写作 Skill 管理/ }).click();
  await page.waitForSelector('[role="dialog"].mdstudio-skill-modal', { timeout: 5000 });
  const headlessSkillModal = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"].mdstudio-skill-modal') as HTMLElement | null;
    if (!dialog) return null;
    const style = getComputedStyle(dialog);
    return {
      paddingTop: style.paddingTop,
      borderRadius: style.borderRadius,
      headlessNoH2: dialog.querySelector('h2') === null,
    };
  });
  assert.ok(headlessSkillModal, 'skill modal opens in real DSH');
  assert.equal(headlessSkillModal.paddingTop, '0px', 'headless SkillManagerDialog keeps 0px outer top padding');
  assert.equal(
    headlessSkillModal.borderRadius,
    '28px',
    'headless SkillManagerDialog keeps native 28px DSH Modal corner',
  );
  assert.equal(headlessSkillModal.headlessNoH2, true, 'SkillManagerDialog avoids redundant outer Modal h2');
  if (process.env.DSH_E2E_SKILL_BUILTIN_SCREENSHOT) {
    await page.waitForTimeout(240);
    await page.screenshot({ path: process.env.DSH_E2E_SKILL_BUILTIN_SCREENSHOT });
  }
  await page.getByRole('button', { name: '新建', exact: true }).click();
  await page.waitForSelector('.mdstudio-skill-cm-box .cm-editor', { timeout: 5000 });
  await page.locator('.mdstudio-skill-modal input:not([type="file"])').first().fill('DSH 专栏风格');
  await page.getByRole('button', { name: '保存 Skill' }).click();
  await page.waitForTimeout(120);
  const savedLocalSkill = await page.evaluate(() => window.localStorage.getItem('dsh.markdown-studio.skills.v1') || '');
  assert.ok(
    savedLocalSkill.includes('DSH 专栏风格'),
    'custom skill persists strictly inside Markdown Studio local storage in DSH',
  );
  if (process.env.DSH_E2E_SKILL_MODAL_SCREENSHOT) {
    await page.screenshot({ path: process.env.DSH_E2E_SKILL_MODAL_SCREENSHOT });
  }
  await page.keyboard.press('Escape');
  await page.waitForSelector('[role="dialog"].mdstudio-skill-modal', { state: 'detached', timeout: 3000 });

  assert.deepEqual(errors, [], 'no page errors in DSH');
  if (process.env.DSH_E2E_CSS) {
    await page.locator('button[aria-label="设置"]').click();
    await page.getByRole('button', { name: '新建主题' }).click();
    await page.waitForSelector(
      '.mdstudio-css-workbench .mdstudio-css-codemirror, .mdstudio-css-workbench .mdstudio-css',
    );
  }
  if (process.env.DSH_E2E_FORMAT_MENU) {
    await page.locator('.mdstudio-format-trigger').click();
    await page.waitForSelector('.mdstudio-format-menu');
  }
  if (process.env.DSH_E2E_MENU) {
    await page.locator('button[aria-label="更多"]').click();
    await page.waitForTimeout(250);
  }
  await page.evaluate(() => {
    const clipboard = navigator.clipboard as
      | (Clipboard & { write?: (items: ClipboardItems) => Promise<void> })
      | undefined;
    if (!clipboard || typeof clipboard.write !== 'function') return;
    const original = clipboard.write.bind(clipboard);
    (window as unknown as { __mdsCopyHtml?: string }).__mdsCopyHtml = '';
    clipboard.write = async (items: ClipboardItems) => {
      try {
        const blob = await items[0].getType('text/html');
        (window as unknown as { __mdsCopyHtml?: string }).__mdsCopyHtml = await blob.text();
      } catch {
        /* fall through to the real write */
      }
      return original(items);
    };
  });
  await page.locator('.mdstudio-copy-btn').click();
  await page.waitForTimeout(3000);
  const copiedHtml = await page.evaluate(() => (window as unknown as { __mdsCopyHtml?: string }).__mdsCopyHtml || '');
  assert.ok(copiedHtml, 'real copy captures HTML from the clipboard API');
  if (copiedHtml) {
    assert.ok(copiedHtml.includes('<section id="mdstudio"'), 'real copy uses the section root');
    assert.ok(!copiedHtml.includes('data-mdstudio-guard'), 'real copy has no zero-height guard paragraphs');
    assert.ok(
      copiedHtml.includes('class="mdstudio-math-inline"') || copiedHtml.includes('class="mdstudio-math-block"'),
      'real copy uses mdstudio math wrappers',
    );
    assert.ok(copiedHtml.includes('<svg'), 'real copy keeps the MathJax SVG');
    assert.ok(!copiedHtml.includes('data-math-image="true"'), 'real copy does not rasterize formulas');
    assert.ok(!copiedHtml.includes('<style'), 'real copy has no style tag');
  }
  if (process.env.DSH_E2E_SCREENSHOT) await page.screenshot({ path: process.env.DSH_E2E_SCREENSHOT });
  console.log(
    'DSH E2E passed: sidebar, CodeMirror, MathJax SVG, Mermaid, typing, format menu, heading shortcuts, PC preview scroll, toolbar tooltip, immersive mode and official dark preview.',
  );
} finally {
  if (browser) await browser.close().catch(() => undefined);
  child.kill('SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 500));
  fs.rmSync(profileDir, { recursive: true, force: true });
  if (isolatedHome) {
    fs.rmSync(isolatedHome, { recursive: true, force: true });
  }
}

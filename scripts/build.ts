import fs from 'node:fs';
import path from 'node:path';
import { build, type Plugin, transform } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { name: string };
const distDir = path.join(root, 'dist');
fs.mkdirSync(distDir, { recursive: true });

const minifyChromeCssPlugin: Plugin = {
  name: 'minify-chrome-css',
  setup(pluginBuild) {
    const stylesPath = path.join(root, 'src', 'ui', 'styles.ts');
    pluginBuild.onLoad({ filter: /styles\.ts$/ }, async (args) => {
      if (path.resolve(args.path) !== stylesPath) return undefined;
      const src = fs.readFileSync(args.path, 'utf8');
      const match = src.match(/(export const CHROME_CSS: string = `)([\s\S]*?)(`;)/);
      if (!match) return undefined;
      const exprs: string[] = [];
      const tokenized = match[2].replace(/\$\{([^}]+)\}/g, (_, expr: string) => `__TPL_${exprs.push(expr) - 1}__`);
      const min = await transform(tokenized, { loader: 'css', minify: true });
      if (min.warnings.length > 0) {
        throw new Error(`CHROME_CSS minify warnings: ${min.warnings.map((w) => w.text).join('; ')}`);
      }
      let restoredCount = 0;
      const escaped = min.code.trim().replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
      const compacted = escaped.replace(/__TPL_(\d+)__/g, (_, idx: string) => {
        restoredCount++;
        return '${' + exprs[Number(idx)] + '}';
      });
      if (restoredCount !== exprs.length) {
        throw new Error(`CHROME_CSS interpolation mismatch (${restoredCount}/${exprs.length})`);
      }
      return {
        contents: src.replace(match[0], () => match[1] + compacted + match[3]),
        loader: 'ts',
      };
    });
  },
};

const shellBuild = await build({
  entryPoints: [path.join(root, 'src/shell-entry.ts')],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: ['es2020'],
  write: false,
  minify: true,
  treeShaking: true,
  legalComments: 'none',
  logLevel: 'silent',
});
const shellFile = shellBuild.outputFiles[0];
if (!shellFile) throw new Error('shell build emitted no output');
const shellCode = shellFile.text.replace(/\n?\/\/# sourceMappingURL=.*$/s, '');

const studioBuild = await build({
  entryPoints: [path.join(root, 'src/plugin-entry.ts')],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: ['es2020'],
  write: false,
  minify: true,
  treeShaking: true,
  legalComments: 'none',
  loader: { '.css': 'text' },
  plugins: [minifyChromeCssPlugin],
  logLevel: 'silent',
});
const studioFile = studioBuild.outputFiles[0];
if (!studioFile) throw new Error('studio chunk build emitted no output');
const studioCode = studioFile.text.replace(/\n?\/\/# sourceMappingURL=.*$/s, '');

const mermaidBuild = await build({
  entryPoints: [path.join(root, 'src/mermaid-entry.ts')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2020'],
  write: false,
  minify: true,
  legalComments: 'none',
  logLevel: 'silent',
});
const mermaidFile = mermaidBuild.outputFiles[0];
if (!mermaidFile) throw new Error('mermaid build emitted no output');
fs.writeFileSync(path.join(distDir, 'mermaid.js'), mermaidFile.text);

const mathBuild = await build({
  entryPoints: [path.join(root, 'src/math-entry.ts')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2020'],
  write: false,
  minify: true,
  legalComments: 'none',
  loader: { '.css': 'text' },
  plugins: [minifyChromeCssPlugin],
  logLevel: 'silent',
});
const mathFile = mathBuild.outputFiles[0];
if (!mathFile) throw new Error('math build emitted no output');
fs.writeFileSync(path.join(distDir, 'math.js'), mathFile.text);

const darkmodeBuild = await build({
  entryPoints: [path.join(root, 'src/darkmode-entry.ts')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2020'],
  write: false,
  minify: true,
  legalComments: 'none',
  logLevel: 'silent',
});
const darkmodeFile = darkmodeBuild.outputFiles[0];
if (!darkmodeFile) throw new Error('darkmode build emitted no output');
fs.writeFileSync(path.join(distDir, 'darkmode.js'), darkmodeFile.text);

const studioChunkOutput = `window.__ModuleLoader__.load({ id: ${JSON.stringify(pkg.name)}, chunk: "client.studio.js", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
(function (module, exports, require) {
${studioCode.trim()}
})(module, exports, require);
var primitives = null;
try { primitives = require('@deepseek-ai/dsh-client-ui-primitives'); } catch (_e) {}
return module.exports.create(require('react'), primitives); } });
`;
fs.writeFileSync(path.join(distDir, 'client.studio.js'), studioChunkOutput);

const clientOutput = `window.__ModuleLoader__.load({ id: ${JSON.stringify(pkg.name)}, factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
(function (module, exports, require) {
${shellCode.trim()}
})(module, exports, require);
var primitives = null;
try { primitives = require('@deepseek-ai/dsh-client-ui-primitives'); } catch (_e) {}
return module.exports.create(require('react'), primitives, function () { return require.async('./client.studio.js'); }); } });
`;
const MAX_COLD_BOOT_BYTES = 12 * 1024;
if (Buffer.byteLength(clientOutput, 'utf8') >= MAX_COLD_BOOT_BYTES) {
  throw new Error(`cold-boot size gate: dist/client.js exceeds ${MAX_COLD_BOOT_BYTES} bytes`);
}
fs.writeFileSync(path.join(distDir, 'client.js'), clientOutput);

const hostBuild = await build({
  entryPoints: [path.join(root, 'index.ts')],
  outfile: path.join(distDir, 'index.js'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: ['node20'],
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'silent',
});
if (hostBuild.errors.length) throw new Error('host build failed');

for (const name of ['client.js', 'client.studio.js', 'index.js', 'math.js', 'mermaid.js', 'darkmode.js']) {
  const bytes = fs.statSync(path.join(distDir, name)).size;
  console.log(`built dist/${name} (${(bytes / 1024).toFixed(1)} KiB)`);
}

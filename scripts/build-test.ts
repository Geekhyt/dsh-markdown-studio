/** Mapped browser bundles for coverage only. Production artifacts are untouched. */
import path from 'node:path';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const destination = path.join(root, '.testdeps/coverage');
const id = 'dsh-markdown-studio';
for (const [entry, name, chunk] of [
  ['shell-entry', 'client', false],
  ['plugin-entry', 'client.studio', true],
] as const) {
  const banner = `window.__ModuleLoader__.load({id:${JSON.stringify(id)},${chunk ? 'chunk:"client.studio.js",' : ''}factory:(require)=>{var module={exports:{}};var exports=module.exports;`;
  const footer = `var primitives=null;try{primitives=require('@deepseek-ai/dsh-client-ui-primitives')}catch{};return module.exports.create(require('react'),primitives${chunk ? '' : ",()=>require.async('./client.studio.js')"});}});`;
  await build({
    entryPoints: [path.join(root, 'src', entry + '.ts')],
    outfile: path.join(destination, name + '.js'),
    bundle: true,
    platform: 'browser',
    format: 'cjs',
    target: 'es2020',
    sourcemap: true,
    sourcesContent: true,
    banner: { js: banner },
    footer: { js: footer },
    loader: { '.css': 'text' },
    logLevel: 'silent',
  });
}
for (const name of ['math', 'mermaid']) {
  await build({
    entryPoints: [path.join(root, 'src', name + '-entry.ts')],
    outfile: path.join(destination, name + '.js'),
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: 'es2020',
    sourcemap: true,
    sourcesContent: true,
    loader: { '.css': 'text' },
    logLevel: 'silent',
  });
}
console.log('Built mapped test-only browser bundles in .testdeps/coverage');
// c8 filters mapped paths before final resolution; absolute sources avoid treating
// a relative browser-bundle source as an unrelated file outside the workspace.
for (const name of ['client', 'client.studio', 'math', 'mermaid']) {
  const mapPath = path.join(destination, name + '.js.map');
  const fs = await import('node:fs');
  const map = JSON.parse(fs.readFileSync(mapPath, 'utf8')) as { sources: string[] };
  map.sources = map.sources.map((source) => path.resolve(destination, source));
  fs.writeFileSync(mapPath, JSON.stringify(map));
}

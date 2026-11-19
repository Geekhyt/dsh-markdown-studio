# Third-Party Notices

`dsh-markdown-studio` distributes self-contained Host and Client bundles (`dist/client.js`, `dist/client.studio.js`, `dist/index.js`, `dist/math.js`, and `dist/mermaid.js`) so end users can install the plugin with zero runtime npm dependency trees. React and `@deepseek-ai/dsh-client-ui-primitives` are provided by the DeepSeek Harness host at runtime and are **not** bundled.

> **Full license texts:** the bundles strip embedded legal comments, so the complete copyright notice and license text of **every** bundled package (81 packages at the time of writing) ships in [THIRD_PARTY_LICENSES.txt](./THIRD_PARTY_LICENSES.txt). That file is generated from esbuild's bundle metafile by `npm run licenses`, and CI fails (`npm run licenses:check`) if it drifts from the installed dependency tree or if any bundled package uses a license outside the allowlist (`MIT`, `ISC`, `BSD-2-Clause`, `BSD-3-Clause`, `Apache-2.0`, `MPL-2.0 OR Apache-2.0`).

## Bundled runtime packages (summary)

| Package(s) | License | Role in `dsh-markdown-studio` |
| :--- | :--- | :--- |
| `@codemirror/*`, `@lezer/*`, `@marijn/find-cluster-break`, `style-mod`, `w3c-keyname`, `crelt` | MIT | Markdown and custom CSS editor engine (`dist/client.studio.js`) |
| `mp-darkmode` | MIT | Official WeChat Dark Mode color transformation algorithm (`dist/client.studio.js`) |
| `mathjax-full`, `mhchemparser` | Apache-2.0 | Lazy-loaded (`dist/math.js`) TeX-to-SVG formula renderer, including its SVG glyph path data |
| `mermaid`, `@mermaid-js/parser`, `dagre-d3-es`, `cytoscape`, `cytoscape-cose-bilkent`, `cytoscape-fcose`, `cose-base`, `layout-base`, `khroma`, `dayjs`, `es-toolkit`, `lodash-es`, `fastdom`, `marked`, `roughjs`, `stylis`, `ts-dedent`, `uuid`, `@braintree/sanitize-url`, `@iconify/utils`, `@upsetjs/venn.js` | MIT | Lazy-loaded (`dist/mermaid.js`) strict-sandbox diagram parsing, layout, and SVG rendering |
| `katex` | MIT | Math typesetting support inside Mermaid diagrams (`dist/mermaid.js`) |
| `d3`, `d3-*`, `internmap` | ISC (`d3-ease`, `d3-sankey`: BSD-3-Clause) | Graph geometry, scales, and Sankey layout utilities used by Mermaid (`dist/mermaid.js`) |
| `dompurify` | MPL-2.0 OR Apache-2.0 (used under Apache-2.0) | HTML and SVG sanitization inside Mermaid (`dist/mermaid.js`) |

`dist/client.js` (cold-boot shell) and `dist/index.js` (Host service) contain no third-party npm code.

## Embedded source content

| Content | License | Where |
| :--- | :--- | :--- |
| [`op7418/Humanizer-zh`](https://github.com/op7418/Humanizer-zh) `SKILL.md` ruleset (verbatim), which itself builds on [`blader/humanizer`](https://github.com/blader/humanizer) | MIT | Built-in "去 AI 味" writing skill (`src/domain/humanizer-zh-skill.ts` → `dist/client.studio.js`) |

```text
MIT License

Copyright (c) 2026 歸藏 (https://github.com/op7418/Humanizer-zh)
Copyright (c) 2025 Siqi Chen (https://github.com/blader/humanizer)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Repository-only content (not shipped in the npm package)

| Content | License | Where |
| :--- | :--- | :--- |
| Adapted from Vercel's [`react-best-practices`](https://github.com/vercel-labs/agent-skills/tree/main/skills/react-best-practices) agent skill (`vercel-labs/agent-skills`) | MIT (© Vercel, Inc.) | `.agents/skills/vercel-react-best-practices/` (contributor AI-agent guidance) |

Development-only tooling (TypeScript, esbuild, Biome, Playwright, c8, Stryker, jsdom, and others listed under `devDependencies`) is not redistributed.

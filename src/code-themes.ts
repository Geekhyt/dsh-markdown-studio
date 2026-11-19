/*
 * Built-in code-block palettes.
 *
 * These are original CSS rules built from widely used editor color conventions.
 * No upstream stylesheet or source file is copied. The article theme still
 * supplies typography; a code theme only controls the fenced-code surface and
 * token colors.
 */
export interface CodeThemeDefinition {
  id: string;
  preview: { bg: string; fg: string; accent: string };
  css: string;
}

interface CodePalette {
  bg: string;
  fg: string;
  border: string;
  comment: string;
  keyword: string;
  string: string;
  number: string;
  function: string;
  tag: string;
  attr: string;
  literal: string;
}

function codeCss(p: CodePalette): string {
  return [
    '.mdstudio-content pre { background-color: ' +
      p.bg +
      '; color: ' +
      p.fg +
      '; border: 1px solid ' +
      p.border +
      '; border-radius: 8px; }',
    '.mdstudio-content pre code { background-color: transparent; color: ' + p.fg + '; }',
    '.mdstudio-content .mdstudio-tok-comment { color: ' + p.comment + '; }',
    '.mdstudio-content .mdstudio-tok-keyword { color: ' + p.keyword + '; }',
    '.mdstudio-content .mdstudio-tok-string { color: ' + p.string + '; }',
    '.mdstudio-content .mdstudio-tok-number { color: ' + p.number + '; }',
    '.mdstudio-content .mdstudio-tok-function { color: ' + p.function + '; }',
    '.mdstudio-content .mdstudio-tok-tag { color: ' + p.tag + '; }',
    '.mdstudio-content .mdstudio-tok-attr { color: ' + p.attr + '; }',
    '.mdstudio-content .mdstudio-tok-literal { color: ' + p.literal + '; }',
  ].join('\n');
}

function definition(id: string, preview: CodeThemeDefinition['preview'], palette: CodePalette): CodeThemeDefinition {
  return { id, preview, css: codeCss(palette) };
}

export const CODE_THEMES: CodeThemeDefinition[] = [
  {
    id: 'theme',
    preview: { bg: 'transparent', fg: '#64748b', accent: '#94a3b8' },
    css: '',
  },
  definition(
    'github',
    { bg: '#f6f8fa', fg: '#24292f', accent: '#cf222e' },
    {
      bg: '#f6f8fa',
      fg: '#24292f',
      border: '#d0d7de',
      comment: '#6e7781',
      keyword: '#cf222e',
      string: '#0a3069',
      number: '#0550ae',
      function: '#8250df',
      tag: '#116329',
      attr: '#0550ae',
      literal: '#0550ae',
    },
  ),
  definition(
    'github-dark',
    { bg: '#0d1117', fg: '#c9d1d9', accent: '#ff7b72' },
    {
      bg: '#0d1117',
      fg: '#c9d1d9',
      border: '#30363d',
      comment: '#8b949e',
      keyword: '#ff7b72',
      string: '#a5d6ff',
      number: '#79c0ff',
      function: '#d2a8ff',
      tag: '#7ee787',
      attr: '#79c0ff',
      literal: '#79c0ff',
    },
  ),
  definition(
    'one-dark',
    { bg: '#282c34', fg: '#abb2bf', accent: '#c678dd' },
    {
      bg: '#282c34',
      fg: '#abb2bf',
      border: '#3e4451',
      comment: '#7f848e',
      keyword: '#c678dd',
      string: '#98c379',
      number: '#d19a66',
      function: '#61afef',
      tag: '#e06c75',
      attr: '#d19a66',
      literal: '#56b6c2',
    },
  ),
  definition(
    'dracula',
    { bg: '#282a36', fg: '#f8f8f2', accent: '#ff79c6' },
    {
      bg: '#282a36',
      fg: '#f8f8f2',
      border: '#44475a',
      comment: '#7c8cc4',
      keyword: '#ff79c6',
      string: '#f1fa8c',
      number: '#bd93f9',
      function: '#50fa7b',
      tag: '#ff79c6',
      attr: '#ffb86c',
      literal: '#8be9fd',
    },
  ),
  definition(
    'nord',
    { bg: '#2e3440', fg: '#d8dee9', accent: '#88c0d0' },
    {
      bg: '#2e3440',
      fg: '#d8dee9',
      border: '#4c566a',
      comment: '#8392ae',
      keyword: '#81a1c1',
      string: '#a3be8c',
      number: '#b48ead',
      function: '#88c0d0',
      tag: '#81a1c1',
      attr: '#8fbcbb',
      literal: '#d08770',
    },
  ),
  definition(
    'solarized-light',
    { bg: '#fdf6e3', fg: '#586e75', accent: '#1b6ca8' },
    {
      bg: '#fdf6e3',
      fg: '#586e75',
      border: '#eee8d5',
      comment: '#6c7c80',
      keyword: '#5f7300',
      string: '#197a73',
      number: '#b5256b',
      function: '#1b6ca8',
      tag: '#1b6ca8',
      attr: '#8a6500',
      literal: '#ad3c0e',
    },
  ),
  definition(
    'solarized-dark',
    { bg: '#0b2229', fg: '#d6e0e2', accent: '#6ec1f8' },
    {
      bg: '#0b2229',
      fg: '#d6e0e2',
      border: '#163842',
      comment: '#8fa6ac',
      keyword: '#b8d12a',
      string: '#5bd3c7',
      number: '#ff94be',
      function: '#6ec1f8',
      tag: '#6ec1f8',
      attr: '#ebb834',
      literal: '#ff966b',
    },
  ),
  definition(
    'monokai',
    { bg: '#272822', fg: '#f8f8f2', accent: '#f92672' },
    {
      bg: '#272822',
      fg: '#f8f8f2',
      border: '#3e3d32',
      comment: '#75715e',
      keyword: '#f92672',
      string: '#e6db74',
      number: '#ae81ff',
      function: '#a6e22e',
      tag: '#f92672',
      attr: '#a6e22e',
      literal: '#66d9ef',
    },
  ),
];

export function getCodeTheme(id: string): CodeThemeDefinition {
  return CODE_THEMES.find((theme) => theme.id === id) || CODE_THEMES[0];
}

export function codeThemeCss(id: string): string {
  return getCodeTheme(id).css;
}

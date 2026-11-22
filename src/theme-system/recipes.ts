/*
 * The eight built-in v2 themes ("同一篇文章，八种阅读心情").
 *
 * Design principles:
 * 1. Put the signature moment in the opening screen (meta / h1 / lead / tldr).
 * 2. Give busy readers a clear skimming path (tldr, h2, bold conclusions, pull quote).
 * 3. Prefer warm surfaces and balanced mobile rhythm (1.65em above h2, tight sub-headings) over heavy boxes.
 * 4. End with a human sign-off while keeping 100% WeChat inline & mp-darkmode fidelity.
 */
import { mix } from './color';
import type { Recipe } from './compose';

function sameHex(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

export const RECIPES: Recipe[] = [
  {
    id: 'classic',
    accent: '#3d57e6',
    paper: false,
    tone: {
      paper: '#ffffff',
      ink: '#1f2329',
      text: '#3b4048',
      radius: '12px',
      tokens: {
        keyword: '#cf222e',
        string: '#0a3069',
        comment: '#656d76',
        number: '#0550ae',
        function: '#8250df',
        tag: '#116329',
        attr: '#0550ae',
        literal: '#0550ae',
      },
      adjust: function (p) {
        const isDef = sameHex(p.accent, '#3d57e6');
        p.point = isDef ? '#4d6bfe' : p.accent;
        p.muted = '#6b7280';
        p.soft = '#f5f6f8';
        p.tldrBg = isDef ? '#f0f3ff' : mix(p.accent, '#ffffff', 0.92);
        p.quoteBg = p.tldrBg;
        p.alertBg = '#f5f6f8';
        p.tableHead = p.tldrBg;
        p.border = '#e7e9ee';
        p.tableBorder = '#e7e9ee';
        p.hrColor = '#e7e9ee';
        p.linkUnderline = isDef ? '#d5dcff' : mix(p.accent, '#ffffff', 0.8);
        p.inlineBg = p.tldrBg;
        p.inlineText = isDef ? '#3346c8' : p.accent;
        p.markBg = '#fff0bf';
        p.markText = '#4a3a05';
        p.codeBg = isDef ? '#f6f7f9' : mix(p.accent, '#f8f9fc', 0.94);
        p.codeText = '#24292f';
        if (!isDef) p.tokens.function = p.accent;
        p.taskBorder = '#6b7280';
        p.delColor = '#6b7280';
      },
    },
    rhythm: 'standard',
    signature: 'lead',
    atoms: {
      meta: 'muted',
      h1: 'clean',
      lead: 'accentBar',
      tldr: 'card',
      h2: 'classicTopNum',
      h3: 'plain',
      h4: 'accent',
      minor: 'muted',
      quote: 'softCard',
      pull: 'quoteMark',
      pre: 'soft',
      table: 'tintedHead',
      hr: 'fullLine',
      image: 'rounded',
      strong: 'ink',
      mark: 'soft',
      alert: 'soft',
      list: 'disc',
      math: 'plate',
      sign: 'quiet',
      notes: 'rule',
    },
  },
  {
    id: 'gallery',
    accent: '#ae3a0b',
    paper: true,
    tone: {
      paper: '#f4f3ef',
      ink: '#141414',
      text: '#34322f',
      radius: '2px',
      tokens: {
        keyword: '#9a2f08',
        string: '#2b593f',
        comment: '#6c685f',
        number: '#854d0e',
        function: '#1f4b7a',
        tag: '#9a2f08',
        attr: '#1f4b7a',
        literal: '#854d0e',
      },
      adjust: function (p) {
        const isDef = sameHex(p.accent, '#ae3a0b');
        p.paperRadius = '2px';
        p.muted = '#66635d';
        p.soft = '#ffffff';
        p.tldrBg = '#ffffff';
        p.alertBg = '#ffffff';
        p.quoteBg = 'transparent';
        p.border = '#d9d6ce';
        p.borderStrong = '#c7c3b8';
        p.tableBorder = '#d9d6ce';
        p.linkUnderline = '#d6d2c8';
        p.inlineBg = '#e8e6df';
        p.inlineText = '#34322f';
        p.markBg = isDef ? '#f7dccb' : mix(p.accent, '#f4f3ef', 0.82);
        p.markText = isDef ? '#5c1f05' : '#141414';
        p.codeBg = isDef ? '#ebe8e0' : mix(p.accent, '#ece9e1', 0.95);
        p.codeText = '#22201d';
        p.codeBorder = '#cfc9bc';
        if (!isDef) p.tokens.keyword = p.accent;
        p.taskBorder = '#66635d';
        p.delColor = '#66635d';
      },
    },
    rhythm: 'standard',
    signature: 'tldr',
    atoms: {
      meta: 'muted',
      h1: 'gallery',
      lead: 'ruled',
      tldr: 'placard',
      h2: 'galleryRuleNum',
      h3: 'square',
      h4: 'accent',
      minor: 'muted',
      quote: 'wallRule',
      pull: 'ruled',
      pre: 'gallery',
      table: 'gallery',
      hr: 'inkLine',
      image: 'matteFrame',
      strong: 'ink',
      mark: 'sharp',
      alert: 'gallery',
      list: 'gallery',
      math: 'ruled',
      sign: 'quiet',
      notes: 'rule',
    },
  },
  {
    id: 'tech',
    accent: '#6d28d9',
    paper: false,
    tone: {
      paper: '#ffffff',
      ink: '#0f172a',
      text: '#334155',
      code: 'dark',
      radius: '8px',
      tokens: {
        keyword: '#ff7b72',
        string: '#a5d6ff',
        comment: '#8b949e',
        number: '#79c0ff',
        function: '#d2a8ff',
        tag: '#7ee787',
        attr: '#79c0ff',
        literal: '#79c0ff',
      },
      adjust: function (p) {
        const isDef = sameHex(p.accent, '#6d28d9');
        p.muted = '#64748b';
        p.soft = '#f6f8fb';
        p.tldrBg = isDef ? '#f5f2ff' : mix(p.accent, '#ffffff', 0.92);
        p.alertBg = '#f6f8fb';
        p.border = '#e2e8f0';
        p.borderStrong = '#cbd5e1';
        p.tableBorder = '#e2e8f0';
        p.tableHead = '#f6f8fb';
        p.quoteBorder = isDef ? '#ddd3fb' : mix(p.accent, '#ffffff', 0.78);
        p.linkUnderline = isDef ? '#ddd3fb' : mix(p.accent, '#ffffff', 0.78);
        p.inlineBg = isDef ? '#f1edff' : mix(p.accent, '#ffffff', 0.9);
        p.inlineText = isDef ? '#5b21b6' : p.accent;
        p.markBg = isDef ? '#ede9fe' : mix(p.accent, '#ffffff', 0.86);
        p.markText = isDef ? '#4c1d95' : '#0f172a';
        p.codeBg = isDef ? '#161529' : mix(p.accent, '#101420', 0.9);
        p.codeText = '#d8dee9';
        if (!isDef) p.tokens.function = mix(p.accent, '#ffffff', 0.55);
        p.taskBorder = '#64748b';
        p.delColor = '#64748b';
      },
    },
    rhythm: 'standard',
    signature: 'tldr',
    atoms: {
      meta: 'muted',
      h1: 'docTitle',
      lead: 'plain',
      tldr: 'sideBar',
      h2: 'docIndex',
      h3: 'numberedSub',
      h4: 'accent',
      minor: 'muted',
      quote: 'sideRule',
      pull: 'quoteMark',
      pre: 'docs',
      table: 'docs',
      hr: 'slateLine',
      image: 'rounded',
      strong: 'ink',
      mark: 'soft',
      alert: 'panel',
      list: 'disc',
      math: 'plate',
      sign: 'quiet',
      notes: 'rule',
    },
  },
  {
    id: 'warm',
    accent: '#27694c',
    paper: true,
    tone: {
      paper: '#faf7ef',
      ink: '#24332a',
      text: '#3f4a42',
      radius: '16px',
      tokens: {
        keyword: '#206043',
        string: '#7c4314',
        comment: '#6a7369',
        number: '#9a3b14',
        function: '#1f5b63',
        tag: '#206043',
        attr: '#854d0e',
        literal: '#9a3b14',
      },
      adjust: function (p) {
        const isDef = sameHex(p.accent, '#27694c');
        p.paperRadius = '18px';
        p.point = isDef ? '#d9793d' : p.accent;
        p.muted = '#687066';
        p.soft = '#ffffff';
        p.tldrBg = isDef ? '#e8f1e8' : mix(p.accent, '#faf7ef', 0.88);
        p.quoteBg = '#ffffff';
        p.alertBg = '#ffffff';
        p.tableZebra = '#ffffff';
        p.border = '#e6e0d0';
        p.borderStrong = '#cfe0d1';
        p.tableBorder = '#e6e0d0';
        p.linkUnderline = isDef ? '#cfe0d1' : mix(p.accent, '#faf7ef', 0.72);
        p.inlineBg = '#efe9d9';
        p.inlineText = '#5f431b';
        p.markBg = '#fbe7c2';
        p.markText = '#5a3b0c';
        p.markBorder = '#f1d39a';
        p.codeBg = isDef ? '#f1ece0' : mix(p.accent, '#f4efe3', 0.94);
        p.codeText = '#28362e';
        p.codeBorder = isDef ? '#d5dec9' : mix(p.accent, '#e6e0d0', 0.8);
        if (!isDef) p.tokens.keyword = p.accent;
        p.taskBorder = '#687066';
        p.delColor = '#687066';
      },
    },
    rhythm: 'airy',
    signature: 'strong',
    atoms: {
      meta: 'centered',
      h1: 'centered',
      lead: 'centered',
      tldr: 'stationery',
      h2: 'warmDotDash',
      h3: 'accentPlain',
      h4: 'accent',
      minor: 'accent',
      quote: 'whiteNote',
      pull: 'warmQuote',
      pre: 'forest',
      table: 'zebra',
      hr: 'pillShort',
      image: 'polaroid',
      strong: 'honeyUnderline',
      mark: 'pill',
      alert: 'stationery',
      list: 'warm',
      math: 'plate',
      sign: 'quiet',
      notes: 'rule',
    },
  },
  {
    id: 'night',
    accent: '#e3b25c',
    paper: true,
    tone: {
      paper: '#16171b',
      ink: '#f3eee4',
      text: '#c9c5bb',
      code: 'dark',
      radius: '12px',
      tokens: {
        keyword: '#e3b25c',
        string: '#a8d1a0',
        comment: '#8d8a82',
        number: '#f0a37a',
        function: '#9cc4f0',
        tag: '#e3b25c',
        attr: '#9cc4f0',
        literal: '#f0a37a',
      },
      adjust: function (p) {
        const isDef = sameHex(p.accent, '#e3b25c');
        p.paperRadius = '16px';
        p.muted = '#99958c';
        p.soft = '#1f2026';
        p.tldrBg = '#1f2026';
        p.alertBg = '#1f2026';
        p.quoteBg = 'transparent';
        p.border = '#2d2e35';
        p.borderStrong = '#4a3f27';
        p.tableBorder = '#2d2e35';
        p.linkUnderline = isDef ? '#4a3f27' : mix(p.accent, '#16171b', 0.65);
        p.inlineBg = '#25272e';
        p.inlineText = isDef ? '#ecc98a' : p.accent;
        p.markBg = isDef ? '#3b3018' : mix(p.accent, '#16171b', 0.78);
        p.markText = isDef ? '#f6d893' : '#f3eee4';
        p.codeBg = '#0e0f13';
        p.codeText = '#d7d3c8';
        if (!isDef) p.tokens.keyword = p.accent;
        p.taskBorder = '#99958c';
        p.delColor = '#99958c';
      },
    },
    rhythm: 'standard',
    signature: 'h2',
    atoms: {
      meta: 'cinema',
      h1: 'cinema',
      lead: 'centered',
      tldr: 'card',
      h2: 'nightCinema',
      h3: 'chevron',
      h4: 'accent',
      minor: 'muted',
      quote: 'goldRule',
      pull: 'cinemaQuote',
      pre: 'goldTop',
      table: 'goldHead',
      hr: 'goldShort',
      image: 'rounded',
      strong: 'ink',
      mark: 'soft',
      alert: 'soft',
      list: 'disc',
      math: 'plate',
      sign: 'quiet',
      notes: 'rule',
    },
  },
  {
    id: 'ink',
    accent: '#146c78',
    paper: true,
    tone: {
      paper: '#f5f9f8',
      ink: '#17272a',
      text: '#33464a',
      radius: '4px',
      tokens: {
        keyword: '#9a3412',
        string: '#146c78',
        comment: '#5d7073',
        number: '#6b3fa0',
        function: '#24507a',
        tag: '#9a3412',
        attr: '#6b3fa0',
        literal: '#6b3fa0',
      },
      adjust: function (p) {
        const isDef = sameHex(p.accent, '#146c78');
        p.paperRadius = '4px';
        p.muted = '#5d7073';
        p.soft = '#ebf2f1';
        p.tldrBg = isDef ? '#e4f0ef' : mix(p.accent, '#f5f9f8', 0.88);
        p.quoteBg = 'transparent';
        p.alertBg = 'transparent';
        p.border = '#d3e0df';
        p.borderStrong = '#c5dcdb';
        p.tableBorder = '#d3e0df';
        p.linkUnderline = isDef ? '#c5dcdb' : mix(p.accent, '#f5f9f8', 0.72);
        p.inlineBg = isDef ? '#e2edec' : mix(p.accent, '#f5f9f8', 0.88);
        p.inlineText = isDef ? '#17555e' : p.accent;
        p.markBg = isDef ? '#d5eaea' : mix(p.accent, '#f5f9f8', 0.84);
        p.markText = isDef ? '#0d4a53' : '#17272a';
        p.codeBg = isDef ? '#e8f1f0' : mix(p.accent, '#eef4f3', 0.92);
        p.codeText = '#17272a';
        if (!isDef) p.tokens.string = p.accent;
        p.taskBorder = '#5d7073';
        p.delColor = '#5d7073';
      },
    },
    rhythm: 'airy',
    signature: 'lead',
    atoms: {
      meta: 'literary',
      h1: 'literary',
      lead: 'literary',
      tldr: 'literary',
      h2: 'bracket',
      h3: 'literarySub',
      h4: 'accent',
      minor: 'muted',
      quote: 'inkHairline',
      pull: 'literary',
      pre: 'ink',
      table: 'threeLine',
      hr: 'inkStroke',
      image: 'literary',
      strong: 'accent',
      mark: 'literary',
      alert: 'marginNote',
      list: 'disc',
      math: 'open',
      sign: 'quiet',
      notes: 'rule',
    },
  },
  {
    id: 'ruby',
    accent: '#c01b1b',
    paper: false,
    tone: {
      paper: '#ffffff',
      ink: '#14171c',
      text: '#383c44',
      radius: '6px',
      tokens: {
        keyword: '#b41616',
        string: '#145a32',
        comment: '#666c76',
        number: '#9a3412',
        function: '#1d4ed8',
        tag: '#b41616',
        attr: '#854d0e',
        literal: '#1d4ed8',
      },
      adjust: function (p) {
        const isDef = sameHex(p.accent, '#c01b1b');
        p.muted = '#676c74';
        p.soft = '#f5f5f6';
        p.tldrBg = isDef ? '#fdf1f0' : mix(p.accent, '#ffffff', 0.92);
        p.quoteBg = '#f5f5f6';
        p.alertBg = '#f5f5f6';
        p.border = '#e6e7ea';
        p.tableBorder = '#e6e7ea';
        p.hrColor = '#e6e7ea';
        p.linkUnderline = isDef ? '#f6cfcc' : mix(p.accent, '#ffffff', 0.8);
        p.inlineBg = '#f3f3f5';
        p.inlineText = isDef ? '#a31515' : p.accent;
        p.markBg = isDef ? '#fde3e0' : mix(p.accent, '#ffffff', 0.86);
        p.markText = isDef ? '#8a1212' : '#14171c';
        p.codeBg = isDef ? '#f8f5f5' : mix(p.accent, '#f7f7f9', 0.95);
        p.codeText = '#1f2329';
        p.codeBorder = '#e6e2e2';
        if (!isDef) p.tokens.keyword = p.accent;
        p.taskBorder = '#676c74';
        p.delColor = '#676c74';
      },
    },
    rhythm: 'standard',
    signature: 'h1',
    atoms: {
      meta: 'boldAccent',
      h1: 'topBand',
      lead: 'bold',
      tldr: 'brief',
      h2: 'numberedBadge',
      h3: 'accentBar',
      h4: 'accent',
      minor: 'plain',
      quote: 'inkSpine',
      pull: 'briefRule',
      pre: 'brief',
      table: 'accentHead',
      hr: 'briefLine',
      image: 'brief',
      strong: 'accent',
      mark: 'literary',
      alert: 'brief',
      list: 'ruby',
      math: 'ruled',
      sign: 'quiet',
      notes: 'rule',
    },
  },
  {
    id: 'poster',
    accent: '#c2410c',
    paper: false,
    tone: {
      paper: '#ffffff',
      ink: '#18181b',
      text: '#333338',
      accent2: '#fde047',
      code: 'dark',
      radius: '0px',
      tokens: {
        keyword: '#fde047',
        string: '#86efac',
        comment: '#a1a1aa',
        number: '#fdba74',
        function: '#93c5fd',
        tag: '#fde047',
        attr: '#fdba74',
        literal: '#93c5fd',
      },
      adjust: function (p) {
        const isDef = sameHex(p.accent, '#c2410c');
        p.point = isDef ? '#ea580c' : p.accent;
        p.muted = '#66666e';
        p.soft = '#f4f4f5';
        p.tldrBg = '#ffffff';
        p.quoteBg = '#f4f4f5';
        p.alertBg = '#fff7d6';
        p.border = '#e4e4e7';
        p.tableBorder = '#e4e4e7';
        p.linkUnderline = '#fde047';
        p.inlineBg = '#f4f4f5';
        p.inlineText = isDef ? '#b93c0b' : p.accent;
        p.markBg = '#fde047';
        p.markText = '#18181b';
        p.codeBg = '#18181b';
        p.codeText = '#f4f4f5';
        p.taskBorder = '#66666e';
        p.delColor = '#66666e';
      },
    },
    rhythm: 'standard',
    signature: 'lead',
    atoms: {
      meta: 'boldAccent',
      h1: 'posterHero',
      lead: 'sticker',
      tldr: 'shadowBox',
      h2: 'posterNoRule',
      h3: 'slash',
      h4: 'accent',
      minor: 'plain',
      quote: 'posterBar',
      pull: 'posterBox',
      pre: 'poster',
      table: 'posterBox',
      hr: 'tear',
      image: 'inkBorder',
      strong: 'stickerUnderline',
      mark: 'poster',
      alert: 'poster',
      list: 'poster',
      math: 'poster',
      sign: 'quiet',
      notes: 'rule',
    },
  },
];

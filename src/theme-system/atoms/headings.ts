/*
 * L1 — heading atoms (v2). Each atom owns one heading level; prefix/suffix
 * decorations use inline-block spans so WeChat receives clean structure with
 * zero `display: block` on `<span>` (plugin_spec 2.3).
 */
import { rootRule, rule } from '../core';
import { type Palette, v } from '../palette';

export type Atom = (p: Palette) => string[];

/* ------------------------------------------------------------------ h1 -- */

export var H1 = {
  /** Clean left-aligned title (classic). */
  clean: function () {
    return [rule('h1', 'color: ' + v('heading') + '; letter-spacing: 0.01em;')];
  },
  /** Gallery architectural crown: 3px ink top bar. */
  gallery: function () {
    return [
      rule('h1', 'padding-top: 0.5em; border-top: 3px solid ' + v('ink') + '; font-size: 1.55em; letter-spacing: 0;'),
    ];
  },
  /** Docs title: crisp slate ink. */
  docTitle: function () {
    return [rule('h1', 'color: ' + v('heading') + '; letter-spacing: 0.01em;')];
  },
  /** Centered warm stationery title (warm). */
  centered: function () {
    return [rule('h1', 'text-align: center; color: ' + v('heading') + ';')];
  },
  /** Centered cinema title with subtle tracking (night). */
  cinema: function () {
    return [rule('h1', 'text-align: center; letter-spacing: 0.04em; color: ' + v('heading') + ';')];
  },
  /** Centered literary book title with generous tracking (ink). */
  literary: function () {
    return [rule('h1', 'text-align: center; font-size: 1.45em; letter-spacing: 0.12em; color: ' + v('heading') + ';')];
  },
  /** Bold crimson top band (ruby). */
  topBand: function () {
    return [
      rule('h1', 'padding-top: 0.5em; border-top: 4px solid ' + v('accent') + '; font-size: 1.6em; letter-spacing: 0;'),
    ];
  },
  /** High-impact poster display headline (poster). */
  posterHero: function () {
    return [rule('h1', 'font-size: 1.72em; line-height: 1.25; letter-spacing: 0; color: ' + v('heading') + ';')];
  },
};

/* ------------------------------------------------------------------ h2 -- */

function numbered(prefixCss: string, content: string, extra: string): string[] {
  return [
    rootRule('counter-reset: mdstudio-h2;'),
    rule('h2', 'counter-increment: mdstudio-h2; counter-reset: mdstudio-h3;' + extra),
    rule('h2 .mdstudio-heading-prefix', prefixCss),
    rule('h2 .mdstudio-heading-prefix::before', 'content: ' + content + ';'),
    rule('h2 .mdstudio-heading-content', 'display: inline; color: ' + v('heading') + '; font-weight: 700;'),
  ];
}

export var H2 = {
  /** Small 01 counter stacked above the section title (classic). */
  classicTopNum: function () {
    return numbered(
      'display: inline-block; width: 100%; margin: 0 0 0.2em; font-size: 0.6em; line-height: 1.4; letter-spacing: 0.16em; font-weight: 700; color: ' +
        v('accentDeep') +
        '; font-variant-numeric: tabular-nums;',
      'counter(mdstudio-h2, decimal-leading-zero)',
      '',
    );
  },
  /** Hairline ink top rule + small inline vermilion 01 number (gallery). */
  galleryRuleNum: function () {
    return numbered(
      'display: inline; margin-right: 0.7em; font-size: 0.72em; letter-spacing: 0.12em; font-weight: 700; color: ' +
        v('accentDeep') +
        '; font-variant-numeric: tabular-nums;',
      'counter(mdstudio-h2, decimal-leading-zero)',
      ' margin-top: 1.45em; padding-top: 0.55em; border-top: 1px solid ' + v('ink') + ';',
    );
  },
  /** “01 /” tabular index + quiet hairline below (tech). */
  docIndex: function () {
    return numbered(
      'display: inline; margin-right: 0.55em; color: ' + v('accentDeep') + '; font-variant-numeric: tabular-nums;',
      'counter(mdstudio-h2, decimal-leading-zero) " /"',
      ' padding-bottom: 0.35em; border-bottom: 1px solid ' + v('border') + ';',
    );
  },
  /** Persimmon dot + dashed botanical underline (warm). */
  warmDotDash: function () {
    return [
      rule('h2', 'padding-bottom: 0.35em; border-bottom: 1px dashed ' + v('borderStrong') + '; font-size: 1.2em;'),
      rule(
        'h2 .mdstudio-heading-prefix',
        'display: inline; margin-right: 0.75em; font-size: 0.5em; vertical-align: middle; color: ' + v('point') + ';',
      ),
      rule('h2 .mdstudio-heading-prefix::before', 'content: "●";'),
    ];
  },
  /** Centered “— 01 —” champagne cinema chapter header (night). */
  nightCinema: function () {
    return numbered(
      'display: inline-block; width: 100%; margin: 0 0 0.4em; font-size: 0.56em; line-height: 1.4; letter-spacing: 0.3em; color: ' +
        v('accentDeep') +
        '; font-variant-numeric: tabular-nums;',
      '"— " counter(mdstudio-h2, decimal-leading-zero) " —"',
      ' text-align: center; letter-spacing: 0.06em;',
    );
  },
  /** Centered 「 Title 」 with wide literary tracking (ink). */
  bracket: function () {
    return [
      rule('h2', 'text-align: center; font-size: 1.18em; letter-spacing: 0.2em;'),
      rule(
        'h2 .mdstudio-heading-prefix, h2 .mdstudio-heading-suffix',
        'display: inline; color: ' + v('accentDeep') + '; font-weight: 700;',
      ),
      rule('h2 .mdstudio-heading-prefix::before', 'content: "「";'),
      rule('h2 .mdstudio-heading-suffix::after', 'content: "」";'),
    ];
  },
  /** Solid crimson [01] badge + crisp ink underline (ruby). */
  numberedBadge: function () {
    return numbered(
      'display: inline-block; margin-right: 0.65em; padding: 0 0.5em; font-size: 0.75em; line-height: 1.75; background-color: ' +
        v('accent') +
        '; color: ' +
        v('onAccent') +
        '; border-radius: 2px; vertical-align: middle; font-variant-numeric: tabular-nums;',
      'counter(mdstudio-h2, decimal-leading-zero)',
      ' padding-bottom: 0.35em; border-bottom: 1px solid ' + v('ink') + ';',
    );
  },
  /** Top-line orange NO.01 + heavy 3px ink bottom bar (poster). */
  posterNoRule: function () {
    return numbered(
      'display: inline-block; width: 100%; margin: 0 0 0.15em; font-size: 0.55em; line-height: 1.4; letter-spacing: 0.1em; color: ' +
        v('accentDeep') +
        '; font-variant-numeric: tabular-nums;',
      '"NO." counter(mdstudio-h2, decimal-leading-zero)',
      ' padding-bottom: 0.25em; border-bottom: 3px solid ' + v('ink') + '; font-size: 1.32em;',
    );
  },
};

/* ------------------------------------------------------------------ h3 -- */

export var H3 = {
  /** Clean ink sub-heading (classic). */
  plain: function () {
    return [rule('h3', 'color: ' + v('heading') + ';')];
  },
  /** Vermilion square seal before the sub-heading (gallery). */
  square: function () {
    return [
      rule('h3', 'color: ' + v('heading') + ';'),
      rule('h3 .mdstudio-heading-prefix', 'display: inline; margin-right: 0.45em; color: ' + v('accentDeep') + ';'),
      rule('h3 .mdstudio-heading-prefix::before', 'content: "▪";'),
    ];
  },
  /** “1.1” sub-index; pairs with a numbered h2 atom (tech). */
  numberedSub: function () {
    return [
      rule('h3', 'counter-increment: mdstudio-h3; color: ' + v('heading') + ';'),
      rule(
        'h3 .mdstudio-heading-prefix',
        'display: inline; margin-right: 0.55em; color: ' + v('muted') + '; font-variant-numeric: tabular-nums;',
      ),
      rule('h3 .mdstudio-heading-prefix::before', 'content: counter(mdstudio-h2) "." counter(mdstudio-h3);'),
    ];
  },
  /** Forest-accent sub-heading without noisy ornament (warm). */
  accentPlain: function () {
    return [rule('h3', 'color: ' + v('accentDeep') + ';')];
  },
  /** Gold chevron prefix (night). */
  chevron: function () {
    return [
      rule('h3', 'color: ' + v('heading') + ';'),
      rule('h3 .mdstudio-heading-prefix', 'display: inline; margin-right: 0.5em; color: ' + v('accentDeep') + ';'),
      rule('h3 .mdstudio-heading-prefix::before', 'content: "›";'),
    ];
  },
  /** Celadon tracked literary sub-heading (ink). */
  literarySub: function () {
    return [rule('h3', 'letter-spacing: 0.1em; color: ' + v('accentDeep') + ';')];
  },
  /** Crimson left bar (ruby). */
  accentBar: function () {
    return [
      rule('h3', 'padding-left: 0.65em; border-left: 3px solid ' + v('accent') + '; color: ' + v('heading') + ';'),
    ];
  },
  /** Bold "//" poster prefix (poster). */
  slash: function () {
    return [
      rule('h3', 'color: ' + v('heading') + ';'),
      rule('h3 .mdstudio-heading-prefix', 'display: inline; margin-right: 0.45em; color: ' + v('accentDeep') + ';'),
      rule('h3 .mdstudio-heading-prefix::before', 'content: "//";'),
    ];
  },
};

/* ------------------------------------------------------------------ h4 -- */

export var H4 = {
  /** Clean accent label (v2 default). */
  accent: function () {
    return [rule('h4', 'color: ' + v('accentDeep') + ';')];
  },
};

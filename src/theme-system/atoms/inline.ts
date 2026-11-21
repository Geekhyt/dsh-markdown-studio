/*
 * L1 — inline & mid-weight atoms (v2): strong, mark, alerts, lists and lead.
 */
import { ensureContrast, isDark } from '../color';
import { invertedInlineRules, rule } from '../core';
import { type Palette, v } from '../palette';

/* ----------------------------------------------------- strong / highlight -- */

export var STRONG = {
  ink: function () {
    return [];
  },
  accent: function () {
    return [rule('strong', 'color: ' + v('accentDeep') + '; font-weight: 700;')];
  },
  /** Warm honey hand-drawn underline on bold conclusions (warm). */
  honeyUnderline: function () {
    return [
      rule(
        'strong',
        'color: ' +
          v('heading') +
          '; font-weight: 700; padding-bottom: 1px; border-bottom: 2px solid ' +
          v('markBorder') +
          ';',
      ),
    ];
  },
  /** Bright yellow poster marker underline on bold conclusions (poster). */
  stickerUnderline: function () {
    return [
      rule(
        'strong',
        'color: ' +
          v('heading') +
          '; font-weight: 700; padding-bottom: 1px; border-bottom: 3px solid ' +
          v('accent2') +
          ';',
      ),
    ];
  },
};

export var MARK = {
  /** Soft rounded highlight (classic / tech / night). */
  soft: function () {
    return [rule('mark', 'border-radius: 4px;')];
  },
  /** Sharp architectural highlight & code corners (gallery). */
  sharp: function () {
    return [rule('mark', 'border-radius: 0;'), rule('code', 'border-radius: 2px;')];
  },
  /** Rounded stationery highlight (warm). */
  pill: function () {
    return [rule('mark', 'border-radius: 6px;')];
  },
  /** Subtle literary / executive 2px corner (ink / ruby). */
  literary: function () {
    return [rule('mark', 'border-radius: 2px;')];
  },
  /** Full-bleed sticker corners (poster). */
  poster: function () {
    return [rule('mark', 'border-radius: 0;'), rule('code', 'border-radius: 0;')];
  },
};

/* ---------------------------------------------------------------- alerts -- */

type AlertKind = 'note' | 'tip' | 'important' | 'warning' | 'caution';

var LIGHT_ALERT_HUES: Record<AlertKind, string> = {
  note: '#1d4ed8',
  tip: '#166534',
  important: '#6d28d9',
  warning: '#92400e',
  caution: '#b91c1c',
};

var DARK_ALERT_HUES: Record<AlertKind, string> = {
  note: '#8ab4ff',
  tip: '#7fd3a0',
  important: '#c0a5ff',
  warning: '#f0b860',
  caution: '#ff9a9a',
};

var ALERT_KINDS: AlertKind[] = ['note', 'tip', 'important', 'warning', 'caution'];

function alertTitleRules(p: Palette, surfaceHex: string): string[] {
  var dark = isDark(p.bg);
  var hues = dark ? DARK_ALERT_HUES : LIGHT_ALERT_HUES;
  return ALERT_KINDS.map(function (kind) {
    var safeTitle = /^#[0-9a-f]{6}$/i.test(surfaceHex) ? ensureContrast(hues[kind], surfaceHex, 4.5) : hues[kind];
    return rule('.mdstudio-alert-' + kind + ' .mdstudio-alert-title', 'color: ' + safeTitle + ';');
  });
}

export var ALERT = {
  /** Soft 12px borderless card (classic / night). */
  soft: function (p: Palette) {
    return [rule('.mdstudio-alert', 'border-radius: 12px;')].concat(alertTitleRules(p, p.alertBg));
  },
  /** Sharp 2px gallery placard (gallery). */
  gallery: function (p: Palette) {
    return [rule('.mdstudio-alert', 'border-radius: 2px;')].concat(alertTitleRules(p, p.alertBg));
  },
  /** Developer 8px callout panel (tech). */
  panel: function (p: Palette) {
    return [rule('.mdstudio-alert', 'border-radius: 8px;')].concat(alertTitleRules(p, p.alertBg));
  },
  /** Generous 16px stationery note card (warm). */
  stationery: function (p: Palette) {
    return [rule('.mdstudio-alert', 'border-radius: 16px;')].concat(alertTitleRules(p, p.alertBg));
  },
  /** Transparent literary margin note (ink — clean in both light & WeChat dark mode). */
  marginNote: function (p: Palette) {
    return [
      rule(
        '.mdstudio-alert',
        'padding: 0.1em 0 0.1em 1.1em; background-color: transparent; border-left: 2px solid ' +
          v('borderStrong') +
          '; border-radius: 0; font-size: 0.9em; color: ' +
          v('muted') +
          ';',
      ),
    ].concat(alertTitleRules(p, p.bg));
  },
  /** Compact 6px executive callout (ruby). */
  brief: function (p: Palette) {
    return [rule('.mdstudio-alert', 'border-radius: 6px;')].concat(alertTitleRules(p, p.alertBg));
  },
  /** Sharp borderless warm-yellow callout (poster). */
  poster: function (p: Palette) {
    return [rule('.mdstudio-alert', 'border-radius: 0;')].concat(alertTitleRules(p, p.alertBg));
  },
};

/* ---------------------------------------------------------------- lists -- */

export var LIST = {
  disc: function () {
    return [];
  },
  /** Square bullets + 01. architectural numbers + square checkboxes (gallery). */
  gallery: function () {
    return [
      rule('ul', 'list-style-type: square;'),
      rule('li > ul, ul > ul, ol > ul, .mdstudio-task-list > ul', 'list-style-type: circle;'),
      rule('ul > ul > ul, li > ul > li > ul', 'list-style-type: disc;'),
      rule('ol', 'padding-left: 2.35em; list-style-type: decimal-leading-zero;'),
      rule('li > ol, ol > ol, ul > ol, .mdstudio-task-list > ol', 'list-style-type: decimal; padding-left: 1.75em;'),
      rule('.mdstudio-task-box', 'border-radius: 0;'),
    ];
  },
  /** Hollow circle bullets + circular stationery checkboxes (warm). */
  warm: function () {
    return [
      rule('ul', 'list-style-type: circle;'),
      rule('li > ul, ul > ul, ol > ul, .mdstudio-task-list > ul', 'list-style-type: disc;'),
      rule('.mdstudio-task-box', 'border-radius: 50%;'),
    ];
  },
  /** 01. executive numbers + 2px checkboxes (ruby). */
  ruby: function () {
    return [
      rule('ol', 'padding-left: 2.35em; list-style-type: decimal-leading-zero;'),
      rule('li > ol, ol > ol, ul > ol, .mdstudio-task-list > ol', 'list-style-type: decimal; padding-left: 1.75em;'),
      rule('.mdstudio-task-box', 'border-radius: 2px;'),
    ];
  },
  /** Square bullets + 2px ink checkboxes with yellow check (poster). */
  poster: function () {
    return [
      rule('ul', 'list-style-type: square;'),
      rule('.mdstudio-task-box', 'border: 2px solid ' + v('ink') + '; border-radius: 0;'),
      rule(
        '.mdstudio-task-box.is-checked, .mdstudio-task-box-checked',
        'background-color: ' + v('ink') + '; color: ' + v('accent2') + '; border: 2px solid ' + v('ink') + ';',
      ),
    ];
  },
};

/* --------------------------------------------------------- opening lead -- */

export var LEAD = {
  /** Quiet muted lead paragraph (tech). */
  plain: function () {
    return [];
  },
  /** Opening stroke bar on the lead paragraph (classic). */
  accentBar: function () {
    return [
      rule(
        '.mdstudio-lead',
        'padding: 0.1em 0 0.1em 0.95em; border-left: 3px solid ' + v('point') + '; color: ' + v('text') + ';',
      ),
    ];
  },
  /** Gallery catalog divider beneath the lead (gallery). */
  ruled: function () {
    return [
      rule(
        '.mdstudio-lead',
        'margin-bottom: 1.2em; padding-bottom: 0.85em; border-bottom: 1px solid ' +
          v('border') +
          '; color: ' +
          v('text') +
          ';',
      ),
    ];
  },
  /** Centered gentle lead (warm / night). */
  centered: function () {
    return [rule('.mdstudio-lead', 'padding: 0 0.4em; text-align: center;')];
  },
  /** Double-hairline literary standfirst (ink). */
  literary: function () {
    return [
      rule(
        '.mdstudio-lead',
        'margin-bottom: 1.3em; padding: 0.75em 0; border-top: 1px solid ' +
          v('border') +
          '; border-bottom: 1px solid ' +
          v('border') +
          '; font-size: 1.05em; line-height: 1.8; color: ' +
          v('heading') +
          '; text-align: justify;',
      ),
    ];
  },
  /** Bold executive lead (ruby). */
  bold: function () {
    return [rule('.mdstudio-lead', 'color: ' + v('heading') + '; font-weight: 700;')];
  },
  /** Bright yellow poster sticker lead (poster). */
  sticker: function () {
    return [
      rule(
        '.mdstudio-lead',
        'padding: 0.6em 0.9em; background-color: ' +
          v('accent2') +
          '; color: ' +
          v('onAccent2') +
          '; font-weight: 700;',
      ),
      invertedInlineRules('.mdstudio-lead', v('onAccent2')),
      rule('.mdstudio-lead mark', 'background-color: ' + v('ink') + '; color: ' + v('accent2') + ';'),
    ];
  },
};

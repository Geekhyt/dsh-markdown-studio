/*
 * L1 — editorial & supporting atoms (v2): eyebrow meta, TL;DR summary cards,
 * pull quotes, sign-offs, block formulas, footnotes/references and h5/h6.
 */
import { invertedInlineRules, rule } from '../core';
import { v } from '../palette';

var MATH = '.mdstudio-math[data-mdstudio-display="1"], .mdstudio-math-block';
var NOTES = '.mdstudio-references, .mdstudio-footnotes, .mdstudio-notes';
var NOTES_TITLE = '.mdstudio-refs-title, .mdstudio-footnotes-title, .mdstudio-notes-title';

/* ----------------------------------------------------------------- meta -- */

export var META = {
  muted: function () {
    return [];
  },
  centered: function () {
    return [rule('.mdstudio-meta', 'text-align: center;')];
  },
  cinema: function () {
    return [rule('.mdstudio-meta', 'text-align: center; color: ' + v('accentDeep') + '; letter-spacing: 0.2em;')];
  },
  literary: function () {
    return [rule('.mdstudio-meta', 'text-align: center; letter-spacing: 0.2em; text-indent: 0;')];
  },
  boldAccent: function () {
    return [rule('.mdstudio-meta', 'color: ' + v('accentDeep') + '; font-weight: 700;')];
  },
};

/* ----------------------------------------------------------------- tldr -- */

export var TLDR = {
  card: function () {
    return [rule('.mdstudio-tldr', 'border-radius: 12px;')];
  },
  placard: function () {
    return [rule('.mdstudio-tldr', 'border-radius: 2px;')];
  },
  sideBar: function () {
    return [rule('.mdstudio-tldr', 'border-left: 3px solid ' + v('accent') + '; border-radius: 0 12px 12px 0;')];
  },
  stationery: function () {
    return [rule('.mdstudio-tldr', 'border-radius: 16px;')];
  },
  literary: function () {
    return [rule('.mdstudio-tldr', 'border-radius: 4px;')];
  },
  brief: function () {
    return [
      rule('.mdstudio-tldr', 'border-radius: 4px;'),
      rule('.mdstudio-tldr ol', 'padding-left: 2.35em; list-style-type: decimal-leading-zero;'),
    ];
  },
  /** Poster hard shadow #1 of 2: crisp 2px ink box + 4px offset shadow. */
  shadowBox: function () {
    return [
      rule(
        '.mdstudio-tldr',
        'border: 2px solid ' + v('ink') + '; border-radius: 0; box-shadow: 4px 4px 0 ' + v('ink') + ';',
      ),
    ];
  },
};

/* ----------------------------------------------------------------- pull -- */

function topQuoteMark(colorExpr: string): string {
  return (
    'content: "“"; display: inline-block; width: 100%; margin: 0 0 0.1em; font-size: 2.4em; line-height: 1; color: ' +
    colorExpr +
    ';'
  );
}

export var PULL = {
  quoteMark: function () {
    return [rule('.mdstudio-pull::before', topQuoteMark(v('accentDeep')))];
  },
  ruled: function () {
    return [
      rule(
        '.mdstudio-pull',
        'padding: 0.75em 0.6em; border-top: 1px solid ' + v('ink') + '; border-bottom: 1px solid ' + v('ink') + ';',
      ),
    ];
  },
  warmQuote: function () {
    return [
      rule('.mdstudio-pull', 'color: ' + v('accentDeep') + ';'),
      rule('.mdstudio-pull::before', topQuoteMark(v('point'))),
    ];
  },
  cinemaQuote: function () {
    return [
      rule('.mdstudio-pull', 'color: ' + v('accentDeep') + ';'),
      rule('.mdstudio-pull::before', topQuoteMark(v('accentDeep'))),
    ];
  },
  literary: function () {
    return [rule('.mdstudio-pull', 'letter-spacing: 0.12em; font-weight: 700;')];
  },
  briefRule: function () {
    return [
      rule(
        '.mdstudio-pull',
        'padding: 0.75em 0.6em; border-top: 2px solid ' +
          v('accent') +
          '; border-bottom: 1px solid ' +
          v('border') +
          ';',
      ),
    ];
  },
  /** Poster hard shadow #2 of 2: reverse-ink banner + orange offset shadow. */
  posterBox: function () {
    return [
      rule(
        '.mdstudio-pull',
        'padding: 0.8em 1em; background-color: ' +
          v('ink') +
          '; color: ' +
          v('accent2') +
          '; box-shadow: 4px 4px 0 ' +
          v('point') +
          ';',
      ),
      invertedInlineRules('.mdstudio-pull', v('accent2')),
    ];
  },
};

/* ----------------------------------------------------------------- sign -- */

export var SIGN = {
  quiet: function () {
    return [];
  },
};

/* ---------------------------------------------------------- block math -- */

export var BLOCK_MATH = {
  plate: function () {
    return [
      rule(MATH, 'background-color: ' + v('soft') + '; border-radius: ' + v('radius') + '; padding: 0.75em 0.95em;'),
    ];
  },
  open: function () {
    return [rule(MATH, 'background-color: transparent; border: 0; border-radius: 0; padding: 0.4em 0;')];
  },
  ruled: function () {
    return [
      rule(
        MATH,
        'background-color: transparent; border: 0; border-top: 1px solid ' +
          v('border') +
          '; border-bottom: 1px solid ' +
          v('border') +
          '; border-radius: 0; padding: 0.65em 0.5em;',
      ),
    ];
  },
  poster: function () {
    return [
      rule(
        MATH,
        'background-color: ' +
          v('soft') +
          '; border: 2px solid ' +
          v('ink') +
          '; border-radius: 0; padding: 0.75em 0.95em;',
      ),
    ];
  },
};

/* ------------------------------------------------- footnotes / references -- */

export var NOTES_ATOM = {
  rule: function () {
    return [rule(NOTES, 'border-top: 1px solid ' + v('border') + ';'), rule(NOTES_TITLE, 'color: ' + v('muted') + ';')];
  },
};

/* ------------------------------------------------------------- h5 / h6 -- */

export var MINOR = {
  plain: function () {
    return [rule('h5, h6', 'color: ' + v('heading') + ';')];
  },
  accent: function () {
    return [rule('h5, h6', 'color: ' + v('accentDeep') + ';')];
  },
  muted: function () {
    return [rule('h5, h6', 'color: ' + v('muted') + '; letter-spacing: 0.08em;')];
  },
};

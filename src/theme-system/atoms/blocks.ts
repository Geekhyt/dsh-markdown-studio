/*
 * L1 — block atoms (v2): quotes, code blocks, tables, dividers and images.
 * Every atom resets properties from the base sheet cleanly so slots compose
 * predictably and pass WeChat Official Account structural validation.
 */
import { invertedInlineRules, rule } from '../core';
import { v } from '../palette';

const QUOTE_RESET = 'border: 0; ';

/* --------------------------------------------------------------- quote -- */

export const QUOTE = {
  /** Soft tinted borderless card (classic). */
  softCard: function () {
    return [
      rule(
        'blockquote',
        QUOTE_RESET +
          'background-color: ' +
          v('quoteBg') +
          '; border-radius: 12px; padding: 0.8em 1.05em; color: ' +
          v('quoteText') +
          ';',
      ),
    ];
  },
  /** Gallery wall placard note: no card fill, crisp 2px ink left rule (gallery). */
  wallRule: function () {
    return [
      rule(
        'blockquote',
        QUOTE_RESET +
          'padding: 0.1em 0 0.1em 1.05em; background-color: transparent; border-left: 2px solid ' +
          v('ink') +
          '; border-radius: 0; color: ' +
          v('ink') +
          ';',
      ),
    ];
  },
  /** Soft accent side rule on clean white (tech). */
  sideRule: function () {
    return [
      rule(
        'blockquote',
        QUOTE_RESET +
          'padding: 0.1em 0 0.1em 1.05em; background-color: transparent; border-left: 3px solid ' +
          v('quoteBorder') +
          '; border-radius: 0; color: ' +
          v('muted') +
          ';',
      ),
    ];
  },
  /** White stationery note card on oatmeal paper (warm). */
  whiteNote: function () {
    return [
      rule(
        'blockquote',
        QUOTE_RESET +
          'padding: 0.85em 1.1em; background-color: ' +
          v('quoteBg') +
          '; border-radius: 16px; color: ' +
          v('quoteText') +
          ';',
      ),
    ];
  },
  /** Champagne gold fine rule on dark cinema canvas (night). */
  goldRule: function () {
    return [
      rule(
        'blockquote',
        QUOTE_RESET +
          'padding: 0.1em 0 0.1em 1.05em; background-color: transparent; border-left: 2px solid ' +
          v('accent') +
          '; border-radius: 0; color: ' +
          v('heading') +
          ';',
      ),
    ];
  },
  /** Transparent celadon hairline margin quote (ink — clean in both light & WeChat dark mode). */
  inkHairline: function () {
    return [
      rule(
        'blockquote',
        QUOTE_RESET +
          'padding: 0.1em 0 0.1em 1.15em; background-color: transparent; border-left: 1px solid ' +
          v('accent') +
          '; border-radius: 0; color: ' +
          v('muted') +
          ';',
      ),
    ];
  },
  /** Soft gray surface with crisp 3px ink spine (ruby). */
  inkSpine: function () {
    return [
      rule(
        'blockquote',
        QUOTE_RESET +
          'background-color: ' +
          v('quoteBg') +
          '; border-left: 3px solid ' +
          v('ink') +
          '; border-radius: 0 6px 6px 0; padding: 0.8em 1.05em; color: ' +
          v('quoteText') +
          ';',
      ),
    ];
  },
  /** Heavy 6px ink bar on neutral block, sharp corners, zero shadow (poster). */
  posterBar: function () {
    return [
      rule(
        'blockquote',
        QUOTE_RESET +
          'background-color: ' +
          v('quoteBg') +
          '; border-left: 6px solid ' +
          v('ink') +
          '; border-radius: 0; padding: 0.8em 1.05em; color: ' +
          v('quoteText') +
          ';',
      ),
    ];
  },
};

/* ----------------------------------------------------------------- pre -- */

export const PRE = {
  /** Soft rounded code surface (classic). */
  soft: function () {
    return [rule('pre', 'border: 0; border-radius: 12px;')];
  },
  /** Architectural stone placard with hairline ink border (gallery). */
  gallery: function () {
    return [rule('pre', 'border: 1px solid ' + v('codeBorder') + '; border-radius: 2px;')];
  },
  /** Developer dark block with accent top band (tech). */
  docs: function () {
    return [rule('pre', 'border: 0; border-top: 2px solid ' + v('accent') + '; border-radius: 8px;')];
  },
  /** Botanical stationery code note with soft sage border (warm). */
  forest: function () {
    return [rule('pre', 'border: 1px solid ' + v('codeBorder') + '; border-radius: 14px;')];
  },
  /** Top champagne gold bar on obsidian (night). */
  goldTop: function () {
    return [rule('pre', 'border: 0; border-top: 2px solid ' + v('accent') + '; border-radius: 0 0 12px 12px;')];
  },
  /** Celadon book-page code block with celadon left bookmark rule (ink). */
  ink: function () {
    return [rule('pre', 'border: 0; border-left: 2px solid ' + v('accent') + '; border-radius: 0 4px 4px 0;')];
  },
  /** Executive briefing code card with crimson left spine (ruby). */
  brief: function () {
    return [
      rule(
        'pre',
        'border: 1px solid ' +
          v('codeBorder') +
          '; border-left: 3px solid ' +
          v('accent') +
          '; border-radius: 2px 6px 6px 2px;',
      ),
    ];
  },
  /** Sharp ink block with bold orange left bar, zero shadow (poster). */
  poster: function () {
    return [rule('pre', 'border: 0; border-left: 6px solid ' + v('point') + '; border-radius: 0;')];
  },
};

/* --------------------------------------------------------------- table -- */

export const TABLE = {
  /** Soft accent-tinted header with clean horizontal hairlines (classic). */
  tintedHead: function () {
    return [rule('th', 'background-color: ' + v('tldrBg') + '; border-bottom: 1px solid ' + v('linkUnderline') + ';')];
  },
  /** Gallery catalog table: transparent header over 2px ink rule (gallery). */
  gallery: function () {
    return [rule('th', 'background-color: ' + v('bg') + '; border-bottom: 2px solid ' + v('ink') + ';')];
  },
  /** Neutral slate header with hairline row dividers (tech). */
  docs: function () {
    return [rule('th', 'background-color: ' + v('soft') + '; border-bottom: 1px solid ' + v('tableBorder') + ';')];
  },
  /** Botanical header + crisp white even zebra rows (warm). */
  zebra: function () {
    return [
      rule('th', 'background-color: ' + v('tldrBg') + '; border-bottom: 1px solid ' + v('borderStrong') + ';'),
      rule('tbody tr:nth-child(even) td', 'background-color: ' + v('tableZebra') + ';'),
    ];
  },
  /** Champagne gold header text on obsidian (night). */
  goldHead: function () {
    return [
      rule(
        'th',
        'background-color: ' +
          v('bg') +
          '; color: ' +
          v('accentDeep') +
          '; border-bottom: 1px solid ' +
          v('borderStrong') +
          ';',
      ),
    ];
  },
  /** Academic three-line table (ink). */
  threeLine: function () {
    return [
      rule('table', 'border-top: 2px solid ' + v('ink') + '; border-bottom: 2px solid ' + v('ink') + ';'),
      rule('th', 'background-color: ' + v('bg') + '; border-bottom: 1px solid ' + v('ink') + ';'),
      rule('td', 'border-bottom: 0;'),
    ];
  },
  /** Solid crimson header band with white text (ruby). */
  accentHead: function () {
    return [
      rule('th', 'background-color: ' + v('accent') + '; color: ' + v('onAccent') + '; border-bottom: 0;'),
      invertedInlineRules('th', v('onAccent')),
    ];
  },
  /** Framed 2px ink box + reverse-ink header, zero shadow (poster). */
  posterBox: function () {
    return [
      rule('table', 'border: 2px solid ' + v('ink') + ';'),
      rule('th', 'background-color: ' + v('ink') + '; color: ' + v('onInk') + '; border-bottom: 0;'),
      invertedInlineRules('th', v('onInk')),
    ];
  },
};

/* ------------------------------------------------------------------ hr -- */

const HR_RESET = 'border: 0; border-radius: 0; background-color: transparent; ';

export const HR = {
  /** Quiet full-width hairline (classic). */
  fullLine: function () {
    return [rule('hr', HR_RESET + 'width: 100%; height: 1px; background-color: ' + v('border') + ';')];
  },
  /** Full-width architectural ink rule (gallery). */
  inkLine: function () {
    return [rule('hr', HR_RESET + 'width: 100%; height: 1px; background-color: ' + v('ink') + ';')];
  },
  /** Full-width slate rule (tech). */
  slateLine: function () {
    return [rule('hr', HR_RESET + 'width: 100%; height: 1px; background-color: ' + v('tableBorder') + ';')];
  },
  /** Short centered botanical pill (warm). */
  pillShort: function () {
    return [
      rule(
        'hr',
        HR_RESET +
          'width: 3em; height: 3px; margin: 2em auto; border-radius: 3px; background-color: ' +
          v('borderStrong') +
          ';',
      ),
    ];
  },
  /** Centered 30% antique gold rule (night). */
  goldShort: function () {
    return [
      rule('hr', HR_RESET + 'width: 30%; height: 1px; margin: 2em auto; background-color: ' + v('borderStrong') + ';'),
    ];
  },
  /** Centered 20% ink stroke (ink). */
  inkStroke: function () {
    return [rule('hr', HR_RESET + 'width: 20%; height: 1px; margin: 2em auto; background-color: ' + v('ink') + ';')];
  },
  /** Executive full hairline (ruby). */
  briefLine: function () {
    return [rule('hr', HR_RESET + 'width: 100%; height: 1px; background-color: ' + v('hrColor') + ';')];
  },
  /** Perforated full-width 2px dashed tear line (poster — non-zero height for WeChat). */
  tear: function () {
    return [
      rule(
        'hr',
        HR_RESET +
          'width: 100%; height: 1px; background-color: ' +
          v('bg') +
          '; border-top: 2px dashed ' +
          v('ink') +
          ';',
      ),
    ];
  },
};

/* --------------------------------------------------------------- image -- */

export const IMAGE = {
  /** Clean 10px rounded image (classic / tech / night). */
  rounded: function () {
    return [rule('img', 'border-radius: 10px;')];
  },
  /** 8px white museum matte frame (gallery). */
  matteFrame: function () {
    return [rule('img', 'border: 8px solid #ffffff; border-radius: 0;')];
  },
  /** 6px white polaroid with soft warm shadow (warm). */
  polaroid: function () {
    return [
      rule('img', 'border: 6px solid #ffffff; border-radius: 4px; box-shadow: 0 3px 14px rgba(70, 56, 30, 0.1);'),
    ];
  },
  /** Subtle 2px literary corner (ink). */
  literary: function () {
    return [rule('img', 'border-radius: 2px;')];
  },
  /** Crisp 4px executive corner (ruby). */
  brief: function () {
    return [rule('img', 'border-radius: 4px;')];
  },
  /** Sharp 2px ink frame, zero shadow (poster). */
  inkBorder: function () {
    return [rule('img', 'border: 2px solid ' + v('ink') + '; border-radius: 0;')];
  },
};

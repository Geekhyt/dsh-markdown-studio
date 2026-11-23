/*
 * Base stylesheet shared by every recipe. Atoms only override the slots they
 * own, so anything not covered by a recipe falls back to these defaults.
 */
import { cssVariables, MONO, type Palette, v } from './palette';

export const ROOT = '.mdstudio-content';

/** Scope one or more comma-separated selectors to the article root. */
export function rule(selector: string, body: string): string {
  const scoped = selector
    .split(',')
    .map(function (part) {
      const trimmed = part.trim();
      return trimmed ? ROOT + ' ' + trimmed : ROOT;
    })
    .join(', ');
  return scoped + ' { ' + body + ' }';
}

export function rootRule(body: string): string {
  return ROOT + ' { ' + body + ' }';
}

/** Force high-contrast foreground for all inline elements inside an inverted/colored surface. */
export function invertedInlineRules(container: string, fgToken: string): string {
  const children = [
    'strong',
    'b',
    'em',
    'u',
    'a',
    '.mdstudio-link',
    'del',
    'sup',
    '.mdstudio-ref',
    '.mdstudio-footnote-ref',
  ];
  const selector = children
    .map(function (child) {
      return container + ' ' + child;
    })
    .join(', ');
  return rule(selector, 'color: ' + fgToken + '; border-bottom-color: ' + fgToken + ';');
}

export function core(p: Palette): string {
  return (
    cssVariables(p) +
    '\n' +
    [
      rootRule(
        'box-sizing: border-box; color: ' +
          v('text') +
          '; background-color: ' +
          v('bg') +
          '; font-family: ' +
          v('fontStack') +
          '; font-size: ' +
          v('fontSize') +
          '; line-height: ' +
          v('lineHeight') +
          '; letter-spacing: ' +
          v('letterSpacing') +
          '; word-break: break-word; overflow-wrap: break-word; -webkit-font-smoothing: antialiased;',
      ),
      rule('*', 'box-sizing: border-box;'),
      rule(
        '> :first-child, > .mdstudio-pull:first-child, > .mdstudio-alert:first-child, > .mdstudio-figure:first-child, > .mdstudio-scroll:first-child, > .mdstudio-scroll-x:first-child, > .mdstudio-math-block:first-child',
        'margin-top: 0;',
      ),
      rule(
        '> :last-child, > .mdstudio-lead:last-child, > .mdstudio-pull:last-child, > .mdstudio-alert:last-child, > .mdstudio-tldr:last-child, > .mdstudio-caption:last-child, > .mdstudio-scroll:last-child, > .mdstudio-scroll-x:last-child, > .mdstudio-math-block:last-child',
        'margin-bottom: 0;',
      ),
      rule(
        '.mdstudio-math[data-mdstudio-display="1"], .mdstudio-math-block',
        'display: block; margin: 1.2em 0; padding: 0.75em 0.95em; text-align: center; color: ' +
          v('text') +
          '; background-color: ' +
          v('soft') +
          '; border-radius: ' +
          v('radius') +
          '; overflow-x: auto;',
      ),
      rule('.mdstudio-math[data-mdstudio-display="0"], .mdstudio-math-inline', 'display: inline;'),
      rule('.mdstudio-math svg, .mdstudio-math-inline svg, .mdstudio-math-block svg', 'max-width: 100%;'),
      rule('p', 'margin: 0 0 ' + v('paragraphSpacing') + '; text-align: ' + v('justify') + ';'),
      rule(
        '.mdstudio-meta',
        'margin: 0 0 0.55em; font-size: 0.78em; line-height: 1.6; letter-spacing: 0.1em; color: ' +
          v('muted') +
          '; text-align: left;',
      ),
      rule(
        '.mdstudio-lead',
        'margin: 0 0 1.2em; font-size: 1.04em; line-height: 1.75; color: ' + v('muted') + '; text-align: left;',
      ),
      rule(
        '.mdstudio-tldr',
        'margin: 0 0 1.4em; padding: 0.85em 1.05em; background-color: ' +
          v('tldrBg') +
          '; color: ' +
          v('text') +
          '; border-radius: 12px; font-size: 0.95em;',
      ),
      rule(
        '.mdstudio-tldr-title',
        'margin: 0 0 0.35em; font-size: 0.8em; line-height: 1.6; font-weight: 700; letter-spacing: 0.14em; color: ' +
          v('accentDeep') +
          '; text-align: left;',
      ),
      rule('.mdstudio-tldr ul, .mdstudio-tldr ol, .mdstudio-tldr .mdstudio-task-list', 'margin: 0;'),
      rule('.mdstudio-tldr li, .mdstudio-tldr .mdstudio-task', 'margin: 0.18em 0;'),
      rule('strong', 'color: ' + v('strongColor') + '; font-weight: 700;'),
      rule('em', 'color: ' + v('emColor') + '; font-style: ' + v('emStyle') + ';'),
      rule('del', 'color: ' + v('delColor') + '; text-decoration: line-through;'),
      rule(
        'mark',
        'background-color: ' +
          v('markBg') +
          '; color: ' +
          v('markText') +
          '; padding: 0.1em 0.3em; border-radius: 4px;',
      ),
      rule(
        'u',
        'text-decoration: none; border-bottom: ' +
          v('uWidth') +
          ' solid ' +
          v('uColor') +
          '; font-weight: ' +
          v('uWeight') +
          '; padding-bottom: 1px;',
      ),
      rule(
        'a, .mdstudio-link',
        'color: ' +
          v('linkColor') +
          '; text-decoration: none; border-bottom: 1px solid ' +
          v('linkUnderline') +
          '; padding-bottom: 1px;',
      ),
      rule(
        'sup, .mdstudio-ref, .mdstudio-footnote-ref',
        'font-size: 0.7em; line-height: 1.2; font-weight: 700; color: ' +
          v('accentDeep') +
          '; vertical-align: super; margin-left: 2px; white-space: nowrap;',
      ),
      rule(
        'h1, h2, h3, h4, h5, h6',
        'margin: 1.5em 0 0.6em; font-family: ' +
          v('headingFont') +
          '; font-weight: 700; line-height: 1.4; color: ' +
          v('heading') +
          ';',
      ),
      rule('h1', 'font-size: 1.55em; line-height: 1.35;'),
      rule('h2', 'font-size: 1.25em; line-height: 1.4;'),
      rule('h3', 'font-size: 1.1em; line-height: 1.45;'),
      rule('h4', 'font-size: 1em; line-height: 1.5; color: ' + v('accentDeep') + ';'),
      rule('h5, h6', 'font-size: 0.94em; color: ' + v('heading') + '; letter-spacing: 0.03em;'),
      rule('.mdstudio-heading-prefix, .mdstudio-heading-suffix', 'display: none;'),
      rule('.mdstudio-heading-content', 'display: inline;'),
      rule('ul', 'margin: 0 0 ' + v('paragraphSpacing') + '; padding-left: 1.4em; list-style-type: disc;'),
      rule(
        'ol',
        'margin: 0 0 ' +
          v('paragraphSpacing') +
          '; padding-left: 1.9em; list-style-type: decimal; font-variant-numeric: tabular-nums; background-color: ' +
          v('orderedBg') +
          ';',
      ),
      rule('li', 'margin: 0.3em 0;'),
      rule(
        'li > ul, ul > ul, ol > ul, .mdstudio-task-list > ul',
        'list-style-type: circle; margin: 0.2em 0 0.25em; padding-left: 1.3em;',
      ),
      rule('li > ol, ol > ol, ul > ol, .mdstudio-task-list > ol', 'margin: 0.2em 0 0.25em; padding-left: 1.75em;'),
      rule('ul > ul > ul, li > ul > li > ul', 'list-style-type: square;'),
      rule('li > p, .mdstudio-task > p', 'margin: 0 0 0.35em; text-align: left;'),
      rule('li > p:last-child, .mdstudio-task > p:last-child', 'margin-bottom: 0;'),
      rule('.mdstudio-task-list', 'list-style: none; margin: 0 0 ' + v('paragraphSpacing') + '; padding-left: 0;'),
      rule(
        'li > .mdstudio-task-list, ul > .mdstudio-task-list, ol > .mdstudio-task-list, .mdstudio-task-list > .mdstudio-task-list',
        'margin: 0.2em 0 0.25em; padding-left: 1.3em;',
      ),
      rule('.mdstudio-task', 'list-style: none; margin: 0.35em 0; text-align: left;'),
      rule(
        '.mdstudio-task-box',
        'display: inline-block; width: 1.5em; font-size: 0.75em; line-height: 1.4; padding: 0.05em 0; text-align: center; text-indent: 0; font-weight: 700; margin-right: 0.6em; vertical-align: 0.06em; border-radius: 5px; border: 1px solid ' +
          v('taskBorder') +
          '; background-color: ' +
          v('bg') +
          '; color: transparent;',
      ),
      rule(
        '.mdstudio-task-box.is-checked, .mdstudio-task-box-checked',
        'background-color: ' + v('accent') + '; border: 1px solid ' + v('accent') + '; color: ' + v('onAccent') + ';',
      ),
      rule('.mdstudio-task-text', 'color: ' + v('text') + ';'),
      rule(
        '.mdstudio-task.is-checked > .mdstudio-task-text, .mdstudio-task.is-checked > p > .mdstudio-task-text, .mdstudio-task-done',
        'color: ' + v('delColor') + '; text-decoration: line-through;',
      ),
      rule(
        'blockquote',
        'margin: 1.2em 0; padding: ' +
          v('quotePadding') +
          '; background-color: ' +
          v('quoteBg') +
          '; border-radius: ' +
          v('quoteRadius') +
          '; color: ' +
          v('quoteText') +
          ';',
      ),
      rule('blockquote p', 'margin: 0; text-align: left;'),
      rule('blockquote p + p', 'margin-top: 0.5em;'),
      rule('blockquote > :last-child', 'margin-bottom: 0;'),
      rule(
        '.mdstudio-pull',
        'margin: 1.45em 0; padding: 0 0.6em; text-align: center; font-size: 1.18em; line-height: 1.65; font-weight: 700; color: ' +
          v('heading') +
          ';',
      ),
      rule('.mdstudio-pull p', 'margin: 0; text-align: center;'),
      rule('.mdstudio-pull p + p', 'margin-top: 0.5em;'),
      rule(
        'pre',
        'margin: 1.45em 0; padding: 0.85em 1em; background-color: ' +
          v('codeBg') +
          '; color: ' +
          v('codeText') +
          '; border-radius: 12px; overflow-x: auto; white-space: pre; word-break: normal; font-size: 0.82em; line-height: 1.65; letter-spacing: 0;',
      ),
      rule(
        'code',
        'display: inline-block; max-width: 100%; font-family: ' +
          MONO +
          '; font-size: 0.88em; line-height: 1.35; vertical-align: 0.06em; background-color: ' +
          v('inlineBg') +
          '; color: ' +
          v('inlineText') +
          '; padding: 0.15em 0.4em; border-radius: 4px; letter-spacing: 0; text-indent: 0;',
      ),
      rule(
        'pre code',
        'display: block; max-width: none; font-size: 1em; line-height: 1.65; vertical-align: baseline; background-color: transparent; color: ' +
          v('codeText') +
          '; border: 0; padding: 0; border-radius: 0; white-space: pre;',
      ),
      rule(
        'table',
        'width: 100%; margin: 1.4em 0; border-collapse: collapse; font-size: 0.85em; line-height: 1.6; letter-spacing: 0;',
      ),
      rule(
        'th, td',
        'padding: 0.5em 0.55em; text-align: left; vertical-align: top; border-bottom: 1px solid ' +
          v('tableBorder') +
          ';',
      ),
      rule('th', 'background-color: ' + v('tableHead') + '; color: ' + v('heading') + '; font-weight: 700;'),
      rule(
        'img',
        'display: block; max-width: 100%; height: auto; margin: 1.25em auto; border-radius: ' + v('imageRadius') + ';',
      ),
      rule('.mdstudio-figure', 'margin: 1.25em 0 0.45em; text-align: center; text-indent: 0;'),
      rule('.mdstudio-figure img', 'margin: 0 auto;'),
      rule(
        '.mdstudio-caption',
        'margin: 0 0 1.55em; text-align: center; font-size: 0.8em; line-height: 1.6; color: ' + v('muted') + ';',
      ),
      rule(
        'hr',
        'border: 0; height: ' +
          v('hrWidth') +
          '; width: 100%; margin: 1.75em auto; background-color: ' +
          v('hrColor') +
          ';',
      ),
      rule(
        '.mdstudio-img-placeholder',
        'display: block; margin: 1.4em 0; padding: 1.35em 1.1em; text-align: center; font-size: 0.85em; line-height: 1.6; letter-spacing: 0.02em; color: ' +
          v('muted') +
          '; background-color: ' +
          v('soft') +
          '; border: 1.5px dashed ' +
          v('borderStrong') +
          '; border-radius: ' +
          v('radius') +
          ';',
      ),
      rule(
        'span.mdstudio-img-placeholder',
        'display: inline-block; margin: 0 0.2em; padding: 0.15em 0.5em; vertical-align: middle;',
      ),
      rule(
        '.mdstudio-alert',
        'margin: 1.25em 0; padding: 0.75em 1em; background-color: ' +
          v('alertBg') +
          '; color: ' +
          v('text') +
          '; border-radius: 12px; font-size: 0.95em;',
      ),
      rule('.mdstudio-alert p', 'margin: 0; text-align: left;'),
      rule('.mdstudio-alert p.mdstudio-task', 'margin: 0.35em 0; text-align: left;'),
      rule('.mdstudio-alert p + p', 'margin-top: 0.45em;'),
      rule('.mdstudio-alert > :last-child', 'margin-bottom: 0;'),
      rule(
        '.mdstudio-alert-title',
        'margin: 0 0 0.25em; font-size: 0.9em; line-height: 1.6; font-weight: 700; color: ' +
          v('accentDeep') +
          '; text-align: left;',
      ),
      rule(
        '.mdstudio-scroll',
        'margin: 1.2em 0; background-color: ' +
          v('soft') +
          '; border: 1px solid ' +
          v('border') +
          '; border-radius: ' +
          v('radius') +
          '; overflow: hidden;',
      ),
      rule(
        '.mdstudio-scroll-hint',
        'margin: 0; padding: 6px 14px 2px; font-size: 0.78em; line-height: 1.4; color: ' +
          v('muted') +
          '; text-align: right; letter-spacing: 0.04em;',
      ),
      rule(
        '.mdstudio-scroll-body',
        'max-height: 260px; overflow-y: auto; -webkit-overflow-scrolling: touch; padding: 4px 15px 12px;',
      ),
      rule('.mdstudio-scroll-body > :last-child', 'margin-bottom: 0;'),
      rule('.mdstudio-scroll-x', 'margin: 1.2em 0;'),
      rule(
        '.mdstudio-scroll-track',
        'display: flex; flex-direction: row; flex-wrap: nowrap; align-items: stretch; overflow-x: auto; -webkit-overflow-scrolling: touch; padding: 2px 0 6px;',
      ),
      rule(
        '.mdstudio-scroll-slide',
        'flex: 0 0 82%; max-width: 82%; margin-right: 10px; padding: 0.85em 1em; background-color: ' +
          v('soft') +
          '; border: 1px solid ' +
          v('border') +
          '; border-radius: ' +
          v('radius') +
          ';',
      ),
      rule('.mdstudio-scroll-slide:last-child', 'margin-right: 0;'),
      rule('.mdstudio-scroll-slide:only-child', 'flex: 0 0 100%; max-width: 100%; margin-right: 0;'),
      rule('.mdstudio-scroll-slide > :last-child', 'margin-bottom: 0;'),
      rule('.mdstudio-scroll-media', 'margin: 0;'),
      rule(
        '.mdstudio-scroll-media img, .mdstudio-scroll-slide img',
        'width: 100%; max-width: 100%; height: auto; margin: 0 auto;',
      ),
      rule(
        '.mdstudio-scroll-caption',
        'margin: 0.45em 0 0; font-size: 0.82em; line-height: 1.5; color: ' + v('muted') + '; text-align: center;',
      ),
      rule(
        '.mdstudio-scroll-x-hint',
        'margin: 2px 2px 0 0; font-size: 0.78em; line-height: 1.4; color: ' +
          v('muted') +
          '; text-align: right; letter-spacing: 0.04em;',
      ),
      rule(
        '.mdstudio-sign',
        'margin: 0 0 ' +
          v('paragraphSpacing') +
          '; text-align: center; font-size: 0.88em; line-height: 1.8; color: ' +
          v('muted') +
          ';',
      ),
      rule(
        '.mdstudio-references, .mdstudio-footnotes, .mdstudio-notes',
        'margin: 1.6em 0 0; padding: 0.75em 0 0; border-top: 1px solid ' +
          v('border') +
          '; font-size: 0.8em; line-height: 1.7; color: ' +
          v('muted') +
          ';',
      ),
      rule(
        '.mdstudio-refs-title, .mdstudio-footnotes-title, .mdstudio-notes-title',
        'margin: 0 0 0.4em; padding: 0; border: 0; font-size: 1em; font-weight: 700; letter-spacing: 0.1em; color: ' +
          v('muted') +
          '; text-align: left;',
      ),
      rule(
        '.mdstudio-ref-item, .mdstudio-notes p',
        'margin: 0 0 0.3em; line-height: 1.7; text-align: left; word-break: break-all;',
      ),
      rule('.mdstudio-footnote-item', 'margin: 0 0 0.3em; line-height: 1.7; text-align: left;'),
      rule('.mdstudio-tok-keyword', 'color: ' + v('tokens.keyword') + ';'),
      rule('.mdstudio-tok-string', 'color: ' + v('tokens.string') + ';'),
      rule('.mdstudio-tok-comment', 'color: ' + v('tokens.comment') + ';'),
      rule('.mdstudio-tok-number', 'color: ' + v('tokens.number') + ';'),
      rule('.mdstudio-tok-function', 'color: ' + v('tokens.function') + ';'),
      rule('.mdstudio-tok-tag', 'color: ' + v('tokens.tag') + ';'),
      rule('.mdstudio-tok-attr', 'color: ' + v('tokens.attr') + ';'),
      rule('.mdstudio-tok-literal', 'color: ' + v('tokens.literal') + ';'),
    ].join('\n')
  );
}

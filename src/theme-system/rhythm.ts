/*
 * L2 — rhythm presets: line height, type scale, heading air and paragraph spacing.
 */
import { rule } from './core';
import type { Palette } from './palette';

export type RhythmName = 'compact' | 'standard' | 'airy';

interface Rhythm {
  lineHeight: number;
  scale: [string, string, string];
  paragraph: string;
  letter: string;
  margins: [string, string, string, string, string];
}

export var RHYTHMS: Record<RhythmName, Rhythm> = {
  compact: {
    lineHeight: 1.68,
    scale: ['1.48em', '1.2em', '1.06em'],
    paragraph: '0.95em',
    letter: '0.015em',
    margins: ['0 0 0.5em', '1.45em 0 0.55em', '1.15em 0 0.45em', '1em 0 0.4em', '0.85em 0 0.3em'],
  },
  standard: {
    lineHeight: 1.75,
    scale: ['1.55em', '1.25em', '1.1em'],
    paragraph: '1.05em',
    letter: '0.025em',
    margins: ['0 0 0.55em', '1.65em 0 0.65em', '1.3em 0 0.55em', '1.15em 0 0.45em', '0.95em 0 0.35em'],
  },
  airy: {
    lineHeight: 1.85,
    scale: ['1.55em', '1.25em', '1.1em'],
    paragraph: '1.15em',
    letter: '0.04em',
    margins: ['0 0 0.6em', '1.8em 0 0.7em', '1.4em 0 0.6em', '1.2em 0 0.5em', '1em 0 0.4em'],
  },
};

export function resolveRhythmLineHeight(name: RhythmName, configured: number): number {
  return Math.abs(configured - 1.75) < 0.001 ? RHYTHMS[name].lineHeight : configured;
}

export function applyRhythmTokens(p: Palette, name: RhythmName): void {
  p.paragraphSpacing = RHYTHMS[name].paragraph;
  p.letterSpacing = RHYTHMS[name].letter;
}

export function rhythmRules(name: RhythmName): string[] {
  var r = RHYTHMS[name];
  return [
    rule(
      'h1',
      'font-size: ' + r.scale[0] + '; line-height: 1.35; margin: ' + r.margins[0] + '; letter-spacing: 0.01em;',
    ),
    rule('h2', 'font-size: ' + r.scale[1] + '; line-height: 1.4; margin: ' + r.margins[1] + ';'),
    rule('h3', 'font-size: ' + r.scale[2] + '; line-height: 1.45; margin: ' + r.margins[2] + ';'),
    rule('h4', 'margin: ' + r.margins[3] + ';'),
    rule('h5, h6', 'margin: ' + r.margins[4] + ';'),
    rule('h1 + h2, h2 + h3, h3 + h4, h4 + h5, h5 + h6', 'margin-top: 0.75em;'),
  ];
}

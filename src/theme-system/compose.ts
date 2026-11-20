/*
 * L3 — recipe composition (v2): Tone × Rhythm × Atoms → theme CSS.
 */

import { HR, IMAGE, PRE, QUOTE, TABLE } from './atoms/blocks';
import { BLOCK_MATH, META, MINOR, NOTES_ATOM, PULL, SIGN, TLDR } from './atoms/extras';
import { H1, H2, H3, H4 } from './atoms/headings';
import { ALERT, LEAD, LIST, MARK, STRONG } from './atoms/inline';
import { ensureContrast, isDark, readableOn } from './color';
import { core } from './core';
import { derivePalette, type Palette, type TokenColors, type Tone } from './palette';
import { applyRhythmTokens, type RhythmName, resolveRhythmLineHeight, rhythmRules } from './rhythm';

type AtomFn = (p: Palette) => string[];

export var ATOM_LIBRARY = {
  meta: META,
  h1: H1,
  lead: LEAD,
  tldr: TLDR,
  h2: H2,
  h3: H3,
  h4: H4,
  minor: MINOR,
  quote: QUOTE,
  pull: PULL,
  pre: PRE,
  table: TABLE,
  hr: HR,
  image: IMAGE,
  strong: STRONG,
  mark: MARK,
  alert: ALERT,
  list: LIST,
  math: BLOCK_MATH,
  sign: SIGN,
  notes: NOTES_ATOM,
};

export type Slot = keyof typeof ATOM_LIBRARY;

export type RecipeAtoms = { [K in Slot]: keyof (typeof ATOM_LIBRARY)[K] };

/** Composition order is fixed so recipes never depend on declaration order. */
export var SLOT_ORDER: Slot[] = [
  'meta',
  'h1',
  'lead',
  'tldr',
  'h2',
  'h3',
  'h4',
  'minor',
  'quote',
  'pull',
  'pre',
  'table',
  'hr',
  'image',
  'strong',
  'mark',
  'alert',
  'list',
  'math',
  'sign',
  'notes',
];

/** Structural slots: the ones readers perceive as the theme's "shape". */
export var STRUCTURAL_SLOTS: Slot[] = ['h1', 'h2', 'h3', 'quote', 'table', 'hr'];

export interface Recipe {
  id: string;
  accent: string;
  /** Tinted or dark canvas rendered as a paper card. */
  paper: boolean;
  tone: Tone;
  rhythm: RhythmName;
  /** The single most eye-catching component of the theme. */
  signature: Slot;
  atoms: RecipeAtoms;
}

export interface ComposeSettings {
  accent: string;
  fontSize: number;
  lineHeight: number;
}

export function atomFor(slot: Slot, name: string): AtomFn {
  var library = ATOM_LIBRARY[slot] as unknown as Record<string, AtomFn>;
  return library[name];
}

function isHexColor(value: string): boolean {
  return /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(value);
}

function clampPair(fg: string, bg: string, minRatio: number): string {
  return isHexColor(fg) && isHexColor(bg) ? ensureContrast(fg, bg, minRatio) : fg;
}

function clampPaletteContrast(p: Palette): void {
  p.text = clampPair(p.text, p.bg, 4.5);
  p.heading = clampPair(p.heading, p.bg, 4.5);
  p.accentDeep = clampPair(p.accentDeep, p.bg, 4.5);
  p.accentDeep = clampPair(p.accentDeep, p.accentSoft, 4.5);
  p.accentDeep = clampPair(p.accentDeep, p.tldrBg, 4.5);
  p.point = clampPair(p.point, p.bg, 3.5);
  if (isHexColor(p.tableHead) && isDark(p.bg) === isDark(p.tableHead)) {
    p.accentDeep = clampPair(p.accentDeep, p.tableHead, 4.5);
  }
  p.inlineText = clampPair(p.inlineText, p.inlineBg, 4.5);
  p.markText = clampPair(p.markText, p.markBg, 4.5);
  p.muted = clampPair(p.muted, p.bg, 4.5);
  p.muted = clampPair(p.muted, p.soft, 4.5);
  p.delColor = clampPair(p.delColor, p.bg, 4.5);
  p.delColor = clampPair(p.delColor, p.tldrBg, 4.5);
  p.delColor = clampPair(p.delColor, p.quoteBg, 4.5);
  if (isHexColor(p.accent)) p.onAccent = readableOn(p.accent, '#111111', '#ffffff');
  if (isHexColor(p.accent2)) p.onAccent2 = readableOn(p.accent2, '#111111', '#ffffff');
  if (isHexColor(p.codeBg)) {
    p.codeText = clampPair(p.codeText, p.codeBg, 4.5);
    (Object.keys(p.tokens) as Array<keyof TokenColors>).forEach(function (key) {
      p.tokens[key] = clampPair(p.tokens[key], p.codeBg, 4.5);
    });
  }
}

export function recipePalette(recipe: Recipe, settings: ComposeSettings): Palette {
  var resolvedLh = resolveRhythmLineHeight(recipe.rhythm, settings.lineHeight);
  var p = derivePalette(recipe.tone, settings.accent || recipe.accent, settings.fontSize, resolvedLh);
  applyRhythmTokens(p, recipe.rhythm);
  if (recipe.tone.adjust) recipe.tone.adjust(p);
  clampPaletteContrast(p);
  return p;
}

export function composeRecipe(recipe: Recipe, settings: ComposeSettings): string {
  var p = recipePalette(recipe, settings);
  var lines: string[] = rhythmRules(recipe.rhythm);
  SLOT_ORDER.forEach(function (slot) {
    lines = lines.concat(atomFor(slot, String(recipe.atoms[slot]))(p));
  });
  return core(p) + '\n' + lines.join('\n');
}

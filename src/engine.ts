import {
  inlineCss,
  normalizeSelector,
  parseDeclarations,
  parseRules,
  resolveVars,
  selectorSpecificity,
} from './css-inliner';
import { containsMath, escapeAttr, escapeHtml, highlightCode, renderMarkdown } from './markdown-parser';

export type { EngineReference, RenderOptions, RenderResult } from './markdown-parser';
export {
  containsMath,
  escapeAttr,
  escapeHtml,
  highlightCode,
  inlineCss,
  normalizeSelector,
  parseDeclarations,
  parseRules,
  renderMarkdown,
  resolveVars,
  selectorSpecificity,
};

export const engine = {
  containsMath,
  escapeHtml,
  escapeAttr,
  renderMarkdown,
  highlightCode,
  parseRules,
  parseDeclarations,
  normalizeSelector,
  selectorSpecificity,
  resolveVars,
  inlineCss,
};

export type Engine = typeof engine;

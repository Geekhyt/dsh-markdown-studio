import {
  inlineCss,
  normalizeSelector,
  parseDeclarations,
  parseRules,
  resolveVars,
  selectorSpecificity,
} from './css-inliner';
import { escapeAttr, escapeHtml, highlightCode, renderMarkdown } from './markdown-parser';

export type { EngineReference, RenderOptions, RenderResult } from './markdown-parser';
export {
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

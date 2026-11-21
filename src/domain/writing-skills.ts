import { HUMANIZER_ZH_SKILL_BODY } from './humanizer-zh-skill';

export interface WritingSkill {
  id: string;
  name: string;
  description: string;
  instructions: string;
  builtin?: boolean;
}

export interface WritingSkillState {
  activeSkillId: string;
  customSkills: WritingSkill[];
}

export interface SkillPatch {
  id: string;
  start: number;
  end: number;
  original: string;
  replacement: string;
}

export const BUILTIN_HUMANIZER_ID = 'builtin:humanizer-zh';
export const MAX_CUSTOM_SKILLS = 24;
export const MAX_SKILL_NAME_CHARS = 32;
export const MAX_SKILL_DESC_CHARS = 96;
export const MAX_SKILL_BODY_CHARS = 32_000;

export const HUMANIZER_ZH_INSTRUCTIONS = HUMANIZER_ZH_SKILL_BODY;

export const BUILTIN_HUMANIZER_SKILL: WritingSkill = {
  id: BUILTIN_HUMANIZER_ID,
  name: '去 AI 味',
  description: '开源 op7418/Humanizer-zh（MIT）原版完整规则：消除空话、重复与模板化表达，保留事实与作者声音',
  instructions: HUMANIZER_ZH_INSTRUCTIONS,
  builtin: true,
};

export const EXAMPLE_CUSTOM_SKILL_BODY = [
  '## 适用目标',
  '将选中文本打磨成克制、平实的一线工程师技术专栏口吻。',
  '',
  '## 改写规则',
  '1. 用平实的「我」或直接陈述事实，删掉「笔者认为」「不难发现」等端架子措辞。',
  '2. 删掉空洞形容词与感叹号，用具体条件、数字和因果关系说话。',
  '3. 遇到超过 35 字的多重定语长句时，主动拆成两句短句。',
  '4. 严禁修改原文中的代码块、行内代码、数学公式、链接 URL 与本地图片路径。',
].join('\n');

function recordOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function clampText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export function defaultWritingSkillState(): WritingSkillState {
  return { activeSkillId: BUILTIN_HUMANIZER_ID, customSkills: [] };
}

export function sanitizeCustomSkill(input: unknown): WritingSkill | null {
  const rec = recordOf(input);
  if (!rec) return null;
  const id = clampText(rec.id, 64);
  const name = clampText(rec.name, MAX_SKILL_NAME_CHARS);
  const instructions = clampText(rec.instructions, MAX_SKILL_BODY_CHARS);
  if (!id || id === BUILTIN_HUMANIZER_ID || !name || !instructions) return null;
  return {
    id,
    name,
    description: clampText(rec.description, MAX_SKILL_DESC_CHARS),
    instructions,
  };
}

export function sanitizeWritingSkillState(input: unknown): WritingSkillState {
  const rec = recordOf(input);
  if (!rec) return defaultWritingSkillState();
  const seen = new Set<string>();
  const customSkills: WritingSkill[] = [];
  const rawList = Array.isArray(rec.customSkills) ? rec.customSkills : [];
  for (const item of rawList) {
    const clean = sanitizeCustomSkill(item);
    if (!clean || seen.has(clean.id)) continue;
    seen.add(clean.id);
    customSkills.push(clean);
    if (customSkills.length >= MAX_CUSTOM_SKILLS) break;
  }
  const candidateActive = clampText(rec.activeSkillId, 64);
  const validActive = candidateActive === BUILTIN_HUMANIZER_ID || seen.has(candidateActive);
  return {
    activeSkillId: validActive ? candidateActive : BUILTIN_HUMANIZER_ID,
    customSkills,
  };
}

export function allWritingSkills(state: WritingSkillState): WritingSkill[] {
  return [BUILTIN_HUMANIZER_SKILL, ...state.customSkills];
}

export function findWritingSkill(state: WritingSkillState, id: string): WritingSkill | null {
  if (id === BUILTIN_HUMANIZER_ID) return BUILTIN_HUMANIZER_SKILL;
  for (const item of state.customSkills) {
    if (item.id === id) return item;
  }
  return null;
}

export function resolveActiveSkill(state: WritingSkillState): WritingSkill {
  return findWritingSkill(state, state.activeSkillId) || BUILTIN_HUMANIZER_SKILL;
}

export function createCustomSkillId(): string {
  return 'skill:' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
}

export function nextCustomSkillName(list: readonly WritingSkill[], baseName: string): string {
  const taken = new Set(list.map((item) => item.name));
  if (!taken.has(baseName)) return baseName;
  let seq = 2;
  while (taken.has(`${baseName} ${seq}`)) seq++;
  return `${baseName} ${seq}`;
}

export function upsertCustomSkill(list: readonly WritingSkill[], next: WritingSkill): WritingSkill[] {
  const idx = list.findIndex((item) => item.id === next.id);
  if (idx >= 0) {
    const copy = list.slice();
    copy[idx] = next;
    return copy;
  }
  if (list.length >= MAX_CUSTOM_SKILLS) return list.slice();
  return [...list, next];
}

export function removeCustomSkill(list: readonly WritingSkill[], id: string): WritingSkill[] {
  return list.filter((item) => item.id !== id);
}

function unquoteYaml(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (typeof parsed === 'string') return parsed.trim();
    } catch {
      /* fall back to slice */
    }
    return trimmed.slice(1, -1).trim();
  }
  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/''/g, "'").trim();
  }
  return trimmed;
}

function parseFrontmatterFields(block: string): Record<string, string> {
  const fields: Record<string, string> = Object.create(null);
  for (const line of block.split(/\r?\n/)) {
    const m = /^([a-zA-Z0-9_-]+)\s*:\s*(.+)$/.exec(line.trim());
    if (m) fields[m[1].toLowerCase()] = unquoteYaml(m[2]);
  }
  return fields;
}

export function parseSkillMarkdown(
  raw: string,
  fallbackName = '自定义 Skill',
): { name: string; description: string; instructions: string } {
  const normalized = String(raw || '')
    .replace(/\r\n?/g, '\n')
    .trim();
  let body = normalized;
  let meta: Record<string, string> = {};
  const fmMatch = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(normalized);
  if (fmMatch) {
    meta = parseFrontmatterFields(fmMatch[1]);
    body = fmMatch[2].trim();
  }
  const headingMatch = /^#\s+(.+)$/m.exec(body);
  const rawName = meta.title || meta.name || (headingMatch ? headingMatch[1] : '') || fallbackName;
  return {
    name: rawName.trim().slice(0, MAX_SKILL_NAME_CHARS) || fallbackName,
    description: (meta.description || '').slice(0, MAX_SKILL_DESC_CHARS),
    instructions: (body || normalized).slice(0, MAX_SKILL_BODY_CHARS),
  };
}

function toSkillSlug(name: string): string {
  const ascii = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return ascii || 'custom-writing-skill';
}

export function serializeSkillMarkdown(skill: Pick<WritingSkill, 'name' | 'description' | 'instructions'>): string {
  const slug = toSkillSlug(skill.name);
  const titleLine = skill.name && skill.name !== slug ? [`title: ${JSON.stringify(skill.name)}`] : [];
  const lines = [
    '---',
    `name: ${slug}`,
    ...titleLine,
    `description: ${JSON.stringify(skill.description || skill.name)}`,
    '---',
    '',
    skill.instructions.trim(),
    '',
  ];
  return lines.join('\n');
}

const SELECTION_SYSTEM_GUARD = [
  '你是内嵌在 Markdown Studio 写作器中的精准文本编辑引擎。',
  '严格执行下方 <skill_instructions> 处理 <target_text>，并遵守以下输出协议：',
  '1. 直接输出修改后的 <target_text> Markdown 正文，严禁包裹在 ```markdown 代码块中，严禁输出问候、解释或修改说明。',
  '2. 必须 100% 保留原文中的代码块（``` / ~~~）、行内代码 `...`、数学公式 $...$ / $$...$$ / \\(...\\) / \\[...\\]、链接地址、脚注与本地图片路径 assets/...。',
  '3. 若原文表达已自然清晰无需修改，原样输出 <target_text> 即可。',
].join('\n');

export function buildSelectionSkillPrompt(params: {
  skill: WritingSkill;
  title: string;
  markdown: string;
  start: number;
  end: number;
}): { system: string; prompt: string } {
  const before = params.markdown.slice(Math.max(0, params.start - 360), params.start).trim();
  const target = params.markdown.slice(params.start, params.end);
  const after = params.markdown.slice(params.end, Math.min(params.markdown.length, params.end + 360)).trim();
  const system = `${SELECTION_SYSTEM_GUARD}\n\n<skill_instructions name=${JSON.stringify(params.skill.name)}>\n${params.skill.instructions}\n</skill_instructions>`;
  const prompt = [
    `<document_title>${params.title || '未命名文章'}</document_title>`,
    before ? `<context_before_readonly>\n${before}\n</context_before_readonly>` : '',
    `<target_text>\n${target}\n</target_text>`,
    after ? `<context_after_readonly>\n${after}\n</context_after_readonly>` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
  return { system, prompt };
}

export function unwrapMarkdownFenceIfProse(candidate: string, original: string): string {
  const origTrim = original.trimStart();
  if (origTrim.startsWith('```') || origTrim.startsWith('~~~')) return candidate;
  const match = /^```(?:markdown|md|text)?[ \t]*\r?\n([\s\S]*?)\r?\n```[ \t]*$/i.exec(candidate.trim());
  if (!match) return candidate;
  // Do not unwrap when the match spans across multiple separate fenced code blocks.
  if (/^[ \t]*```/m.test(match[1])) return candidate;
  return match[1].trimEnd();
}

export function applySkillPatches(markdown: string, patches: readonly SkillPatch[]): string {
  if (!patches.length) return markdown;
  const ordered = patches.slice().sort((a, b) => b.start - a.start);
  let result = markdown;
  for (const patch of ordered) {
    if (patch.start < 0 || patch.end > result.length || patch.start > patch.end) continue;
    result = result.slice(0, patch.start) + patch.replacement + result.slice(patch.end);
  }
  // Only the patched ranges change: the rest of the document (e.g. intentional blank
  // lines inside code fences) is preserved byte-for-byte.
  return result;
}

function isFenceLineStart(text: string, index: number): boolean {
  const lineStart = index > 0 ? text.lastIndexOf('\n', index - 1) + 1 : 0;
  const indent = text.slice(lineStart, index);
  return indent.length <= 3 && /^[ \t]*$/.test(indent);
}

function matchFencedBlock(text: string, index: number): number {
  if (!isFenceLineStart(text, index)) return -1;
  const open = /^(`{3,}|~{3,})/.exec(text.slice(index));
  if (!open) return -1;
  const fenceChar = open[1][0];
  const fenceLen = open[1].length;
  const lineEnd = text.indexOf('\n', index);
  if (lineEnd < 0) return -1;
  const closeRe = new RegExp(`^[ \\t]{0,3}${fenceChar}{${fenceLen},}[ \\t]*(?:\\r?\\n|$)`, 'gm');
  closeRe.lastIndex = lineEnd + 1;
  const closed = closeRe.exec(text);
  return closed ? closed.index + closed[0].replace(/\r?\n$/, '').length : text.length;
}

function matchBacktickCode(text: string, index: number): number {
  if (text[index] !== '`') return -1;
  let ticks = 0;
  while (index + ticks < text.length && text[index + ticks] === '`') ticks++;
  const closer = '`'.repeat(ticks);
  let cursor = index + ticks;
  while (cursor < text.length) {
    const found = text.indexOf(closer, cursor);
    if (found < 0) return -1;
    const before = found > 0 && text[found - 1] === '`';
    const after = text[found + ticks] === '`';
    if (!before && !after) return found + ticks;
    cursor = found + 1;
  }
  return -1;
}

function isEscaped(text: string, index: number): boolean {
  let slashes = 0;
  for (let i = index - 1; i >= 0 && text[i] === '\\'; i--) slashes++;
  return slashes % 2 === 1;
}

function matchDelimited(text: string, index: number, open: string, close: string, multiline: boolean): number {
  if (!text.startsWith(open, index) || isEscaped(text, index)) return -1;
  let cursor = index + open.length;
  while (cursor < text.length) {
    const found = text.indexOf(close, cursor);
    if (found < 0) return -1;
    if (!multiline && text.slice(index + open.length, found).includes('\n')) return -1;
    if (!isEscaped(text, found)) return found + close.length;
    cursor = found + 1;
  }
  return -1;
}

function isLikelyCurrencySpan(text: string, openIndex: number, closeIndex: number): boolean {
  const inner = text.slice(openIndex + 1, closeIndex);
  if (!inner || /^\s|\s$/.test(inner)) return true;
  const nextChar = text[closeIndex + 1] || '';
  if (/\d/.test(nextChar)) return true;
  return /^\d[\d,.]*(?:[ \t]*[/\-–—][ \t]*|[ \t]+(?:to|or|and|至|到|或)[ \t]+)?$/i.test(inner);
}

function matchInlineDollarMath(text: string, index: number): number {
  if (text[index] !== '$' || text[index + 1] === '$' || isEscaped(text, index)) return -1;
  let cursor = index + 1;
  while (cursor < text.length) {
    const ch = text[cursor];
    if (ch === '\n') return -1;
    if (ch === '$' && text[cursor + 1] !== '$' && !isEscaped(text, cursor)) {
      if (isLikelyCurrencySpan(text, index, cursor)) return -1;
      return cursor + 1;
    }
    cursor++;
  }
  return -1;
}

function readBalancedLinkDest(text: string, openParen: number): { url: string; end: number } | null {
  let i = openParen + 1;
  while (i < text.length && /[ \t]/.test(text[i])) i++;
  const urlStart = i;
  let depth = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (/\s/.test(ch)) break;
    if (ch === '(') depth++;
    else if (ch === ')') {
      if (depth === 0) break;
      depth--;
    }
    i++;
  }
  const url = text.slice(urlStart, i);
  if (!/^(?:https?:\/\/\S+|assets\/[a-zA-Z0-9._-]+)$/.test(url)) return null;
  while (i < text.length && text[i] !== ')' && text[i] !== '\n') i++;
  if (text[i] !== ')') return null;
  return { url, end: i + 1 };
}

function matchLinkOrAsset(text: string, index: number): { token: string; next: number } | null {
  if (text[index] === ']' && text[index + 1] === '(') {
    const parsed = readBalancedLinkDest(text, index + 1);
    if (parsed) return { token: parsed.url, next: parsed.end };
  }
  if (text.startsWith('assets/', index)) {
    const m = /^assets\/[a-zA-Z0-9._-]+/.exec(text.slice(index));
    if (m) return { token: m[0], next: index + m[0].length };
  }
  if (text.startsWith('[^', index)) {
    const m = /^\[\^[^\s\]]+\]/.exec(text.slice(index));
    if (m) return { token: m[0], next: index + m[0].length };
  }
  return null;
}

function matchProtectedSpanEnd(text: string, index: number): number {
  const ch = text[index];
  if (ch === '`' || ch === '~') {
    const fenceEnd = matchFencedBlock(text, index);
    if (fenceEnd > index) return fenceEnd;
    return matchBacktickCode(text, index);
  }
  if (ch === '$') {
    const displayEnd = matchDelimited(text, index, '$$', '$$', true);
    return displayEnd > index ? displayEnd : matchInlineDollarMath(text, index);
  }
  if (ch === '\\') {
    const blockTex = matchDelimited(text, index, '\\[', '\\]', true);
    return blockTex > index ? blockTex : matchDelimited(text, index, '\\(', '\\)', false);
  }
  return -1;
}

export function extractProtectedTokens(text: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < text.length) {
    const spanEnd = matchProtectedSpanEnd(text, i);
    if (spanEnd > i) {
      tokens.push(text.slice(i, spanEnd));
      i = spanEnd;
      continue;
    }
    const ref = matchLinkOrAsset(text, i);
    if (ref) {
      tokens.push(ref.token);
      i = ref.next;
      continue;
    }
    i++;
  }
  return tokens;
}

export function hasMissingProtectedTokens(original: string, candidate: string): boolean {
  const counts = new Map<string, number>();
  for (const token of extractProtectedTokens(original)) {
    counts.set(token, (counts.get(token) || 0) + 1);
  }
  const candCounts = new Map<string, number>();
  for (const token of extractProtectedTokens(candidate)) {
    candCounts.set(token, (candCounts.get(token) || 0) + 1);
  }
  for (const [token, needed] of counts.entries()) {
    if ((candCounts.get(token) || 0) < needed && !candidate.includes(token)) return true;
    if (needed > 1 && (candCounts.get(token) || 0) < needed) return true;
  }
  return false;
}

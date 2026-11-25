export interface DiffSegment {
  type: 'equal' | 'delete' | 'insert';
  text: string;
}

export interface DiffTextPart {
  text: string;
  changed?: boolean;
}

export interface DiffRangeOffset {
  fromOffset: number;
  toOffset: number;
}

export interface ComputedTextDiff {
  segments: DiffSegment[];
  delParts: DiffTextPart[];
  addParts: DiffTextPart[];
  delOffsets: DiffRangeOffset[];
  addOffsets: DiffRangeOffset[];
}

const DIFF_TOKEN_RE = /[A-Za-z0-9_]+|\s+|[^\sA-Za-z0-9_]/gu;
const DIFF_CLAUSE_RE = /[^。！？!?；;，,\n]+[。！？!?；;，,\n]*|[。！？!?；;，,\n]+/gu;
const ASCII_WORD_RE = /^[A-Za-z0-9_]$/;
const WS_CHAR_RE = /^\s+$/;
const MAX_MYERS_D = 600;

let cachedGraphemeSegmenter: Intl.Segmenter | null | undefined;

function getGraphemeSegmenter(): Intl.Segmenter | null {
  if (cachedGraphemeSegmenter === undefined) {
    cachedGraphemeSegmenter =
      typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
        ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
        : null;
  }
  return cachedGraphemeSegmenter;
}

export function tokenizeDiff(text: string): string[] {
  if (!text) return [];
  const segmenter = getGraphemeSegmenter();
  if (!segmenter) return text.match(DIFF_TOKEN_RE) ?? [];
  const tokens: string[] = [];
  let buf = '';
  let bufKind: '' | 'word' | 'ws' = '';
  const flush = (): void => {
    if (buf) {
      tokens.push(buf);
      buf = '';
      bufKind = '';
    }
  };
  for (const { segment } of segmenter.segment(text)) {
    const kind = ASCII_WORD_RE.test(segment) ? 'word' : WS_CHAR_RE.test(segment) ? 'ws' : '';
    if (kind && kind === bufKind) {
      buf += segment;
    } else if (kind) {
      flush();
      buf = segment;
      bufKind = kind;
    } else {
      flush();
      tokens.push(segment);
    }
  }
  flush();
  return tokens;
}

function splitDiffClauses(text: string): string[] {
  return text.match(DIFF_CLAUSE_RE) ?? [];
}

function pushSegment(out: DiffSegment[], type: DiffSegment['type'], text: string): void {
  if (!text) return;
  const prev = out[out.length - 1];
  if (prev && prev.type === type) prev.text += text;
  else out.push({ type, text });
}

function backtrackMyers(a: readonly string[], b: readonly string[], trace: readonly Int32Array[]): DiffSegment[] {
  let x = a.length;
  let y = b.length;
  const ops: Array<{ type: DiffSegment['type']; text: string }> = [];
  for (let d = trace.length - 1; d > 0; d--) {
    const prev = trace[d - 1];
    const k = x - y;
    const prevOffset = d - 1;
    const prevK = k === -d || (k !== d && prev[prevOffset + k - 1] < prev[prevOffset + k + 1]) ? k + 1 : k - 1;
    const prevX = prev[prevOffset + prevK];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      ops.push({ type: 'equal', text: a[x - 1] });
      x--;
      y--;
    }
    if (x === prevX) {
      ops.push({ type: 'insert', text: b[y - 1] });
      y--;
    } else {
      ops.push({ type: 'delete', text: a[x - 1] });
      x--;
    }
  }
  while (x > 0 && y > 0) {
    ops.push({ type: 'equal', text: a[x - 1] });
    x--;
    y--;
  }
  const out: DiffSegment[] = [];
  for (let i = ops.length - 1; i >= 0; i--) {
    pushSegment(out, ops[i].type, ops[i].text);
  }
  return out;
}

function myersDiff(a: readonly string[], b: readonly string[], maxDLimit = MAX_MYERS_D): DiffSegment[] | null {
  const n = a.length;
  const m = b.length;
  if (!n && !m) return [];
  if (!n) return [{ type: 'insert', text: b.join('') }];
  if (!m) return [{ type: 'delete', text: a.join('') }];
  const maxD = Math.min(n + m, maxDLimit);
  const offset = maxD;
  const v = new Int32Array(2 * maxD + 1);
  const trace: Int32Array[] = [];
  for (let d = 0; d <= maxD; d++) {
    const snap = new Int32Array(2 * d + 1);
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      snap[d + k] = x;
      if (x === n && y === m) {
        trace.push(snap);
        return backtrackMyers(a, b, trace);
      }
    }
    trace.push(snap);
  }
  return null;
}

function refineClauseHunk(delText: string, insText: string, out: DiffSegment[]): void {
  const { prefix, oldMid, newMid, suffix } = trimCommonEnds(tokenizeDiff(delText), tokenizeDiff(insText));
  pushSegment(out, 'equal', prefix);
  for (const seg of diffTokenSlices(oldMid, newMid, false)) {
    pushSegment(out, seg.type, seg.text);
  }
  pushSegment(out, 'equal', suffix);
}

function diffByClauses(aText: string, bText: string): DiffSegment[] | null {
  const aClauses = splitDiffClauses(aText);
  const bClauses = splitDiffClauses(bText);
  if (aClauses.length <= 1 && bClauses.length <= 1) return null;
  const coarse = myersDiff(aClauses, bClauses, MAX_MYERS_D);
  if (!coarse) return null;
  const out: DiffSegment[] = [];
  for (let i = 0; i < coarse.length; i++) {
    const cur = coarse[i];
    const next = coarse[i + 1];
    if (cur.type === 'delete' && next && next.type === 'insert') {
      refineClauseHunk(cur.text, next.text, out);
      i++;
      continue;
    }
    if (cur.type === 'insert' && next && next.type === 'delete') {
      refineClauseHunk(next.text, cur.text, out);
      i++;
      continue;
    }
    pushSegment(out, cur.type, cur.text);
  }
  return out;
}

function diffTokenSlices(a: readonly string[], b: readonly string[], allowClauseSplit = true): DiffSegment[] {
  if (!a.length && !b.length) return [];
  const direct = myersDiff(a, b);
  if (direct) return direct;
  const aText = a.join('');
  const bText = b.join('');
  if (allowClauseSplit) {
    const refined = diffByClauses(aText, bText);
    if (refined) return refined;
  }
  const fallback: DiffSegment[] = [];
  pushSegment(fallback, 'delete', aText);
  pushSegment(fallback, 'insert', bText);
  return fallback;
}

function trimCommonEnds(
  oldToks: readonly string[],
  newToks: readonly string[],
): { prefix: string; oldMid: string[]; newMid: string[]; suffix: string } {
  let start = 0;
  const minLen = Math.min(oldToks.length, newToks.length);
  while (start < minLen && oldToks[start] === newToks[start]) start++;

  let oldEnd = oldToks.length;
  let newEnd = newToks.length;
  while (oldEnd > start && newEnd > start && oldToks[oldEnd - 1] === newToks[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }
  return {
    prefix: oldToks.slice(0, start).join(''),
    oldMid: oldToks.slice(start, oldEnd),
    newMid: newToks.slice(start, newEnd),
    suffix: oldToks.slice(oldEnd).join(''),
  };
}

function buildDelData(segments: readonly DiffSegment[]): {
  delParts: DiffTextPart[];
  delOffsets: DiffRangeOffset[];
} {
  const delParts: DiffTextPart[] = [];
  const delOffsets: DiffRangeOffset[] = [];
  let offset = 0;
  for (const seg of segments) {
    if (seg.type === 'insert') continue;
    const isDel = seg.type === 'delete';
    delParts.push({ text: seg.text, changed: isDel });
    if (isDel) {
      delOffsets.push({ fromOffset: offset, toOffset: offset + seg.text.length });
    }
    offset += seg.text.length;
  }
  return { delParts, delOffsets };
}

function buildAddData(segments: readonly DiffSegment[]): {
  addParts: DiffTextPart[];
  addOffsets: DiffRangeOffset[];
} {
  const addParts: DiffTextPart[] = [];
  const addOffsets: DiffRangeOffset[] = [];
  let offset = 0;
  for (const seg of segments) {
    if (seg.type === 'delete') continue;
    const isAdd = seg.type === 'insert';
    addParts.push({ text: seg.text, changed: isAdd });
    if (isAdd) {
      addOffsets.push({ fromOffset: offset, toOffset: offset + seg.text.length });
    }
    offset += seg.text.length;
  }
  return { addParts, addOffsets };
}

export function computeTextDiff(original: string, replacement: string): ComputedTextDiff {
  const { prefix, oldMid, newMid, suffix } = trimCommonEnds(tokenizeDiff(original), tokenizeDiff(replacement));
  const segments: DiffSegment[] = [];
  pushSegment(segments, 'equal', prefix);
  for (const mid of diffTokenSlices(oldMid, newMid)) {
    pushSegment(segments, mid.type, mid.text);
  }
  pushSegment(segments, 'equal', suffix);

  const { delParts, delOffsets } = buildDelData(segments);
  const { addParts, addOffsets } = buildAddData(segments);
  return { segments, delParts, addParts, delOffsets, addOffsets };
}

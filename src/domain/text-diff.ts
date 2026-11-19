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
const MAX_LCS_CELLS = 250_000;

export function tokenizeDiff(text: string): string[] {
  return text.match(DIFF_TOKEN_RE) ?? [];
}

function pushSegment(out: DiffSegment[], type: DiffSegment['type'], text: string): void {
  if (!text) return;
  const prev = out[out.length - 1];
  if (prev && prev.type === type) prev.text += text;
  else out.push({ type, text });
}

function buildLcsTable(a: readonly string[], b: readonly string[]): Uint32Array {
  const cols = b.length + 1;
  const dp = new Uint32Array((a.length + 1) * cols);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      const idx = i * cols + j;
      dp[idx] = a[i] === b[j] ? dp[(i + 1) * cols + j + 1] + 1 : Math.max(dp[(i + 1) * cols + j], dp[i * cols + j + 1]);
    }
  }
  return dp;
}

function backtrackLcs(a: readonly string[], b: readonly string[], dp: Uint32Array): DiffSegment[] {
  const cols = b.length + 1;
  const out: DiffSegment[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      pushSegment(out, 'equal', a[i]);
      i++;
      j++;
    } else if (dp[(i + 1) * cols + j] >= dp[i * cols + j + 1]) {
      pushSegment(out, 'delete', a[i++]);
    } else {
      pushSegment(out, 'insert', b[j++]);
    }
  }
  while (i < a.length) pushSegment(out, 'delete', a[i++]);
  while (j < b.length) pushSegment(out, 'insert', b[j++]);
  return out;
}

function diffTokenSlices(a: readonly string[], b: readonly string[]): DiffSegment[] {
  if (!a.length && !b.length) return [];
  if (a.length * b.length > MAX_LCS_CELLS) {
    const fallback: DiffSegment[] = [];
    pushSegment(fallback, 'delete', a.join(''));
    pushSegment(fallback, 'insert', b.join(''));
    return fallback;
  }
  return backtrackLcs(a, b, buildLcsTable(a, b));
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

import type * as ReactNamespace from 'react';
import { type AiClient, formatAiClientError } from '../adapters/ai-client';
import { loadWritingSkills, saveWritingSkills } from '../adapters/storage';
import type { SelectionRange } from '../domain/article';
import { computeTextDiff } from '../domain/text-diff';
import {
  allWritingSkills,
  applySkillPatches,
  BUILTIN_HUMANIZER_ID,
  buildSelectionSkillPrompt,
  createCustomSkillId,
  findWritingSkill,
  hasMissingProtectedTokens,
  parseSkillMarkdown,
  removeCustomSkill,
  resolveActiveSkill,
  type SkillPatch,
  sanitizeWritingSkillState,
  serializeSkillMarkdown,
  unwrapMarkdownFenceIfProse,
  upsertCustomSkill,
  type WritingSkill,
  type WritingSkillState,
} from '../domain/writing-skills';
import type { EditorDiffTransition, EditorInlineBlock } from '../domain/editor-types';
import { useLatest, useMountDisposable } from '../runtime/react-lifecycle';

type Notify = (text: string, tone?: 'success' | 'error' | 'info') => void;

export interface AiReviewSession {
  status: 'streaming' | 'ready' | 'error';
  skill: WritingSkill;
  baseMarkdown: string;
  selectionRange: SelectionRange;
  streamText: string;
  patches: SkillPatch[];
  error: string;
}

export interface SaveSkillInput {
  id: string | null;
  name: string;
  description: string;
  instructions: string;
  setAsDefault: boolean;
}

export interface UseWritingSkillsOptions {
  React: typeof ReactNamespace;
  t: (key: string) => string;
  notify: Notify;
  aiClient: AiClient;
  markdown?: string;
  title: () => string;
  editorValue: () => string;
  selection: () => SelectionRange;
  setMarkdown: (next: string, opts?: { boundary?: boolean; prevSelection?: SelectionRange }) => void;
  download: (name: string, content: Blob | string, mime: string) => boolean;
}

export interface WritingSkillsApi {
  skillState: WritingSkillState;
  skills: WritingSkill[];
  activeSkill: WritingSkill;
  managerOpen: boolean;
  managerTargetId: string | null;
  session: AiReviewSession | null;
  diffTransition: EditorDiffTransition | null;
  previewMarkdown: (rawMarkdown: string) => string;
  buildInlineBlocks: () => EditorInlineBlock[];
  setSkillStateAll: (next: WritingSkillState) => void;
  selectSkill: (id: string) => void;
  openManager: (targetId?: string | null) => void;
  closeManager: () => void;
  saveCustom: (input: SaveSkillInput) => WritingSkill | null;
  deleteCustom: (id: string) => void;
  exportSkill: (skill: WritingSkill) => void;
  importSkillText: (
    file: File | null | undefined,
  ) => Promise<{ name: string; description: string; instructions: string } | null>;
  runSkill: (overrideSkill?: WritingSkill) => Promise<void>;
  acceptPatch: (id: string) => void;
  dismissPatch: (id: string) => void;
  cancelSession: () => void;
  resetSession: () => void;
}

function buildSelectionStreamingBlock(
  session: AiReviewSession,
  t: (key: string) => string,
  onCancel: () => void,
  onRetry: () => void,
): EditorInlineBlock {
  const isErr = session.status === 'error';
  return {
    id: 'sel-stream',
    from: session.selectionRange.start,
    to: session.selectionRange.end,
    text: isErr ? session.error : session.streamText || t('ai.generating'),
    status: session.status,
    primaryLabel: t('ai.replace'),
    secondaryLabel: session.status === 'streaming' ? t('ai.stop') : t('ai.discard'),
    retryLabel: isErr ? t('ai.retry') : undefined,
    onPrimary: onCancel,
    onSecondary: onCancel,
    onRetry: isErr ? onRetry : undefined,
  };
}

function buildPatchInlineBlock(
  patch: SkillPatch,
  t: (key: string) => string,
  onAccept: () => void,
  onDismiss: () => void,
): EditorInlineBlock {
  const warn = hasMissingProtectedTokens(patch.original, patch.replacement) ? t('ai.syntaxWarn') : undefined;
  const diff = computeTextDiff(patch.original, patch.replacement);
  return {
    id: patch.id,
    from: patch.start,
    to: patch.end,
    text: patch.replacement,
    delParts: diff.delParts,
    addParts: diff.addParts,
    delOffsets: diff.delOffsets,
    status: 'ready',
    warning: warn,
    primaryLabel: t('ai.replace'),
    secondaryLabel: t('ai.discard'),
    onPrimary: onAccept,
    onSecondary: onDismiss,
  };
}

function trimSelectionNewlines(markdown: string, raw: SelectionRange): SelectionRange {
  let start = raw.start;
  let end = raw.end;
  while (start < end && (markdown[start] === '\n' || markdown[start] === '\r')) start++;
  while (end > start && (markdown[end - 1] === '\n' || markdown[end - 1] === '\r')) end--;
  return { start, end };
}

function isPartialInlineSpan(markdown: string, start: number, end: number): boolean {
  const lineStart = start > 0 ? markdown.lastIndexOf('\n', start - 1) + 1 : 0;
  const nextNl = markdown.indexOf('\n', end);
  const lineEnd = nextNl < 0 ? markdown.length : nextNl;
  return start > lineStart || end < lineEnd;
}

function toAcceptTransition(seq: number, patch: SkillPatch, baseMarkdown: string): EditorDiffTransition {
  const diff = computeTextDiff(patch.original, patch.replacement);
  const inlinePhrase = isPartialInlineSpan(baseMarkdown, patch.start, patch.end);
  return {
    kind: 'accept',
    seq,
    from: patch.start,
    to: patch.start + patch.replacement.length,
    inlinePhrase,
    ghostParts: inlinePhrase ? diff.addParts : diff.delParts,
    offsets: diff.addOffsets,
  };
}

function toRejectTransition(seq: number, patch: SkillPatch): EditorDiffTransition {
  const diff = computeTextDiff(patch.original, patch.replacement);
  return {
    kind: 'reject',
    seq,
    from: patch.start,
    to: patch.end,
    ghostParts: diff.addParts,
    offsets: diff.delOffsets,
  };
}

export function useWritingSkills(options: UseWritingSkillsOptions): WritingSkillsApi {
  const React = options.React;
  const t = options.t;
  const [skillState, setSkillState] = React.useState<WritingSkillState>(() => loadWritingSkills());
  const [managerOpen, setManagerOpen] = React.useState(false);
  const [managerTargetId, setManagerTargetId] = React.useState<string | null>(null);
  const [session, setSession] = React.useState<AiReviewSession | null>(null);
  const [diffTransition, setDiffTransition] = React.useState<EditorDiffTransition | null>(null);
  const abortRef = React.useRef<AbortController | null>(null);
  const transitionTimerRef = React.useRef<number | null>(null);
  const transitionSeqRef = React.useRef(0);
  const skillStateRef = React.useRef(skillState);
  const sessionRef = useLatest(React, session);

  const clearTransitionTimer = (): void => {
    if (transitionTimerRef.current !== null) {
      window.clearTimeout(transitionTimerRef.current);
      transitionTimerRef.current = null;
    }
  };

  const startDiffTransition = (next: EditorDiffTransition, durationMs: number): void => {
    clearTransitionTimer();
    setDiffTransition(next);
    transitionTimerRef.current = window.setTimeout(() => {
      transitionTimerRef.current = null;
      setDiffTransition(null);
    }, durationMs);
  };

  const rejectReadyPatch = (patch: SkillPatch): void => {
    transitionSeqRef.current += 1;
    setSession(null);
    startDiffTransition(toRejectTransition(transitionSeqRef.current, patch), 240);
  };

  const commitSkillState = (next: WritingSkillState): void => {
    const clean = sanitizeWritingSkillState(next);
    skillStateRef.current = clean;
    setSkillState(clean);
    saveWritingSkills(clean);
  };

  const resetSession = (): void => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    clearTransitionTimer();
    setDiffTransition(null);
    setSession(null);
  };

  const cancelSession = (): void => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    if (session && session.status === 'ready' && session.patches.length > 0) {
      rejectReadyPatch(session.patches[0]);
      return;
    }
    setSession(null);
  };

  if (options.markdown !== undefined && session && session.baseMarkdown !== options.markdown) {
    resetSession();
  }

  useMountDisposable(React, () => () => {
    if (abortRef.current) abortRef.current.abort();
    clearTransitionTimer();
  });

  const selectSkill = (id: string): void => {
    const found = findWritingSkill(skillStateRef.current, id);
    if (!found) return;
    commitSkillState({ ...skillStateRef.current, activeSkillId: found.id });
  };

  const saveCustom = (input: SaveSkillInput): WritingSkill | null => {
    const name = input.name.trim();
    const instructions = input.instructions.trim();
    if (!name || !instructions) return null;
    const current = skillStateRef.current;
    const id = input.id && input.id !== BUILTIN_HUMANIZER_ID ? input.id : createCustomSkillId();
    const saved: WritingSkill = { id, name, description: input.description.trim(), instructions };
    const nextList = upsertCustomSkill(current.customSkills, saved);
    const activeSkillId = input.setAsDefault ? id : current.activeSkillId;
    commitSkillState({ activeSkillId, customSkills: nextList });
    options.notify(t('ai.skillSaved'));
    return saved;
  };

  const deleteCustom = (id: string): void => {
    if (id === BUILTIN_HUMANIZER_ID) return;
    const current = skillStateRef.current;
    const nextList = removeCustomSkill(current.customSkills, id);
    const activeSkillId = current.activeSkillId === id ? BUILTIN_HUMANIZER_ID : current.activeSkillId;
    commitSkillState({ activeSkillId, customSkills: nextList });
    options.notify(t('ai.skillDeleted'));
  };

  const exportSkill = (skill: WritingSkill): void => {
    const safeFile = (skill.name.replace(/[\\/:*?"<>|\s]+/g, '-') || 'skill') + '.SKILL.md';
    if (options.download(safeFile, serializeSkillMarkdown(skill), 'text/markdown;charset=utf-8')) {
      options.notify(t('ai.skillExported'));
    }
  };

  const importSkillText = async (
    file: File | null | undefined,
  ): Promise<{ name: string; description: string; instructions: string } | null> => {
    if (!file) return null;
    try {
      const raw = await file.text();
      const baseName = file.name.replace(/(?:\.skill)?\.md$/i, '').trim() || t('ai.defaultCustomName');
      return parseSkillMarkdown(raw, baseName);
    } catch (error) {
      options.notify(t('ai.skillImportFailed'), 'error');
      return null;
    }
  };

  const runSelectionFlow = async (
    skill: WritingSkill,
    markdown: string,
    range: SelectionRange,
    controller: AbortController,
  ): Promise<void> => {
    const selectedText = markdown.slice(range.start, range.end);
    const { system, prompt } = buildSelectionSkillPrompt({
      skill,
      title: options.title(),
      markdown,
      start: range.start,
      end: range.end,
    });
    setSession({
      status: 'streaming',
      skill,
      baseMarkdown: markdown,
      selectionRange: range,
      streamText: '',
      patches: [],
      error: '',
    });
    let raw = '';
    const res = await options.aiClient.stream({
      system,
      prompt,
      signal: controller.signal,
      onDelta: (delta) => {
        raw += delta;
        setSession((prev) => (prev ? { ...prev, streamText: raw.trimEnd() } : null));
      },
    });
    const unwrapped = unwrapMarkdownFenceIfProse((raw || res.text).trimEnd(), selectedText);
    const cleanText = unwrapped.trim();
    if (!cleanText || cleanText === selectedText.trim()) {
      setSession(null);
      options.notify(t('ai.noChangesNeeded'), 'info');
      return;
    }
    const patch: SkillPatch = {
      id: 'S1',
      start: range.start,
      end: range.end,
      original: selectedText,
      replacement: unwrapped,
    };
    setSession((prev) => (prev ? { ...prev, status: 'ready', patches: [patch] } : null));
  };

  const runSkill = async (overrideSkill?: WritingSkill): Promise<void> => {
    const markdown = options.editorValue();
    const liveSelection = options.selection();
    const rawRange =
      liveSelection.end > liveSelection.start
        ? liveSelection
        : sessionRef.current?.status === 'error'
          ? sessionRef.current.selectionRange
          : liveSelection;
    const range = trimSelectionNewlines(markdown, rawRange);
    const hasSelection = range.end > range.start && markdown.slice(range.start, range.end).trim().length > 0;
    if (!hasSelection) return;
    if (abortRef.current) abortRef.current.abort();
    clearTransitionTimer();
    setDiffTransition(null);
    const skill = overrideSkill || resolveActiveSkill(skillStateRef.current);
    if (overrideSkill && overrideSkill.id !== skillStateRef.current.activeSkillId) {
      commitSkillState({ ...skillStateRef.current, activeSkillId: overrideSkill.id });
    }
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await runSelectionFlow(skill, markdown, range, controller);
    } catch (error) {
      if (controller.signal.aborted) return;
      const msg = formatAiClientError(error, t);
      setSession((prev) => (prev ? { ...prev, status: 'error', error: msg } : null));
      options.notify(msg, 'error');
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  };

  const acceptPatch = (id: string): void => {
    if (!session) return;
    const target = session.patches.find((p) => p.id === id);
    if (!target) return;
    const beforeMd = options.editorValue();
    if (beforeMd.slice(target.start, target.end) !== target.original) {
      resetSession();
      return;
    }
    const afterMd = applySkillPatches(beforeMd, [target]);
    transitionSeqRef.current += 1;
    options.setMarkdown(afterMd, { boundary: true, prevSelection: options.selection() });
    setSession(null);
    startDiffTransition(toAcceptTransition(transitionSeqRef.current, target, beforeMd), 640);
  };

  const dismissPatch = (id: string): void => {
    if (!session) return;
    const target = session.patches.find((p) => p.id === id);
    if (target) rejectReadyPatch(target);
  };

  const previewMarkdown = (rawMarkdown: string): string => {
    if (!session) return rawMarkdown;
    if (session.patches.length > 0) return applySkillPatches(rawMarkdown, session.patches);
    if (session.status === 'streaming' && session.streamText.trim()) {
      const { start, end } = session.selectionRange;
      if (start >= 0 && end <= rawMarkdown.length && start <= end) {
        return rawMarkdown.slice(0, start) + session.streamText + rawMarkdown.slice(end);
      }
    }
    return rawMarkdown;
  };

  const buildInlineBlocks = (): EditorInlineBlock[] => {
    if (!session) return [];
    if (session.patches.length === 0) {
      return [
        buildSelectionStreamingBlock(session, t, cancelSession, () => {
          void runSkill(session.skill);
        }),
      ];
    }
    return session.patches.map((patch) =>
      buildPatchInlineBlock(
        patch,
        t,
        () => {
          acceptPatch(patch.id);
        },
        () => {
          dismissPatch(patch.id);
        },
      ),
    );
  };

  const localizeBuiltin = (item: WritingSkill): WritingSkill =>
    item.id === BUILTIN_HUMANIZER_ID ? { ...item, name: t('ai.builtinName'), description: t('ai.builtinDesc') } : item;

  return {
    skillState,
    skills: allWritingSkills(skillState).map(localizeBuiltin),
    activeSkill: localizeBuiltin(resolveActiveSkill(skillState)),
    managerOpen,
    managerTargetId,
    session,
    diffTransition,
    previewMarkdown,
    buildInlineBlocks,
    setSkillStateAll: commitSkillState,
    selectSkill,
    openManager: (targetId = null) => {
      setManagerTargetId(targetId);
      setManagerOpen(true);
    },
    closeManager: () => {
      setManagerOpen(false);
    },
    saveCustom,
    deleteCustom,
    exportSkill,
    importSkillText,
    runSkill,
    acceptPatch,
    dismissPatch,
    cancelSession,
    resetSession,
  };
}

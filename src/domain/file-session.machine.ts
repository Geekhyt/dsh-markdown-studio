export type FilePermissionState = 'granted' | 'prompt' | 'denied';
export type FileHandleId = 'none' | 'fileA' | 'fileB';
export type FileWriteOutcome = 'saved' | 'conflict' | 'denied' | 'stale';

export interface PendingWriteOp {
  generation: number;
  handle: Exclude<FileHandleId, 'none'>;
  docId: 'doc1' | 'doc2';
  content: number;
  overwrite: boolean;
}

export interface PendingReloadOp {
  generation: number;
  reloadSeq: number;
  docId: 'doc1' | 'doc2';
  originalContent: number;
}

export interface FileSessionState {
  activeDocId: 'doc1' | 'doc2';
  linkedDocId: 'doc1' | 'doc2' | null;
  linkedHandle: FileHandleId;
  generation: number;
  reloadSeq: number;
  restoring: boolean;
  permission: FilePermissionState;
  conflict: boolean;
  dirtyDisk: boolean;
  autosaveArmedFor: 'doc1' | 'doc2' | null;
  pendingWrite: PendingWriteOp | null;
  pendingReload: PendingReloadOp | null;
  docContent: Record<'doc1' | 'doc2', number>;
  diskContent: Record<'fileA' | 'fileB', number>;
  stampByHandle: Record<'fileA' | 'fileB', number | null>;
  lastCommittedWrite: {
    handle: 'fileA' | 'fileB';
    docId: 'doc1' | 'doc2';
    hadConflict: boolean;
    overwrite: boolean;
  } | null;
}

export type FileSessionEvent =
  | { type: 'RESTORE_DONE' }
  | { type: 'LINK_FILE'; handle: 'fileA' | 'fileB' }
  | { type: 'SWITCH_DOC'; docId: 'doc1' | 'doc2' }
  | { type: 'EDIT_DOC' }
  | { type: 'EXTERNAL_MODIFY'; handle: 'fileA' | 'fileB' }
  | { type: 'SET_PERMISSION'; permission: FilePermissionState }
  | { type: 'FOCUS_CHECK' }
  | { type: 'AUTOSAVE_FIRE' }
  | { type: 'MANUAL_SAVE'; overwrite: boolean }
  | { type: 'WRITE_COMPLETE' }
  | { type: 'RELOAD_START' }
  | { type: 'RELOAD_COMPLETE' }
  | { type: 'DETACH' };

export function normalizePermissionState(result: string): FilePermissionState {
  if (result === 'granted') return 'granted';
  if (result === 'denied') return 'denied';
  return 'prompt';
}

export function isGenerationCurrent(capturedGeneration: number, currentGeneration: number): boolean {
  return capturedGeneration === currentGeneration;
}

export function isReloadRequestValid(params: {
  capturedGeneration: number;
  currentGeneration: number;
  capturedRequest: number;
  currentRequest: number;
  capturedArticleId: string;
  currentArticleId: string;
  originalText: string;
  currentText: string;
}): boolean {
  return (
    params.capturedGeneration === params.currentGeneration &&
    params.capturedRequest === params.currentRequest &&
    params.capturedArticleId === params.currentArticleId &&
    params.originalText === params.currentText
  );
}

export function canStartAutosave(params: {
  hasLinkedFile: boolean;
  hasConflict: boolean;
  sameArticle: boolean;
}): boolean {
  return params.hasLinkedFile && !params.hasConflict && params.sameArticle;
}

export function initialFileSessionState(): FileSessionState {
  return {
    activeDocId: 'doc1',
    linkedDocId: 'doc1',
    linkedHandle: 'fileA',
    generation: 1,
    reloadSeq: 0,
    restoring: true,
    permission: 'granted',
    conflict: false,
    dirtyDisk: false,
    autosaveArmedFor: null,
    pendingWrite: null,
    pendingReload: null,
    docContent: { doc1: 1, doc2: 10 },
    diskContent: { fileA: 1, fileB: 10 },
    stampByHandle: { fileA: 1, fileB: null },
    lastCommittedWrite: null,
  };
}

function isDiskConflicted(state: FileSessionState, handle: 'fileA' | 'fileB'): boolean {
  const stamped = state.stampByHandle[handle];
  return stamped === null || stamped !== state.diskContent[handle];
}

function enqueueWrite(state: FileSessionState, overwrite: boolean): FileSessionState {
  if (state.linkedHandle === 'none' || state.pendingWrite !== null) return state;
  return {
    ...state,
    pendingWrite: {
      generation: state.generation,
      handle: state.linkedHandle,
      docId: state.activeDocId,
      content: state.docContent[state.activeDocId],
      overwrite,
    },
  };
}

function completeWrite(state: FileSessionState): FileSessionState {
  const op = state.pendingWrite;
  if (!op || state.restoring) return state;
  const cleared = { ...state, pendingWrite: null };
  if (!isGenerationCurrent(op.generation, state.generation)) return cleared;
  if (state.permission !== 'granted') return cleared;
  const externalChanged = isDiskConflicted(state, op.handle);
  if (!op.overwrite && (state.conflict || externalChanged)) {
    return { ...cleared, conflict: true };
  }
  const diskContent = { ...state.diskContent, [op.handle]: op.content };
  const stampByHandle = { ...state.stampByHandle, [op.handle]: op.content };
  const stillSameText = state.docContent[op.docId] === op.content;
  return {
    ...cleared,
    conflict: false,
    dirtyDisk: stillSameText ? false : state.dirtyDisk,
    diskContent,
    stampByHandle,
    lastCommittedWrite: {
      handle: op.handle,
      docId: op.docId,
      hadConflict: state.conflict || externalChanged,
      overwrite: op.overwrite,
    },
  };
}

function completeReload(state: FileSessionState): FileSessionState {
  const op = state.pendingReload;
  if (!op || state.pendingWrite !== null) return state;
  const cleared = { ...state, pendingReload: null };
  const valid = isReloadRequestValid({
    capturedGeneration: op.generation,
    currentGeneration: state.generation,
    capturedRequest: op.reloadSeq,
    currentRequest: state.reloadSeq,
    capturedArticleId: op.docId,
    currentArticleId: state.activeDocId,
    originalText: String(op.originalContent),
    currentText: String(state.docContent[state.activeDocId]),
  });
  if (!valid || state.linkedHandle === 'none') return cleared;
  const fresh = state.diskContent[state.linkedHandle];
  return {
    ...cleared,
    conflict: false,
    dirtyDisk: false,
    autosaveArmedFor: null,
    docContent: { ...state.docContent, [state.activeDocId]: fresh },
    stampByHandle: { ...state.stampByHandle, [state.linkedHandle]: fresh },
  };
}

function stepLifecycleEvent(state: FileSessionState, event: FileSessionEvent): FileSessionState | null {
  if (event.type === 'RESTORE_DONE') {
    if (!state.restoring) return state;
    if (state.linkedHandle === 'none') return { ...state, restoring: false };
    const conflict = state.permission === 'granted' && isDiskConflicted(state, state.linkedHandle);
    return { ...state, restoring: false, conflict: state.conflict || conflict };
  }
  if (event.type === 'LINK_FILE') {
    const fresh = state.diskContent[event.handle];
    return {
      ...state,
      linkedDocId: state.activeDocId,
      linkedHandle: event.handle,
      generation: state.generation + 1,
      reloadSeq: state.reloadSeq + 1,
      conflict: false,
      dirtyDisk: false,
      autosaveArmedFor: null,
      stampByHandle: { ...state.stampByHandle, [event.handle]: fresh },
    };
  }
  if (event.type === 'SWITCH_DOC') {
    if (event.docId === state.activeDocId) return state;
    return {
      ...state,
      activeDocId: event.docId,
      linkedDocId: null,
      linkedHandle: 'none',
      generation: state.generation + 1,
      reloadSeq: state.reloadSeq + 1,
      conflict: false,
      dirtyDisk: false,
      autosaveArmedFor: null,
    };
  }
  if (event.type === 'DETACH') {
    return {
      ...state,
      linkedDocId: null,
      linkedHandle: 'none',
      generation: state.generation + 1,
      reloadSeq: state.reloadSeq + 1,
      conflict: false,
      dirtyDisk: false,
      autosaveArmedFor: null,
      permission: 'granted',
    };
  }
  return null;
}

export function stepFileSession(state: FileSessionState, event: FileSessionEvent): FileSessionState {
  const base = { ...state, lastCommittedWrite: null };
  const life = stepLifecycleEvent(base, event);
  if (life) return life;
  switch (event.type) {
    case 'EDIT_DOC': {
      const nextVer = ((base.docContent[base.activeDocId] + 1) % 3) + 1;
      const hasLinked = base.linkedHandle !== 'none';
      return {
        ...base,
        docContent: { ...base.docContent, [base.activeDocId]: nextVer },
        dirtyDisk: hasLinked ? true : base.dirtyDisk,
        autosaveArmedFor: hasLinked && !base.conflict ? base.activeDocId : null,
      };
    }
    case 'EXTERNAL_MODIFY': {
      const nextDisk = ((base.diskContent[event.handle] + 1) % 3) + 1;
      return { ...base, diskContent: { ...base.diskContent, [event.handle]: nextDisk } };
    }
    case 'SET_PERMISSION':
      return { ...base, permission: event.permission };
    case 'FOCUS_CHECK': {
      if (base.restoring || base.pendingWrite !== null || base.linkedHandle === 'none' || base.conflict) return base;
      if (base.permission !== 'granted') return base;
      return isDiskConflicted(base, base.linkedHandle) ? { ...base, conflict: true } : base;
    }
    case 'AUTOSAVE_FIRE': {
      const armedFor = base.autosaveArmedFor;
      const disarmed = { ...base, autosaveArmedFor: null };
      const allowed = canStartAutosave({
        hasLinkedFile: base.linkedHandle !== 'none',
        hasConflict: base.conflict,
        sameArticle: armedFor === base.activeDocId,
      });
      return allowed ? enqueueWrite(disarmed, false) : disarmed;
    }
    case 'MANUAL_SAVE':
      return enqueueWrite(base, event.overwrite);
    case 'WRITE_COMPLETE':
      return completeWrite(base);
    case 'RELOAD_START': {
      if (base.linkedHandle === 'none') return base;
      const nextSeq = base.reloadSeq + 1;
      return {
        ...base,
        reloadSeq: nextSeq,
        pendingReload: {
          generation: base.generation,
          reloadSeq: nextSeq,
          docId: base.activeDocId,
          originalContent: base.docContent[base.activeDocId],
        },
      };
    }
    case 'RELOAD_COMPLETE':
      return completeReload(base);
    default:
      return base;
  }
}

const FILE_SESSION_INVARIANTS: ReadonlyArray<readonly [string, (state: FileSessionState) => boolean]> = [
  [
    'linked file handle belongs to a different document than activeDocId',
    (s) => s.linkedHandle !== 'none' && s.linkedDocId !== s.activeDocId,
  ],
  [
    'detached library document must not retain conflict, dirtyDisk, or armed autosave',
    (s) => s.linkedHandle === 'none' && (s.conflict || s.dirtyDisk || s.autosaveArmedFor !== null),
  ],
  [
    'stale write committed across a document or handle switch',
    (s) =>
      Boolean(
        s.lastCommittedWrite &&
          (s.lastCommittedWrite.docId !== s.activeDocId || s.lastCommittedWrite.handle !== s.linkedHandle),
      ),
  ],
  [
    'conflicted disk file was silently overwritten without explicit overwrite confirmation',
    (s) => Boolean(s.lastCommittedWrite && s.lastCommittedWrite.hadConflict && !s.lastCommittedWrite.overwrite),
  ],
];

export function checkFileSessionInvariants(state: FileSessionState): string[] {
  return FILE_SESSION_INVARIANTS.filter(([, violated]) => violated(state)).map(([message]) => message);
}

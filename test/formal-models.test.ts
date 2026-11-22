import assert from 'node:assert/strict';
import type * as ReactNamespace from 'react';
import { createAssetGarbageCollector } from '../src/application/asset-gc';
import { DocumentStore } from '../src/application/document-store';
import { useDocumentHistory } from '../src/application/use-document-history';
import type { LibraryState } from '../src/domain/article';
import {
  checkFileSessionInvariants,
  type FileSessionEvent,
  type FileSessionState,
  initialFileSessionState,
  normalizePermissionState,
  stepFileSession,
} from '../src/domain/file-session.machine';
import {
  canFocusMarkdownEditor,
  checkStudioSurfaceInvariants,
  computePaneVisibility,
  effectiveBubbleVisible,
  hasSurfaceModal,
  initialStudioSurfaceState,
  isParentModalOpen,
  shouldApplyAiPreview,
  stepStudioSurface,
  type StudioSurfaceEvent,
  type StudioSurfaceState,
} from '../src/domain/studio-overlay.machine';
import { applySkillPatches, hasMissingProtectedTokens } from '../src/domain/writing-skills';
import { DEFAULT_SETTINGS } from '../src/themes';

interface BfsNode<S, E> {
  state: S;
  trace: E[];
}

function formatTrace<E>(trace: E[]): string {
  return trace.map((step, i) => `${i + 1}. ${JSON.stringify(step)}`).join('\n');
}

function exploreStateSpace<S, E>(options: {
  name: string;
  initials: S[];
  events: E[];
  step: (state: S, event: E) => S;
  keyOf: (state: S) => string;
  checkInvariants: (state: S) => string[];
  maxStates: number;
  afterVisit?: (state: S, trace: E[]) => void;
}): { states: number; transitions: number } {
  const visited = new Set<string>();
  const queue: Array<BfsNode<S, E>> = [];
  let head = 0;
  let transitions = 0;

  for (const init of options.initials) {
    const key = options.keyOf(init);
    if (!visited.has(key)) {
      visited.add(key);
      queue.push({ state: init, trace: [] });
    }
  }

  while (head < queue.length && visited.size <= options.maxStates) {
    const { state, trace } = queue[head++];
    const violations = options.checkInvariants(state);
    if (violations.length > 0) {
      assert.fail(
        `[${options.name}] Invariant violation(s): ${violations.join('; ')}\n` +
          `Counterexample trace (${trace.length} steps):\n${formatTrace(trace)}\n` +
          `Final state: ${JSON.stringify(state)}`,
      );
    }
    options.afterVisit?.(state, trace);
    for (const event of options.events) {
      const next = options.step(state, event);
      transitions++;
      const nextKey = options.keyOf(next);
      if (!visited.has(nextKey) && visited.size < options.maxStates) {
        visited.add(nextKey);
        queue.push({ state: next, trace: [...trace, event] });
      }
    }
  }

  return { states: visited.size, transitions };
}

/* ------------------------------------------------------------------------- */
/* Model 1: Studio Surface, Overlays, Focus, Escape, CSS Workbench & Modes   */
/* ------------------------------------------------------------------------- */

const STUDIO_EVENTS: StudioSurfaceEvent[] = [
  { type: 'SET_VIEW', view: 'split' },
  { type: 'SET_VIEW', view: 'edit' },
  { type: 'SET_VIEW', view: 'preview' },
  { type: 'RESIZE', narrow: false },
  { type: 'RESIZE', narrow: true },
  { type: 'OPEN_CSS_WORKBENCH' },
  { type: 'CLOSE_CSS_WORKBENCH' },
  { type: 'ENTER_IMMERSIVE' },
  { type: 'SWITCH_IMMERSIVE', mode: 'write' },
  { type: 'SWITCH_IMMERSIVE', mode: 'preview' },
  { type: 'EXIT_IMMERSIVE' },
  { type: 'TOGGLE_MENU' },
  { type: 'TOGGLE_DRAWER' },
  { type: 'OPEN_SLASH' },
  { type: 'TOGGLE_OUTLINE' },
  { type: 'OPEN_SEARCH' },
  { type: 'START_AI' },
  { type: 'AI_READY' },
  { type: 'AI_ERROR' },
  { type: 'CANCEL_AI' },
  { type: 'OPEN_PARENT_MODAL', modal: 'library' },
  { type: 'OPEN_PARENT_MODAL', modal: 'skills' },
  { type: 'CLOSE_PARENT_MODAL' },
  { type: 'OPEN_CHILD_MODAL', modal: 'confirm' },
  { type: 'CLOSE_CHILD_MODAL' },
  { type: 'SHOW_BUBBLE' },
  { type: 'SCROLL_EDITOR' },
  { type: 'RESET_EDITOR' },
  { type: 'REPLACE_DOCUMENT' },
  { type: 'ESCAPE', target: 'editor' },
  { type: 'ESCAPE', target: 'drawer' },
  { type: 'ESCAPE', target: 'document' },
];

function isEscapeClean(state: StudioSurfaceState): boolean {
  return (
    state.childModal === 'none' &&
    state.parentModal === 'none' &&
    !state.menuOpen &&
    !state.slashOpen &&
    !state.outlineOpen &&
    !state.searchOpen &&
    state.aiSession === 'none' &&
    !state.drawerOpen &&
    state.immersive === null
  );
}

const studioReport = exploreStateSpace<StudioSurfaceState, StudioSurfaceEvent>({
  name: 'StudioOverlayMachine',
  initials: [initialStudioSurfaceState(false), initialStudioSurfaceState(true)],
  events: STUDIO_EVENTS,
  step: stepStudioSurface,
  keyOf: (s) =>
    [
      s.immersive ?? '-',
      s.view,
      +s.cssWorkbenchOpen,
      +s.narrow,
      +s.menuOpen,
      +s.drawerOpen,
      +s.slashOpen,
      +s.outlineOpen,
      +s.searchOpen,
      s.aiSession,
      s.parentModal,
      s.childModal,
      +s.bubbleVisible,
    ].join('|'),
  checkInvariants: checkStudioSurfaceInvariants,
  maxStates: 25_000,
  afterVisit: (state, trace) => {
    // Liveness check: repeated document Escape must converge to a clean state within 8 presses
    // (preserving only an active AI session that is intentionally hidden while in view='preview').
    let cur = state;
    for (let step = 0; step < 8; step++) {
      if (isEscapeClean(cur)) break;
      cur = stepStudioSurface(cur, { type: 'ESCAPE', target: 'document' });
      assert.deepEqual(checkStudioSurfaceInvariants(cur), [], 'Escape step preserves invariants');
    }
    const onlyHiddenAi =
      cur.aiSession !== 'none' && cur.view === 'preview' && cur.immersive === null && !hasSurfaceModal(cur);
    assert.ok(
      isEscapeClean(cur) || onlyHiddenAi,
      `[StudioOverlayMachine] Escape failed to converge within 8 steps from:\n${formatTrace(trace)}\nStuck at: ${JSON.stringify(cur)}`,
    );
  },
});

assert.ok(studioReport.states >= 500, `explored rich studio overlay state space (${studioReport.states} states)`);

// Targeted regression traces (exact historical v0.1.10 / v0.1.11 counterexamples)
{
  // 1. Narrow container + CSS workbench + Preview + Widen > 720px restores split
  let s = initialStudioSurfaceState(true);
  s = stepStudioSurface(s, { type: 'OPEN_CSS_WORKBENCH' });
  s = stepStudioSurface(s, { type: 'SET_VIEW', view: 'preview' });
  assert.equal(s.cssWorkbenchOpen, true, 'narrow preview retains CSS workbench draft');
  s = stepStudioSurface(s, { type: 'RESIZE', narrow: false });
  assert.equal(s.view, 'split', 'widening past 720px restores split view');
  assert.deepEqual(checkStudioSurfaceInvariants(s), []);

  // 2. Outline + AI diff + Search: Editor Escape closes Outline first without losing AI diff
  s = initialStudioSurfaceState(false);
  s = stepStudioSurface(s, { type: 'OPEN_SEARCH' });
  s = stepStudioSurface(s, { type: 'START_AI' });
  s = stepStudioSurface(s, { type: 'AI_READY' });
  s = stepStudioSurface(s, { type: 'TOGGLE_OUTLINE' });
  s = stepStudioSurface(s, { type: 'ESCAPE', target: 'editor' });
  assert.equal(s.outlineOpen, false, 'first Esc closes Outline');
  assert.equal(s.searchOpen, true, 'Search remains open under Outline');
  assert.equal(s.aiSession, 'ready', 'AI ready diff survives Outline dismissal');
  s = stepStudioSurface(s, { type: 'ESCAPE', target: 'editor' });
  assert.equal(s.searchOpen, false, 'second Esc closes Search');
  assert.equal(s.aiSession, 'ready', 'AI ready diff survives Search dismissal');
  s = stepStudioSurface(s, { type: 'ESCAPE', target: 'editor' });
  assert.equal(s.aiSession, 'none', 'third Esc cancels AI session');

  // 3. Focused SettingsDrawer closes before background SearchBar; document Esc closes Search first
  s = initialStudioSurfaceState(false);
  s = stepStudioSurface(s, { type: 'OPEN_SEARCH' });
  s = stepStudioSurface(s, { type: 'TOGGLE_DRAWER' });
  const fromDrawer = stepStudioSurface(s, { type: 'ESCAPE', target: 'drawer' });
  assert.equal(fromDrawer.drawerOpen, false, 'Esc inside drawer closes drawer first');
  assert.equal(fromDrawer.searchOpen, true, 'background search stays open when closing focused drawer');
  const fromDoc = stepStudioSurface(s, { type: 'ESCAPE', target: 'document' });
  assert.equal(fromDoc.searchOpen, false, 'document Esc closes search before docked drawer');
  assert.equal(fromDoc.drawerOpen, true, 'docked drawer stays open when document Esc closes search');

  // 4. Immersive Write + Search: first Esc closes Search, second Esc exits Immersive
  s = initialStudioSurfaceState(false);
  s = stepStudioSurface(s, { type: 'ENTER_IMMERSIVE' });
  s = stepStudioSurface(s, { type: 'OPEN_SEARCH' });
  s = stepStudioSurface(s, { type: 'ESCAPE', target: 'editor' });
  assert.equal(s.searchOpen, false);
  assert.equal(s.immersive, 'write', 'closing Search does not simultaneously exit Immersive');
  s = stepStudioSurface(s, { type: 'ESCAPE', target: 'editor' });
  assert.equal(s.immersive, null, 'second Esc exits Immersive cleanly');

  // 5. Parent modal + child confirm dialog mutual visibility & bubble suppression
  s = initialStudioSurfaceState(false);
  s = stepStudioSurface(s, { type: 'SHOW_BUBBLE' });
  assert.equal(effectiveBubbleVisible(s), true);
  s = stepStudioSurface(s, { type: 'OPEN_PARENT_MODAL', modal: 'library' });
  assert.equal(effectiveBubbleVisible(s), false, 'modal suppresses floating selection bubble');
  s = stepStudioSurface(s, { type: 'OPEN_CHILD_MODAL', modal: 'confirm' });
  assert.equal(isParentModalOpen(s.parentModal !== 'none', s.childModal !== 'none'), false);
  s = stepStudioSurface(s, { type: 'CLOSE_PARENT_MODAL' });
  assert.equal(s.parentModal, 'library', 'parent modal cannot close while child confirm is open');

  // 6. Real counterexample discovered by BFS model check:
  //    preview -> enter immersive -> switch to immersive write -> open search -> exit immersive
  //    must close search when returning to non-editor preview view.
  s = initialStudioSurfaceState(false);
  s = stepStudioSurface(s, { type: 'SET_VIEW', view: 'preview' });
  s = stepStudioSurface(s, { type: 'ENTER_IMMERSIVE' });
  s = stepStudioSurface(s, { type: 'SWITCH_IMMERSIVE', mode: 'write' });
  s = stepStudioSurface(s, { type: 'OPEN_SEARCH' });
  assert.equal(s.searchOpen, true);
  s = stepStudioSurface(s, { type: 'EXIT_IMMERSIVE' });
  assert.equal(s.view, 'preview');
  assert.equal(s.searchOpen, false, 'exiting immersive back to preview closes orphaned search bar');
  assert.deepEqual(checkStudioSurfaceInvariants(s), []);

  // 7. Document replacement (Clear / Load Sample / Import / Drop) closes CssWorkbench & AI session
  s = initialStudioSurfaceState(false);
  s = stepStudioSurface(s, { type: 'OPEN_CSS_WORKBENCH' });
  s = stepStudioSurface(s, { type: 'REPLACE_DOCUMENT' });
  assert.equal(s.cssWorkbenchOpen, false, 'replacing document closes CssWorkbench');

  // 8. Clicking active Split button while in CssWorkbench preserves workbench draft
  s = initialStudioSurfaceState(false);
  s = stepStudioSurface(s, { type: 'OPEN_CSS_WORKBENCH' });
  s = stepStudioSurface(s, { type: 'SET_VIEW', view: 'split' });
  assert.equal(s.cssWorkbenchOpen, true, 'no-op Split click keeps CssWorkbench open');
  assert.equal(s.view, 'split');

  // 9. Narrow CssWorkbench -> Preview -> Edit -> Widen > 720px restores split live preview
  s = initialStudioSurfaceState(true);
  s = stepStudioSurface(s, { type: 'OPEN_CSS_WORKBENCH' });
  s = stepStudioSurface(s, { type: 'SET_VIEW', view: 'preview' });
  s = stepStudioSurface(s, { type: 'SET_VIEW', view: 'edit' });
  assert.equal(s.cssWorkbenchOpen, true, 'narrow edit retains CssWorkbench draft');
  s = stepStudioSurface(s, { type: 'RESIZE', narrow: false });
  assert.equal(s.view, 'split', 'widening from narrow CssWorkbench edit restores split view');
  assert.equal(s.cssWorkbenchOpen, true);
  assert.deepEqual(checkStudioSurfaceInvariants(s), []);

  // 10. Outline, SlashMenu, and HeaderMenu mutually exclude SelectionBubble
  s = initialStudioSurfaceState(false);
  s = stepStudioSurface(s, { type: 'TOGGLE_OUTLINE' });
  s = stepStudioSurface(s, { type: 'SHOW_BUBBLE' });
  assert.equal(effectiveBubbleVisible(s), false, 'open Outline suppresses floating SelectionBubble');
  s = stepStudioSurface(s, { type: 'OPEN_SLASH' });
  s = stepStudioSurface(s, { type: 'SHOW_BUBBLE' });
  assert.equal(effectiveBubbleVisible(s), false, 'open SlashMenu suppresses floating SelectionBubble');
  s = stepStudioSurface(s, { type: 'TOGGLE_MENU' });
  s = stepStudioSurface(s, { type: 'SHOW_BUBBLE' });
  assert.equal(effectiveBubbleVisible(s), false, 'open HeaderMenu suppresses floating SelectionBubble');

  // 11. Immersive Write -> SkillManagerDialog -> LIFO Escape closes modal first, then exits Immersive
  s = initialStudioSurfaceState(false);
  s = stepStudioSurface(s, { type: 'ENTER_IMMERSIVE' });
  s = stepStudioSurface(s, { type: 'SHOW_BUBBLE' });
  s = stepStudioSurface(s, { type: 'OPEN_PARENT_MODAL', modal: 'skills' });
  assert.equal(s.parentModal, 'skills', 'SkillManagerDialog can open from Immersive Write');
  assert.equal(s.immersive, 'write', 'opening SkillManagerDialog preserves Immersive Write');
  assert.equal(effectiveBubbleVisible(s), false, 'SkillManagerDialog suppresses SelectionBubble');
  s = stepStudioSurface(s, { type: 'ESCAPE', target: 'document' });
  assert.equal(s.parentModal, 'none', 'first Esc closes SkillManagerDialog');
  assert.equal(s.immersive, 'write', 'first Esc keeps Immersive Write active');
  s = stepStudioSurface(s, { type: 'ESCAPE', target: 'document' });
  assert.equal(s.immersive, null, 'second Esc exits Immersive Write');
  assert.deepEqual(checkStudioSurfaceInvariants(s), []);
  assert.equal(computePaneVisibility(s.immersive, s.view, s.cssWorkbenchOpen).showMarkdownEditor, true);

  // 8. Modal-guarded editor focus policy & container resize invalidating Outline popover
  assert.equal(canFocusMarkdownEditor({ hasModal: true, showMarkdownEditor: true }), false);
  assert.equal(canFocusMarkdownEditor({ hasModal: false, showMarkdownEditor: false }), false);
  assert.equal(canFocusMarkdownEditor({ hasModal: false, showMarkdownEditor: true }), true);
  s = initialStudioSurfaceState(false);
  s = stepStudioSurface(s, { type: 'TOGGLE_OUTLINE' });
  assert.equal(s.outlineOpen, true);
  s = stepStudioSurface(s, { type: 'RESIZE', narrow: true });
  assert.equal(s.outlineOpen, false, 'container resize dismisses stale Outline popover');
  assert.deepEqual(checkStudioSurfaceInvariants(s), []);

  // 8. Active AI diff preview stays consistent across Split <-> Preview-only view toggles
  assert.equal(shouldApplyAiPreview(false, true), true, 'preview keeps AI draft when switching to preview-only');
  assert.equal(shouldApplyAiPreview(true, true), false, 'CssWorkbench suppresses AI draft preview');
  assert.equal(shouldApplyAiPreview(false, false), false, 'no AI session renders original markdown');

  // Negative self-tests: prove every invariant predicate fires on broken synthetic states (non-vacuity)
  const base = initialStudioSurfaceState(false);
  assert.ok(
    checkStudioSurfaceInvariants({ ...base, cssWorkbenchOpen: true, view: 'preview', narrow: false }).length > 0,
    'invariant rejects hidden wide CSS workbench',
  );
  assert.ok(
    checkStudioSurfaceInvariants({ ...base, cssWorkbenchOpen: true, aiSession: 'ready' }).length > 0,
    'invariant rejects CSS workbench + AI session coexistence',
  );
  assert.ok(
    checkStudioSurfaceInvariants({ ...base, immersive: 'write', drawerOpen: true }).length > 0,
    'invariant rejects immersive + drawer coexistence',
  );
  assert.ok(
    checkStudioSurfaceInvariants({ ...base, view: 'preview', searchOpen: true }).length > 0,
    'invariant rejects orphaned search bar in preview view',
  );
}

/* ------------------------------------------------------------------------- */
/* Model 2: Local File Session × Autosave × Conflict × Permission × Switch   */
/* ------------------------------------------------------------------------- */

const FILE_EVENTS: FileSessionEvent[] = [
  { type: 'RESTORE_DONE' },
  { type: 'LINK_FILE', handle: 'fileA' },
  { type: 'LINK_FILE', handle: 'fileB' },
  { type: 'SWITCH_DOC', docId: 'doc1' },
  { type: 'SWITCH_DOC', docId: 'doc2' },
  { type: 'EDIT_DOC' },
  { type: 'EXTERNAL_MODIFY', handle: 'fileA' },
  { type: 'EXTERNAL_MODIFY', handle: 'fileB' },
  { type: 'SET_PERMISSION', permission: 'granted' },
  { type: 'SET_PERMISSION', permission: 'prompt' },
  { type: 'SET_PERMISSION', permission: 'denied' },
  { type: 'FOCUS_CHECK' },
  { type: 'AUTOSAVE_FIRE' },
  { type: 'MANUAL_SAVE', overwrite: false },
  { type: 'MANUAL_SAVE', overwrite: true },
  { type: 'WRITE_COMPLETE' },
  { type: 'RELOAD_START' },
  { type: 'RELOAD_COMPLETE' },
  { type: 'DETACH' },
];

// Normalize unbounded counters into a bounded horizon (generation/reloadSeq <= 3) so BFS covers every race shape
function boundedFileStep(state: FileSessionState, event: FileSessionEvent): FileSessionState {
  if ((event.type === 'LINK_FILE' || event.type === 'SWITCH_DOC' || event.type === 'DETACH') && state.generation >= 3) {
    return state;
  }
  if (event.type === 'RELOAD_START' && state.reloadSeq >= 3) {
    return state;
  }
  return stepFileSession(state, event);
}

const fileReport = exploreStateSpace<FileSessionState, FileSessionEvent>({
  name: 'FileSessionMachine',
  initials: [initialFileSessionState()],
  events: FILE_EVENTS,
  step: boundedFileStep,
  keyOf: (s) =>
    [
      s.activeDocId,
      s.linkedDocId ?? '-',
      s.linkedHandle,
      s.generation,
      s.reloadSeq,
      +s.restoring,
      s.permission,
      +s.conflict,
      +s.dirtyDisk,
      s.autosaveArmedFor ?? '-',
      s.pendingWrite
        ? `${s.pendingWrite.generation}:${s.pendingWrite.handle}:${s.pendingWrite.docId}:${s.pendingWrite.content}:${+s.pendingWrite.overwrite}`
        : '-',
      s.pendingReload
        ? `${s.pendingReload.generation}:${s.pendingReload.reloadSeq}:${s.pendingReload.docId}:${s.pendingReload.originalContent}`
        : '-',
      s.docContent.doc1,
      s.docContent.doc2,
      s.diskContent.fileA,
      s.diskContent.fileB,
      s.stampByHandle.fileA ?? '-',
      s.stampByHandle.fileB ?? '-',
    ].join('|'),
  checkInvariants: checkFileSessionInvariants,
  maxStates: 25_000,
});

assert.ok(
  fileReport.states >= 1_000,
  `explored rich file-session concurrency state space (${fileReport.states} states)`,
);
assert.equal(normalizePermissionState('granted'), 'granted');
assert.equal(normalizePermissionState('denied'), 'denied');
assert.equal(normalizePermissionState('prompt'), 'prompt');

// Targeted concurrency counterexample checks for FileSessionMachine
{
  // 1. Stale write dropped after document switch
  let f = stepFileSession(initialFileSessionState(), { type: 'RESTORE_DONE' });
  f = stepFileSession(f, { type: 'EDIT_DOC' });
  f = stepFileSession(f, { type: 'AUTOSAVE_FIRE' });
  assert.ok(f.pendingWrite, 'autosave enqueues write');
  const diskBeforeSwitch = f.diskContent.fileA;
  f = stepFileSession(f, { type: 'SWITCH_DOC', docId: 'doc2' });
  f = stepFileSession(f, { type: 'WRITE_COMPLETE' });
  assert.equal(f.diskContent.fileA, diskBeforeSwitch, 'stale queued write must not mutate old file after doc switch');
  assert.deepEqual(checkFileSessionInvariants(f), []);

  // 2. External modification triggers conflict on save; explicit overwrite commits
  f = stepFileSession(initialFileSessionState(), { type: 'RESTORE_DONE' });
  f = stepFileSession(f, { type: 'EDIT_DOC' });
  f = stepFileSession(f, { type: 'EXTERNAL_MODIFY', handle: 'fileA' });
  const externalVer = f.diskContent.fileA;
  f = stepFileSession(f, { type: 'MANUAL_SAVE', overwrite: false });
  f = stepFileSession(f, { type: 'WRITE_COMPLETE' });
  assert.equal(f.conflict, true, 'non-overwrite save detects external conflict');
  assert.equal(f.diskContent.fileA, externalVer, 'conflicted disk file is untouched');
  f = stepFileSession(f, { type: 'MANUAL_SAVE', overwrite: true });
  f = stepFileSession(f, { type: 'WRITE_COMPLETE' });
  assert.equal(f.conflict, false, 'explicit overwrite clears conflict');
  assert.equal(f.diskContent.fileA, f.docContent.doc1, 'explicit overwrite writes local content');

  // 3. Reload aborted if user edits doc while reload is in flight
  f = stepFileSession(initialFileSessionState(), { type: 'RESTORE_DONE' });
  f = stepFileSession(f, { type: 'EXTERNAL_MODIFY', handle: 'fileA' });
  f = stepFileSession(f, { type: 'RELOAD_START' });
  f = stepFileSession(f, { type: 'EDIT_DOC' });
  const userEditVer = f.docContent.doc1;
  f = stepFileSession(f, { type: 'RELOAD_COMPLETE' });
  assert.equal(f.docContent.doc1, userEditVer, 'in-flight reload does not clobber concurrent user typing');

  // Negative self-tests: prove every file-session invariant rejects synthetic broken states (non-vacuity)
  const fBase = initialFileSessionState();
  assert.ok(
    checkFileSessionInvariants({ ...fBase, linkedHandle: 'fileA', linkedDocId: 'doc2', activeDocId: 'doc1' }).length >
      0,
    'invariant rejects cross-doc handle link',
  );
  assert.ok(
    checkFileSessionInvariants({ ...fBase, linkedHandle: 'none', linkedDocId: null, conflict: true }).length > 0,
    'invariant rejects conflict on detached doc',
  );
  assert.ok(
    checkFileSessionInvariants({
      ...fBase,
      lastCommittedWrite: { handle: 'fileB', docId: 'doc2', hadConflict: false, overwrite: false },
    }).length > 0,
    'invariant rejects cross-doc stale write commit',
  );
  assert.ok(
    checkFileSessionInvariants({
      ...fBase,
      lastCommittedWrite: { handle: 'fileA', docId: 'doc1', hadConflict: true, overwrite: false },
    }).length > 0,
    'invariant rejects silent conflict overwrite',
  );
}

/* ------------------------------------------------------------------------- */
/* Model 3: Multi-Tab DocumentStore + Deterministic History Coalescing       */
/* ------------------------------------------------------------------------- */

function assertLibraryInvariants(state: LibraryState, label: string): void {
  assert.ok(state.docs.length >= 1, `${label}: docs is never empty`);
  const seen = new Set<string>();
  for (const doc of state.docs) {
    assert.ok(!seen.has(doc.id), `${label}: duplicate live doc id ${doc.id}`);
    seen.add(doc.id);
  }
  for (const item of state.trash || []) {
    assert.ok(!seen.has(item.id), `${label}: duplicate id ${item.id} across docs/trash`);
    seen.add(item.id);
  }
  assert.ok(
    state.docs.some((doc) => doc.id === state.activeId),
    `${label}: activeId ${state.activeId} exists in docs`,
  );
  const expectedCustomIds = (state.docs[0].settings.customThemes || []).map((c) => c.id).sort();
  for (const doc of state.docs) {
    assert.deepEqual(
      (doc.settings.customThemes || []).map((c) => c.id).sort(),
      expectedCustomIds,
      `${label}: shared customThemes unified across all docs`,
    );
  }
}

{
  let clock = 1_000;
  let idSeq = 1;
  const now = () => (clock += 10);
  const nextId = () => `det-${idSeq++}`;
  const seed: LibraryState = {
    activeId: 'a1',
    docs: [
      { id: 'a1', title: 'Alpha', markdown: 'A0', settings: { ...DEFAULT_SETTINGS }, view: 'split', updatedAt: 100 },
      { id: 'b1', title: 'Beta', markdown: 'B0', settings: { ...DEFAULT_SETTINGS }, view: 'split', updatedAt: 100 },
    ],
    trash: [],
  };

  let sharedDisk: LibraryState = structuredClone(seed);
  const makeTab = () =>
    new DocumentStore(
      structuredClone(sharedDisk),
      (next) => {
        sharedDisk = structuredClone(next);
        return true;
      },
      () => structuredClone(sharedDisk),
      { now, nextId },
    );

  // Exhaustive deterministic sequence testing multi-tab interleaving
  const actions: Array<() => void> = [];
  const tabA = makeTab();
  const tabB = makeTab();
  tabB.switchTo('b1');

  // Tab A edits a1 (dirty), Tab B edits b1 and flushes -> storage event syncs Tab A
  tabA.updateActive({ markdown: 'A-local-dirty' });
  tabB.updateActive({ markdown: 'B-remote-saved' });
  tabB.flush();
  tabA.syncExternal(structuredClone(sharedDisk));

  assertLibraryInvariants(tabA.getSnapshot(), 'tabA after sibling flush');
  assert.equal(
    tabA.getSnapshot().docs.find((d) => d.id === 'a1')?.markdown,
    'A-local-dirty',
    'dirty local doc on Tab A is never overwritten by Tab B flush',
  );
  assert.equal(
    tabA.getSnapshot().docs.find((d) => d.id === 'b1')?.markdown,
    'B-remote-saved',
    'Tab B edit to sibling doc merges cleanly into Tab A',
  );

  // Tab A flushes, Tab B deletes & restores, syncs back across tabs
  tabA.flush();
  tabB.syncExternal(structuredClone(sharedDisk));
  assertLibraryInvariants(tabB.getSnapshot(), 'tabB after tabA flush');

  actions.push(
    () => {
      tabA.create({ title: 'Gamma', markdown: 'G0', settings: { ...DEFAULT_SETTINGS }, view: 'split' });
      tabA.flush();
    },
    () => {
      tabB.syncExternal(structuredClone(sharedDisk));
      tabB.delete('b1', 'Untitled');
      tabB.flush();
    },
    () => {
      tabA.syncExternal(structuredClone(sharedDisk));
      const trashed = tabA.getTrash()[0];
      if (trashed) tabA.restore(trashed.id);
      tabA.flush();
    },
    () => {
      tabB.syncExternal(structuredClone(sharedDisk));
      tabB.updateActive({
        settings: {
          ...tabB.getActive().settings,
          theme: 'custom:c1',
          customThemes: [{ id: 'custom:c1', name: 'Mint', css: '#mdstudio { color: #111; }' }],
        },
      });
      tabB.flush();
      tabA.syncExternal(structuredClone(sharedDisk));
    },
  );
  for (const fn of actions) {
    fn();
    assertLibraryInvariants(tabA.getSnapshot(), 'tabA multi-tab sequence');
    assertLibraryInvariants(tabB.getSnapshot(), 'tabB multi-tab sequence');
    assertLibraryInvariants(sharedDisk, 'sharedDisk multi-tab sequence');
  }
  tabA.flush();
  tabB.flush();
}

// Deterministic clock verification for useDocumentHistory (exact 699ms vs 700ms coalesce boundary)
{
  let historyNow = 10_000;
  let latestMd = 'start';
  const fakeReact = {
    useRef<T>(initial: T) {
      return { current: initial };
    },
  } as unknown as typeof ReactNamespace;
  const hist = useDocumentHistory({
    React: fakeReact,
    initialMarkdown: 'start',
    onApply: (md) => {
      latestMd = md;
    },
    getSelection: () => ({ start: latestMd.length, end: latestMd.length }),
    focusRange: () => {},
    now: () => historyNow,
  });

  hist.setMarkdown('start-1', { boundary: false });
  historyNow += 699;
  hist.setMarkdown('start-12', { boundary: false });
  assert.equal(hist.historyMarkdowns().length, 1, 'edits within 699ms coalesce into 1 undo step');
  historyNow += 700;
  hist.setMarkdown('start-123', { boundary: false });
  assert.equal(hist.historyMarkdowns().length, 2, 'edit at >= 700ms starts a distinct undo boundary');
}

/* ------------------------------------------------------------------------- */
/* Model 4: Exhaustive Asset GC Safety Matrix & AI Patch Guard Invariants    */
/* ------------------------------------------------------------------------- */

{
  // Test all 2^7 = 128 combinations of asset protection flags for AssetGarbageCollector
  const filename = 'a1b2c3d4e5f6a1b2c3d4e5f6.png';
  const fixedNow = Date.parse('2026-11-22T12:00:00.000Z');
  const withinGrace = new Date(fixedNow - 15_000).toISOString();
  const expiredGrace = new Date(fixedNow - 90_000).toISOString();

  for (let mask = 0; mask < 128; mask++) {
    const inDocs = Boolean(mask & 1);
    const inTrash = Boolean(mask & 2);
    const inHistory = Boolean(mask & 4);
    const inFlight = Boolean(mask & 8);
    const inMermaid = Boolean(mask & 16);
    const isFresh = Boolean(mask & 32);
    const bypassGrace = Boolean(mask & 64);

    const deleted: string[] = [];
    const gc = createAssetGarbageCollector({
      hostClient: {
        listAssets: async () => [
          {
            filename,
            assetPath: `assets/${filename}`,
            url: `http://127.0.0.1:4010/uploads/${filename}`,
            bytes: 42,
            mime: 'image/png',
            storedAt: isFresh ? withinGrace : expiredGrace,
          },
        ],
        deleteAsset: async (name) => {
          deleted.push(name);
        },
      },
      getSnapshot: () => ({
        activeId: 'd1',
        docs: [
          {
            id: 'd1',
            title: 'T',
            markdown: inDocs ? `![](assets/${filename})` : 'plain',
            settings: { ...DEFAULT_SETTINGS },
            view: 'split',
            updatedAt: fixedNow,
          },
        ],
        trash: inTrash
          ? [
              {
                id: 't1',
                title: 'Trashed',
                markdown: `![](assets/${filename})`,
                settings: { ...DEFAULT_SETTINGS },
                view: 'split',
                updatedAt: fixedNow,
                deletedAt: fixedNow,
              },
            ]
          : [],
      }),
      mermaidFilenames: () => new Set(inMermaid ? [filename] : []),
      extraFilenames: () => [...(inHistory ? [filename] : []), ...(inFlight ? [filename] : [])],
      minAgeMs: 60_000,
      now: () => fixedNow,
    });

    await gc.prune(bypassGrace ? { bypassGraceFor: [filename] } : undefined);
    const referencedAnywhere = inDocs || inTrash || inHistory || inFlight || inMermaid;
    const expectedDeleted = !referencedAnywhere && (!isFresh || bypassGrace);
    assert.equal(
      deleted.length === 1,
      expectedDeleted,
      `GC safety matrix failed for mask=${mask} (docs=${inDocs}, trash=${inTrash}, hist=${inHistory}, inFlight=${inFlight}, mermaid=${inMermaid}, fresh=${isFresh}, bypass=${bypassGrace})`,
    );
  }
}

// AI Writing Skill patch safety invariants
{
  const original = '前缀 `code()` 与 $a+b$ 还有 [链接](https://example.com) 后缀。';
  const safeReplacement = '精简后 `code()` 与 $a+b$ 还有 [链接](https://example.com) 结尾。';
  const brokenReplacement = '精简后丢失了代码和链接。';
  assert.equal(hasMissingProtectedTokens(original, safeReplacement), false, 'intact protected tokens pass guard');
  assert.equal(hasMissingProtectedTokens(original, brokenReplacement), true, 'dropped code/math/url triggers guard');
  const patched = applySkillPatches(original, [
    { id: 'S1', start: 0, end: original.length, original, replacement: safeReplacement },
  ]);
  assert.equal(patched, safeReplacement, 'exact patch replaces cleanly');
}

console.log(
  `ok - formal model verification passed: StudioOverlayMachine (${studioReport.states} states, ${studioReport.transitions} transitions), ` +
    `FileSessionMachine (${fileReport.states} states, ${fileReport.transitions} transitions), ` +
    `Multi-Tab DocumentStore, 128-state AssetGC matrix, and AI patch guards`,
);

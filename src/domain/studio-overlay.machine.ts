export type SurfaceViewMode = 'split' | 'edit' | 'preview';
export type SurfaceImmersiveMode = 'write' | 'preview' | null;
export type AiSessionPhase = 'none' | 'streaming' | 'ready' | 'error';
export type ParentModalKind = 'none' | 'library' | 'workspace' | 'skills';
export type ChildModalKind = 'none' | 'confirm' | 'importMode' | 'mergeReview';
export type EscapeAction = 'none' | 'close-search' | 'cancel-ai' | 'close-menu' | 'close-drawer';
export type EditorEscapeOutcome = 'close-search' | 'cancel-ai' | 'defer' | false;

export const NARROW_CONTAINER_PX = 720;

export interface PaneVisibility {
  showMarkdownEditor: boolean;
  showCssWorkbench: boolean;
  showPreview: boolean;
}

export interface StudioSurfaceState {
  immersive: SurfaceImmersiveMode;
  view: SurfaceViewMode;
  cssWorkbenchOpen: boolean;
  narrow: boolean;
  menuOpen: boolean;
  drawerOpen: boolean;
  slashOpen: boolean;
  outlineOpen: boolean;
  searchOpen: boolean;
  aiSession: AiSessionPhase;
  parentModal: ParentModalKind;
  childModal: ChildModalKind;
  bubbleVisible: boolean;
}

export type StudioSurfaceEvent =
  | { type: 'SET_VIEW'; view: SurfaceViewMode }
  | { type: 'RESIZE'; narrow: boolean }
  | { type: 'OPEN_CSS_WORKBENCH' }
  | { type: 'CLOSE_CSS_WORKBENCH' }
  | { type: 'ENTER_IMMERSIVE' }
  | { type: 'SWITCH_IMMERSIVE'; mode: 'write' | 'preview' }
  | { type: 'EXIT_IMMERSIVE' }
  | { type: 'TOGGLE_MENU' }
  | { type: 'TOGGLE_DRAWER' }
  | { type: 'OPEN_SLASH' }
  | { type: 'TOGGLE_OUTLINE' }
  | { type: 'OPEN_SEARCH' }
  | { type: 'START_AI' }
  | { type: 'AI_READY' }
  | { type: 'AI_ERROR' }
  | { type: 'CANCEL_AI' }
  | { type: 'OPEN_PARENT_MODAL'; modal: Exclude<ParentModalKind, 'none'> }
  | { type: 'CLOSE_PARENT_MODAL' }
  | { type: 'OPEN_CHILD_MODAL'; modal: Exclude<ChildModalKind, 'none'> }
  | { type: 'CLOSE_CHILD_MODAL' }
  | { type: 'SHOW_BUBBLE' }
  | { type: 'SCROLL_EDITOR' }
  | { type: 'RESET_EDITOR' }
  | { type: 'REPLACE_DOCUMENT' }
  | { type: 'ESCAPE'; target: 'editor' | 'drawer' | 'document' };

export function shouldApplyAiPreview(cssOpen: boolean, hasAiSession: boolean): boolean {
  return !cssOpen && hasAiSession;
}

export function isFullscreenDrawer(drawerOpen: boolean, containerWidth: number): boolean {
  return drawerOpen && containerWidth <= NARROW_CONTAINER_PX;
}

export function shouldKeepDrawerOnNavigation(containerWidth: number): boolean {
  return containerWidth > NARROW_CONTAINER_PX;
}

export function canFocusMarkdownEditor(flags: {
  hasModal: boolean;
  showMarkdownEditor: boolean;
  fullscreenDrawer?: boolean;
}): boolean {
  return !flags.hasModal && flags.showMarkdownEditor && !flags.fullscreenDrawer;
}

export function computePaneVisibility(immersive: SurfaceImmersiveMode, view: string, cssOpen: boolean): PaneVisibility {
  const leftVisible = immersive ? immersive === 'write' : view !== 'preview';
  const showPreview = immersive ? immersive === 'preview' : view !== 'edit';
  return {
    showMarkdownEditor: leftVisible && !cssOpen,
    showCssWorkbench: leftVisible && cssOpen,
    showPreview,
  };
}

export function isParentModalOpen(open: boolean, childOpen: boolean, promptA?: unknown, promptB?: unknown): boolean {
  return Boolean(open && !childOpen && !promptA && !promptB);
}

export function shouldKeepCssWorkbenchOnViewChange(
  cssOpen: boolean,
  containerWidth: number,
  nextView: SurfaceViewMode,
): boolean {
  return cssOpen && (nextView === 'split' || containerWidth <= NARROW_CONTAINER_PX);
}

export function shouldRestoreSplitOnResize(cssOpen: boolean, view: string, containerWidth: number): boolean {
  return cssOpen && view !== 'split' && containerWidth > NARROW_CONTAINER_PX;
}

export function canShowSelectionBubble(flags: {
  showMarkdownEditor: boolean;
  hasModal: boolean;
  hasAiSession: boolean;
  outlineOpen: boolean;
  slashOpen: boolean;
  menuOpen: boolean;
  fullscreenDrawer?: boolean;
}): boolean {
  return (
    flags.showMarkdownEditor &&
    !flags.hasModal &&
    !flags.hasAiSession &&
    !flags.outlineOpen &&
    !flags.slashOpen &&
    !flags.menuOpen &&
    !flags.fullscreenDrawer
  );
}

export function resolveEditorEscapeOutcome(flags: {
  menuOpen: boolean;
  outlineOpen: boolean;
  showMarkdownEditor: boolean;
  searchOpen: boolean;
  hasAiSession: boolean;
  fullscreenDrawer?: boolean;
}): EditorEscapeOutcome {
  if (flags.menuOpen || flags.outlineOpen || flags.fullscreenDrawer) return 'defer';
  if (!flags.showMarkdownEditor) return false;
  if (flags.searchOpen) return 'close-search';
  if (flags.hasAiSession) return 'cancel-ai';
  return false;
}

export function resolveDocumentEscapeAction(flags: {
  hasModal: boolean;
  menuOpen: boolean;
  outlineOpen: boolean;
  slashOpen: boolean;
  drawerOpen: boolean;
  inDrawer: boolean;
  showMarkdownEditor: boolean;
  searchOpen: boolean;
  hasAiSession: boolean;
  fullscreenDrawer?: boolean;
}): 'none' | 'close-search' | 'cancel-ai' {
  if (flags.hasModal || flags.menuOpen || flags.outlineOpen || flags.slashOpen) return 'none';
  if (flags.drawerOpen && (flags.inDrawer || flags.fullscreenDrawer)) return 'none';
  if (!flags.showMarkdownEditor) return 'none';
  if (flags.searchOpen) return 'close-search';
  if (flags.hasAiSession) return 'cancel-ai';
  return 'none';
}

export function resolveWindowEscapeAction(flags: {
  hasModal: boolean;
  menuOpen: boolean;
  drawerOpen: boolean;
  inEditor: boolean;
  fullscreenDrawer?: boolean;
}): 'none' | 'close-menu' | 'close-drawer' {
  if (flags.hasModal) return 'none';
  if (flags.menuOpen) return 'close-menu';
  if (flags.drawerOpen && (!flags.inEditor || flags.fullscreenDrawer)) return 'close-drawer';
  return 'none';
}

export function canHandleImmersiveShortcutPolicy(
  flags: {
    hasModal: boolean;
    showMarkdownEditor: boolean;
    searchOpen: boolean;
    slashOpen: boolean;
    outlineOpen: boolean;
    hasAiSession: boolean;
    menuOpen: boolean;
    drawerOpen: boolean;
  },
  action: 'toggle' | 'exit',
): boolean {
  if (flags.hasModal) return false;
  if (action === 'toggle') return true;
  const editorBlocking =
    flags.showMarkdownEditor && (flags.searchOpen || flags.slashOpen || flags.outlineOpen || flags.hasAiSession);
  return !(editorBlocking || flags.menuOpen || flags.drawerOpen);
}

export function initialStudioSurfaceState(narrow = false): StudioSurfaceState {
  return {
    immersive: null,
    view: 'split',
    cssWorkbenchOpen: false,
    narrow,
    menuOpen: false,
    drawerOpen: false,
    slashOpen: false,
    outlineOpen: false,
    searchOpen: false,
    aiSession: 'none',
    parentModal: 'none',
    childModal: 'none',
    bubbleVisible: false,
  };
}

export function hasSurfaceModal(state: StudioSurfaceState): boolean {
  return state.parentModal !== 'none' || state.childModal !== 'none';
}

export function effectiveBubbleVisible(state: StudioSurfaceState): boolean {
  const panes = computePaneVisibility(state.immersive, state.view, state.cssWorkbenchOpen);
  return (
    state.bubbleVisible &&
    canShowSelectionBubble({
      showMarkdownEditor: panes.showMarkdownEditor,
      hasModal: hasSurfaceModal(state),
      hasAiSession: state.aiSession !== 'none',
      outlineOpen: state.outlineOpen,
      slashOpen: state.slashOpen,
      menuOpen: state.menuOpen,
      fullscreenDrawer: isFullscreenDrawer(state.drawerOpen, state.narrow ? 640 : 1024),
    })
  );
}

function dismissTransient(
  state: StudioSurfaceState,
  opts?: { keepSearch?: boolean; keepDrawer?: boolean; keepMenu?: boolean },
): StudioSurfaceState {
  return {
    ...state,
    drawerOpen: opts?.keepDrawer ? state.drawerOpen : false,
    menuOpen: opts?.keepMenu ? state.menuOpen : false,
    slashOpen: false,
    outlineOpen: false,
    bubbleVisible: false,
    searchOpen: opts?.keepSearch ? state.searchOpen : false,
  };
}

function applyEditorEscape(state: StudioSurfaceState, showMarkdownEditor: boolean): StudioSurfaceState | null {
  if (!showMarkdownEditor) return null;
  const fullscreenDrawer = isFullscreenDrawer(state.drawerOpen, state.narrow ? 640 : 1024);
  if (fullscreenDrawer) {
    return state.menuOpen ? { ...state, menuOpen: false } : { ...state, drawerOpen: false };
  }
  if (state.slashOpen) return { ...state, slashOpen: false };
  const outcome = resolveEditorEscapeOutcome({
    menuOpen: state.menuOpen,
    outlineOpen: state.outlineOpen,
    showMarkdownEditor,
    searchOpen: state.searchOpen,
    hasAiSession: state.aiSession !== 'none',
    fullscreenDrawer,
  });
  if (outcome === 'close-search') return { ...state, searchOpen: false };
  if (outcome === 'cancel-ai') return { ...state, aiSession: 'none' };
  if (outcome === 'defer') {
    if (state.menuOpen) return { ...state, menuOpen: false };
    if (state.outlineOpen) return { ...state, outlineOpen: false };
  }
  return null;
}

function applyNonEditorEscape(
  state: StudioSurfaceState,
  target: 'drawer' | 'document',
  showMarkdownEditor: boolean,
): StudioSurfaceState | null {
  const fullscreenDrawer = isFullscreenDrawer(state.drawerOpen, state.narrow ? 640 : 1024);
  const docAction = resolveDocumentEscapeAction({
    hasModal: false,
    menuOpen: state.menuOpen,
    outlineOpen: state.outlineOpen,
    slashOpen: state.slashOpen,
    drawerOpen: state.drawerOpen,
    inDrawer: target === 'drawer',
    showMarkdownEditor,
    searchOpen: state.searchOpen,
    hasAiSession: state.aiSession !== 'none',
    fullscreenDrawer,
  });
  if (docAction === 'close-search') return { ...state, searchOpen: false };
  if (docAction === 'cancel-ai') return { ...state, aiSession: 'none' };
  if (state.menuOpen) return { ...state, menuOpen: false };
  if (fullscreenDrawer) return { ...state, drawerOpen: false };
  if (target === 'document' && state.outlineOpen) return { ...state, outlineOpen: false };
  if (target === 'document' && state.slashOpen) return { ...state, slashOpen: false };
  const winAction = resolveWindowEscapeAction({
    hasModal: false,
    menuOpen: state.menuOpen,
    drawerOpen: state.drawerOpen,
    inEditor: false,
    fullscreenDrawer,
  });
  return winAction === 'close-drawer' ? { ...state, drawerOpen: false } : null;
}

function applyEscape(state: StudioSurfaceState, target: 'editor' | 'drawer' | 'document'): StudioSurfaceState {
  if (state.childModal !== 'none') return { ...state, childModal: 'none' };
  if (state.parentModal !== 'none') return { ...state, parentModal: 'none' };
  const panes = computePaneVisibility(state.immersive, state.view, state.cssWorkbenchOpen);
  const handled =
    target === 'editor'
      ? applyEditorEscape(state, panes.showMarkdownEditor)
      : applyNonEditorEscape(state, target, panes.showMarkdownEditor);
  if (handled) return handled;
  const canExit = canHandleImmersiveShortcutPolicy(
    {
      hasModal: false,
      showMarkdownEditor: panes.showMarkdownEditor,
      searchOpen: state.searchOpen,
      slashOpen: state.slashOpen,
      outlineOpen: state.outlineOpen,
      hasAiSession: state.aiSession !== 'none',
      menuOpen: state.menuOpen,
      drawerOpen: state.drawerOpen,
    },
    'exit',
  );
  return state.immersive && canExit
    ? { ...dismissTransient(state, { keepSearch: state.view !== 'preview' }), immersive: null }
    : state;
}

function stepModalEvent(state: StudioSurfaceState, event: StudioSurfaceEvent): StudioSurfaceState | null {
  switch (event.type) {
    case 'OPEN_PARENT_MODAL': {
      const allowedInImmersive = event.modal === 'skills' && state.immersive === 'write';
      if (hasSurfaceModal(state) || (state.immersive && !allowedInImmersive)) return state;
      return { ...dismissTransient(state, { keepSearch: true, keepDrawer: true }), parentModal: event.modal };
    }
    case 'CLOSE_PARENT_MODAL':
      return state.childModal !== 'none' ? state : { ...state, parentModal: 'none' };
    case 'OPEN_CHILD_MODAL':
      return { ...state, childModal: event.modal, bubbleVisible: false };
    case 'CLOSE_CHILD_MODAL':
      return { ...state, childModal: 'none' };
    default:
      return null;
  }
}

function stepOverlayEvent(state: StudioSurfaceState, event: StudioSurfaceEvent): StudioSurfaceState | null {
  const panes = computePaneVisibility(state.immersive, state.view, state.cssWorkbenchOpen);
  switch (event.type) {
    case 'TOGGLE_MENU':
      if (state.immersive || hasSurfaceModal(state)) return state;
      return state.menuOpen
        ? { ...state, menuOpen: false }
        : { ...dismissTransient(state, { keepSearch: true, keepDrawer: true, keepMenu: true }), menuOpen: true };
    case 'TOGGLE_DRAWER':
      if (state.immersive || hasSurfaceModal(state)) return state;
      return { ...dismissTransient(state, { keepSearch: true, keepDrawer: true }), drawerOpen: !state.drawerOpen };
    case 'OPEN_SLASH':
      if (!panes.showMarkdownEditor || hasSurfaceModal(state) || state.aiSession !== 'none') return state;
      return { ...state, slashOpen: true, outlineOpen: false };
    case 'TOGGLE_OUTLINE':
      if (!panes.showMarkdownEditor || hasSurfaceModal(state)) return state;
      return { ...state, outlineOpen: !state.outlineOpen, slashOpen: false, bubbleVisible: false };
    case 'OPEN_SEARCH':
      if (!panes.showMarkdownEditor || hasSurfaceModal(state)) return state;
      return { ...state, searchOpen: true, outlineOpen: false, bubbleVisible: false };
    case 'SHOW_BUBBLE':
      if (!panes.showMarkdownEditor || hasSurfaceModal(state) || state.aiSession !== 'none') return state;
      return { ...state, bubbleVisible: true };
    case 'SCROLL_EDITOR':
      return { ...state, slashOpen: false, bubbleVisible: false };
    default:
      return null;
  }
}

function stepAiEvent(state: StudioSurfaceState, event: StudioSurfaceEvent): StudioSurfaceState | null {
  const panes = computePaneVisibility(state.immersive, state.view, state.cssWorkbenchOpen);
  if (event.type === 'START_AI') {
    if (!panes.showMarkdownEditor || hasSurfaceModal(state)) return state;
    return { ...state, aiSession: 'streaming', slashOpen: false, bubbleVisible: false };
  }
  if (event.type === 'AI_READY') {
    return state.aiSession === 'streaming' ? { ...state, aiSession: 'ready' } : state;
  }
  if (event.type === 'AI_ERROR') {
    return state.aiSession === 'streaming' ? { ...state, aiSession: 'error' } : state;
  }
  if (event.type === 'CANCEL_AI') {
    return { ...state, aiSession: 'none' };
  }
  return null;
}

function stepViewOrWorkbenchEvent(state: StudioSurfaceState, event: StudioSurfaceEvent): StudioSurfaceState | null {
  switch (event.type) {
    case 'SET_VIEW': {
      if (state.immersive || hasSurfaceModal(state)) return state;
      const width = state.narrow ? 640 : 1024;
      const keepWorkbench = shouldKeepCssWorkbenchOnViewChange(state.cssWorkbenchOpen, width, event.view);
      return {
        ...dismissTransient(state, {
          keepSearch: event.view !== 'preview',
          keepDrawer: shouldKeepDrawerOnNavigation(width),
        }),
        view: event.view,
        cssWorkbenchOpen: keepWorkbench ? state.cssWorkbenchOpen : false,
      };
    }
    case 'RESIZE': {
      const width = event.narrow ? 640 : 1024;
      const restoreSplit = shouldRestoreSplitOnResize(state.cssWorkbenchOpen, state.view, width);
      return {
        ...state,
        narrow: event.narrow,
        slashOpen: false,
        outlineOpen: false,
        bubbleVisible: false,
        view: restoreSplit ? 'split' : state.view,
      };
    }
    case 'OPEN_CSS_WORKBENCH': {
      if (state.immersive || hasSurfaceModal(state)) return state;
      return { ...dismissTransient(state), view: 'split', cssWorkbenchOpen: true, aiSession: 'none' };
    }
    case 'CLOSE_CSS_WORKBENCH':
      return { ...state, cssWorkbenchOpen: false };
    default:
      return null;
  }
}

export function stepStudioSurface(state: StudioSurfaceState, event: StudioSurfaceEvent): StudioSurfaceState {
  const handled =
    stepModalEvent(state, event) ??
    stepOverlayEvent(state, event) ??
    stepAiEvent(state, event) ??
    stepViewOrWorkbenchEvent(state, event);
  if (handled) return handled;
  switch (event.type) {
    case 'ENTER_IMMERSIVE': {
      if (hasSurfaceModal(state)) return state;
      const mode: 'write' | 'preview' = state.view === 'preview' ? 'preview' : 'write';
      return { ...dismissTransient(state), cssWorkbenchOpen: false, immersive: mode };
    }
    case 'SWITCH_IMMERSIVE':
      if (!state.immersive || hasSurfaceModal(state)) return state;
      return { ...dismissTransient(state), immersive: event.mode };
    case 'EXIT_IMMERSIVE':
      if (!state.immersive || hasSurfaceModal(state)) return state;
      return { ...dismissTransient(state, { keepSearch: state.view !== 'preview' }), immersive: null };
    case 'RESET_EDITOR':
    case 'REPLACE_DOCUMENT':
      return {
        ...dismissTransient(state, { keepDrawer: shouldKeepDrawerOnNavigation(state.narrow ? 640 : 1024) }),
        cssWorkbenchOpen: false,
        aiSession: 'none',
      };
    case 'ESCAPE':
      return applyEscape(state, event.target);
    default:
      return state;
  }
}

const STUDIO_INVARIANTS: ReadonlyArray<readonly [string, (state: StudioSurfaceState) => boolean]> = [
  [
    'editor and CSS workbench cannot be visible simultaneously',
    (s) => {
      const p = computePaneVisibility(s.immersive, s.view, s.cssWorkbenchOpen);
      return p.showMarkdownEditor && p.showCssWorkbench;
    },
  ],
  [
    'CSS workbench draft is active while invisible outside narrow mobile preview',
    (s) => {
      if (!s.cssWorkbenchOpen) return false;
      const p = computePaneVisibility(s.immersive, s.view, s.cssWorkbenchOpen);
      const allowedHidden = s.narrow && s.view === 'preview' && s.immersive === null;
      return !p.showCssWorkbench && !allowedHidden;
    },
  ],
  [
    'CSS workbench requires split view (live preview) whenever container is wide',
    (s) => s.cssWorkbenchOpen && !s.narrow && s.view !== 'split',
  ],
  [
    'CSS workbench cannot coexist with an active AI writing session',
    (s) => s.cssWorkbenchOpen && s.aiSession !== 'none',
  ],
  [
    'parent and child modals cannot both be open simultaneously',
    (s) => isParentModalOpen(s.parentModal !== 'none', s.childModal !== 'none') && s.childModal !== 'none',
  ],
  [
    'selection bubble must not coexist with modals, AI sessions, outline, slash menu, header menu, or fullscreen drawer',
    (s) =>
      (hasSurfaceModal(s) ||
        s.aiSession !== 'none' ||
        s.outlineOpen ||
        s.slashOpen ||
        s.menuOpen ||
        isFullscreenDrawer(s.drawerOpen, s.narrow ? 640 : 1024)) &&
      effectiveBubbleVisible(s),
  ],
  [
    'immersive mode must not coexist with CSS workbench, settings drawer, or header menu',
    (s) => s.immersive !== null && (s.cssWorkbenchOpen || s.drawerOpen || s.menuOpen),
  ],
  [
    'editor-scoped overlays (slash, outline, search) must be closed when editor is hidden',
    (s) => {
      const p = computePaneVisibility(s.immersive, s.view, s.cssWorkbenchOpen);
      return !p.showMarkdownEditor && (s.slashOpen || s.outlineOpen || s.searchOpen);
    },
  ],
];

export function checkStudioSurfaceInvariants(state: StudioSurfaceState): string[] {
  return STUDIO_INVARIANTS.filter(([, violated]) => violated(state)).map(([message]) => message);
}

/**
 * Markdown Studio lazy studio view (`dist/client.studio.js`).
 *
 * Architectural invariants:
 * 1. Zero `useEffect` / `useLayoutEffect` in business or UI layers; all host/DOM
 *    subscriptions go through `src/runtime/` disposable primitives or `DocumentStore`.
 * 2. Cold-boot sidebar registration lives exclusively in `src/shell-entry.ts`; this
 *    lazy chunk registers full UI locale dictionaries and the `main` studio view.
 */
import type * as ReactNamespace from 'react';
import { AiClient } from './adapters/ai-client';
import { formatHostClientError, HostClient } from './adapters/host-client';
import { observeHostTitlebarInset } from './adapters/host-shell';
import { prepareImageForWechat } from './adapters/image-encode';
import { renderArticle } from './adapters/render-article';
import {
  hasFuturePersistedLibrary,
  LIBRARY_KEY_V2,
  LibraryStorageError,
  loadInitialLibrary,
  loadPersistedLibrary,
  savePersistedLibrary,
} from './adapters/storage';
import { createArticleExporter } from './application/article-exporter';
import { createAssetGarbageCollector } from './application/asset-gc';
import { createDocumentCommands } from './application/document-commands';
import { DocumentStore } from './application/document-store';
import { createFormattingCommands } from './application/editor-formatting';
import { createEditorSearch, type SearchState } from './application/editor-search';
import { createEditorShortcuts } from './application/editor-shortcuts';
import { createFileCommands } from './application/file-commands';
import { importFolderAssets, writeFolderAssets } from './application/folder-assets';
import { createImageInserter } from './application/image-inserter';
import { useCopyActions } from './application/use-copy-actions';
import { useDocumentHistory } from './application/use-document-history';
import { useDocumentLibrary } from './application/use-document-library';
import { useFileContext } from './application/use-file-context';
import {
  collectImportRecoveryAssets,
  type ImportBackupSummary,
  type ImportModeChoice,
  useLibraryArchive,
} from './application/use-library-archive';
import { useMathAssets } from './application/use-math-assets';
import { useMermaidAssets } from './application/use-mermaid-assets';
import { useScrollSync } from './application/use-scroll-sync';
import { useSlashMenu } from './application/use-slash-menu';
import { useWorkspace } from './application/use-workspace';
import { useWritingSkills, type WritingSkillsApi } from './application/use-writing-skills';
import {
  type DocumentSeed,
  deriveTitle,
  type LibraryState,
  markdownHeadings,
  type SelectionRange,
} from './domain/article';
import { extractCustomThemePreview, findCustomTheme } from './domain/custom-themes';
import type { EditorApi, EditorSelection } from './domain/editor-types';
import { assetFilesInMarkdown, collectLocalImages, portableizeAssetUrls, replaceLocalImages } from './domain/images';
import { collectReferencedAssets } from './domain/library-archive';
import type { MergeConflict, MergeDecision } from './domain/library-backup';
import { sanitizeSettings } from './domain/settings';
import { canStartAutosave } from './domain/file-session.machine';
import {
  canFocusMarkdownEditor,
  canHandleImmersiveShortcutPolicy,
  computePaneVisibility,
  isParentModalOpen,
  resolveDocumentEscapeAction,
  resolveEditorEscapeOutcome,
  resolveWindowEscapeAction,
  shouldApplyAiPreview,
  shouldKeepCssWorkbenchOnViewChange,
  shouldRestoreSplitOnResize,
} from './domain/studio-overlay.machine';
import type { WritingSkill } from './domain/writing-skills';
import { createStudioLocaleController } from './locales/ui-strings';
import { useElementBinding } from './runtime/dom-surfaces';
import {
  useDebouncedKeyTask,
  useDocumentEvent,
  useExternalStore,
  useLatest,
  useMountDisposable,
  useWindowEvent,
} from './runtime/react-lifecycle';
import * as themes from './themes';
import type { ClientContext, ClientPlugin, LocaleService } from './types/dsh';
import type { DshPrimitivesModule } from './types/dsh-primitives';
import { CssWorkbenchPane } from './ui/css-workbench';
import { useDialogHost } from './ui/dialog-host';
import { type EditorAiModel, EditorPane } from './ui/editor-pane';
import { createErrorBoundary } from './ui/error-boundary';
import { HeaderBar } from './ui/header-bar';
import { ImmersiveDock, type ImmersiveMode, useImmersiveShortcuts } from './ui/immersive-dock';
import { ImportModeDialog, LibraryDialog, MergeConflictDialog, WorkspaceDialog } from './ui/library-dialogs';
import { PreviewPane } from './ui/preview-pane';
import { useSelectionBubble } from './ui/selection-bubble';
import { SettingsDrawer } from './ui/settings-drawer';
import { buildShortcutRows } from './ui/shortcut-model';
import { SkillManagerDialog } from './ui/skill-manager-dialog';
import { StorageBlockedView } from './ui/storage-blocked-view';
import { CHROME_CSS } from './ui/styles';
import { createUiKit } from './ui/ui-kit';

const PANEL_ID = 'dsh-markdown-studio';
const LOCALE_NS = 'dsh-markdown-studio';
const ASSET_SERVICE_ROUTE = '/api/markdown-studio/wechat';
const AI_SERVICE_ROUTE = '/api/markdown-studio/ai';

type ToastTone = 'success' | 'error' | 'info';
type PreviewMode = 'mobile' | 'desktop';

interface ToastState {
  id: number;
  text: string;
  tone: ToastTone;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : String(error);
}

function isAbortError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as { name?: unknown }).name === 'AbortError');
}

function isEventInside(event: Event, selector: string): boolean {
  const el = event.target as Element | null;
  return Boolean(el && typeof el.closest === 'function' && el.closest(selector));
}

function asFocusableElement(node: unknown): HTMLElement | null {
  return node && typeof (node as HTMLElement).focus === 'function' ? (node as HTMLElement) : null;
}

function detectPlatformModifiers(): { modKey: string; shiftKey: string; altKey: string } {
  let isMac = false;
  try {
    const docPlatform =
      typeof document !== 'undefined' ? document.documentElement?.getAttribute?.('data-platform') || '' : '';
    const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
    const platformText = nav.userAgentData?.platform || navigator.platform || navigator.userAgent || '';
    isMac = docPlatform === 'darwin' || /mac|iphone|ipad/i.test(String(platformText));
  } catch {
    isMac = false;
  }
  return {
    modKey: isMac ? '⌘' : 'Ctrl+',
    shiftKey: isMac ? '⇧' : 'Shift+',
    altKey: isMac ? '⌥' : 'Alt+',
  };
}

async function migrateDataImages(
  markdown: string,
  client: HostClient,
  onTrackInFlight?: (filename: string, active: boolean) => void,
): Promise<{ mapping: Map<string, string>; migrated: number }> {
  const entries = Array.from(collectLocalImages(markdown).entries()).filter(([, info]) => info.kind === 'data');
  const mapping = new Map<string, string>();
  const tracked: string[] = [];
  try {
    const results = await Promise.all(
      entries.map(async ([rawUrl]) => {
        try {
          const prepared = await prepareImageForWechat(rawUrl);
          const stored = await client.storeAsset(prepared.dataUrl, prepared.filename);
          if (stored.filename) {
            onTrackInFlight?.(stored.filename, true);
            tracked.push(stored.filename);
          }
          const nextPath = stored.assetPath || stored.localUrl || stored.url;
          return nextPath ? ([rawUrl, nextPath] as const) : null;
        } catch {
          /* keep inline base64 when local image service is unreachable */
          return null;
        }
      }),
    );
    for (const pair of results) {
      if (pair) mapping.set(pair[0], pair[1]);
    }
    return { mapping, migrated: mapping.size };
  } finally {
    for (const filename of tracked) onTrackInFlight?.(filename, false);
  }
}

function resolvePreviewSettings(base: themes.ThemeSettings, cssOpen: boolean, draftCss: string): themes.ThemeSettings {
  const trimmed = draftCss.trim();
  if (!cssOpen || !trimmed) return base;
  // Use the `custom:` prefix so standalone custom theme isolation matches the saved theme identically.
  const draftId = 'custom:__css_workbench_live__';
  const draftPreview = extractCustomThemePreview(trimmed, base.accent);
  return {
    ...base,
    theme: draftId,
    accent: draftPreview.accent,
    customThemes: [{ id: draftId, name: 'Draft', css: trimmed }],
  };
}

function countMarkdownWords(text: string): number {
  let words = 0;
  let inLatinWord = false;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0x4e00 && code <= 0x9fff) {
      words++;
      inLatinWord = false;
    } else if ((code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122)) {
      if (!inLatinWord) {
        words++;
        inLatinWord = true;
      }
    } else {
      inLatinWord = false;
    }
  }
  return words;
}

/**
 * Why parent modals temporarily hide (`open = false`) while a child confirm/prompt/conflict
 * dialog is active: avoids dual modal focus-trap and Escape-key collisions in DSH Modal.
 * Consequently, any state that must survive a child confirmation lives outside the modal view.
 */
function isUnhandledEscapeKey(event: KeyboardEvent): boolean {
  if (event.isComposing || event.keyCode === 229) return false;
  return event.key === 'Escape' && !event.defaultPrevented;
}

function buildEditorAiModel(
  skillsApi: WritingSkillsApi,
  bubblePos: { top: number; left: number } | null,
  onOpenManager: () => void,
): EditorAiModel {
  return {
    skills: skillsApi.skills,
    activeSkill: skillsApi.activeSkill,
    session: skillsApi.session,
    inlineBlocks: skillsApi.buildInlineBlocks(),
    diffTransition: skillsApi.diffTransition,
    selectionBubblePos: skillsApi.session ? null : bubblePos,
    onRunSkill: (skill?: WritingSkill) => {
      void skillsApi.runSkill(skill);
    },
    onOpenManager,
    onCancel: skillsApi.cancelSession,
  };
}

export function createClientPlugin(
  React: typeof ReactNamespace,
  primitives?: DshPrimitivesModule | null,
): ClientPlugin {
  const h = React.createElement;
  const localeCtrl = createStudioLocaleController(React, LOCALE_NS);
  const { t, lang, useLocaleRevision } = localeCtrl;
  const uiKit = createUiKit(React, primitives, () => lang());
  const StudioErrorBoundary = createErrorBoundary(React, { Button: uiKit.Button, cssText: CHROME_CSS });

  function useDeferredText(value: string): string {
    return React.useDeferredValue ? React.useDeferredValue(value) : value;
  }

  function describeHostError(error: unknown): string {
    return formatHostClientError(error, {
      hostMissing: t('wechat.hostMissing'),
      fallback: t('wechat.failed'),
      t,
    });
  }

  function StudioPage(props: { initial: LibraryState }): ReactNamespace.ReactElement {
    const localeRevision = useLocaleRevision();
    const dialogHost = useDialogHost(React, t, uiKit.bridge);

    const [store] = React.useState(() => new DocumentStore(props.initial, savePersistedLibrary, loadPersistedLibrary));
    const [hostClient] = React.useState(
      () => new HostClient(ASSET_SERVICE_ROUTE, (input, init) => window.fetch(input, init)),
    );
    const [aiClient] = React.useState(() => new AiClient(AI_SERVICE_ROUTE, (input, init) => window.fetch(input, init)));

    const library = useExternalStore(React, store.subscribe, store.getSnapshot);
    const saveStatus = useExternalStore(React, store.subscribeStatus, store.getStatus);
    const doc = store.getActive();
    const { settings, view } = doc;

    const rootRef = React.useRef<HTMLDivElement | null>(null);
    const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);
    const codeMirrorApiRef = React.useRef<EditorApi | null>(null);
    const cmScrollCleanupRef = React.useRef<(() => void) | null>(null);
    const copyRef = React.useRef<HTMLDivElement | null>(null);
    const fileRef = React.useRef<HTMLInputElement | null>(null);
    const imageRef = React.useRef<HTMLInputElement | null>(null);
    const searchInputRef = React.useRef<HTMLInputElement | null>(null);
    const dialogReturnFocusRef = React.useRef<HTMLElement | null>(null);
    const pageAliveRef = React.useRef(true);
    const toastSeq = React.useRef(0);
    const inFlightAssetsRef = React.useRef<Map<string, number>>(new Map());
    const dirtyDiskRef = React.useRef(false);
    const cancelAutosaveRef = React.useRef<() => void>(() => {});

    function trackInFlightAsset(filename: string, active: boolean): void {
      if (!filename) return;
      const counts = inFlightAssetsRef.current;
      const next = (counts.get(filename) || 0) + (active ? 1 : -1);
      if (next > 0) counts.set(filename, next);
      else counts.delete(filename);
    }

    const [previewMode, setPreviewMode] = React.useState<PreviewMode>(() =>
      typeof window !== 'undefined' && window.innerWidth >= 900 ? 'desktop' : 'mobile',
    );
    const [drawerOpen, setDrawerOpen] = React.useState(false);
    const [drawerTab, setDrawerTab] = React.useState<'theme' | 'help'>('theme');
    const [cssWorkbench, setCssWorkbench] = React.useState<{ open: boolean; targetId: string | null; seq: number }>({
      open: false,
      targetId: null,
      seq: 0,
    });
    const [liveCssDraft, setLiveCssDraft] = React.useState('');
    const [immersive, setImmersive] = React.useState<ImmersiveMode>(null);
    const [menuOpen, setMenuOpen] = React.useState(false);
    const [toast, setToast] = React.useState<ToastState | null>(null);
    const [localImageServerUrl, setLocalImageServerUrl] = React.useState('');
    const localImageServerUrlRef = useLatest(React, localImageServerUrl);
    const [searchPanel, setSearchPanel] = React.useState<SearchState>({ open: false, query: '', replacement: '' });
    const [outlineOpen, setOutlineOpen] = React.useState(false);
    const [overlayEpoch, setOverlayEpoch] = React.useState(0);
    const [editorFailed, setEditorFailed] = React.useState(false);

    function notify(text: string, tone: ToastTone = 'success'): void {
      toastSeq.current += 1;
      setToast({ id: toastSeq.current, text, tone: tone || 'success' });
    }

    function deriveTitleWithFallback(markdown: unknown): string {
      return deriveTitle(markdown, t('untitled'));
    }

    function editorValue(): string {
      if (codeMirrorApiRef.current) return codeMirrorApiRef.current.getValue();
      return textareaRef.current ? textareaRef.current.value : doc.markdown;
    }

    function selection(): SelectionRange {
      if (codeMirrorApiRef.current) return codeMirrorApiRef.current.getSelection();
      const ta = textareaRef.current;
      if (!ta) return { start: doc.markdown.length, end: doc.markdown.length };
      return { start: ta.selectionStart, end: ta.selectionEnd };
    }

    const docHistory = useDocumentHistory({
      React,
      initialMarkdown: doc.markdown,
      onApply: (markdown, title) => {
        store.updateActive({ markdown, ...(title !== undefined ? { title } : {}) });
      },
      getSelection: selection,
      focusRange,
    });
    const { markdownRef, lastSelectionRef, setMarkdown } = docHistory;

    function revealRange(start: number, end: number): void {
      lastSelectionRef.current = { start, end };
      selectionBubble.clear();
      selectionBubble.clearPointer();
      window.requestAnimationFrame(() => {
        if (codeMirrorApiRef.current?.revealRange) {
          codeMirrorApiRef.current.revealRange(start, end);
          return;
        }
        const ta = textareaRef.current;
        if (!ta) return;
        try {
          ta.setSelectionRange(start, end);
        } catch {
          /* ignore */
        }
      });
    }

    function focusRange(start: number, end: number): void {
      selectionBubble.clear();
      selectionBubble.clearPointer();
      window.requestAnimationFrame(() => {
        if (!canFocusEditorRef.current()) {
          lastSelectionRef.current = { start, end };
          codeMirrorApiRef.current?.revealRange?.(start, end);
          return;
        }
        if (codeMirrorApiRef.current) {
          codeMirrorApiRef.current.focusRange(start, end);
          lastSelectionRef.current = { start, end };
          return;
        }
        const ta = textareaRef.current;
        if (!ta) return;
        ta.focus();
        try {
          ta.setSelectionRange(start, end);
        } catch {
          /* ignore */
        }
        lastSelectionRef.current = { start: ta.selectionStart, end: ta.selectionEnd };
      });
    }

    function focusEditor(): void {
      if (!canFocusEditorRef.current()) return;
      if (codeMirrorApiRef.current) codeMirrorApiRef.current.focus();
      else textareaRef.current?.focus();
    }

    function focusEditorSoon(): void {
      window.setTimeout(focusEditor, 30);
    }

    function captureDialogTriggerFocus(): void {
      const active = asFocusableElement(document.activeElement);
      if (active && active.getAttribute('role') === 'menuitem') {
        const moreBtn = rootRef.current?.querySelector<HTMLElement>('[data-mdstudio-menu-trigger="more"]');
        dialogReturnFocusRef.current = moreBtn || null;
        return;
      }
      dialogReturnFocusRef.current = active;
    }

    function restoreDialogTriggerFocus(): void {
      const target = dialogReturnFocusRef.current;
      dialogReturnFocusRef.current = null;
      if (target && target.isConnected) {
        window.requestAnimationFrame(() => target.focus());
      } else if (store.getActive().view !== 'preview') {
        window.requestAnimationFrame(() => focusEditor());
      }
    }

    const selectionBubble = useSelectionBubble({
      React,
      rootRef,
      codeMirrorApiRef,
      lastSelectionRef,
      editorValue,
      selection,
    });

    const slashMenu = useSlashMenu({
      React,
      t,
      rootRef,
      editorValue,
      selection,
      coordsAtPos: (pos) => codeMirrorApiRef.current?.coordsAtPos?.(pos) ?? null,
      setMarkdown,
      focusRange,
      closeOutline: () => setOutlineOpen(false),
    });

    function clearCssWorkbenchDraft(): void {
      setCssWorkbench((prev) => (prev.open ? { open: false, targetId: null, seq: prev.seq } : prev));
      setLiveCssDraft('');
    }

    function dismissTransientOverlays(opts?: { keepSearch?: boolean; keepDrawer?: boolean; keepMenu?: boolean }): void {
      if (!opts?.keepDrawer) setDrawerOpen(false);
      if (!opts?.keepMenu) setMenuOpen(false);
      slashMenu.close();
      setOutlineOpen(false);
      selectionBubble.clear();
      selectionBubble.clearPointer();
      if (!opts?.keepSearch) setSearchPanel((prev) => (prev.open ? { ...prev, open: false } : prev));
      setOverlayEpoch((value) => value + 1);
    }

    const fileContext = useFileContext({
      React,
      t,
      notify,
      getDocument: () => store.getActive(),
      onReload: (text) => {
        setMarkdown(text, { boundary: true, resetHistory: true, title: deriveTitleWithFallback(text) });
        focusRange(text.length, text.length);
      },
    });

    const openTransitionSeqRef = React.useRef(0);
    function claimOpenTransition(): () => boolean {
      const seq = ++openTransitionSeqRef.current;
      return () => pageAliveRef.current && openTransitionSeqRef.current === seq;
    }

    function detachFileContext(): void {
      cancelAutosaveRef.current();
      dirtyDiskRef.current = false;
      fileContext.reset(store.getActive().id);
      fileContext.setFileName('');
    }

    function needsLinkedFileFlush(): boolean {
      return Boolean(fileContext.linkedFile() && dirtyDiskRef.current && !fileContext.conflictRef.current);
    }

    async function flushLinkedFileBeforeSwitch(): Promise<boolean> {
      const handle = fileContext.linkedFile();
      if (!handle || !dirtyDiskRef.current || fileContext.conflictRef.current) return true;
      cancelAutosaveRef.current();
      try {
        const result = await fileContext.writeFile(handle, markdownRef.current);
        if (result === 'saved') {
          dirtyDiskRef.current = false;
          const folder = fileContext.linkedFolder();
          if (folder) {
            void writeFolderAssets(folder, markdownRef.current, localImageServerUrlRef.current).catch(() => {});
          }
          return true;
        }
        notify(t(result === 'denied' ? 'file.permission' : 'file.saveFailed'), 'error');
        return false;
      } catch {
        notify(t('file.saveFailed'), 'error');
        return false;
      }
    }

    const activeLang = lang();

    const writingSkills = useWritingSkills({
      React,
      t,
      locale: activeLang,
      notify,
      aiClient,
      markdown: doc.markdown,
      title: () => store.getActive().title,
      editorValue,
      selection,
      setMarkdown,
      focusEditor: focusEditorSoon,
      download: downloadFile,
    });

    const scrollSync = useScrollSync({
      React,
      codeMirrorApiRef,
      textareaRef,
      onCodeMirrorReady: (api) => {
        if (!api) return;
        if (canFocusEditorRef.current()) api.focusRange(0, 0);
        else api.revealRange?.(0, 0);
        lastSelectionRef.current = { start: 0, end: 0 };
      },
    });

    function resetDocumentSurface(): void {
      writingSkills.resetSession();
      dismissTransientOverlays({ keepDrawer: true });
      clearCssWorkbenchDraft();
      scrollSync.resetPreviewScroll();
    }

    function resetEditorTo(entry: DocumentSeed, alreadyActive = false): void {
      const markdown = String(entry.markdown || '');
      resetDocumentSurface();
      docHistory.reset(markdown);
      if (!alreadyActive) {
        store.updateActive({
          title: entry.title || t('untitled'),
          markdown,
          settings: sanitizeSettings(entry.settings || settings),
          view: entry.view === 'edit' || entry.view === 'preview' ? entry.view : 'split',
        });
      }
      detachFileContext();
      window.setTimeout(() => focusRange(0, 0), 30);
    }

    const deferredCssDraft = useDeferredText(liveCssDraft);
    const previewSettings = React.useMemo(
      () => resolvePreviewSettings(settings, cssWorkbench.open, deferredCssDraft),
      [settings, cssWorkbench.open, deferredCssDraft],
    );

    const mermaidTheme = React.useMemo(
      () => themes.mermaidThemeFor(previewSettings),
      [
        previewSettings.theme,
        previewSettings.accent,
        previewSettings.fontSize,
        previewSettings.lineHeight,
        previewSettings.customThemes,
      ],
    );
    const mermaidAssets = useMermaidAssets({
      React,
      hostClient,
      markdown: doc.markdown,
      theme: mermaidTheme,
      pageAliveRef,
    });
    const mathAssets = useMathAssets({ React, markdown: doc.markdown });

    const [assetGc] = React.useState(() =>
      createAssetGarbageCollector({
        hostClient,
        getSnapshot: () => store.getSnapshot(),
        mermaidFilenames: () => mermaidAssets.filenames(),
        extraFilenames: () => {
          const extra = new Set<string>(inFlightAssetsRef.current.keys());
          const persisted = loadPersistedLibrary();
          if (persisted) {
            for (const name of collectReferencedAssets(persisted)) extra.add(name);
          }
          for (const name of collectImportRecoveryAssets()) extra.add(name);
          for (const md of docHistory.historyMarkdowns()) {
            for (const name of assetFilesInMarkdown(md)) extra.add(name);
          }
          return extra;
        },
      }),
    );
    const pruneOrphanAssets = (bypassGraceFor?: Iterable<string>) => {
      if (hasFuturePersistedLibrary()) return;
      void assetGc.prune(bypassGraceFor ? { bypassGraceFor } : undefined);
    };

    const docLibrary = useDocumentLibrary({
      React,
      store,
      t,
      notify,
      confirm: dialogHost.confirm,
      settings,
      view,
      needsFlushBeforeSwitch: needsLinkedFileFlush,
      flushBeforeSwitch: flushLinkedFileBeforeSwitch,
      onActivate: (entry) => {
        openTransitionSeqRef.current++;
        resetEditorTo(entry, true);
      },
      onPruneAssets: pruneOrphanAssets,
    });

    const [importModePrompt, setImportModePrompt] = React.useState<{
      summary: ImportBackupSummary;
      resolve: (choice: ImportModeChoice | null) => void;
    } | null>(null);
    const [mergeReview, setMergeReview] = React.useState<{
      conflicts: MergeConflict[];
      defaultDecision: MergeDecision;
      resolve: (decisions: Record<string, MergeDecision> | null) => void;
    } | null>(null);

    function finishImportMode(choice: ImportModeChoice | null): void {
      const active = importModePrompt;
      setImportModePrompt(null);
      active?.resolve(choice);
    }

    function finishMergeReview(decisions: Record<string, MergeDecision> | null): void {
      const active = mergeReview;
      setMergeReview(null);
      active?.resolve(decisions);
    }

    const workspaceTools = useWorkspace({
      React,
      t,
      notify,
      fileContext,
      onMenuClose: () => setMenuOpen(false),
      onOpenFile: async (directory, entry, text, openedFile) => {
        const isCurrentOpen = claimOpenTransition();
        if (!(await flushLinkedFileBeforeSwitch())) return false;
        if (!isCurrentOpen()) return false;
        const fileObj = openedFile || (await entry.handle.getFile());
        if (!isCurrentOpen()) return false;
        resetEditorTo({ title: deriveTitleWithFallback(text), markdown: text, settings, view });
        await fileContext.stampFile(entry.handle, fileObj, text);
        if (!isCurrentOpen()) return false;
        fileContext.applyDocumentRef({ kind: 'folder', directory, file: entry.handle });
        const isStaleOpen = (): boolean => !isCurrentOpen() || fileContext.linkedFile() !== entry.handle;
        if (isStaleOpen()) return false;
        fileContext.setFileName(entry.name);
        const imported = await importFolderAssets(directory, text, hostClient, trackInFlightAsset);
        if (isStaleOpen() || store.getActive().markdown !== text) return true;
        if (imported.text !== text) {
          setMarkdown(imported.text, {
            boundary: true,
            title: deriveTitleWithFallback(imported.text),
            prevSelection: selection(),
          });
        }
        return true;
      },
    });
    const workspace = workspaceTools.state;

    function downloadFile(name: string, content: Blob | string, mime: string): boolean {
      try {
        const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = name;
        anchor.style.display = 'none';
        (rootRef.current || document.body).appendChild(anchor);
        anchor.click();
        window.setTimeout(() => {
          anchor.remove();
          URL.revokeObjectURL(url);
        }, 800);
        return true;
      } catch {
        return false;
      }
    }

    const fileActions = createFileCommands({
      confirm: dialogHost.confirm,
      t,
      notify,
      fileContext,
      store,
      doc,
      settings,
      view,
      markdownRef,
      fileName: fileContext.fileName,
      localImageServerUrl,
      setMenuOpen,
      setFileName: fileContext.setFileName,
      resetEditorTo,
      setDocumentRef: fileContext.applyDocumentRef,
      stampFile: fileContext.stampFile,
      flushBeforeSwitch: flushLinkedFileBeforeSwitch,
      claimOpenTransition,
      onSaved: (writtenContent) => {
        cancelAutosaveRef.current();
        if (markdownRef.current === writtenContent) dirtyDiskRef.current = false;
      },
      isPageAlive: () => pageAliveRef.current,
      download: downloadFile,
      isAbortError,
      errorMessage,
      deriveTitle: deriveTitleWithFallback,
    });

    const libraryArchive = useLibraryArchive({
      React,
      t,
      notify,
      confirm: dialogHost.confirm,
      store,
      library,
      hostClient,
      localImageServerUrl,
      download: downloadFile,
      flushBeforeSwitch: flushLinkedFileBeforeSwitch,
      onReplace: (entry) => {
        openTransitionSeqRef.current++;
        resetEditorTo(entry, true);
        pruneOrphanAssets();
      },
      onClose: () => {
        docLibrary.closeLibrary();
        restoreDialogTriggerFocus();
      },
      chooseImportMode: (summary) => new Promise((resolve) => setImportModePrompt({ summary, resolve })),
      resolveConflicts: (conflicts, defaultDecision) =>
        new Promise((resolve) => setMergeReview({ conflicts, defaultDecision, resolve })),
      writingSkills: writingSkills.skillState,
      onWritingSkills: writingSkills.setSkillStateAll,
      onTrackInFlight: trackInFlightAsset,
    });

    const searchCmds = createEditorSearch({
      editorValue,
      selection,
      setMarkdown,
      focusRange,
      revealRange,
      notify,
      t,
      searchPanel,
      setSearchPanel,
      searchInputRef,
      setOutlineOpen,
    });

    function updateSettings(patch: Partial<themes.ThemeSettings>): void {
      store.updateActive({ settings: { ...settings, ...patch } });
    }

    function pickTheme(id: string): void {
      clearCssWorkbenchDraft();
      const custom = findCustomTheme(settings.customThemes, id);
      if (custom) {
        const preview = extractCustomThemePreview(custom.css, settings.accent);
        updateSettings({ theme: id, accent: preview.accent });
        return;
      }
      updateSettings({ theme: id, accent: themes.getTheme(id).defaultAccent });
    }

    function resetStyles(): void {
      clearCssWorkbenchDraft();
      store.updateActive({ settings: { ...themes.DEFAULT_SETTINGS, customThemes: settings.customThemes || [] } });
    }

    const articleExport = createArticleExporter({
      React,
      t,
      locale: activeLang,
      notify,
      doc,
      settings,
      localImageServerUrl,
      mermaidAssets,
      mathAssets,
      download: downloadFile,
      closeMenu: () => setMenuOpen(false),
      updateSettings,
    });

    const copyActions = useCopyActions({
      React,
      t,
      locale: activeLang,
      notify,
      doc,
      settings,
      localImageServerUrl,
      mermaidAssets,
      mathAssets,
      copyRef,
      setMenuOpen,
      describeHostError,
    });

    function replaceRange(
      value: string,
      start: number,
      end: number,
      text: string,
      selectStart?: number | null,
      selectEnd?: number | null,
    ): void {
      const next = value.slice(0, start) + text + value.slice(end);
      slashMenu.close();
      setMarkdown(next, { boundary: true, prevSelection: { start, end } });
      focusRange(
        selectStart == null ? start + text.length : selectStart,
        selectEnd == null ? start + text.length : selectEnd,
      );
    }

    const formatting = createFormattingCommands({
      editorValue,
      selection,
      replaceRange,
      setMarkdown,
      focusRange,
      clearSlash: slashMenu.close,
      imageRef,
      t,
      notify,
      settings,
      updateSettings,
    });

    const { insertImageFiles, handlePaste } = createImageInserter({
      t,
      notify,
      hostClient,
      describeHostError,
      insertBlock: formatting.insertBlock,
      onTrackInFlight: trackInFlightAsset,
      getActiveArticleId: () => store.getActive().id,
      isPageAlive: () => pageAliveRef.current,
    });

    function undo(): void {
      if (docHistory.undo()) slashMenu.close();
    }

    function redo(): void {
      if (docHistory.redo()) slashMenu.close();
    }

    const panes = computePaneVisibility(immersive, view, cssWorkbench.open);

    function closeSearchPanel(): void {
      setSearchPanel((prev) => (prev.open ? { ...prev, open: false } : prev));
      focusEditor();
    }

    function dismissEditorEscape(): 'handled' | 'defer' | false {
      const outcome = resolveEditorEscapeOutcome({
        menuOpen,
        outlineOpen,
        showMarkdownEditor: panes.showMarkdownEditor,
        searchOpen: searchPanel.open,
        hasAiSession: Boolean(writingSkills.session),
      });
      if (outcome === 'close-search') {
        closeSearchPanel();
        return 'handled';
      }
      if (outcome === 'cancel-ai') {
        writingSkills.cancelSession();
        return 'handled';
      }
      return outcome;
    }

    const handleEditorShortcut = createEditorShortcuts({
      t,
      notify,
      editorValue,
      selection,
      replaceRange,
      undo,
      redo,
      copyArticle: () => void copyActions.copyArticle(),
      linkedFile: fileContext.linkedFile,
      saveLocalFile: fileActions.saveLocalFile,
      persistNow: () => {
        try {
          return store.flush();
        } catch {
          return false;
        }
      },
      wrapSelection: formatting.wrapSelection,
      setLinePrefix: formatting.setLinePrefix,
      applyHeadingLevel: formatting.applyHeadingLevel,
      insertMathBlock: formatting.insertMathBlock,
      insertCodeBlock: formatting.insertCodeBlock,
      insertScrollBox: formatting.insertScrollBox,
      insertScrollXBox: formatting.insertScrollXBox,
      insertTable: formatting.insertTable,
      insertHr: formatting.insertHr,
      openImagePicker: formatting.openImagePicker,
      toggleLinkFootnotes: formatting.toggleLinkFootnotes,
      openSearch: () => {
        selectionBubble.clear();
        selectionBubble.clearPointer();
        searchCmds.openSearch();
      },
      runWritingSkill: () => void writingSkills.runSkill(),
      acceptAiReview: () => {
        const session = writingSkills.session;
        if (!session || session.status !== 'ready' || session.patches.length !== 1) return false;
        writingSkills.acceptPatch(session.patches[0].id);
        return true;
      },
      dismissEscape: dismissEditorEscape,
    });

    const docCommands = createDocumentCommands({
      React,
      t,
      locale: lang,
      notify,
      confirm: dialogHost.confirm,
      doc,
      hostClient,
      fileRef,
      setMenuOpen,
      detachFileContext,
      setMarkdown,
      focusRange,
      deriveTitle: deriveTitleWithFallback,
      errorMessage,
      onPruneAssets: pruneOrphanAssets,
      onTrackInFlight: trackInFlightAsset,
      getActiveArticleId: () => store.getActive().id,
      isPageAlive: () => pageAliveRef.current,
      flushBeforeSwitch: flushLinkedFileBeforeSwitch,
      onResetSurface: resetDocumentSurface,
    });

    function handleSurfaceResize(width: number): void {
      selectionBubble.clear();
      selectionBubble.clearPointer();
      slashMenu.close();
      setOutlineOpen(false);
      if (shouldRestoreSplitOnResize(cssWorkbench.open, view, width)) {
        store.updateActive({ view: 'split' });
      }
    }
    const handleSurfaceResizeRef = useLatest(React, handleSurfaceResize);

    // Host titlebar clearance binding + Window flush/Escape/Immersive bindings + Mount disposable
    useElementBinding(React, rootRef, (el) => observeHostTitlebarInset(el, (w) => handleSurfaceResizeRef.current(w)));
    useWindowEvent(React, 'beforeunload', () => store.flush());
    useWindowEvent(React, 'pagehide', () => store.flush());
    useWindowEvent(React, 'storage', (event: StorageEvent) => {
      if (event.key !== LIBRARY_KEY_V2 || store.getStatus() !== 'saved') return;
      const external = loadPersistedLibrary();
      if (!external) return;
      const prevActive = store.getActive();
      store.syncExternal(external);
      const nextActive = store.getActive();
      if (nextActive.id !== prevActive.id) {
        openTransitionSeqRef.current++;
        detachFileContext();
        resetDocumentSurface();
        docHistory.reset(nextActive.markdown);
      } else if (nextActive.markdown !== prevActive.markdown) {
        docHistory.reset(nextActive.markdown);
      }
    });

    useWindowEvent(React, 'resize', () => {
      const width = rootRef.current?.clientWidth || window.innerWidth;
      handleSurfaceResize(width);
    });

    useWindowEvent(
      React,
      'keydown',
      (event: KeyboardEvent) => {
        if (!isUnhandledEscapeKey(event)) return;
        // Keep the docked desktop inspector open when pressing Esc inside the editor (CodeMirror Esc->Tab escape).
        const action = resolveWindowEscapeAction({
          hasModal: hasActiveModal(),
          menuOpen,
          drawerOpen,
          inEditor: isEventInside(event, '.mdstudio-editor-pane'),
        });
        if (action === 'close-menu') setMenuOpen(false);
        else if (action === 'close-drawer') setDrawerOpen(false);
      },
      menuOpen || drawerOpen,
    );

    useMountDisposable(React, () => {
      pageAliveRef.current = true;

      if (!codeMirrorApiRef.current && textareaRef.current) {
        const ta = textareaRef.current;
        ta.focus({ preventScroll: true });
        const end = ta.value.length;
        try {
          ta.setSelectionRange(end, end);
        } catch {
          /* ignore */
        }
        lastSelectionRef.current = { start: end, end };
      }

      let alive = true;
      hostClient
        .health()
        .then((data) => {
          if (alive) setLocalImageServerUrl(data.localServerUrl);
        })
        .catch(() => {
          /* editor works offline without local showcase server */
        });

      const initialMd = markdownRef.current;
      const portableMd = portableizeAssetUrls(initialMd);
      if (portableMd !== initialMd) {
        setMarkdown(portableMd, { boundary: true, prevSelection: selection() });
      }

      const migrateTimer = window.setTimeout(() => {
        const snapshot = markdownRef.current;
        if (!/data:image\//i.test(snapshot)) return;
        migrateDataImages(snapshot, hostClient, trackInFlightAsset)
          .then((result) => {
            if (!alive || !result.migrated) return;
            const current = markdownRef.current;
            const next = replaceLocalImages(current, result.mapping);
            if (next !== current) {
              setMarkdown(next, { boundary: true, prevSelection: selection() });
              notify(result.migrated + ' ' + t('toast.migrated'));
            }
          })
          .catch(() => {
            /* keep base64 when host is unreachable */
          });
      }, 800);

      // Event-driven 1200ms debounced autosave to linked local file via DocumentStore subscription
      let lastObservedId = store.getActive().id;
      let lastObservedMd = store.getActive().markdown;
      let autoSaveTimer: number | null = null;
      const clearAutosaveTimer = (): void => {
        if (autoSaveTimer !== null) {
          window.clearTimeout(autoSaveTimer);
          autoSaveTimer = null;
        }
      };
      cancelAutosaveRef.current = clearAutosaveTimer;
      const unsubscribeAutosave = store.subscribe(() => {
        const active = store.getActive();
        if (active.id !== lastObservedId) {
          lastObservedId = active.id;
          lastObservedMd = active.markdown;
          dirtyDiskRef.current = false;
          clearAutosaveTimer();
          return;
        }
        if (active.markdown === lastObservedMd) return;
        lastObservedMd = active.markdown;
        clearAutosaveTimer();
        const targetArticleId = active.id;
        if (!fileContext.linkedFile()) return;
        dirtyDiskRef.current = true;
        if (fileContext.conflictRef.current) return;
        autoSaveTimer = window.setTimeout(() => {
          autoSaveTimer = null;
          const currentHandle = fileContext.linkedFile();
          const ok = canStartAutosave({
            hasLinkedFile: Boolean(currentHandle),
            hasConflict: fileContext.conflictRef.current,
            sameArticle: store.getActive().id === targetArticleId,
          });
          if (!ok || !currentHandle) return;
          const snapshotMd = markdownRef.current;
          fileContext
            .writeFile(currentHandle, snapshotMd)
            .then((result) => {
              if (result === 'saved' && markdownRef.current === snapshotMd) dirtyDiskRef.current = false;
              const folder = result === 'saved' ? fileContext.linkedFolder() : null;
              if (folder && store.getActive().id === targetArticleId) {
                void writeFolderAssets(folder, snapshotMd, localImageServerUrlRef.current).catch(() => {});
              }
            })
            .catch(() => {
              notify(t('file.saveFailed'), 'error');
            });
        }, 1200);
      });

      return () => {
        alive = false;
        pageAliveRef.current = false;
        store.flush();
        window.clearTimeout(migrateTimer);
        clearAutosaveTimer();
        cancelAutosaveRef.current = () => {};
        unsubscribeAutosave();
        if (cmScrollCleanupRef.current) cmScrollCleanupRef.current();
      };
    });

    function openCssWorkbench(targetId: string | null): void {
      dismissTransientOverlays();
      writingSkills.resetSession();
      if (view !== 'split') store.updateActive({ view: 'split' });
      setCssWorkbench((prev) => ({ open: true, targetId, seq: prev.seq + 1 }));
    }

    function closeCssWorkbench(): void {
      clearCssWorkbenchDraft();
      focusEditorSoon();
    }

    function enterImmersive(): void {
      dismissTransientOverlays();
      clearCssWorkbenchDraft();
      const next: 'write' | 'preview' = view === 'preview' ? 'preview' : 'write';
      setImmersive(next);
      if (next === 'write') focusEditorSoon();
    }

    function exitImmersive(): void {
      dismissTransientOverlays({ keepSearch: view !== 'preview' });
      setImmersive(null);
      window.setTimeout(() => {
        rootRef.current?.querySelector<HTMLElement>('.mdstudio-focus-btn')?.focus();
      }, 0);
    }

    function hasActiveModal(): boolean {
      return [
        dialogHost.open,
        importModePrompt,
        mergeReview,
        docLibrary.open,
        workspace.open,
        writingSkills.managerOpen,
      ].some(Boolean);
    }

    const canFocusEditorRef = useLatest(
      React,
      () =>
        canFocusMarkdownEditor({
          hasModal: hasActiveModal(),
          showMarkdownEditor: panes.showMarkdownEditor,
        }) && !document.querySelector('[aria-modal="true"]'),
    );

    useDebouncedKeyTask(React, 'editor-scroll-restore', 0, panes.showMarkdownEditor, scrollSync.restoreEditorScroll);

    function canHandleImmersiveShortcut(action: 'toggle' | 'exit'): boolean {
      return canHandleImmersiveShortcutPolicy(
        {
          hasModal: hasActiveModal(),
          showMarkdownEditor: panes.showMarkdownEditor,
          searchOpen: searchPanel.open,
          slashOpen: slashMenu.open,
          outlineOpen,
          hasAiSession: Boolean(writingSkills.session),
          menuOpen,
          drawerOpen,
        },
        action,
      );
    }

    useImmersiveShortcuts(React, immersive, enterImmersive, exitImmersive, canHandleImmersiveShortcut);

    useDocumentEvent(
      React,
      'keydown',
      (event: KeyboardEvent) => {
        if (!isUnhandledEscapeKey(event)) return;
        const action = resolveDocumentEscapeAction({
          hasModal: hasActiveModal(),
          menuOpen,
          outlineOpen,
          slashOpen: slashMenu.open,
          drawerOpen,
          inDrawer: isEventInside(event, '.mdstudio-drawer'),
          showMarkdownEditor: panes.showMarkdownEditor,
          searchOpen: searchPanel.open,
          hasAiSession: Boolean(writingSkills.session),
        });
        if (action === 'close-search') {
          closeSearchPanel();
          event.preventDefault();
        } else if (action === 'cancel-ai') {
          writingSkills.cancelSession();
          event.preventDefault();
        }
      },
      panes.showMarkdownEditor && (searchPanel.open || Boolean(writingSkills.session)),
    );

    function handleEditorKeyDown(event: React.KeyboardEvent<HTMLElement>): void {
      const native = event.nativeEvent as KeyboardEvent | undefined;
      if (native && (native.isComposing || native.keyCode === 229)) return;
      selectionBubble.clearPointer();
      if (slashMenu.handleKeyDown(event, Boolean(writingSkills.session))) return;
      handleEditorShortcut(event);
    }

    function handleDrop(event: React.DragEvent<HTMLElement>): void {
      const files: File[] = event.dataTransfer?.files ? Array.from(event.dataTransfer.files) : [];
      if (!files.length) return;
      event.preventDefault();
      const images = files.filter((file) => /^image\//i.test(file.type || ''));
      if (images.length) {
        insertImageFiles(images);
        return;
      }
      const first = files[0];
      if (/\.zip$/i.test(first.name) || /zip/i.test(first.type || '')) {
        void docCommands.importBundle(first);
        return;
      }
      if (!/\.(md|markdown|txt)$/i.test(first.name)) return;
      const isCurrent = claimOpenTransition();
      void (async () => {
        try {
          if (!(await flushLinkedFileBeforeSwitch())) return;
          const text = await first.text();
          if (!isCurrent()) return;
          detachFileContext();
          resetDocumentSurface();
          setMarkdown(text, { boundary: true, title: deriveTitleWithFallback(text), resetHistory: true });
          focusRange(0, 0);
          notify(t('toast.imported'));
        } catch {
          /* ignore unreadable dropped file */
        }
      })();
    }

    function previewClick(event: React.MouseEvent<HTMLElement>): void {
      // `closest('a')` also matches SVG `<a>` elements (e.g. inside formulas or diagrams).
      const link = (event.target as Element | null)?.closest?.('a');
      if (link && event.currentTarget.contains(link)) event.preventDefault();
    }

    const useCodeMirror = !editorFailed && typeof window.ResizeObserver !== 'undefined';
    const deferredMarkdown = useDeferredText(doc.markdown);
    const effectivePreviewMarkdown = React.useMemo(
      () =>
        shouldApplyAiPreview(cssWorkbench.open, Boolean(writingSkills.session))
          ? writingSkills.previewMarkdown(deferredMarkdown)
          : deferredMarkdown,
      [deferredMarkdown, cssWorkbench.open, writingSkills.session],
    );
    const headings = React.useMemo(
      () => (outlineOpen ? markdownHeadings(doc.markdown) : []),
      [outlineOpen, doc.markdown],
    );
    const rendered = React.useMemo(() => {
      try {
        return renderArticle(effectivePreviewMarkdown, previewSettings, {
          forPreview: true,
          locale: activeLang,
          imageBaseUrl: localImageServerUrl || 'http://127.0.0.1:4010',
          mermaidAssets: mermaidAssets.cache,
          footnotesTitle: t('footnotes.title'),
          referencesTitle: t('references.title'),
          scrollVerticalHint: t('scroll.verticalHint'),
          scrollHorizontalHint: t('scroll.horizontalHint'),
          imagePlaceholderPrefix: t('render.imagePlaceholderPrefix'),
          imagePlaceholderFallback: t('render.imagePlaceholderFallback'),
          codeBlockAriaLabel: t('render.codeBlockAria'),
        });
      } catch (error) {
        window.console?.error('[markdown-studio] render failed', error);
        return {
          html: '',
          text: '',
          refs: 0,
          localImages: 0,
          bg: '#ffffff',
          paper: false,
          stageBg: '#ffffff',
          error,
        };
      }
    }, [
      effectivePreviewMarkdown,
      previewSettings,
      localImageServerUrl,
      mermaidAssets.version,
      mathAssets.version,
      localeRevision,
    ]);

    const docStats = React.useMemo(
      () => ({
        chars: deferredMarkdown.length,
        words: countMarkdownWords(deferredMarkdown),
      }),
      [deferredMarkdown],
    );
    const { modKey, shiftKey, altKey } = React.useMemo(() => detectPlatformModifiers(), []);
    const shortcutRows = React.useMemo(
      () => buildShortcutRows(t, modKey, shiftKey, altKey),
      [localeRevision, modKey, shiftKey, altKey],
    );

    return h(
      'div',
      {
        className: 'mdstudio-root',
        'data-mdstudio-immersive': immersive || undefined,
        ref: rootRef,
      },
      h('style', {
        'data-plugin': 'dsh-markdown-studio',
        dangerouslySetInnerHTML: { __html: CHROME_CSS + (mathAssets.css ? '\n' + mathAssets.css : '') },
      }),

      h(HeaderBar, {
        React,
        t,
        ui: uiKit,
        state: {
          title: doc.title,
          fileName: fileContext.fileName,
          view,
          drawerOpen,
          menuOpen,
          copying: copyActions.copying,
          modKey,
          shiftKey,
        },
        actions: {
          onTitle: (value) => store.updateActive({ title: value }),
          onView: (next) => {
            store.updateActive({ view: next });
            const containerW =
              rootRef.current?.clientWidth || (typeof window !== 'undefined' ? window.innerWidth : 1024);
            const keepWorkbench = shouldKeepCssWorkbenchOnViewChange(cssWorkbench.open, containerW, next);
            if (!keepWorkbench) clearCssWorkbenchDraft();
            dismissTransientOverlays({ keepSearch: next !== 'preview', keepDrawer: true });
          },
          onImmersive: enterImmersive,
          onOpenLibrary: () => {
            captureDialogTriggerFocus();
            dismissTransientOverlays({ keepSearch: true, keepDrawer: true });
            docLibrary.openLibrary();
          },
          onToggleDrawer: () => {
            if (!drawerOpen) setDrawerTab('theme');
            dismissTransientOverlays({ keepSearch: true, keepDrawer: true });
            setDrawerOpen(!drawerOpen);
          },
          onToggleMenu: () => {
            if (!menuOpen) dismissTransientOverlays({ keepSearch: true, keepDrawer: true, keepMenu: true });
            setMenuOpen(!menuOpen);
          },
          onCloseMenu: () => setMenuOpen(false),
          onNew: () => {
            dismissTransientOverlays({ keepDrawer: true });
            docLibrary.newDocument();
          },
          onOpenFolder: () => {
            captureDialogTriggerFocus();
            dismissTransientOverlays({ keepSearch: true, keepDrawer: true });
            void workspaceTools.openFolder();
          },
          onOpenFile: fileActions.openLocalFile,
          onSave: () => void fileActions.saveLocalFile(false),
          onSaveAs: () => void fileActions.saveLocalFile(true),
          onExportHtml: () => void articleExport.exportHtml(),
          onExportMarkdown: articleExport.exportMarkdown,
          onExportBundle: () => void articleExport.exportBundle(),
          onImport: docCommands.handleImportClick,
          onManageSkills: () => {
            captureDialogTriggerFocus();
            dismissTransientOverlays({ keepSearch: true, keepDrawer: true });
            writingSkills.openManager(null);
          },
          onCopyText: copyActions.copyPlainText,
          onShortcuts: () => {
            setDrawerTab('help');
            setDrawerOpen(true);
            setMenuOpen(false);
          },
          onSample: () => {
            setMenuOpen(false);
            void docCommands.loadSample(false);
          },
          onClear: () => {
            setMenuOpen(false);
            void docCommands.clearArticle();
          },
          onCopy: copyActions.copyArticle,
        },
      }),

      saveStatus === 'error'
        ? h('div', { className: 'mdstudio-host-error', role: 'alert' }, t('storage.saveFailed'))
        : null,

      h(
        'div',
        { className: 'mdstudio-body' + (drawerOpen ? ' is-settings' : ''), 'data-mdstudio-view': view },
        h(EditorPane, {
          React,
          t,
          visible: panes.showMarkdownEditor,
          ui: uiKit,
          stats: docStats,
          toolbar: {
            modKey,
            shiftKey,
            altKey,
            linkFootnotes: settings.linkFootnotes,
            canUndo: docHistory.canUndo(),
            canRedo: docHistory.canRedo(),
            fileConflict: fileContext.conflict,
            permission: fileContext.permission,
            overlayEpoch,
            onAuthorize: () => {
              void fileContext.requestPermission().then((granted) => {
                if (granted) notify(t('file.authorized'));
              });
            },
            onUndo: undo,
            onRedo: redo,
            onHeadingLevel: formatting.applyHeadingLevel,
            onBold: () => formatting.wrapSelection('**', '**', t('toolbar.bold')),
            onItalic: () => formatting.wrapSelection('*', '*', t('toolbar.italic')),
            onStrike: () => formatting.wrapSelection('~~', '~~', t('toolbar.strike')),
            onUnderline: () => formatting.wrapSelection('++', '++', t('toolbar.underline')),
            onInlineMath: () => formatting.wrapSelection('$', '$', t('toolbar.inlineMath')),
            onOrderedList: () => formatting.setLinePrefix('1. '),
            onTaskList: formatting.insertTaskList,
            onAlert: formatting.insertAlert,
            onCodeBlock: formatting.insertCodeBlock,
            onMathBlock: formatting.insertMathBlock,
            onScrollBox: formatting.insertScrollBox,
            onScrollXBox: formatting.insertScrollXBox,
            onMeta: formatting.insertMeta,
            onLead: formatting.insertLead,
            onTldr: formatting.insertTldr,
            onPull: formatting.insertPull,
            onSign: formatting.insertSign,
            onToggleLinkFootnotes: formatting.toggleLinkFootnotes,
            onMark: () => formatting.wrapSelection('==', '==', t('toolbar.mark')),
            onQuote: formatting.insertQuote,
            onCode: formatting.insertCode,
            onLink: () => formatting.wrapSelection('[', '](https://)', t('toolbar.link')),
            onImage: formatting.openImagePicker,
            onList: formatting.insertList,
            onTable: formatting.insertTable,
            onHr: formatting.insertHr,
            onSearch: () => {
              selectionBubble.clear();
              searchCmds.openSearch();
            },
            onOutline: () => {
              selectionBubble.clear();
              slashMenu.close();
              setOutlineOpen((prev) => !prev);
            },
            onReload: () => void fileActions.reloadLinkedFile(),
          },
          slash: {
            open: slashMenu.open,
            items: slashMenu.items,
            selected: slashMenu.selected,
            pos: slashMenu.pos,
            onSelect: slashMenu.selectIndex,
            onApply: slashMenu.applyCommand,
          },
          search: {
            open: searchPanel.open,
            query: searchPanel.query,
            replacement: searchPanel.replacement,
            inputRef: searchInputRef,
            onQuery: (value) => searchCmds.updateSearch({ query: value }),
            onReplacement: (value) => searchCmds.updateSearch({ replacement: value }),
            onFind: () => {
              selectionBubble.clearPointer();
              searchCmds.findNext();
            },
            onReplaceOne: searchCmds.replaceOne,
            onReplaceAll: searchCmds.replaceAll,
            onClose: closeSearchPanel,
          },
          outline: {
            open: outlineOpen,
            headings,
            onFocus: (heading) => {
              selectionBubble.clearPointer();
              searchCmds.focusHeading(heading);
            },
            onClose: () => setOutlineOpen(false),
          },
          content: {
            useCodeMirror,
            markdown: doc.markdown,
            placeholder: t('editor.placeholder'),
            textareaRef,
            onReady: (api) => {
              cmScrollCleanupRef.current?.();
              cmScrollCleanupRef.current = api
                ? api.onScroll(() => {
                    selectionBubble.clear();
                    slashMenu.onEditorScroll();
                  })
                : null;
              scrollSync.registerCodeMirror(api);
            },
            onError: () => {
              setEditorFailed(true);
              notify(t('editor.fallback'), 'error');
            },
            onPointerDown: selectionBubble.onPointerDown,
            onChange: (value: string, nextSelection: EditorSelection) => {
              setMarkdown(value, { boundary: false, prevSelection: lastSelectionRef.current });
              lastSelectionRef.current = nextSelection;
              slashMenu.syncAtCaret(value, nextSelection.end);
              selectionBubble.sync(value, nextSelection);
            },
            onSelection: (nextSelection: EditorSelection) => {
              lastSelectionRef.current = nextSelection;
              if (nextSelection.programmatic) selectionBubble.clear();
              else selectionBubble.sync(editorValue(), nextSelection);
              if (nextSelection.start !== nextSelection.end || writingSkills.session || writingSkills.diffTransition) {
                slashMenu.close();
              } else {
                slashMenu.refreshFromCaret();
              }
            },
            onKeyDown: handleEditorKeyDown,
            onPaste: handlePaste,
            onDrop: handleDrop,
            onBlur: slashMenu.close,
            onTextareaInput: (value, _caret, boundary, selectionStart, selectionEnd) => {
              const nextRange = { start: selectionStart, end: selectionEnd };
              setMarkdown(value, { boundary, prevSelection: lastSelectionRef.current });
              lastSelectionRef.current = nextRange;
              slashMenu.syncAtCaret(value, selectionStart);
              selectionBubble.sync(value, nextRange);
            },
            onTextareaSelect: (selectionStart, selectionEnd) => {
              const nextRange = { start: selectionStart, end: selectionEnd };
              lastSelectionRef.current = nextRange;
              selectionBubble.sync(editorValue(), nextRange);
            },
            onTextareaScroll: () => {
              selectionBubble.clear();
              slashMenu.onEditorScroll();
              scrollSync.syncPreviewFromEditor();
            },
            onRefreshSlash: slashMenu.refreshFromCaret,
          },
          ai: buildEditorAiModel(writingSkills, hasActiveModal() ? null : selectionBubble.pos, () => {
            captureDialogTriggerFocus();
            setMenuOpen(false);
            slashMenu.close();
            setOutlineOpen(false);
            writingSkills.openManager(null);
          }),
        }),

        h(CssWorkbenchPane, {
          React,
          t,
          ui: uiKit,
          open: cssWorkbench.open,
          visible: panes.showCssWorkbench,
          targetId: cssWorkbench.targetId,
          requestSeq: cssWorkbench.seq,
          settings,
          modKey,
          locale: lang() === 'en' ? 'en' : 'zh',
          onBack: closeCssWorkbench,
          onSettings: updateSettings,
          onNotify: (text) => notify(text),
          onDraftCssChange: setLiveCssDraft,
        }),

        panes.showPreview
          ? h(PreviewPane, {
              React,
              t,
              ui: uiKit,
              rendered,
              empty: !effectivePreviewMarkdown.trim(),
              previewMode,
              onPreviewMode: setPreviewMode,
              scrollSyncEnabled: scrollSync.enabled,
              onToggleSync: () => scrollSync.setEnabled(!scrollSync.enabled),
              previewScrollRef: scrollSync.previewRef,
              onPreviewScroll: scrollSync.syncEditorFromPreview,
              onPreviewClick: previewClick,
              onPreviewMounted: scrollSync.restorePreviewScroll,
            })
          : null,

        h(SettingsDrawer, {
          React,
          t,
          ui: uiKit,
          open: drawerOpen,
          initialTab: drawerTab,
          onTabChange: setDrawerTab,
          settings,
          shortcuts: shortcutRows,
          onClose: () => setDrawerOpen(false),
          themeActions: {
            onSettings: updateSettings,
            onPickTheme: pickTheme,
            onCreateCustomTheme: () => openCssWorkbench(null),
            onEditCustomTheme: (custom) => openCssWorkbench(custom.id),
            onResetStyles: resetStyles,
            onExportTheme: articleExport.exportTheme,
            onImportTheme: (file) => {
              clearCssWorkbenchDraft();
              void articleExport.importThemeFile(file);
            },
          },
        }),

        h(LibraryDialog, {
          key: 'library-' + docLibrary.openSeq,
          React,
          t,
          ui: uiKit,
          open: isParentModalOpen(docLibrary.open, dialogHost.open, importModePrompt, mergeReview),
          docs: library.docs,
          trash: library.trash || [],
          activeId: library.activeId,
          hasRecovery: libraryArchive.recoveryAvailable,
          onClose: () => {
            if (dialogHost.open || importModePrompt !== null || mergeReview !== null) return;
            docLibrary.closeLibrary();
            restoreDialogTriggerFocus();
          },
          actions: {
            onNew: docLibrary.newDocument,
            onSwitch: (id) => {
              const sameDoc = id === library.activeId;
              const pending = docLibrary.switchDocument(id);
              if (sameDoc) {
                restoreDialogTriggerFocus();
                return;
              }
              void Promise.resolve(pending).then(() => {
                if (store.getActive().id === id && store.getActive().view === 'preview') {
                  restoreDialogTriggerFocus();
                }
              });
            },
            onDelete: (id) => void docLibrary.deleteDocument(id),
            onRestore: docLibrary.restoreArticle,
            onPurge: (id) => void docLibrary.purgeArticle(id),
            onEmptyTrash: () => void docLibrary.emptyTrash(),
            onExportArchive: () => void libraryArchive.exportArchive(),
            onImport: (file) => void libraryArchive.importFile(file),
            onRecoverImport: () => void libraryArchive.recover(),
          },
        }),

        importModePrompt
          ? h(ImportModeDialog, {
              React,
              t,
              ui: uiKit,
              summary: importModePrompt.summary,
              onClose: () => {
                if (!dialogHost.open) finishImportMode(null);
              },
              onChoose: finishImportMode,
              onCancel: () => finishImportMode(null),
            })
          : null,

        mergeReview
          ? h(MergeConflictDialog, {
              React,
              t,
              ui: uiKit,
              conflicts: mergeReview.conflicts,
              defaultDecision: mergeReview.defaultDecision,
              onClose: () => {
                if (!dialogHost.open) finishMergeReview(null);
              },
              onApply: finishMergeReview,
              onCancel: () => finishMergeReview(null),
            })
          : null,

        h(WorkspaceDialog, {
          key: 'workspace-' + (workspace.open ? workspace.name || 'open' : 'closed'),
          React,
          t,
          ui: uiKit,
          open: isParentModalOpen(workspace.open, dialogHost.open),
          loading: workspace.loading,
          entries: workspace.entries,
          name: workspace.name,
          selectedDir: workspace.selectedDir,
          error: workspace.error,
          onClose: () => {
            if (dialogHost.open) return;
            workspaceTools.close();
            restoreDialogTriggerFocus();
          },
          actions: {
            onConfirm: dialogHost.confirm,
            onPrompt: dialogHost.prompt,
            onOpen: (entry) => void workspaceTools.openEntry(entry),
            onPickFolder: workspaceTools.pickFolder,
            onRefresh: workspaceTools.refresh,
            onCreateFile: workspaceTools.createFile,
            onCreateDirectory: workspaceTools.createDirectory,
            onRename: workspaceTools.renameFile,
            onRenameDirectory: workspaceTools.renameDirectory,
            onMove: (entry, target) => void workspaceTools.moveEntry(entry, target),
            onDelete: workspaceTools.deleteEntry,
            onSelectDirectory: workspaceTools.selectDirectory,
          },
        }),

        h(SkillManagerDialog, {
          React,
          t,
          ui: uiKit,
          open: isParentModalOpen(writingSkills.managerOpen, dialogHost.open),
          targetId: writingSkills.managerTargetId,
          modKey,
          skills: writingSkills.skills,
          activeSkillId: writingSkills.skillState.activeSkillId,
          actions: {
            onClose: () => {
              if (!dialogHost.open) {
                writingSkills.closeManager();
                restoreDialogTriggerFocus();
              }
            },
            onSelectDefault: writingSkills.selectSkill,
            onSave: writingSkills.saveCustom,
            onDelete: writingSkills.deleteCustom,
            onExport: writingSkills.exportSkill,
            onImportFile: writingSkills.importSkillText,
          },
        }),

        dialogHost.node,

        toast
          ? h(uiKit.Toast, {
              key: toast.id,
              text: toast.text,
              tone: toast.tone,
              anchor: rootRef.current,
              holdMs: 2800,
              onDone: () => {
                const targetId = toast.id;
                setToast((prev) => (prev && prev.id === targetId ? null : prev));
              },
            })
          : null,
      ),

      immersive
        ? h(ImmersiveDock, {
            React,
            t,
            ui: uiKit,
            mode: immersive,
            onSwitch: (next) => {
              dismissTransientOverlays();
              setImmersive(next);
              if (next === 'write') focusEditorSoon();
            },
            onExit: exitImmersive,
          })
        : null,

      h('input', {
        type: 'file',
        ref: fileRef,
        className: 'mdstudio-hidden-input',
        tabIndex: -1,
        'aria-hidden': 'true',
        accept: '.md,.markdown,.txt,.zip,text/markdown,text/plain,application/zip',
        onChange: docCommands.handleFile,
      }),
      h('input', {
        type: 'file',
        ref: imageRef,
        className: 'mdstudio-hidden-input',
        tabIndex: -1,
        'aria-hidden': 'true',
        accept: 'image/*',
        multiple: true,
        onChange: (event) => {
          const files = event.target.files;
          if (files?.length) void insertImageFiles(files);
          event.target.value = '';
        },
      }),
      h('div', {
        className: 'mdstudio-copy-holder',
        ref: copyRef,
        contentEditable: true,
        tabIndex: -1,
        'aria-hidden': 'true',
      }),
    );
  }

  function LoadedStudioPage(): ReactNamespace.ReactElement {
    useLocaleRevision();
    const [loaded] = React.useState(() => {
      try {
        return { library: loadInitialLibrary(lang()), error: null };
      } catch (error) {
        if (!(error instanceof LibraryStorageError)) throw error;
        return { library: null, error };
      }
    });
    if (loaded.library) return h(StudioPage, { initial: loaded.library });
    return h(StorageBlockedView, { React, t, ui: uiKit, error: loaded.error! }) as ReactNamespace.ReactElement;
  }

  function SafeStudioPage(): ReactNamespace.ReactElement {
    useLocaleRevision();
    return h(StudioErrorBoundary, { t }, h(LoadedStudioPage));
  }

  function apply(ctx: ClientContext): void {
    const locale = ctx.get<LocaleService>('locale');
    if (locale) {
      ctx.effect(() => localeCtrl.registerWithHost(locale));
    }
    ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID }, SafeStudioPage));
  }

  return { inject: ['slots'], apply };
}

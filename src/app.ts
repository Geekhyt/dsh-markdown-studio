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
import { LibraryStorageError, loadInitialLibrary, savePersistedLibrary } from './adapters/storage';
import { createArticleExporter } from './application/article-exporter';
import { createAssetGarbageCollector } from './application/asset-gc';
import { createDocumentCommands } from './application/document-commands';
import { DocumentStore } from './application/document-store';
import { createFormattingCommands } from './application/editor-formatting';
import { createEditorSearch, type SearchState } from './application/editor-search';
import { createEditorShortcuts } from './application/editor-shortcuts';
import { createFileCommands } from './application/file-commands';
import { importFolderAssets } from './application/folder-assets';
import { createImageInserter } from './application/image-inserter';
import { useCopyActions } from './application/use-copy-actions';
import { useDocumentHistory } from './application/use-document-history';
import { useDocumentLibrary } from './application/use-document-library';
import { useFileContext } from './application/use-file-context';
import { type ImportBackupSummary, type ImportModeChoice, useLibraryArchive } from './application/use-library-archive';
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
import { collectLocalImages, portableizeAssetUrls, replaceLocalImages } from './domain/images';
import type { MergeConflict, MergeDecision } from './domain/library-backup';
import { sanitizeSettings } from './domain/settings';
import type { WritingSkill } from './domain/writing-skills';
import { createStudioLocaleController } from './locales/ui-strings';
import { useElementBinding } from './runtime/dom-surfaces';
import { useExternalStore, useMountDisposable, useWindowEvent } from './runtime/react-lifecycle';
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

function detectPlatformModifiers(): { modKey: string; shiftKey: string; altKey: string } {
  let isMac = false;
  try {
    const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
    const platformText = nav.userAgentData?.platform || navigator.platform || navigator.userAgent || '';
    isMac = /Mac|iPhone|iPad/.test(String(platformText));
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
): Promise<{ mapping: Map<string, string>; migrated: number }> {
  const entries = Array.from(collectLocalImages(markdown).entries()).filter(([, info]) => info.kind === 'data');
  const mapping = new Map<string, string>();
  for (const [rawUrl] of entries) {
    try {
      const prepared = await prepareImageForWechat(rawUrl);
      const stored = await client.storeAsset(prepared.dataUrl, prepared.filename);
      const nextPath = stored.assetPath || stored.localUrl || stored.url;
      if (nextPath) mapping.set(rawUrl, nextPath);
    } catch {
      /* keep inline base64 when local image service is unreachable */
    }
  }
  return { mapping, migrated: mapping.size };
}

function resolvePreviewSettings(base: themes.ThemeSettings, cssOpen: boolean, draftCss: string): themes.ThemeSettings {
  const trimmed = draftCss.trim();
  if (!cssOpen || !trimmed) return base;
  const draftId = '__css_workbench_live__';
  const draftPreview = extractCustomThemePreview(trimmed, base.accent);
  return {
    ...base,
    theme: draftId,
    accent: draftPreview.accent,
    customThemes: [{ id: draftId, name: 'Draft', css: trimmed }],
  };
}

function computePaneVisibility(
  immersive: ImmersiveMode,
  view: string,
  cssOpen: boolean,
): { showMarkdownEditor: boolean; showCssWorkbench: boolean; showPreview: boolean } {
  const leftVisible = immersive ? immersive === 'write' : view !== 'preview';
  const showPreview = immersive ? immersive === 'preview' : view !== 'edit';
  return {
    showMarkdownEditor: leftVisible && !cssOpen,
    showCssWorkbench: leftVisible && cssOpen,
    showPreview,
  };
}

/**
 * Why parent modals temporarily hide (`open = false`) while a child confirm/prompt/conflict
 * dialog is active: avoids dual modal focus-trap and Escape-key collisions in DSH Modal.
 * Consequently, any state that must survive a child confirmation lives outside the modal view.
 */
function parentModalOpen(open: boolean, childOpen: boolean, promptA?: unknown, promptB?: unknown): boolean {
  if (!open || childOpen) return false;
  return !promptA && !promptB;
}

function buildEditorAiModel(
  skillsApi: WritingSkillsApi,
  bubblePos: { top: number; left: number } | null,
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
    onOpenManager: () => {
      skillsApi.openManager(null);
    },
    onCancel: skillsApi.cancelSession,
  };
}

export function createClientPlugin(
  React: typeof ReactNamespace,
  primitives?: DshPrimitivesModule | null,
): ClientPlugin {
  const h = React.createElement;
  const uiKit = createUiKit(React, primitives);
  const localeCtrl = createStudioLocaleController(React, LOCALE_NS);
  const { t, lang, useLocaleRevision } = localeCtrl;
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

    const [store] = React.useState(() => new DocumentStore(props.initial, savePersistedLibrary));
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
    const [searchPanel, setSearchPanel] = React.useState<SearchState>({ open: false, query: '', replacement: '' });
    const [outlineOpen, setOutlineOpen] = React.useState(false);
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

    function focusRange(start: number, end: number): void {
      window.requestAnimationFrame(() => {
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
      if (codeMirrorApiRef.current) codeMirrorApiRef.current.focus();
      else textareaRef.current?.focus();
    }

    function focusEditorSoon(): void {
      window.setTimeout(focusEditor, 30);
    }

    function restoreDialogTriggerFocus(): void {
      const target = dialogReturnFocusRef.current;
      dialogReturnFocusRef.current = null;
      if (target && target.isConnected) {
        window.requestAnimationFrame(() => target.focus());
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
      setMarkdown,
      focusRange,
      closeOutline: () => setOutlineOpen(false),
    });

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

    function detachFileContext(): void {
      fileContext.reset(store.getActive().id);
      fileContext.setFileName('');
    }

    const writingSkills = useWritingSkills({
      React,
      t,
      notify,
      aiClient,
      markdown: doc.markdown,
      title: () => store.getActive().title,
      editorValue,
      selection,
      setMarkdown,
      download: downloadFile,
    });

    function resetEditorTo(entry: DocumentSeed): void {
      const markdown = String(entry.markdown || '');
      writingSkills.resetSession();
      selectionBubble.clear();
      docHistory.reset(markdown);
      store.updateActive({
        title: entry.title || t('untitled'),
        markdown,
        settings: sanitizeSettings(entry.settings || settings),
        view: entry.view === 'edit' || entry.view === 'preview' ? entry.view : 'split',
      });
      slashMenu.close();
      setCssWorkbench((prev) => ({ open: false, targetId: null, seq: prev.seq }));
      setSearchPanel((prev) => ({ ...prev, open: false }));
      detachFileContext();
      window.setTimeout(() => focusRange(markdown.length, markdown.length), 30);
    }

    const mermaidTheme = React.useMemo(
      () => themes.mermaidThemeFor(settings),
      [settings.theme, settings.accent, settings.fontSize, settings.lineHeight, settings.customThemes],
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
      }),
    );
    const pruneOrphanAssets = () => {
      void assetGc.prune();
    };

    const docLibrary = useDocumentLibrary({
      React,
      store,
      t,
      notify,
      confirm: dialogHost.confirm,
      settings,
      view,
      onActivate: resetEditorTo,
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
      onOpenFile: async (directory, entry, text) => {
        resetEditorTo({ title: deriveTitleWithFallback(text), markdown: text, settings, view });
        fileContext.applyDocumentRef({ kind: 'folder', directory, file: entry.handle });
        await fileContext.stampFile(entry.handle, await entry.handle.getFile());
        fileContext.setFileName(entry.name);
        const imported = await importFolderAssets(directory, text, hostClient);
        if (imported.text !== text) {
          setMarkdown(imported.text, {
            boundary: true,
            title: deriveTitleWithFallback(imported.text),
            prevSelection: selection(),
          });
        }
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
      onReplace: (entry) => {
        resetEditorTo(entry);
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
    });

    const searchCmds = createEditorSearch({
      editorValue,
      selection,
      setMarkdown,
      focusRange,
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
      const custom = findCustomTheme(settings.customThemes, id);
      if (custom) {
        const preview = extractCustomThemePreview(custom.css, settings.accent);
        updateSettings({ theme: id, accent: preview.accent });
        return;
      }
      updateSettings({ theme: id, accent: themes.getTheme(id).defaultAccent });
    }

    function resetStyles(): void {
      store.updateActive({ settings: { ...themes.DEFAULT_SETTINGS, customThemes: settings.customThemes || [] } });
    }

    const activeLang = lang();

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
    });

    function undo(): void {
      if (docHistory.undo()) slashMenu.close();
    }

    function redo(): void {
      if (docHistory.redo()) slashMenu.close();
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
      openSearch: searchCmds.openSearch,
      runWritingSkill: () => void writingSkills.runSkill(),
      acceptAiReview: () => {
        const session = writingSkills.session;
        if (!session || session.status !== 'ready' || session.patches.length !== 1) return false;
        writingSkills.acceptPatch(session.patches[0].id);
        return true;
      },
      cancelAiReview: () => {
        if (!writingSkills.session) return false;
        writingSkills.cancelSession();
        return true;
      },
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
    });

    const scrollSync = useScrollSync({
      React,
      codeMirrorApiRef,
      textareaRef,
      onCodeMirrorReady: (api) => {
        if (!api) return;
        const value = api.getValue();
        api.focusRange(value.length, value.length);
        lastSelectionRef.current = { start: value.length, end: value.length };
      },
    });

    // Host titlebar clearance binding + Window flush/Escape/Immersive bindings + Mount disposable
    useElementBinding(React, rootRef, observeHostTitlebarInset);
    useWindowEvent(React, 'beforeunload', () => store.flush());
    useWindowEvent(React, 'pagehide', () => store.flush());

    useWindowEvent(
      React,
      'keydown',
      (event: KeyboardEvent) => {
        if (event.key !== 'Escape') return;
        const blocked = [
          event.defaultPrevented,
          dialogHost.open,
          importModePrompt,
          mergeReview,
          docLibrary.open,
          workspace.open,
          writingSkills.managerOpen,
        ].some(Boolean);
        if (blocked) return;
        setMenuOpen(false);
        if (!menuOpen) setDrawerOpen(false);
      },
      menuOpen || drawerOpen,
    );

    useMountDisposable(React, () => {
      pageAliveRef.current = true;
      store.flush();

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
        migrateDataImages(snapshot, hostClient)
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
      let lastObservedMd = store.getActive().markdown;
      let autoSaveTimer: number | null = null;
      const unsubscribeAutosave = store.subscribe(() => {
        const activeMd = store.getActive().markdown;
        if (activeMd === lastObservedMd) return;
        lastObservedMd = activeMd;
        if (autoSaveTimer !== null) window.clearTimeout(autoSaveTimer);
        if (!fileContext.linkedFile() || fileContext.conflictRef.current) return;
        autoSaveTimer = window.setTimeout(() => {
          autoSaveTimer = null;
          const currentHandle = fileContext.linkedFile();
          if (!currentHandle || fileContext.conflictRef.current) return;
          fileContext.writeFile(currentHandle, markdownRef.current).catch(() => {
            notify(t('file.saveFailed'), 'error');
          });
        }, 1200);
      });

      return () => {
        alive = false;
        pageAliveRef.current = false;
        window.clearTimeout(migrateTimer);
        if (autoSaveTimer !== null) window.clearTimeout(autoSaveTimer);
        unsubscribeAutosave();
        if (cmScrollCleanupRef.current) cmScrollCleanupRef.current();
      };
    });

    function openCssWorkbench(targetId: string | null): void {
      setDrawerOpen(false);
      setMenuOpen(false);
      slashMenu.close();
      setOutlineOpen(false);
      if (view !== 'split') store.updateActive({ view: 'split' });
      setCssWorkbench((prev) => ({ open: true, targetId, seq: prev.seq + 1 }));
    }

    function closeCssWorkbench(): void {
      setCssWorkbench((prev) => ({ open: false, targetId: null, seq: prev.seq }));
      setLiveCssDraft('');
      focusEditorSoon();
    }

    function enterImmersive(): void {
      setDrawerOpen(false);
      setMenuOpen(false);
      slashMenu.close();
      setOutlineOpen(false);
      setCssWorkbench((prev) => ({ open: false, targetId: null, seq: prev.seq }));
      setLiveCssDraft('');
      setSearchPanel((prev) => (prev.open ? { ...prev, open: false } : prev));
      const next: 'write' | 'preview' = view === 'preview' ? 'preview' : 'write';
      setImmersive(next);
      if (next === 'write') focusEditorSoon();
    }

    function exitImmersive(): void {
      setImmersive(null);
      window.setTimeout(() => {
        rootRef.current?.querySelector<HTMLElement>('.mdstudio-focus-btn')?.focus();
      }, 0);
    }

    useImmersiveShortcuts(React, immersive, enterImmersive, exitImmersive);

    function handleEditorKeyDown(event: React.KeyboardEvent<HTMLElement>): void {
      if (event.nativeEvent.isComposing) return;
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
      first
        .text()
        .then((text) => {
          setMarkdown(text, { boundary: true, title: deriveTitleWithFallback(text), resetHistory: true });
          focusRange(text.length, text.length);
          notify(t('toast.imported'));
        })
        .catch(() => {});
    }

    function previewClick(event: React.MouseEvent<HTMLElement>): void {
      const target = event.target as Element | null;
      // `closest('a')` also matches SVG `<a>` elements (e.g. inside formulas or diagrams).
      const link = target && typeof target.closest === 'function' ? target.closest('a') : null;
      if (link && event.currentTarget.contains(link)) event.preventDefault();
    }

    const useCodeMirror = !editorFailed && typeof window.ResizeObserver !== 'undefined';
    const deferredMarkdown = useDeferredText(doc.markdown);
    const effectivePreviewMarkdown = React.useMemo(
      () => writingSkills.previewMarkdown(deferredMarkdown),
      [deferredMarkdown, writingSkills.session],
    );
    const deferredCssDraft = useDeferredText(liveCssDraft);
    const previewSettings = React.useMemo(
      () => resolvePreviewSettings(settings, cssWorkbench.open, deferredCssDraft),
      [settings, cssWorkbench.open, deferredCssDraft],
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
        chars: doc.markdown.length,
        words:
          (doc.markdown.match(/[\u4e00-\u9fff]/g) || []).length + (doc.markdown.match(/[A-Za-z0-9]+/g) || []).length,
      }),
      [doc.markdown],
    );
    const panes = computePaneVisibility(immersive, view, cssWorkbench.open);
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
            setCssWorkbench((prev) => ({ open: false, targetId: null, seq: prev.seq }));
            setLiveCssDraft('');
            slashMenu.close();
            setOutlineOpen(false);
            setMenuOpen(false);
          },
          onImmersive: enterImmersive,
          onOpenLibrary: () => {
            if (document.activeElement instanceof HTMLElement) dialogReturnFocusRef.current = document.activeElement;
            docLibrary.openLibrary();
            setMenuOpen(false);
          },
          onToggleDrawer: () => {
            if (!drawerOpen) setDrawerTab('theme');
            setDrawerOpen(!drawerOpen);
            setMenuOpen(false);
          },
          onToggleMenu: () => setMenuOpen(!menuOpen),
          onCloseMenu: () => setMenuOpen(false),
          onNew: () => {
            setMenuOpen(false);
            docLibrary.newDocument();
          },
          onOpenFolder: () => {
            if (document.activeElement instanceof HTMLElement) dialogReturnFocusRef.current = document.activeElement;
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
            setMenuOpen(false);
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
            onSearch: searchCmds.openSearch,
            onOutline: () => setOutlineOpen((prev) => !prev),
            onReload: () => void fileActions.reloadLinkedFile(),
          },
          slash: {
            open: slashMenu.open,
            items: slashMenu.items,
            selected: slashMenu.selected,
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
            onFind: searchCmds.findNext,
            onReplaceOne: searchCmds.replaceOne,
            onReplaceAll: searchCmds.replaceAll,
            onClose: () => {
              setSearchPanel((prev) => ({ ...prev, open: false }));
              focusEditor();
            },
          },
          outline: {
            open: outlineOpen,
            headings,
            onFocus: searchCmds.focusHeading,
            onClose: () => setOutlineOpen(false),
          },
          content: {
            useCodeMirror,
            markdown: doc.markdown,
            placeholder: t('editor.placeholder'),
            textareaRef,
            onReady: (api) => {
              cmScrollCleanupRef.current?.();
              cmScrollCleanupRef.current = api ? api.onScroll(() => selectionBubble.clear()) : null;
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
              selectionBubble.sync(editorValue(), nextSelection);
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
              scrollSync.syncPreviewFromEditor();
            },
            onRefreshSlash: slashMenu.refreshFromCaret,
          },
          ai: buildEditorAiModel(writingSkills, selectionBubble.pos),
        }),

        h(CssWorkbenchPane, {
          React,
          t,
          ui: uiKit,
          visible: panes.showCssWorkbench,
          targetId: cssWorkbench.targetId,
          requestSeq: cssWorkbench.seq,
          settings,
          modKey,
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
            })
          : null,

        h(SettingsDrawer, {
          React,
          t,
          ui: uiKit,
          open: drawerOpen,
          initialTab: drawerTab,
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
            onImportTheme: (file) => void articleExport.importThemeFile(file),
          },
        }),

        h(LibraryDialog, {
          React,
          t,
          ui: uiKit,
          open: parentModalOpen(docLibrary.open, dialogHost.open, importModePrompt, mergeReview),
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
              docLibrary.switchDocument(id);
              restoreDialogTriggerFocus();
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
          React,
          t,
          ui: uiKit,
          open: parentModalOpen(workspace.open, dialogHost.open),
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
          open: parentModalOpen(writingSkills.managerOpen, dialogHost.open),
          targetId: writingSkills.managerTargetId,
          modKey,
          skills: writingSkills.skills,
          activeSkillId: writingSkills.skillState.activeSkillId,
          actions: {
            onClose: () => {
              if (!dialogHost.open) writingSkills.closeManager();
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
        accept: '.md,.markdown,.txt,.zip,text/markdown,text/plain,application/zip',
        onChange: docCommands.handleFile,
      }),
      h('input', {
        type: 'file',
        ref: imageRef,
        className: 'mdstudio-hidden-input',
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

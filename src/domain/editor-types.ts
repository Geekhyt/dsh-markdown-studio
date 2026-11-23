/**
 * Pure editor port contracts shared across domain, application, and UI layers.
 */

export interface EditorSelection {
  start: number;
  end: number;
  head?: number;
  programmatic?: boolean;
  composing?: boolean;
  boundary?: boolean;
}

export interface EditorScrollInfo {
  top: number;
  max: number;
}

export interface EditorDiffPart {
  text: string;
  changed?: boolean;
}

export interface EditorDiffOffset {
  fromOffset: number;
  toOffset: number;
}

export interface EditorInlineBlock {
  id: string;
  from: number;
  to: number;
  text: string;
  delParts?: readonly EditorDiffPart[];
  addParts?: readonly EditorDiffPart[];
  delOffsets?: readonly EditorDiffOffset[];
  status: 'streaming' | 'ready' | 'error';
  warning?: string;
  primaryLabel: string;
  secondaryLabel: string;
  retryLabel?: string;
  onPrimary: () => void;
  onSecondary: () => void;
  onRetry?: () => void;
}

export interface EditorDiffTransition {
  kind: 'accept' | 'reject';
  seq: number;
  from: number;
  to: number;
  inlinePhrase?: boolean;
  ghostParts: readonly EditorDiffPart[];
  offsets: readonly EditorDiffOffset[];
}

export interface EditorCoords {
  top: number;
  bottom: number;
  left: number;
}

export interface EditorApi {
  getValue(): string;
  setValue(value: string, silent?: boolean): void;
  getSelection(): EditorSelection;
  getScrollInfo(): EditorScrollInfo;
  scrollToRatio(ratio: number): void;
  onScroll(listener: (info: EditorScrollInfo) => void): () => void;
  focusRange(start: number, end: number): void;
  revealRange?(start: number, end: number): void;
  focus(): void;
  destroy(): void;
  setDark(dark: boolean): void;
  setPlaceholder?(placeholder: string, ariaLabel?: string): void;
  coordsAtPos?(pos: number): EditorCoords | null;
  setInlineBlocks?(blocks: readonly EditorInlineBlock[]): void;
  setDiffTransition?(transition: EditorDiffTransition | null): void;
}

import type * as ReactNamespace from 'react';
import type { EditorApi, EditorDiffTransition, EditorInlineBlock, EditorSelection } from '../domain/editor-types';
import { useHostDarkTheme, useImperativeEditor } from '../runtime/dom-surfaces';
import { useLatest } from '../runtime/react-lifecycle';
import { create as createEditor } from './codemirror-core';

export interface EditorConfig {
  language?: 'markdown' | 'css';
  placeholder?: string;
  ariaLabel?: string;
  enableHistory?: boolean;
  slashAria?: { open: boolean; activeId: string | null };
}

export interface EditorProps {
  React: typeof ReactNamespace;
  value: string;
  config?: EditorConfig;
  inlineBlocks?: readonly EditorInlineBlock[];
  diffTransition?: EditorDiffTransition | null;
  onChange: (value: string, selection: EditorSelection) => void;
  onSelection?: (selection: EditorSelection) => void;
  onBlur?: () => void;
  onKeyDown?: (event: ReactNamespace.KeyboardEvent<HTMLDivElement>) => void;
  onPaste?: (event: ReactNamespace.ClipboardEvent<HTMLDivElement>) => void;
  onDragOver?: (event: ReactNamespace.DragEvent<HTMLDivElement>) => void;
  onDrop?: (event: ReactNamespace.DragEvent<HTMLDivElement>) => void;
  onReady?: (api: EditorApi | null) => void;
  onError?: (error: unknown) => void;
}

export function CodeMirrorEditor(props: EditorProps) {
  const React = props.React;
  const h = React.createElement;
  const hostRef = React.useRef<HTMLDivElement | null>(null);
  const propsRef = useLatest(React, props);
  const dark = useHostDarkTheme(React);

  useImperativeEditor<EditorApi, EditorInlineBlock, EditorDiffTransition>(React, hostRef, {
    value: props.value,
    dark,
    placeholder: props.config?.placeholder,
    ariaLabel: props.config?.ariaLabel,
    slashAria: props.config?.slashAria,
    inlineBlocks: props.inlineBlocks,
    diffTransition: props.diffTransition,
    onReady: props.onReady,
    onError: props.onError,
    mount: function (parent, initialDark) {
      const cfg = propsRef.current.config;
      return createEditor({
        parent,
        doc: propsRef.current.value || '',
        placeholder: cfg?.placeholder || '',
        ariaLabel: cfg?.ariaLabel,
        language: cfg?.language,
        enableHistory: cfg?.enableHistory,
        dark: initialDark,
        onChange: function (value, selection) {
          propsRef.current.onChange(value, selection);
        },
        onSelection: function (selection) {
          propsRef.current.onSelection?.(selection);
        },
        onBlur: function () {
          propsRef.current.onBlur?.();
        },
      });
    },
  });

  return h('div', {
    className: 'mdstudio-codemirror',
    ref: hostRef,
    onKeyDownCapture: function (event: ReactNamespace.KeyboardEvent<HTMLDivElement>) {
      propsRef.current.onKeyDown?.(event);
    },
    onPasteCapture: function (event: ReactNamespace.ClipboardEvent<HTMLDivElement>) {
      propsRef.current.onPaste?.(event);
    },
    onDragOver: function (event: ReactNamespace.DragEvent<HTMLDivElement>) {
      propsRef.current.onDragOver?.(event);
    },
    onDropCapture: function (event: ReactNamespace.DragEvent<HTMLDivElement>) {
      propsRef.current.onDrop?.(event);
    },
  });
}

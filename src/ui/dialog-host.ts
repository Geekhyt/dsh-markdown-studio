import type * as ReactNamespace from 'react';
import type { ReactNode } from 'react';
import type { ConfirmDialogFn, ConfirmDialogOptions, PromptDialogFn, PromptDialogOptions } from '../domain/dialog';
import type { DshBridge } from './dsh-primitives';

export type { ConfirmDialogFn, ConfirmDialogOptions, PromptDialogFn, PromptDialogOptions };

type ActiveDialog =
  | ({ kind: 'confirm'; resolve: (ok: boolean) => void } & ConfirmDialogOptions)
  | ({ kind: 'prompt'; resolve: (value: string | null) => void } & PromptDialogOptions);

export interface DialogHostApi {
  open: boolean;
  confirm: ConfirmDialogFn;
  prompt: PromptDialogFn;
  node: ReactNode;
}

function resolveConfirmLabel(dialog: ActiveDialog, t: (key: string) => string): string {
  if (dialog.confirmLabel) return dialog.confirmLabel;
  if (dialog.kind === 'confirm' && dialog.danger) return t('dialog.delete');
  return t('dialog.confirm');
}

function isDangerConfirm(dialog: ActiveDialog): boolean {
  return dialog.kind === 'confirm' && Boolean(dialog.danger);
}

export function useDialogHost(
  React: typeof ReactNamespace,
  t: (key: string) => string,
  bridge: DshBridge,
): DialogHostApi {
  const h = React.createElement;
  const [dialog, setDialog] = React.useState<ActiveDialog | null>(null);
  const activeRef = React.useRef<ActiveDialog | null>(null);
  const [value, setValue] = React.useState('');
  const focusedPromptRef = React.useRef(false);

  function settlePrevious(): void {
    const prev = activeRef.current;
    activeRef.current = null;
    if (!prev) return;
    if (prev.kind === 'confirm') prev.resolve(false);
    else prev.resolve(null);
  }

  function bindPromptInput(el: HTMLInputElement | null): void {
    if (!el || focusedPromptRef.current) return;
    focusedPromptRef.current = true;
    window.setTimeout(function () {
      el.focus();
      try {
        el.select();
      } catch {
        /* ignore */
      }
    }, 0);
  }

  function confirm(options: ConfirmDialogOptions): Promise<boolean> {
    settlePrevious();
    return new Promise(function (resolve) {
      const next: ActiveDialog = { kind: 'confirm', ...options, resolve };
      activeRef.current = next;
      setDialog(next);
    });
  }

  function prompt(options: PromptDialogOptions): Promise<string | null> {
    settlePrevious();
    focusedPromptRef.current = false;
    setValue(options.defaultValue || '');
    return new Promise(function (resolve) {
      const next: ActiveDialog = { kind: 'prompt', ...options, resolve };
      activeRef.current = next;
      setDialog(next);
    });
  }

  function cancel(): void {
    const active = activeRef.current || dialog;
    activeRef.current = null;
    setDialog(null);
    if (!active) return;
    if (active.kind === 'confirm') active.resolve(false);
    else active.resolve(null);
  }

  function submit(): void {
    const active = activeRef.current || dialog;
    if (!active) return;
    if (active.kind === 'confirm') {
      activeRef.current = null;
      setDialog(null);
      active.resolve(true);
      return;
    }
    if (!active.allowEmpty && !value.trim()) return;
    activeRef.current = null;
    setDialog(null);
    active.resolve(value);
  }

  function renderDialog(active: ActiveDialog): ReactNode {
    const danger = isDangerConfirm(active);
    const submitDisabled = active.kind === 'prompt' && !active.allowEmpty && !value.trim();
    return h(
      bridge.Modal,
      {
        open: true,
        onClose: cancel,
        title: active.title,
        closeLabel: t('close'),
        description: active.description,
        tone: danger ? 'warning' : undefined,
        className: 'mdstudio-dialog-prompt' + (danger ? ' is-danger-dialog' : ''),
        footer: h(
          React.Fragment,
          null,
          h(
            bridge.Button,
            {
              variant: 'outline',
              size: 'md',
              className: 'mdstudio-dialog-cancel',
              onClick: cancel,
            },
            active.cancelLabel || t('dialog.cancel'),
          ),
          h(
            bridge.Button,
            {
              variant: 'primary',
              size: 'md',
              disabled: submitDisabled,
              autoFocus: active.kind === 'confirm',
              className: 'mdstudio-dialog-submit' + (danger ? ' is-danger-fill' : ''),
              onClick: submit,
            },
            resolveConfirmLabel(active, t),
          ),
        ),
      },
      active.kind === 'prompt'
        ? h(bridge.Input, {
            ref: bindPromptInput,
            type: 'text',
            className: 'mdstudio-dialog-input',
            wrapClassName: 'mdstudio-dialog-input-wrap',
            value,
            placeholder: active.placeholder || '',
            'aria-label': active.title,
            autoFocus: true,
            onChange: function (event: ReactNamespace.ChangeEvent<HTMLInputElement>) {
              setValue(event.target.value);
            },
            onKeyDown: function (event: ReactNamespace.KeyboardEvent<HTMLInputElement>) {
              if (event.nativeEvent.isComposing || event.keyCode === 229) return;
              if (event.key === 'Enter') {
                event.preventDefault();
                submit();
              }
            },
          })
        : undefined,
    );
  }

  return {
    open: dialog !== null,
    confirm,
    prompt,
    node: dialog ? renderDialog(dialog) : null,
  };
}

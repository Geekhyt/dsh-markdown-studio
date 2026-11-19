export interface ConfirmDialogOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

export interface PromptDialogOptions {
  title: string;
  description?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  allowEmpty?: boolean;
}

export type ConfirmDialogFn = (options: ConfirmDialogOptions) => Promise<boolean>;
export type PromptDialogFn = (options: PromptDialogOptions) => Promise<string | null>;

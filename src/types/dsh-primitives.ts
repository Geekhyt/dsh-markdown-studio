import type {
  ButtonHTMLAttributes,
  ComponentType,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactElement,
  ReactNode,
  RefAttributes,
} from 'react';

export interface DshIconProps {
  size?: number;
  className?: string;
}

export type DshButtonVariant = 'primary' | 'ghost' | 'outline' | 'toolbar';

export interface DshButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, RefAttributes<HTMLButtonElement> {
  variant?: DshButtonVariant;
  size?: 'md' | 'sm';
  icon?: ReactNode;
  className?: string;
  children?: ReactNode;
}

export interface DshSwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
  title?: string;
  className?: string;
}

export interface DshCheckboxProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: ReactNode;
  disabled?: boolean;
  title?: string;
  className?: string;
}

export interface DshInputProps extends InputHTMLAttributes<HTMLInputElement>, RefAttributes<HTMLInputElement> {
  icon?: ReactNode;
  className?: string;
  wrapClassName?: string;
}

export type DshTagTone = 'outline' | 'solid' | 'neutral' | 'quiet' | 'success' | 'info' | 'warning' | 'danger';

export interface DshTagProps {
  tone?: DshTagTone;
  className?: string;
  children?: ReactNode;
}

export type DshStateDotState = 'done' | 'warning' | 'ongoing' | 'error' | 'idle';

export interface DshStateDotProps {
  state: DshStateDotState;
  size?: number;
  className?: string;
}

export interface DshTooltipProps {
  label: string | (() => string);
  side?: 'right' | 'bottom' | 'top';
  delayMs?: number;
  disabled?: boolean;
  maxWidth?: number;
  portal?: boolean;
  children: ReactElement;
}

export interface DshToastProps {
  text: string;
  icon?: ReactNode;
  tone?: 'success';
  anchor?: HTMLElement | null;
  holdMs?: number;
  onDone: () => void;
}

export interface DshModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  closeLabel: string;
  description?: string;
  tone?: 'warning';
  headless?: boolean;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
  contentClassName?: string;
  onKeyDownCapture?: (event: import('react').KeyboardEvent<HTMLElement>) => void;
}

export interface DshMenuShortcut {
  keys: readonly string[];
  aria?: string;
}

export interface DshMenuItem {
  id: string;
  label: ReactNode;
  disabled?: boolean;
  icon?: ReactNode;
  danger?: boolean;
  shortcut?: DshMenuShortcut;
  submenu?: readonly DshMenuItem[];
}

export interface DshMenuSeparator {
  type: 'separator';
  id: string;
}

export interface DshMenuLabel {
  type: 'label';
  id: string;
  text: string;
}

export type DshMenuEntry = DshMenuItem | DshMenuSeparator | DshMenuLabel;

export interface DshMenuProps {
  open: boolean;
  anchor: ReactNode;
  items: readonly DshMenuEntry[];
  footer?: readonly DshMenuEntry[];
  selectedId?: string;
  selectedIds?: readonly string[];
  onSelect: (id: string) => void;
  onClose: () => void;
  align?: 'start' | 'end';
  side?: 'bottom' | 'top' | 'right';
  portal?: boolean;
  dense?: boolean;
  compact?: boolean;
  autoFocus?: boolean;
  selection?: 'check' | 'fill';
  getAnchorRect?: () => DOMRect | null;
  className?: string;
  listClassName?: string;
}

export interface DshPillProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  className?: string;
  children?: ReactNode;
}

export interface DshPrimitivesModule extends Record<string, unknown> {
  Button?: ComponentType<DshButtonProps>;
  Switch?: ComponentType<DshSwitchProps>;
  Checkbox?: ComponentType<DshCheckboxProps>;
  Input?: ComponentType<DshInputProps>;
  Tag?: ComponentType<DshTagProps>;
  StateDot?: ComponentType<DshStateDotProps>;
  Tooltip?: ComponentType<DshTooltipProps>;
  Toast?: ComponentType<DshToastProps>;
  Modal?: ComponentType<DshModalProps>;
  Menu?: ComponentType<DshMenuProps>;
  Pill?: ComponentType<DshPillProps>;
  IconSearchOutlineRegular?: ComponentType<DshIconProps>;
  IconSlidersTwoOutlineRegular?: ComponentType<DshIconProps>;
  IconSettingsOutlineRegular?: ComponentType<DshIconProps>;
  IconEllipsisOutlineRegular?: ComponentType<DshIconProps>;
  IconPlusOutlineRegular?: ComponentType<DshIconProps>;
  IconCheckOutlineRegular?: ComponentType<DshIconProps>;
  IconChecklistOutlineRegular?: ComponentType<DshIconProps>;
  IconCloseOutlineRegular?: ComponentType<DshIconProps>;
  IconCopyOutlineRegular?: ComponentType<DshIconProps>;
  IconRefreshOutlineRegular?: ComponentType<DshIconProps>;
  IconEditOutlineRegular?: ComponentType<DshIconProps>;
  IconLinkOutlineRegular?: ComponentType<DshIconProps>;
  IconTrashOutlineRegular?: ComponentType<DshIconProps>;
  IconWarningOutlineRegular?: ComponentType<DshIconProps>;
  IconSaveOutlineRegular?: ComponentType<DshIconProps>;
  IconDownloadOutlineRegular?: ComponentType<DshIconProps>;
  IconUploadOutlineRegular?: ComponentType<DshIconProps>;
  IconFullscreenOutlineRegular?: ComponentType<DshIconProps>;
  IconCompactOutlineRegular?: ComponentType<DshIconProps>;
  IconCodeOutlineRegular?: ComponentType<DshIconProps>;
  IconFolderOpenOutlineRegular?: ComponentType<DshIconProps>;
  IconFolderCloseRegular?: ComponentType<DshIconProps>;
  IconQuestionOutlineRegular?: ComponentType<DshIconProps>;
  IconArchiveOutlineRegular?: ComponentType<DshIconProps>;
  IconSparkleRegular?: ComponentType<DshIconProps>;
  IconEyeOutlineRegular?: ComponentType<DshIconProps>;
  IconCompareSplitOutlineRegular?: ComponentType<DshIconProps>;
  IconChevronDownOutlineRegular?: ComponentType<DshIconProps>;
  IconChevronRightOutlineRegular?: ComponentType<DshIconProps>;
  IconInspectOutlineRegular?: ComponentType<DshIconProps>;
  IconBrowseOutlineRegular?: ComponentType<DshIconProps>;
  IconInfoOutlineRegular?: ComponentType<DshIconProps>;
  IconDragHandleOutlineRegular?: ComponentType<DshIconProps>;
  IconLayersOutlineRegular?: ComponentType<DshIconProps>;
  IconDeliverDocRegular?: ComponentType<DshIconProps>;
  IconWorkspaceTreeOutlineRegular?: ComponentType<DshIconProps>;
  IconFlatListOutlineRegular?: ComponentType<DshIconProps>;
  IconPersonalizationOutlineRegular?: ComponentType<DshIconProps>;
  IconClockOutlineRegular?: ComponentType<DshIconProps>;
  IconSearchOutline16?: ComponentType<DshIconProps>;
  IconSettingsOutline16?: ComponentType<DshIconProps>;
  IconEllipsisOutline16?: ComponentType<DshIconProps>;
  IconPlusOutline16?: ComponentType<DshIconProps>;
  IconCheckOutline16?: ComponentType<DshIconProps>;
  IconCheckOutline14?: ComponentType<DshIconProps>;
  IconCloseOutline16?: ComponentType<DshIconProps>;
  IconCopyOutline16?: ComponentType<DshIconProps>;
  IconRefreshOutline16?: ComponentType<DshIconProps>;
  IconEditOutline16?: ComponentType<DshIconProps>;
  IconLinkOutline16?: ComponentType<DshIconProps>;
  IconTrashOutline16?: ComponentType<DshIconProps>;
  IconWarningOutline16?: ComponentType<DshIconProps>;
  IconDownloadOutline16?: ComponentType<DshIconProps>;
  IconFullscreenOutline16?: ComponentType<DshIconProps>;
  IconCodeOutline16?: ComponentType<DshIconProps>;
  IconFolderOpenOutline16?: ComponentType<DshIconProps>;
  IconFolderClose16?: ComponentType<DshIconProps>;
  IconQuestionOutline14?: ComponentType<DshIconProps>;
  IconArchiveOutline20?: ComponentType<DshIconProps>;
  IconSparkle16?: ComponentType<DshIconProps>;
}

export type DivProps = HTMLAttributes<HTMLDivElement>;

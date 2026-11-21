import type { DshMenuShortcut } from '../types/dsh-primitives';

export function toMenuShortcut(parts: readonly string[]): DshMenuShortcut {
  const keys: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const token = parts[i];
    if (!token) continue;
    if (token.length > 1 && token.endsWith('+')) {
      keys.push(token.slice(0, -1), '+');
    } else {
      keys.push(token);
    }
  }
  return { keys, aria: parts.join('') };
}

export function buildShortcutRows(
  t: (key: string) => string,
  modKey: string,
  shiftKey: string,
  altKey: string,
): Array<[string, string]> {
  return [
    [modKey + 'Z', t('shortcuts.undo')],
    [modKey + shiftKey + 'Z' + ' / ' + modKey + 'Y', t('shortcuts.redo')],
    [modKey + shiftKey + 'B', t('shortcuts.bold')],
    [modKey + 'I', t('shortcuts.italic')],
    [modKey + 'K', t('shortcuts.link')],
    [modKey + 'E', t('shortcuts.code')],
    [modKey + shiftKey + 'X', t('shortcuts.strike')],
    [modKey + shiftKey + 'H', t('shortcuts.mark')],
    [modKey + '1–6', t('shortcuts.heading')],
    [modKey + shiftKey + '0', t('shortcuts.paragraph')],
    [modKey + 'U', t('shortcuts.underline')],
    [modKey + shiftKey + 'E', t('shortcuts.inlineMath')],
    [modKey + altKey + shiftKey + 'E', t('shortcuts.mathBlock')],
    [modKey + altKey + '4', t('shortcuts.task')],
    [modKey + altKey + 'C', t('shortcuts.codeBlock')],
    [modKey + altKey + '-', t('shortcuts.hr')],
    [modKey + altKey + 'T', t('shortcuts.table')],
    [modKey + altKey + 'P', t('shortcuts.image')],
    [modKey + altKey + 'V', t('shortcuts.scrollBox')],
    [modKey + altKey + 'X', t('shortcuts.scrollXBox')],
    [modKey + altKey + 'L', t('shortcuts.linkNotes')],
    [modKey + shiftKey + '7', t('shortcuts.numbered')],
    [modKey + shiftKey + '8', t('shortcuts.bullet')],
    [modKey + shiftKey + '9', t('shortcuts.quote')],
    [modKey + 'F', t('shortcuts.search')],
    [modKey + shiftKey + 'F', t('shortcuts.immersive')],
    [modKey + 'J', t('shortcuts.aiSkill')],
    [modKey + 'S', t('shortcuts.save')],
    [modKey + '↵', t('shortcuts.copy')],
    ['Tab', t('shortcuts.tab')],
    [shiftKey + 'Tab', t('shortcuts.outdent')],
    ['Esc → Tab', t('shortcuts.escapeTab')],
    [t('shortcuts.slashKey'), t('shortcuts.slash')],
  ];
}

export function buildSlashHelpRows(t: (key: string) => string): Array<[string, string]> {
  return [
    ['/h1 – /h6', t('slashHelp.headings')],
    ['/lead', t('slash.lead')],
    ['/tldr', t('slash.tldr')],
    ['/pull', t('slash.pull')],
    ['/meta', t('slash.meta')],
    ['/sign', t('slash.sign')],
    ['/alert', t('slash.alert')],
    ['/task', t('slash.task')],
    ['/code', t('slash.code')],
    ['/table', t('slash.table')],
    ['/scroll', t('slash.scroll')],
    ['/scroll-x', t('slash.scrollX')],
    ['/divider', t('slash.divider')],
  ];
}

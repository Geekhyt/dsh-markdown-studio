import type { Article, LibraryState } from './article';
import { parseView } from './article';
import { BACKUP_SCHEMA_VERSION, supportedSchemaVersion } from './schema';
import { sanitizeSettings } from './settings';
import { sanitizeWritingSkillState, type WritingSkillState } from './writing-skills';

export interface LibraryBackup {
  format: 'markdown-studio-library';
  version: 1;
  schemaVersion: number;
  exportedAt: string;
  activeId: string;
  docs: Article[];
  trash: Article[];
  writingSkills?: WritingSkillState;
}

export function createLibraryBackup(library: LibraryState, writingSkills?: WritingSkillState): LibraryBackup {
  return {
    format: 'markdown-studio-library',
    version: 1,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    activeId: library.activeId,
    ...(writingSkills ? { writingSkills: sanitizeWritingSkillState(writingSkills) } : {}),
    trash: (library.trash || []).map(function (entry) {
      return {
        id: entry.id,
        title: entry.title,
        markdown: entry.markdown,
        settings: entry.settings,
        view: entry.view,
        updatedAt: entry.updatedAt,
        deletedAt: entry.deletedAt,
      };
    }),
    docs: library.docs.map(function (entry) {
      return {
        id: entry.id,
        title: entry.title,
        markdown: entry.markdown,
        settings: entry.settings,
        view: entry.view,
        updatedAt: entry.updatedAt,
      };
    }),
  };
}

export type MergeDecision = 'current' | 'incoming';

export interface MergeConflict {
  id: string;
  title: string;
  currentTitle: string;
  incomingTitle: string;
}

/** Articles/trash entries that exist on both sides and need a per-id choice. */
export function mergeConflicts(current: LibraryState, incoming: LibraryState): MergeConflict[] {
  const currentAll = new Map<string, Article>();
  for (const entry of current.docs) currentAll.set(entry.id, entry);
  for (const entry of current.trash || []) {
    if (!currentAll.has(entry.id)) currentAll.set(entry.id, entry);
  }
  const seen = new Set<string>();
  const conflicts: MergeConflict[] = [];
  for (const entry of [...incoming.docs, ...(incoming.trash || [])]) {
    if (seen.has(entry.id) || !currentAll.has(entry.id)) continue;
    seen.add(entry.id);
    const existing = currentAll.get(entry.id)!;
    conflicts.push({
      id: entry.id,
      title: entry.title || existing.title,
      currentTitle: existing.title,
      incomingTitle: entry.title,
    });
  }
  return conflicts;
}

/** Merge an imported library into the current one. Per-id decisions win over the default. */
export function mergeLibraryBackup(
  current: LibraryState,
  incoming: LibraryState,
  prefer: MergeDecision = 'incoming',
  decisions: Record<string, MergeDecision> = {},
): LibraryState {
  const docs = new Map(current.docs.map((entry) => [entry.id, entry] as const));
  const trash = new Map((current.trash || []).map((entry) => [entry.id, entry] as const));
  const decisionFor = (id: string, exists: boolean): MergeDecision =>
    Object.hasOwn(decisions, id) ? decisions[id] : exists ? prefer : 'incoming';
  const incomingDocIds = new Set<string>();
  for (const entry of incoming.docs) {
    const exists = docs.has(entry.id) || trash.has(entry.id);
    const decision = decisionFor(entry.id, exists);
    if (decision === 'incoming' || !exists) {
      docs.set(entry.id, entry);
      trash.delete(entry.id);
      incomingDocIds.add(entry.id);
    }
  }
  for (const entry of incoming.trash || []) {
    if (incomingDocIds.has(entry.id)) continue;
    const exists = docs.has(entry.id) || trash.has(entry.id);
    const decision = decisionFor(entry.id, exists);
    if (decision === 'incoming' || !exists) {
      trash.set(entry.id, entry);
      docs.delete(entry.id);
    }
  }
  if (!docs.size) {
    const fallback = current.docs.find((entry) => entry.id === current.activeId) || current.docs[0] || incoming.docs[0];
    if (fallback) {
      docs.set(fallback.id, fallback);
      trash.delete(fallback.id);
    }
  }
  const nextDocs = Array.from(docs.values());
  const activeId = nextDocs.some((entry) => entry.id === current.activeId)
    ? current.activeId
    : nextDocs.some((entry) => entry.id === incoming.activeId)
      ? incoming.activeId
      : nextDocs[0]
        ? nextDocs[0].id
        : current.activeId;
  return { activeId, docs: nextDocs, trash: Array.from(trash.values()) };
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function parseBackupArticle(
  value: unknown,
  fallbackId: string,
  fallbackTitle: string,
  includeDeletedAt: boolean,
): Article | null {
  const record = recordOf(value);
  if (!record || typeof record.markdown !== 'string') return null;
  const article: Article = {
    id: typeof record.id === 'string' && record.id ? record.id : fallbackId,
    title: typeof record.title === 'string' && record.title ? record.title : fallbackTitle,
    markdown: record.markdown,
    settings: sanitizeSettings(record.settings),
    view: parseView(record.view),
    updatedAt: Number(record.updatedAt) || Date.now(),
  };
  if (includeDeletedAt) article.deletedAt = Number(record.deletedAt) || Date.now();
  return article;
}

export function parseLibraryBackup(input: unknown, fallbackTitle = '未命名'): LibraryState | null {
  const root = recordOf(input);
  if (!root || root.format !== 'markdown-studio-library' || root.version !== 1 || !Array.isArray(root.docs))
    return null;
  if (supportedSchemaVersion(root.schemaVersion, 1, BACKUP_SCHEMA_VERSION) === null) return null;
  const docs: Article[] = [];
  for (const value of root.docs) {
    const parsed = parseBackupArticle(
      value,
      'doc-' + docs.length + '-' + Date.now().toString(36),
      fallbackTitle,
      false,
    );
    if (parsed) docs.push(parsed);
  }
  if (!docs.length) return null;
  const trash: Article[] = [];
  if (Array.isArray(root.trash)) {
    for (const value of root.trash) {
      const parsed = parseBackupArticle(value, 'trash-' + trash.length, fallbackTitle, true);
      if (parsed) trash.push(parsed);
    }
  }
  const activeId =
    typeof root.activeId === 'string' &&
    docs.some(function (entry) {
      return entry.id === root.activeId;
    })
      ? root.activeId
      : docs[0].id;
  return { activeId, docs, trash };
}

export function extractBackupWritingSkills(input: unknown): WritingSkillState | null {
  const root = recordOf(input);
  if (!root || root.writingSkills === undefined) return null;
  return sanitizeWritingSkillState(root.writingSkills);
}

export function mergeWritingSkillStates(
  current: WritingSkillState,
  incoming: WritingSkillState,
  prefer: MergeDecision = 'incoming',
): WritingSkillState {
  const map = new Map(current.customSkills.map((item) => [item.id, item] as const));
  for (const item of incoming.customSkills) {
    if (!map.has(item.id) || prefer === 'incoming') map.set(item.id, item);
  }
  const activeSkillId = prefer === 'incoming' ? incoming.activeSkillId : current.activeSkillId;
  return sanitizeWritingSkillState({ activeSkillId, customSkills: Array.from(map.values()) });
}

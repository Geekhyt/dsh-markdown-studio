/**
 * Where the active article is backed. A document cannot be both a library
 * entry, a standalone file, and a folder file at the same time.
 */
export interface FileVersion {
  fingerprint: string;
  lastModified: number;
  size: number;
}

interface FileAssociation {
  /** Optional for handles saved by older plugin versions. */
  articleId?: string;
  version?: FileVersion;
}

export type DocumentRef =
  | { kind: 'library'; articleId: string }
  | ({ kind: 'file'; handle: FileSystemFileHandle } & FileAssociation)
  | ({ kind: 'folder'; directory: FileSystemDirectoryHandle; file: FileSystemFileHandle } & FileAssociation);

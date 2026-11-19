export interface WorkspaceFile {
  kind: 'file';
  name: string;
  path: string;
  handle: FileSystemFileHandle;
}

export interface WorkspaceDirectory {
  kind: 'directory';
  name: string;
  path: string;
  handle: FileSystemDirectoryHandle;
  children: WorkspaceEntry[];
}

export type WorkspaceEntry = WorkspaceFile | WorkspaceDirectory;

export interface WorkspaceState {
  open: boolean;
  loading: boolean;
  entries: WorkspaceEntry[];
  error: string;
  name: string;
  selectedDir: string;
}

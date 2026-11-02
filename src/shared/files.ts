export interface SourceFile {
  rootId: string;
  relativePath: string;
  role: "blend" | "psd" | "preview" | "render" | "dependency";
}
export interface FixedFile extends SourceFile {
  id: string;
  source: { rootId: string; relativePath: string };
  size: number;
  sha256: string;
}
export interface MissingDependency {
  source: { rootId: string; relativePath: string };
  reason: "not_found" | "cycle" | "outside_root" | "inspection_pending";
}
export interface ImportInput {
  requestKey: string;
  body: string;
  application: "Blender" | "Photoshop" | "Other";
  beforeStateId: string | null;
  reason?: string;
  render?: { stateId: string; fileId: string };
  files: SourceFile[];
}
export interface SavedState {
  id: string;
  workId: string;
  recordId: string;
  beforeStateId: string | null;
  changeKind: "import" | "manual";
  application: ImportInput["application"];
  reason: string | null;
  render: ImportInput["render"] | null;
  historyBeforeImport: "unknown" | "recorded";
  files: FixedFile[];
  missing: MissingDependency[];
  createdAt: string;
}
export interface ImportOperation {
  id: string;
  requestKey: string;
  workId: string;
  conversationId: string;
  stateId: string;
  input: ImportInput;
  phase: "planned" | "incomplete" | "reconciling" | "committed" | "abandoned";
  error: string | null;
  createdAt: string;
}
export interface FileRoots {
  sources: { id: string; path: string }[];
  managed: { id: string; path: string };
}

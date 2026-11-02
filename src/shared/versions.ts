export interface GitReference {
  repositoryId: string;
  objectFormat: "sha1" | "sha256";
  commit: string;
  tree: string;
  tag: string;
  manifest: string;
  files: { path: string; blob: string }[];
}
export interface DefinitionManifest {
  schema: "scene-craft.definition.v1";
  runtime: "scene-craft.v1";
  roles: {
    id: string;
    description: string;
    instructions: string[];
    procedures: string[];
    code: string[];
    context: string[];
    tools: string[];
    operations: string[];
    outputs: string[];
  }[];
  style: { required: boolean; formats: string[] };
}
export interface StyleManifest {
  schema: "scene-craft.style.v1";
  tendencies: string[];
  policies: string[];
}
export interface VersionStatus {
  definition: GitReference | null;
  style: GitReference | null;
  availability: { available: boolean; reason: string | null };
  remote: "unverified";
}
export interface VersionPlan {
  id: string;
  workId: string;
  definition: GitReference;
  style: GitReference | null;
  createdAt: string;
}

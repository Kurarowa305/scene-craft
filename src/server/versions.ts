import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { OperationError } from "./store.js";
import type {
  DefinitionManifest,
  GitReference,
  StyleManifest,
  VersionStatus,
} from "../shared/versions.js";

const fail = (code: string): never => {
  throw new OperationError(409, code);
};
const pathValid = (path: string) =>
  /^[a-zA-Z0-9_.\/-]+$/.test(path) &&
  path
    .split("/")
    .every((part) => part && part !== "." && part !== ".." && part !== ".git");
const strings = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.every((item) => typeof item === "string" && item.length > 0);

/** Only committed blobs enter the export. This module never launches their code. */
export function gitVersions(repository: string, directory: string) {
  // Ignore caller-supplied Git routing, replacement objects, and implicit network fetches.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
  );
  Object.assign(env, {
    GIT_NO_LAZY_FETCH: "1",
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
  });
  function git(...args: string[]): Buffer {
    try {
      return execFileSync(
        "git",
        ["--no-replace-objects", "-C", repository, ...args],
        {
          env,
          stdio: ["ignore", "pipe", "pipe"],
          maxBuffer: 16 * 1024 * 1024,
          timeout: 15000,
        },
      );
    } catch {
      return fail("GIT_CONTENT_UNAVAILABLE");
    }
  }
  const value = (...args: string[]) =>
    git(...args)
      .toString("utf8")
      .trim();
  // Older installed Git versions do not honor GIT_NO_LAZY_FETCH. Reject promisor
  // repositories before object reads, so selection cannot initiate a network fetch.
  const partial = spawnSync(
    "git",
    [
      "-C",
      repository,
      "config",
      "--includes",
      "--get-regexp",
      "^(extensions\\.partialclone|remote\\..*\\.(promisor|partialclonefilter))$",
    ],
    { env, stdio: "pipe", timeout: 15000 },
  );
  if (partial.status === 0) fail("GIT_INCOMPLETE_HISTORY");
  if (partial.status !== 1) fail("GIT_CONTENT_UNAVAILABLE");
  const common = value(
    "rev-parse",
    "--path-format=absolute",
    "--git-common-dir",
  );
  const identityPath = join(common, "scene-craft-repository-id");
  try {
    writeFileSync(identityPath, randomUUID(), { flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const repositoryId = readFileSync(identityPath, "utf8").trim();
  if (!/^[a-f0-9-]{36}$/.test(repositoryId)) fail("GIT_REPOSITORY_ID_INVALID");
  const objectFormat = value("rev-parse", "--show-object-format");
  if (objectFormat !== "sha1" && objectFormat !== "sha256")
    fail("GIT_FORMAT_UNSUPPORTED");
  function object(type: "commit" | "tree" | "blob", id: string) {
    const data = git("cat-file", type, id);
    const actual = createHash(objectFormat)
      .update(`${type} ${data.length}\0`)
      .update(data)
      .digest("hex");
    if (actual !== id) fail("GIT_CONTENT_MISMATCH");
    return data;
  }

  function inspect(commit: string, kind: "definition" | "style") {
    if (
      !new RegExp(`^[a-f0-9]{${objectFormat === "sha1" ? 40 : 64}}$`).test(
        commit,
      )
    )
      fail("GIT_FULL_COMMIT_REQUIRED");
    if (value("cat-file", "-t", commit) !== "commit")
      fail("GIT_COMMIT_REQUIRED");
    object("commit", commit);
    if (value("rev-parse", "--is-shallow-repository") !== "false")
      fail("GIT_INCOMPLETE_HISTORY");
    // Traverse ancestors too; a partial clone cannot silently fetch missing objects.
    git("rev-list", "--objects", "--missing=error", commit);
    const tree = value("rev-parse", `${commit}^{tree}`);
    object("tree", tree);
    const entries = new Map(
      git("ls-tree", "-rtz", "--full-tree", commit)
        .toString("utf8")
        .split("\0")
        .filter(Boolean)
        .map((line) => {
          const split = line.indexOf("\t");
          return [
            line.slice(split + 1),
            line.slice(0, split).split(" "),
          ] as const;
        }),
    );
    for (const entry of entries.values())
      if (entry[1] === "tree") object("tree", entry[2]);
    function blob(path: string) {
      if (!pathValid(path)) fail("GIT_PATH_INVALID");
      const entry = entries.get(path);
      if (
        !entry ||
        !["100644", "100755"].includes(entry[0]) ||
        entry[1] !== "blob"
      )
        fail("GIT_DEPENDENCY_UNRESOLVED");
      const data = object("blob", entry![2]);
      if (
        data
          .subarray(0, 80)
          .toString()
          .startsWith("version https://git-lfs.github.com/spec/v1")
      )
        fail("GIT_DEPENDENCY_UNRESOLVED");
      return { path, blob: entry![2], data };
    }
    const manifestPath = `${kind}.json`;
    const manifestFile = blob(manifestPath);
    let manifest: DefinitionManifest | StyleManifest;
    try {
      manifest = JSON.parse(manifestFile.data.toString("utf8"));
    } catch {
      return fail("GIT_MANIFEST_INVALID");
    }
    let paths: string[] = [];
    if (kind === "definition") {
      const m = manifest as DefinitionManifest;
      if (
        m?.schema !== "scene-craft.definition.v1" ||
        m.runtime !== "scene-craft.v1"
      )
        fail("GIT_RUNTIME_INCOMPATIBLE");
      if (
        !m.style ||
        typeof m.style.required !== "boolean" ||
        !strings(m.style.formats) ||
        m.style.formats.some((f) => f !== "scene-craft.style.v1") ||
        !Array.isArray(m.roles) ||
        !m.roles.length
      )
        fail("GIT_MANIFEST_INVALID");
      const ids = new Set<string>();
      for (const role of m.roles) {
        if (
          !role ||
          typeof role.id !== "string" ||
          !/^[a-z][a-z0-9-]*$/.test(role.id) ||
          ids.has(role.id) ||
          typeof role.description !== "string" ||
          !role.description.trim()
        )
          fail("GIT_MANIFEST_INVALID");
        ids.add(role.id);
        for (const field of [
          "instructions",
          "procedures",
          "code",
          "context",
          "tools",
          "operations",
          "outputs",
        ] as const)
          if (!strings(role[field])) fail("GIT_MANIFEST_INVALID");
        if (!role.instructions.length || !role.outputs.length)
          fail("GIT_MANIFEST_INVALID");
        // v1 exposes no production tools yet. Future runtime adapters extend this allowlist.
        if (
          role.context.some(
            (c) => !["work.intent", "work.history", "work.style"].includes(c),
          ) ||
          role.outputs.some((o) => o !== "text") ||
          role.tools.length ||
          role.operations.length
        )
          fail("GIT_TOOL_CONTRACT_INCOMPATIBLE");
        paths.push(...role.instructions, ...role.procedures, ...role.code);
      }
    } else {
      const m = manifest as StyleManifest;
      if (
        m?.schema !== "scene-craft.style.v1" ||
        !strings(m.tendencies) ||
        !strings(m.policies)
      )
        fail("GIT_STYLE_INCOMPATIBLE");
    }
    const files = [
      manifestFile,
      ...[...new Set(paths)].filter((p) => p !== manifestPath).map(blob),
    ];
    const reference: GitReference = {
      repositoryId,
      objectFormat: objectFormat as "sha1" | "sha256",
      commit,
      tree,
      tag: `refs/tags/scene-craft/retained/${commit}`,
      manifest: manifestPath,
      files: files.map(({ path, blob }) => ({ path, blob })),
    };
    return { reference, manifest, files };
  }
  function tag(reference: GitReference, create: boolean) {
    // for-each-ref omits dangling symbolic refs; check them before create-only update.
    const symbolic = spawnSync(
      "git",
      [
        "--no-replace-objects",
        "-C",
        repository,
        "symbolic-ref",
        "-q",
        reference.tag,
      ],
      { env, stdio: "pipe", timeout: 15000 },
    );
    if (symbolic.status === 0) fail("GIT_TAG_CONFLICT");
    if (symbolic.status !== 1) fail("GIT_CONTENT_UNAVAILABLE");
    const refs = git(
      "for-each-ref",
      "--format=%(refname) %(objectname) %(symref)",
      reference.tag,
    )
      .toString()
      .split("\n");
    const existing = refs.find((line) => line.startsWith(reference.tag + " "));
    if (existing) {
      const [, target, symbolic] = existing.split(" ");
      if (target !== reference.commit || symbolic) fail("GIT_TAG_CONFLICT");
    } else if (create) {
      // Atomic create-only, no dereferencing; never move or delete existing tags.
      git(
        "update-ref",
        "--no-deref",
        reference.tag,
        reference.commit,
        "0".repeat(reference.commit.length),
      );
    } else fail("GIT_TAG_MISSING");
    // Also catches races and symbolic refs omitted by for-each-ref.
    const line = git(
      "for-each-ref",
      "--format=%(refname) %(objectname) %(symref)",
      reference.tag,
    )
      .toString()
      .split("\n")
      .find((l) => l.startsWith(reference.tag + " "));
    if (line !== `${reference.tag} ${reference.commit} `)
      fail("GIT_TAG_CONFLICT");
  }
  function check(reference: GitReference, kind: "definition" | "style") {
    if (reference.repositoryId !== repositoryId)
      fail("GIT_REPOSITORY_MISMATCH");
    const result = inspect(reference.commit, kind);
    if (JSON.stringify(result.reference) !== JSON.stringify(reference))
      fail("GIT_CONTENT_MISMATCH");
    tag(reference, false);
    return result;
  }
  return {
    repositoryId,
    prepare(definition: GitReference | null, style: GitReference | null) {
      const status = this.status(definition, style);
      if (!status.availability.available) fail(status.availability.reason!);
      this.materialize(definition!, "definition");
      if (style) this.materialize(style, "style");
      return { definition: definition!, style };
    },
    content(
      reference: GitReference,
      kind: "definition" | "style",
      path: string,
    ) {
      const result = check(reference, kind);
      const file = result.files.find((file) => file.path === path);
      if (!file) fail("GIT_PATH_NOT_DECLARED");
      return { path, blob: file!.blob, content: file!.data.toString("utf8") };
    },
    select(commit: string, kind: "definition" | "style") {
      const result = inspect(commit, kind);
      tag(result.reference, true);
      return result.reference;
    },
    status(
      definition: GitReference | null,
      style: GitReference | null,
    ): VersionStatus {
      try {
        const d = definition ? check(definition, "definition") : null;
        const s = style ? check(style, "style") : null;
        if (!d) fail("GIT_DEFINITION_NOT_SELECTED");
        const required = (d!.manifest as DefinitionManifest).style;
        if (
          (!s && required.required) ||
          (s && !required.formats.includes(s.manifest.schema))
        )
          fail("GIT_STYLE_INCOMPATIBLE");
        return {
          definition,
          style,
          availability: { available: true, reason: null },
          remote: "unverified",
        };
      } catch (error) {
        return {
          definition,
          style,
          availability: {
            available: false,
            reason:
              error instanceof OperationError
                ? error.code
                : "GIT_CONTENT_UNAVAILABLE",
          },
          remote: "unverified",
        };
      }
    },
    materialize(reference: GitReference, kind: "definition" | "style") {
      const result = check(reference, kind);
      const root = join(directory, "git-exports");
      mkdirSync(root, { recursive: true, mode: 0o700 });
      const destination = mkdtempSync(join(root, `${kind}-`));
      const directories = new Set([destination]);
      for (const file of result.files) {
        const target = join(destination, file.path);
        mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
        writeFileSync(target, file.data, { flag: "wx", mode: 0o400 });
        let parent = dirname(target);
        while (parent !== destination) {
          directories.add(parent);
          parent = dirname(parent);
        }
      }
      for (const path of directories) chmodSync(path, 0o500);
      return destination;
    },
  };
}

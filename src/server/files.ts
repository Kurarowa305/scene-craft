import { constants } from "node:fs";
import {
  open,
  mkdir,
  realpath,
  rename,
  readFile,
  stat,
} from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { join, relative, resolve, extname, isAbsolute } from "node:path";
import type {
  FileRoots,
  SourceFile,
  FixedFile,
  MissingDependency,
  ImportOperation,
  SavedState,
} from "../shared/files.js";
import { OperationError, openStore } from "./store.js";

export function validateFileRoots(value: FileRoots) {
  if (
    !value ||
    !Array.isArray(value.sources) ||
    !value.sources.length ||
    value.sources.length > 100 ||
    !value.managed
  )
    throw new Error("INVALID_FILE_ROOTS");
  const ids = new Set<string>();
  for (const root of [...value.sources, value.managed]) {
    if (
      !root ||
      typeof root.id !== "string" ||
      !/^[a-zA-Z0-9_-]{1,100}$/.test(root.id) ||
      ids.has(root.id) ||
      typeof root.path !== "string" ||
      !isAbsolute(root.path)
    )
      throw new Error("INVALID_FILE_ROOTS");
    ids.add(root.id);
  }
}
export interface DependencyInspection {
  dependencies: Pick<SourceFile, "rootId" | "relativePath">[];
  verified: boolean;
  observedInputs?: {
    source: Pick<SourceFile, "rootId" | "relativePath">;
    size: number;
    sha256: string;
  }[];
}
/** Future Blender content inspector plugs in here; declarations alone never verify a blend. */
export type DependencyInspector = (
  source: SourceFile,
  absolutePath: string,
) => Promise<DependencyInspection>;
const inside = (root: string, path: string) => {
  const tail = relative(root, path);
  return (
    tail !== "" && tail !== ".." && !tail.startsWith("../") && !isAbsolute(tail)
  );
};
export async function resolveSource(
  roots: FileRoots,
  source: Pick<SourceFile, "rootId" | "relativePath">,
) {
  const root = roots.sources.find((item) => item.id === source.rootId);
  if (!root) throw new OperationError(400, "UNKNOWN_ROOT");
  if (
    !source.relativePath ||
    source.relativePath.includes("\\") ||
    source.relativePath.includes(":") ||
    source.relativePath.includes("\0") ||
    source.relativePath
      .split("/")
      .some((part) => part === ".." || part === "." || !part)
  )
    throw new OperationError(400, "OUTSIDE_ROOT");
  const base = await realpath(root.path);
  const path = await realpath(resolve(base, source.relativePath));
  if (!inside(base, path)) throw new OperationError(400, "OUTSIDE_ROOT");
  const managed = await realpath(roots.managed.path);
  if (path === managed || inside(managed, path))
    throw new OperationError(400, "FIXED_SOURCE");
  return path;
}
const same = (
  a: Awaited<ReturnType<typeof stat>>,
  b: Awaited<ReturnType<typeof stat>>,
) =>
  a.dev === b.dev &&
  a.ino === b.ino &&
  a.size === b.size &&
  a.mtimeMs === b.mtimeMs &&
  a.ctimeMs === b.ctimeMs;
async function hashFile(path: string) {
  const file = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const before = await file.stat();
    if (!before.isFile()) throw new OperationError(400, "NOT_A_FILE");
    const hash = createHash("sha256");
    for await (const chunk of file.createReadStream({ autoClose: false }))
      hash.update(chunk);
    if (!same(before, await file.stat()))
      throw new OperationError(409, "SOURCE_CHANGED");
    return { size: before.size, sha256: hash.digest("hex") };
  } finally {
    await file.close();
  }
}
async function copyVerified(source: string, target: string) {
  const input = await open(
    source,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  let output: Awaited<ReturnType<typeof open>> | undefined;
  try {
    output = await open(target, "wx", 0o400);
    const before = await input.stat();
    if (!before.isFile()) throw new OperationError(400, "NOT_A_FILE");
    const hash = createHash("sha256");
    for await (const chunk of input.createReadStream({ autoClose: false })) {
      hash.update(chunk);
      await output.writeFile(chunk);
    }
    await output.sync();
    if (!same(before, await input.stat()) || !same(before, await stat(source)))
      throw new OperationError(409, "SOURCE_CHANGED");
    const result = { size: before.size, sha256: hash.digest("hex") };
    const reread = await hashFile(source);
    const copied = await hashFile(target);
    if (
      JSON.stringify(result) !== JSON.stringify(reread) ||
      JSON.stringify(result) !== JSON.stringify(copied)
    )
      throw new OperationError(409, "SOURCE_CHANGED");
    return result;
  } finally {
    await input.close();
    await output?.close();
  }
}
/** Explicit optional dependency declarations; never executes code from imported files. */
const declaredDependencies =
  (roots: FileRoots): DependencyInspector =>
  async (source) => {
    try {
      const manifestSource = {
        rootId: source.rootId,
        relativePath: source.relativePath + ".scene-craft-dependencies.json",
      };
      const manifest = await resolveSource(roots, manifestSource);
      if ((await stat(manifest)).size > 1024 * 1024) throw new Error();
      const content = await readFile(manifest);
      const digest = {
        size: content.length,
        sha256: createHash("sha256").update(content).digest("hex"),
      };
      const current = await hashFile(manifest);
      if (current.size !== digest.size || current.sha256 !== digest.sha256)
        throw new OperationError(409, "SOURCE_CHANGED");
      const items: unknown = JSON.parse(
        content.toString("utf8").replace(/^\uFEFF/, ""),
      );
      if (
        !Array.isArray(items) ||
        items.length > 10000 ||
        items.some(
          (item) =>
            !item ||
            typeof item.rootId !== "string" ||
            typeof item.relativePath !== "string",
        )
      )
        throw new Error();
      return {
        dependencies: items,
        verified: false,
        observedInputs: [{ source: manifestSource, ...digest }],
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return { dependencies: [], verified: false };
      if (error instanceof OperationError && error.code === "SOURCE_CHANGED")
        throw error;
      throw new OperationError(400, "INVALID_DEPENDENCY_MANIFEST");
    }
  };

export function fileService(
  store: ReturnType<typeof openStore>,
  roots: FileRoots,
  inspector: DependencyInspector = declaredDependencies(roots),
  publish: typeof rename = rename,
) {
  // Serializes both same-key retries and competing publications within this process.
  let queue = Promise.resolve();
  async function managedDirectory() {
    await mkdir(roots.managed.path, { recursive: true, mode: 0o700 });
    return realpath(roots.managed.path);
  }
  async function checkedPath(base: string, path: string) {
    const actual = await realpath(path);
    if (!inside(base, actual))
      throw new OperationError(409, "MANAGED_PATH_INVALID");
    return actual;
  }
  async function validateCompletion(
    op: ImportOperation,
    base: string,
    completed: string,
  ): Promise<SavedState> {
    await checkedPath(base, completed);
    const marker = join(completed, "complete.json");
    await checkedPath(base, marker);
    const content = await readFile(marker, "utf8");
    const expectedHash = store.operation(op.id).completionHash;
    if (
      !expectedHash ||
      createHash("sha256").update(content).digest("hex") !== expectedHash
    )
      throw new OperationError(409, "COMPLETION_MISMATCH");
    const manifest = JSON.parse(content) as {
      version: number;
      operationId: string;
      state: SavedState;
    };
    const state = manifest.state;
    if (
      manifest.version !== 1 ||
      manifest.operationId !== op.id ||
      state.id !== op.stateId ||
      state.workId !== op.workId ||
      state.beforeStateId !== op.input.beforeStateId ||
      !state.files.length
    )
      throw new OperationError(409, "COMPLETION_MISMATCH");
    const before = op.input.beforeStateId
      ? store.state(op.input.beforeStateId)
      : null;
    for (const source of op.input.files) {
      if (
        !state.files.some(
          (file) =>
            file.source.rootId === source.rootId &&
            file.source.relativePath === source.relativePath &&
            file.role === source.role &&
            file.relativePath.startsWith(op.id + "/"),
        )
      )
        throw new OperationError(409, "COMPLETION_MISMATCH");
    }
    for (const file of state.files) {
      if (
        !file.relativePath.startsWith(op.id + "/") &&
        !before?.files.some(
          (previous) => JSON.stringify(previous) === JSON.stringify(file),
        )
      )
        throw new OperationError(409, "COMPLETION_MISMATCH");
      if (
        file.rootId !== roots.managed.id ||
        !/^[a-f0-9-]+\/[a-f0-9-]+\.[a-z0-9]+$/.test(file.relativePath) ||
        !file.relativePath.endsWith(`/${file.id}${extname(file.relativePath)}`)
      )
        throw new OperationError(409, "COMPLETION_MISMATCH");
      const path = await checkedPath(base, join(base, file.relativePath));
      const actual = await hashFile(path);
      if (actual.size !== file.size || actual.sha256 !== file.sha256)
        throw new OperationError(409, "FIXED_FILE_CORRUPT");
    }
    return state;
  }
  async function run(conversationId: string, input: ImportOperation["input"]) {
    const base = await managedDirectory();
    const op = store.planImport(conversationId, input);
    if (op.phase === "abandoned")
      throw new OperationError(409, "IMPORT_ABANDONED");
    if (op.phase === "committed") return store.importResult(op.id);
    const completed = join(base, op.id);
    try {
      let exists = false;
      try {
        await stat(completed);
        exists = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      let state: SavedState;
      if (exists) {
        store.markImport(op.id, "reconciling", null);
        state = await validateCompletion(op, base, completed);
      } else {
        // Each attempt uses a fresh area. Incomplete evidence is retained, never reused as success.
        const temporary = join(base, `.pending-${op.id}-${randomUUID()}`);
        await mkdir(temporary, { mode: 0o700 });
        await checkedPath(base, temporary);
        const files: FixedFile[] = [];
        const missing: MissingDependency[] = [];
        const canonicalStack = new Set<string>();
        const seen = new Map<string, "visiting" | "done">();
        const fingerprints: {
          source: SourceFile;
          path: string;
          size: number;
          sha256: string;
        }[] = [];
        async function collect(source: SourceFile, required: boolean) {
          const signature = JSON.stringify([
            source.rootId,
            source.relativePath,
          ]);
          if (seen.get(signature) === "visiting") {
            missing.push({ source, reason: "cycle" });
            return;
          }
          if (seen.has(signature)) return;
          let path: string;
          try {
            path = await resolveSource(roots, source);
          } catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            if (!required && (code === "ENOENT" || code === "OUTSIDE_ROOT")) {
              missing.push({
                source,
                reason: code === "ENOENT" ? "not_found" : "outside_root",
              });
              return;
            }
            throw error;
          }
          if (canonicalStack.has(path)) {
            missing.push({ source, reason: "cycle" });
            return;
          }
          canonicalStack.add(path);
          seen.set(signature, "visiting");
          if (seen.size > 10000)
            throw new OperationError(400, "TOO_MANY_DEPENDENCIES");
          const extension = extname(path).toLowerCase();
          const id = randomUUID();
          const suffix = /^[.][a-z0-9]+$/.test(extension) ? extension : ".bin";
          const digest = await copyVerified(path, join(temporary, id + suffix));
          const primary = input.files.find(
            (file) =>
              file.rootId === source.rootId &&
              file.relativePath === source.relativePath,
          );
          files.push({
            ...source,
            role: primary?.role ?? source.role,
            id,
            rootId: roots.managed.id,
            relativePath: `${op.id}/${id}${suffix}`,
            source: {
              rootId: source.rootId,
              relativePath: source.relativePath,
            },
            ...digest,
          });
          fingerprints.push({ source, path, ...digest });
          const inspection = await inspector(source, path);
          for (const observed of inspection.observedInputs ?? []) {
            const path = await resolveSource(roots, observed.source);
            fingerprints.push({
              source: { ...observed.source, role: "dependency" },
              path,
              size: observed.size,
              sha256: observed.sha256,
            });
          }
          if (
            [".blend", ".psd", ".psb"].includes(extension) &&
            !inspection.verified
          )
            missing.push({ source, reason: "inspection_pending" });
          for (const dependency of inspection.dependencies)
            await collect({ ...dependency, role: "dependency" }, false);
          canonicalStack.delete(path);
          seen.set(signature, "done");
        }
        for (const source of input.files) await collect(source, true);
        // A file may change while another dependency is copied. Recheck the whole set.
        for (const entry of fingerprints) {
          const resolved = await resolveSource(roots, entry.source);
          const actual = await hashFile(resolved);
          if (
            resolved !== entry.path ||
            actual.size !== entry.size ||
            actual.sha256 !== entry.sha256
          )
            throw new OperationError(409, "SOURCE_CHANGED");
        }
        const before = input.beforeStateId
          ? store.state(input.beforeStateId)
          : null;
        // Replacing one application file does not pretend to update the other application's files.
        const roles = new Set(input.files.map((file) => file.role));
        const inherited =
          before?.files.filter((file) => !roles.has(file.role)) ?? [];
        state = {
          id: op.stateId,
          workId: op.workId,
          recordId: randomUUID(),
          beforeStateId: input.beforeStateId,
          changeKind: before ? "manual" : "import",
          application: input.application,
          reason: input.reason ?? null,
          render: input.render ?? before?.render ?? null,
          historyBeforeImport: before ? "recorded" : "unknown",
          files: [...files, ...inherited],
          // Unresolved shortages remain until an explicit verified reinspection resolves them.
          missing: [...missing, ...(before?.missing ?? [])],
          createdAt: op.createdAt,
        };
        const completion = JSON.stringify({
          version: 1,
          operationId: op.id,
          state,
        });
        store.sealImport(
          op.id,
          createHash("sha256").update(completion).digest("hex"),
        );
        const marker = await open(
          join(temporary, "complete.json"),
          "wx",
          0o400,
        );
        try {
          await marker.writeFile(completion);
          await marker.sync();
        } finally {
          await marker.close();
        }
        await publish(temporary, completed);
        store.markImport(op.id, "reconciling", null);
        state = await validateCompletion(op, base, completed);
      }
      store.commitImport(op.id, state);
      return store.importResult(op.id);
    } catch (error) {
      let phase: ImportOperation["phase"] = "incomplete";
      try {
        await stat(completed);
        phase = "reconciling";
      } catch {}
      try {
        store.markImport(
          op.id,
          phase,
          error instanceof OperationError ? error.code : "COPY_OR_SAVE_FAILED",
        );
      } catch {}
      throw error;
    }
  }
  return {
    import: (conversationId: string, input: ImportOperation["input"]) => {
      const next = queue.then(() => run(conversationId, input));
      queue = next.then(
        () => {},
        () => {},
      );
      return next;
    },
    abandon: (key: string, id: string) => {
      const next = queue.then(async () => {
        const base = await managedDirectory();
        try {
          await stat(join(base, id));
          throw new OperationError(409, "RECONCILIATION_REQUIRED");
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        return store.abandonImport(key, id);
      });
      queue = next.then(
        () => {},
        () => {},
      );
      return next;
    },
    download: async (state: SavedState, id: string) => {
      const file = state.files.find((item) => item.id === id);
      if (!file) throw new OperationError(404, "FILE_NOT_FOUND");
      const base = await managedDirectory();
      const path = await checkedPath(base, join(base, file.relativePath));
      const digest = await hashFile(path);
      if (digest.size !== file.size || digest.sha256 !== file.sha256)
        throw new OperationError(409, "FIXED_FILE_CORRUPT");
      return { path, file };
    },
  };
}

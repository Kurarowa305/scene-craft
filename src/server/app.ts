import Fastify, { type FastifyError } from "fastify";
import staticFiles from "@fastify/static";
import { randomBytes, createHmac } from "node:crypto";
import { createReadStream } from "node:fs";
import type { FileRoots, ImportInput } from "../shared/files.js";
import {
  fileService,
  validateFileRoots,
  type DependencyInspector,
} from "./files.js";
import { mkdir, open } from "node:fs/promises";
import { openStore, OperationError } from "./store.js";
import { gitVersions } from "./versions.js";
import { registerChat } from "./chat.js";
import { connectCodex, type CodexConnection } from "./codex.js";
import { text, bodySchema, idParams } from "./http-schema.js";
import { startContextRpc } from "./context-rpc.js";
import type { DefinitionManifest } from "../shared/versions.js";

interface AppOptions {
  directory: string;
  gitRepository?: string;
  codex?: CodexConnection;
  codexBinary?: string;
  fileRoots?: FileRoots;
  dependencyInspector?: DependencyInspector;
  publishFiles?: typeof import("node:fs/promises").rename;
  port: number;
  staticRoot?: string;
  instanceSecret?: string;
  onShutdown?: () => void;
}

export async function createApp(options: AppOptions) {
  if (options.fileRoots) validateFileRoots(options.fileRoots);
  await mkdir(options.directory, { recursive: true, mode: 0o700 });
  const store = openStore(options.directory);
  function versions() {
    if (!options.gitRepository)
      throw new OperationError(409, "GIT_NOT_CONFIGURED");
    return gitVersions(options.gitRepository, options.directory);
  }
  const app = Fastify({
    logger: false,
    bodyLimit: 1024 * 1024,
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false } },
  });
  const files = options.fileRoots
    ? fileService(
        store,
        options.fileRoots,
        options.dependencyInspector,
        options.publishFiles,
      )
    : null;
  const origin = `http://localhost:${options.port}`;
  const csrfToken = randomBytes(32).toString("hex");
  const session = randomBytes(32).toString("hex");
  let codexPromise: Promise<CodexConnection> | undefined;
  const contextRpc = await startContextRpc(store);
  function definition(plan: {
    definition: import("../shared/versions.js").GitReference;
  }) {
    return JSON.parse(
      versions().content(
        plan.definition,
        "definition",
        plan.definition.manifest,
      ).content,
    ) as DefinitionManifest;
  }
  registerChat(
    app,
    store,
    async () => {
      if (options.codex) return options.codex;
      if (!options.codexBinary)
        throw new OperationError(409, "CODEX_NOT_CONFIGURED");
      if (codexPromise) {
        const previous = await codexPromise;
        if (previous.available === false) {
          await previous.close();
          codexPromise = undefined;
        }
      }
      codexPromise ??= connectCodex(
        options.codexBinary,
        options.directory,
        contextRpc.endpoint,
      ).catch((error) => {
        codexPromise = undefined;
        throw error;
      });
      return codexPromise;
    },
    (workId) =>
      versions().prepare(
        store.defaultDefinition(),
        store.workVersions(workId).style,
      ),
    (plan) => {
      versions().prepare(plan.definition, plan.style);
    },
    contextRpc,
    (workId, plan, role) => {
      const manifest = definition(plan);
      const selected = manifest.roles.find((r) => r.id === role);
      if (role !== "none" && !selected)
        throw new OperationError(409, "ROLE_UNAVAILABLE");
      const instructions = selected
        ? [...selected.instructions, ...selected.procedures]
            .map(
              (path) =>
                versions().content(plan.definition, "definition", path).content,
            )
            .join("\n")
        : "相談と明示した記録更新だけを行う。制作操作を開始しない。";
      return {
        snapshot: {
          ...store.context.context(workId),
          states: store.states(workId),
          plan,
        },
        instructions,
      };
    },
  );
  app.get("/api/roles", async () => {
    const ref = store.defaultDefinition();
    return ref
      ? definition({ definition: ref }).roles.map((r) => ({
          id: r.id,
          description: r.description,
        }))
      : [];
  });
  app.get<{ Params: { id: string } }>(
    "/api/works/:id/context",
    { schema: { params: idParams } },
    async (request) => store.context.context(request.params.id),
  );
  app.get<{ Params: { id: string } }>(
    "/api/works/:id/record-history",
    { schema: { params: idParams } },
    async (request) => store.context.history(request.params.id),
  );
  app.addHook("onClose", async () => {
    await contextRpc.close();
    store.close();
  });
  app.addHook("onRequest", async (request, reply) => {
    reply.headers({
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "x-frame-options": "DENY",
      "content-security-policy":
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    });
    if (
      request.headers.host !== `localhost:${options.port}` ||
      (request.headers.origin !== undefined &&
        request.headers.origin !== origin) ||
      request.headers["sec-fetch-site"] === "cross-site"
    ) {
      return reply.code(403).send({ error: "INVALID_ORIGIN" });
    }
    if (!["GET", "HEAD"].includes(request.method)) {
      const cookies = (request.headers.cookie ?? "")
        .split(";")
        .map((value) => value.trim());
      if (
        request.headers.origin !== origin ||
        request.headers["x-csrf-token"] !== csrfToken ||
        !cookies.includes(`scene_craft_session=${session}`)
      ) {
        return reply.code(403).send({ error: "INVALID_SESSION" });
      }
      if (request.headers["content-type"]?.split(";")[0] !== "application/json")
        return reply.code(415).send({ error: "JSON_REQUIRED" });
    }
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof OperationError)
      return reply.code(error.statusCode).send({ error: error.code });
    const failure = error as FastifyError;
    if (failure.validation || (failure.statusCode && failure.statusCode < 500))
      return reply
        .code(failure.statusCode ?? 400)
        .send({ error: "INVALID_INPUT" });
    // SQLite/OS exceptions may contain user paths or content. Never return or log them.
    return reply.code(500).send({ error: "SAVE_FAILED" });
  });
  app.get("/api/session", async (_request, reply) => {
    reply.header(
      "set-cookie",
      `scene_craft_session=${session}; HttpOnly; SameSite=Strict; Path=/`,
    );
    return { csrfToken };
  });
  if (options.instanceSecret)
    app.get("/api/instance", async (request, reply) => {
      const challenge = request.headers["x-scene-craft-challenge"];
      if (typeof challenge !== "string" || !/^[a-f0-9]{64}$/.test(challenge))
        return reply.code(400).send({ error: "INVALID_CHALLENGE" });
      return {
        app: "scene-craft",
        proof: createHmac("sha256", options.instanceSecret!)
          .update(challenge)
          .digest("hex"),
      };
    });
  app.get("/api/works", async () => store.works());
  const commitSchema = {
    type: "string",
    pattern: "^([a-f0-9]{40}|[a-f0-9]{64})$",
  };
  app.get("/api/versions", async () => {
    const definition = store.defaultDefinition();
    try {
      return {
        configured: Boolean(options.gitRepository),
        ...versions().status(definition, null),
      };
    } catch {
      return {
        configured: Boolean(options.gitRepository),
        definition,
        style: null,
        availability: { available: false, reason: "GIT_CONTENT_UNAVAILABLE" },
        remote: "unverified",
      };
    }
  });
  app.post<{ Body: { requestKey: string; commit: string } }>(
    "/api/versions/default",
    {
      schema: { body: bodySchema({ commit: commitSchema }, ["commit"]) },
    },
    async (request) =>
      store.selectDefault(request.body.requestKey, request.body.commit, () => {
        const service = versions();
        const reference = service.select(request.body.commit, "definition");
        service.materialize(reference, "definition");
        return reference;
      }),
  );
  app.get<{ Params: { id: string } }>(
    "/api/works/:id/versions",
    { schema: { params: idParams } },
    async (request) => {
      const refs = store.workVersions(request.params.id);
      // This is the preview for a NEW request: current explicit default + fixed work style.
      const definition = store.defaultDefinition();
      try {
        return versions().status(definition, refs.style);
      } catch {
        return {
          definition,
          style: refs.style,
          availability: { available: false, reason: "GIT_CONTENT_UNAVAILABLE" },
          remote: "unverified",
        };
      }
    },
  );
  app.get<{ Params: { id: string } }>(
    "/api/works/:id/version-plans",
    { schema: { params: idParams } },
    async (request) => store.versionPlans(request.params.id),
  );
  app.post<{ Params: { id: string }; Body: { requestKey: string } }>(
    "/api/works/:id/version-plans",
    { schema: { params: idParams, body: bodySchema({}, []) } },
    async (request) =>
      store.planVersions(request.body.requestKey, request.params.id, () => {
        const service = versions();
        const definition = store.defaultDefinition();
        const { style } = store.workVersions(request.params.id);
        return service.prepare(definition, style);
      }),
  );
  app.get<{
    Params: { id: string };
    Querystring: { kind: "definition" | "style"; path: string };
  }>(
    "/api/version-plans/:id/content",
    {
      schema: {
        params: idParams,
        querystring: {
          type: "object",
          additionalProperties: false,
          required: ["kind", "path"],
          properties: {
            kind: { enum: ["definition", "style"] },
            path: { ...text, maxLength: 2000 },
          },
        },
      },
    },
    async (request) => {
      const plan = store.versionPlan(request.params.id);
      const reference = plan[request.query.kind];
      if (!reference) throw new OperationError(409, "GIT_STYLE_NOT_SELECTED");
      return versions().content(
        reference,
        request.query.kind,
        request.query.path,
      );
    },
  );
  app.post<{
    Body: {
      requestKey: string;
      name: string;
      intent?: string;
      styleCommit?: string | null;
    };
  }>(
    "/api/works",
    {
      schema: {
        body: bodySchema(
          {
            name: { ...text, maxLength: 200, pattern: "\\S" },
            intent: { type: "string", maxLength: 20000 },
            styleCommit: { anyOf: [{ type: "null" }, commitSchema] },
          },
          ["name"],
        ),
      },
    },
    async (request) =>
      store.createWork(
        request.body.requestKey,
        request.body.name,
        request.body.intent ?? null,
        request.body.styleCommit ?? null,
        () => {
          const definition = store.defaultDefinition();
          if (!definition && !request.body.styleCommit)
            return { definition: null, style: null };
          const service = versions();
          const style = request.body.styleCommit
            ? service.select(request.body.styleCommit, "style")
            : null;
          return service.prepare(definition, style);
        },
      ),
  );
  app.get<{ Params: { id: string } }>(
    "/api/works/:id/conversations",
    { schema: { params: idParams } },
    async (request) => store.conversations(request.params.id),
  );
  app.post<{ Params: { id: string }; Body: { requestKey: string } }>(
    "/api/works/:id/conversations",
    {
      schema: { params: idParams, body: bodySchema({}, []) },
    },
    async (request) =>
      store.createConversation(request.body.requestKey, request.params.id),
  );
  app.get<{ Params: { id: string } }>(
    "/api/conversations/:id/records",
    { schema: { params: idParams } },
    async (request) => store.records(request.params.id),
  );
  app.post<{
    Params: { id: string };
    Body: { requestKey: string; body: string };
  }>(
    "/api/conversations/:id/records",
    {
      schema: {
        params: idParams,
        body: bodySchema(
          { body: { ...text, maxLength: 200000, pattern: "\\S" } },
          ["body"],
        ),
      },
    },
    async (request) =>
      store.createRecord(
        request.body.requestKey,
        request.params.id,
        request.body.body,
      ),
  );
  app.get("/api/file-roots", async () => ({
    sources: options.fileRoots?.sources.map((root) => ({ id: root.id })) ?? [],
    configured: Boolean(files),
  }));
  app.get<{ Params: { id: string } }>(
    "/api/works/:id/states",
    { schema: { params: idParams } },
    async (request) => store.states(request.params.id),
  );
  app.get<{ Params: { id: string } }>(
    "/api/works/:id/imports",
    { schema: { params: idParams } },
    async (request) => store.operations(request.params.id),
  );
  app.post<{ Params: { id: string }; Body: { requestKey: string } }>(
    "/api/imports/:id/abandon",
    { schema: { params: idParams, body: bodySchema({}, []) } },
    async (request) => {
      if (!files) throw new OperationError(409, "FILE_STORAGE_NOT_CONFIGURED");
      return files.abandon(request.body.requestKey, request.params.id);
    },
  );
  const sourceSchema = {
    type: "object",
    additionalProperties: false,
    required: ["rootId", "relativePath", "role"],
    properties: {
      rootId: { ...text, maxLength: 100 },
      relativePath: { ...text, maxLength: 2000 },
      role: { enum: ["blend", "psd", "preview", "render"] },
    },
  };
  app.post<{ Params: { id: string }; Body: ImportInput }>(
    "/api/conversations/:id/imports",
    {
      schema: {
        params: idParams,
        body: bodySchema(
          {
            body: { ...text, maxLength: 200000, pattern: "\\S" },
            application: { enum: ["Blender", "Photoshop", "Other"] },
            beforeStateId: {
              anyOf: [{ type: "null" }, { type: "string", format: "uuid" }],
            },
            reason: { type: "string", maxLength: 20000 },
            render: {
              type: "object",
              additionalProperties: false,
              required: ["stateId", "fileId"],
              properties: {
                stateId: { type: "string", format: "uuid" },
                fileId: { type: "string", format: "uuid" },
              },
            },
            files: {
              type: "array",
              minItems: 1,
              maxItems: 100,
              items: sourceSchema,
            },
          },
          ["body", "application", "beforeStateId", "files"],
        ),
      },
    },
    async (request) => {
      if (!files) throw new OperationError(409, "FILE_STORAGE_NOT_CONFIGURED");
      const extensions: Record<string, RegExp> = {
        blend: /\.blend$/i,
        psd: /\.ps[db]$/i,
        preview: /\.(png|jpe?g|webp)$/i,
        render: /\.(png|jpe?g|webp|exr|tiff?)$/i,
      };
      const sources = request.body.files.map((file) =>
        JSON.stringify([file.rootId, file.relativePath]),
      );
      if (new Set(sources).size !== sources.length)
        throw new OperationError(400, "DUPLICATE_FILE");
      for (const file of request.body.files)
        if (!extensions[file.role]?.test(file.relativePath))
          throw new OperationError(400, "INVALID_FILE_TYPE");
      return files.import(request.params.id, request.body);
    },
  );
  app.get<{
    Params: { id: string; fileId: string };
    Querystring: { inline?: string };
  }>(
    "/api/states/:id/files/:fileId",
    {
      schema: {
        params: {
          ...idParams,
          required: ["id", "fileId"],
          properties: {
            ...idParams.properties,
            fileId: { type: "string", format: "uuid" },
          },
        },
      },
    },
    async (request, reply) => {
      if (!files) throw new OperationError(409, "FILE_STORAGE_NOT_CONFIGURED");
      const result = await files.download(
        store.state(request.params.id),
        request.params.fileId,
      );
      if (request.query.inline === "1") {
        const handle = await open(result.path, "r");
        const signature = Buffer.alloc(12);
        try {
          await handle.read(signature, 0, 12, 0);
        } finally {
          await handle.close();
        }
        const mime = signature
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
          ? "image/png"
          : signature[0] === 255 && signature[1] === 216 && signature[2] === 255
            ? "image/jpeg"
            : signature.toString("ascii", 0, 4) === "RIFF" &&
                signature.toString("ascii", 8, 12) === "WEBP"
              ? "image/webp"
              : null;
        if (!mime) throw new OperationError(415, "PREVIEW_UNAVAILABLE");
        return reply.type(mime).send(createReadStream(result.path));
      }
      return reply
        .type("application/octet-stream")
        .header(
          "content-disposition",
          `attachment; filename="${result.file.id}"`,
        )
        .send(createReadStream(result.path));
    },
  );
  app.post(
    "/api/shutdown",
    {
      schema: {
        body: { type: "object", additionalProperties: false, maxProperties: 0 },
      },
    },
    async (_request, reply) => {
      reply.raw.once("finish", () => {
        setImmediate(() => options.onShutdown?.());
      });
      return { status: "stopping" };
    },
  );
  if (options.staticRoot)
    await app.register(staticFiles, {
      root: options.staticRoot,
      index: "index.html",
      dotfiles: "deny",
    });
  return app;
}

import Fastify, { type FastifyError } from "fastify";
import staticFiles from "@fastify/static";
import { randomBytes, createHmac } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { openStore, OperationError } from "./store.js";

interface AppOptions {
  directory: string;
  port: number;
  staticRoot?: string;
  instanceSecret?: string;
  onShutdown?: () => void;
}
const text = { type: "string", minLength: 1 } as const;
const key = {
  type: "string",
  minLength: 8,
  maxLength: 128,
  pattern: "^[a-zA-Z0-9_-]+$",
} as const;
const bodySchema = (
  properties: Record<string, unknown>,
  required: string[],
) => ({
  type: "object",
  additionalProperties: false,
  properties: { requestKey: key, ...properties },
  required: ["requestKey", ...required],
});
const idParams = {
  type: "object",
  properties: { id: { type: "string", format: "uuid" } },
  required: ["id"],
  additionalProperties: false,
};

export async function createApp(options: AppOptions) {
  await mkdir(options.directory, { recursive: true, mode: 0o700 });
  const store = openStore(options.directory);
  const app = Fastify({
    logger: false,
    bodyLimit: 1024 * 1024,
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false } },
  });
  const origin = `http://localhost:${options.port}`;
  const csrfToken = randomBytes(32).toString("hex");
  const session = randomBytes(32).toString("hex");
  app.addHook("onClose", async () => {
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
  app.post<{ Body: { requestKey: string; name: string; intent?: string } }>(
    "/api/works",
    {
      schema: {
        body: bodySchema(
          {
            name: { ...text, maxLength: 200, pattern: "\\S" },
            intent: { type: "string", maxLength: 20000 },
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

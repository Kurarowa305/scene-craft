import type { FastifyInstance } from "fastify";
import type {
  ChatRequest,
  ChatItem,
  ModelChoice,
  ChatModel,
} from "../shared/chat.js";
import type { VersionPlan } from "../shared/versions.js";
import type { CodexConnection } from "./codex.js";
import { OperationError, type openStore } from "./store.js";
import { idParams as params, bodySchema as body } from "./http-schema.js";
const blockingErrors = new Set([
  "MODEL_REROUTED",
  "USAGE_LIMIT",
  "AUTH_REQUIRED",
  "MODEL_UNAVAILABLE",
  "PERMISSION_DENIED",
]);

export function registerChat(
  app: FastifyInstance,
  store: ReturnType<typeof openStore>,
  connection: () => Promise<CodexConnection>,
  prepare: (workId: string) => Omit<VersionPlan, "id" | "workId" | "createdAt">,
  validate: (plan: VersionPlan) => void,
) {
  const chat = store.chat;
  const executing = new Set<string>();
  const subscribers = new Map<string, Set<() => void>>();
  const streams = new Set<() => void>();
  let attached: CodexConnection | undefined;
  let detach: (() => void) | undefined;
  async function runtime() {
    const c = await connection();
    if (attached !== c) {
      detach?.();
      attached = c;
      detach = c.onEvent(event);
    }
    return c;
  }
  function save(r: ChatRequest) {
    chat.save(r);
    for (const fn of subscribers.get(r.conversationId) ?? []) fn();
  }
  function classify(info: unknown): string {
    if (info === "usageLimitExceeded" || info === "sessionBudgetExceeded")
      return "USAGE_LIMIT";
    if (info === "unauthorized") return "AUTH_REQUIRED";
    if (info === "modelNotFound") return "MODEL_UNAVAILABLE";
    return "CODEX_FAILED";
  }
  function item(value: any, complete: boolean): ChatItem {
    return {
      id: value.id,
      type: value.type,
      text:
        typeof value.text === "string"
          ? value.text
          : value.type === "userMessage"
            ? (value.content ?? [])
                .filter((x: any) => x.type === "text")
                .map((x: any) => x.text)
                .join("\n")
            : "",
      complete,
    };
  }
  function merge(r: ChatRequest, value: ChatItem) {
    const old = r.items.findIndex((i) => i.id === value.id);
    if (old < 0) r.items.push(value);
    else if (!r.items[old].complete || value.complete) r.items[old] = value;
  }
  function terminal(r: ChatRequest, turn: any) {
    for (const i of turn.items ?? []) merge(r, item(i, true));
    r.terminal = turn.status;
    if (
      ["completed", "interrupted"].includes(turn.status) &&
      r.error &&
      !blockingErrors.has(r.error)
    )
      r.error = null;
    if (turn.error) r.error = classify(turn.error.codexErrorInfo);
    if (turn.status === "completed")
      r.phase =
        r.error && r.error !== "INTERNAL_RETRY" ? "blocked" : "completed";
    else if (turn.status === "interrupted")
      r.phase =
        r.error && !["INTERNAL_RETRY"].includes(r.error)
          ? "blocked"
          : "interrupted";
    else if (turn.status === "failed") {
      r.phase = "blocked";
      r.error ??= "CODEX_FAILED";
    } else {
      r.terminal = null;
      r.phase = r.stopRequested ? "stopping" : "running";
    }
    if (r.error === "INTERNAL_RETRY" && r.terminal) r.error = null;
  }
  function event(method: string, p: any) {
    for (const initial of chat.requests()) {
      if (
        method !== "connection/lost" &&
        (p.threadId !== initial.threadId || !initial.threadId)
      )
        continue;
      const r = chat.get(initial.id);
      if (!chat.unsettled(r) && method !== "model/rerouted") continue;
      const turnId = p.turnId ?? p.turn?.id;
      if (
        turnId &&
        chat
          .requests()
          .some(
            (other) =>
              (other.id !== r.id && other.turnId === turnId) ||
              other.attempts.some((a) => a.turnId === turnId),
          )
      )
        continue;
      if (turnId && r.turnId && turnId !== r.turnId) continue;
      if (turnId && !r.turnId) {
        r.turnId = turnId;
      }
      if (method === "connection/lost") {
        r.phase = "unknown";
        r.error = "CODEX_DISCONNECTED";
      } else if (method === "model/rerouted") {
        r.actualModel = p.toModel;
        r.error = "MODEL_REROUTED";
        r.phase = r.terminal ? "blocked" : "stopping";
        save(r);
        void interrupt(r);
        continue;
      } else if (method === "item/agentMessage/delta") {
        const old = r.items.find((i) => i.id === p.itemId);
        if (!old?.complete)
          merge(r, {
            id: p.itemId,
            type: "agentMessage",
            text: (old?.text ?? "") + p.delta,
            complete: false,
          });
      } else if (method === "item/started" || method === "item/completed")
        merge(r, item(p.item, method === "item/completed"));
      else if (method === "turn/started") {
        r.turnId = p.turn.id;
        if (!r.stopRequested) r.phase = "running";
      } else if (method === "turn/completed") terminal(r, p.turn);
      else if (method === "error") {
        const reason = classify(p.error?.codexErrorInfo);
        r.error =
          p.willRetry && reason === "CODEX_FAILED" ? "INTERNAL_RETRY" : reason;
        if (
          ["USAGE_LIMIT", "AUTH_REQUIRED", "MODEL_UNAVAILABLE"].includes(reason)
        ) {
          r.phase = "stopping";
          save(r);
          void interrupt(r);
          continue;
        }
      } else continue;
      save(r);
      if (r.stopRequested && r.turnId && !r.terminal) void interrupt(r);
    }
  }
  async function interrupt(r: ChatRequest) {
    if (!r.threadId || !r.turnId || r.terminal) return;
    try {
      await (
        await runtime()
      ).rpc("turn/interrupt", { threadId: r.threadId, turnId: r.turnId });
    } catch {
      const latest = chat.get(r.id);
      if (!latest.terminal) {
        latest.phase = "unknown";
        latest.error ??= "INTERRUPT_UNKNOWN";
        save(latest);
      }
    }
  }
  async function models(): Promise<ChatModel[]> {
    const c = await runtime();
    const all: ChatModel[] = [];
    let cursor: string | null = null;
    const seen = new Set<string>();
    do {
      const page = await c.rpc("model/list", { limit: 50, cursor });
      all.push(...page.data);
      cursor = page.nextCursor ?? null;
      if (cursor && seen.has(cursor))
        throw new OperationError(409, "HISTORY_INCOMPLETE");
      if (cursor) seen.add(cursor);
    } while (cursor);
    return all;
  }
  async function authenticate() {
    const c = await runtime();
    const account = await c.rpc("account/read", { refreshToken: false });
    if (account.account?.type !== "chatgpt")
      throw new OperationError(409, "AUTH_REQUIRED");
    return c;
  }
  async function dispatch(id: string) {
    if (executing.has(id) || chat.get(id).phase !== "accepted") return;
    executing.add(id);
    let startIssued = false;
    let createdThread = false;
    try {
      const c = await authenticate();
      let r = chat.get(id);
      if (r.stopRequested) {
        r.phase = "interrupted";
        r.terminal = "notStarted";
        save(r);
        return;
      }
      const catalog = await models();
      if (!catalog.some((m) => m.model === r.selection.model))
        throw new OperationError(409, "MODEL_UNAVAILABLE");
      // Revalidate fixed versions before touching an external runtime. No HEAD resolution.
      validate(r.plan);
      const s = chat.session(r.conversationId);
      createdThread = !s.threadId;
      const settings = {
        model: r.selection.model,
        modelProvider: "openai",
        approvalPolicy: "never",
        sandbox: "read-only",
        environments: [],
        runtimeWorkspaceRoots: [],
        baseInstructions:
          "You are scene-craft's conversation assistant. Respond in text. Production tools and file changes are unavailable.",
        developerInstructions:
          "This chat has no production permissions. Do not execute commands or change files.",
      };
      const thread = await c.rpc(
        s.threadId ? "thread/resume" : "thread/start",
        {
          ...settings,
          ...(s.threadId
            ? { threadId: s.threadId, excludeTurns: true }
            : { historyMode: "paginated", allowProviderModelFallback: false }),
        },
      );
      r = chat.get(id);
      const latestSession = chat.session(r.conversationId);
      latestSession.threadId = thread.thread.id;
      chat.saveSession(latestSession);
      r.threadId = latestSession.threadId;
      r.runtime = c.runtime;
      r.actualModel = thread.model ?? null;
      save(r);
      if (
        thread.model !== r.selection.model ||
        thread.modelProvider !== "openai"
      )
        throw new OperationError(409, "MODEL_REROUTED");
      if (r.stopRequested) {
        if (createdThread) {
          latestSession.threadId = null;
          chat.saveSession(latestSession);
        }
        r.phase = "interrupted";
        r.terminal = "notStarted";
        save(r);
        return;
      }
      r.phase = "running";
      save(r);
      startIssued = true;
      const result = await c.rpc("turn/start", {
        threadId: r.threadId,
        input: [{ type: "text", text: r.body, text_elements: [] }],
        clientUserMessageId: r.id,
        model: r.selection.model,
        effort: r.selection.effort,
        serviceTierForTurn: r.selection.speed === "fast" ? "fast" : "default",
        approvalPolicy: "never",
        sandboxPolicy: { type: "readOnly" },
        environments: [],
      });
      r = chat.get(id);
      if (r.turnId && r.turnId !== result.turn.id)
        throw new OperationError(409, "TURN_MISMATCH");
      r.turnId = result.turn.id;
      if (!r.terminal) terminal(r, result.turn);
      save(r);
      if (r.stopRequested || r.error === "MODEL_REROUTED") await interrupt(r);
    } catch (error) {
      const r = chat.get(id);
      if (!r.terminal) {
        if (createdThread && !startIssued) {
          const s = chat.session(r.conversationId);
          s.threadId = null;
          chat.saveSession(s);
        }
        r.error = error instanceof OperationError ? error.code : "CODEX_FAILED";
        r.phase = startIssued ? "unknown" : "blocked";
        if (!startIssued) r.terminal = "notStarted";
        save(r);
      }
    } finally {
      executing.delete(id);
    }
  }
  async function reconcile(id: string) {
    const r = chat.get(id);
    if (r.terminal === "notStarted") return r;
    if (!r.threadId) return r;
    const c = await runtime();
    const turns: any[] = [];
    let cursor: string | null = null;
    const seen = new Set<string>();
    do {
      const page = await c.rpc("thread/turns/list", {
        threadId: r.threadId,
        cursor,
        limit: 50,
        itemsView: "full",
        sortDirection: "asc",
      });
      turns.push(...page.data);
      cursor = page.nextCursor ?? null;
      if (cursor && seen.has(cursor))
        throw new OperationError(409, "HISTORY_INCOMPLETE");
      if (cursor) seen.add(cursor);
    } while (cursor);
    // Only an acknowledged turn ID can settle this request; matching text is insufficient.
    const turn = turns.find((t) => t.id === r.turnId);
    if (!turn) {
      const latest = chat.get(id);
      if (
        latest.terminal ||
        latest.turnId !== r.turnId ||
        latest.retryCount !== r.retryCount
      )
        return latest;
      latest.phase = "unknown";
      if (!blockingErrors.has(latest.error ?? ""))
        latest.error = "ACCEPTANCE_UNKNOWN";
      save(latest);
      return latest;
    }
    let itemCursor: string | null = null;
    const items: any[] = [];
    seen.clear();
    do {
      const page = await c.rpc("thread/items/list", {
        threadId: r.threadId,
        turnId: r.turnId,
        cursor: itemCursor,
        limit: 50,
        sortDirection: "asc",
      });
      items.push(
        ...page.data
          .filter((entry: any) => entry.turnId === r.turnId)
          .map((entry: any) => entry.item),
      );
      itemCursor = page.nextCursor ?? null;
      if (itemCursor && seen.has(itemCursor))
        throw new OperationError(409, "HISTORY_INCOMPLETE");
      if (itemCursor) seen.add(itemCursor);
    } while (itemCursor);
    const latest = chat.get(id);
    if (latest.turnId !== r.turnId || latest.retryCount !== r.retryCount)
      throw new OperationError(409, "STALE_RECONCILIATION");
    if (
      latest.terminal &&
      !["completed", "interrupted", "failed"].includes(turn.status)
    )
      return latest;
    terminal(latest, { ...turn, items });
    save(latest);
    if (latest.stopRequested && !latest.terminal) await interrupt(latest);
    return latest;
  }
  app.get("/api/codex", async () => {
    try {
      const c = await runtime();
      const a = await c.rpc("account/read", { refreshToken: false });
      return {
        configured: true,
        authenticated: a.account?.type === "chatgpt",
        runtime: c.runtime,
        models: await models(),
      };
    } catch {
      return {
        configured: false,
        authenticated: false,
        runtime: null,
        models: [],
      };
    }
  });
  app.post("/api/codex/login", { schema: { body: body({}, []) } }, async () => {
    const result = await (
      await runtime()
    ).rpc("account/login/start", { type: "chatgpt" });
    if (result.type !== "chatgpt" || typeof result.authUrl !== "string")
      throw new OperationError(409, "AUTH_REQUIRED");
    const url = new URL(result.authUrl);
    if (url.protocol !== "https:" || url.hostname !== "auth.openai.com")
      throw new OperationError(409, "AUTH_REQUIRED");
    return { authUrl: result.authUrl };
  });
  app.get<{ Params: { id: string } }>(
    "/api/conversations/:id/chat",
    { schema: { params } },
    async (req) => {
      const s = chat.session(req.params.id);
      if (!s.selection)
        try {
          const m = (await models()).find((m) => m.isDefault);
          if (m)
            chat.select(`initial-model-${s.conversationId}`, s.conversationId, {
              model: m.model,
              effort: m.defaultReasoningEffort,
              speed: "standard",
            });
        } catch {
          /* Local history remains available offline. */
        }
      return chat.view(req.params.id);
    },
  );
  app.post<{
    Params: { id: string };
    Body: ModelChoice & { requestKey: string };
  }>(
    "/api/conversations/:id/model",
    {
      schema: {
        params,
        body: body(
          {
            model: { type: "string", maxLength: 200 },
            effort: { type: "string", maxLength: 30 },
            speed: { enum: ["standard", "fast"] },
          },
          ["model", "effort", "speed"],
        ),
      },
    },
    async (req) => {
      const { requestKey, ...selection } = req.body;
      const m = (await models()).find((m) => m.model === selection.model);
      if (
        !m ||
        !m.supportedReasoningEfforts.some(
          (e) => e.reasoningEffort === selection.effort,
        )
      )
        throw new OperationError(409, "MODEL_UNAVAILABLE");
      return chat.select(requestKey, req.params.id, selection);
    },
  );
  app.post<{
    Params: { id: string };
    Body: { requestKey: string; body: string };
  }>(
    "/api/conversations/:id/messages",
    {
      schema: {
        params,
        body: body(
          {
            body: {
              type: "string",
              minLength: 1,
              maxLength: 200000,
              pattern: "\\S",
            },
          },
          ["body"],
        ),
      },
    },
    async (req) => {
      const r = chat.accept(
        req.body.requestKey,
        req.params.id,
        req.body.body,
        (workId) => {
          return {
            id: crypto.randomUUID(),
            workId,
            ...prepare(workId),
            createdAt: new Date().toISOString(),
          };
        },
      );
      void dispatch(r.id);
      return r;
    },
  );
  for (const operation of ["stop", "reconcile", "resume"] as const)
    app.post<{ Params: { id: string }; Body: { requestKey: string } }>(
      `/api/chat-requests/:id/${operation}`,
      { schema: { params, body: body({}, []) } },
      async (req) => {
        if (operation === "reconcile") return reconcile(req.params.id);
        if (operation === "stop") {
          const r = chat.stop(req.body.requestKey, req.params.id);
          void interrupt(r);
          return r;
        }
        const r = chat.resume(req.body.requestKey, req.params.id);
        void dispatch(r.id);
        return r;
      },
    );
  app.get<{ Params: { id: string } }>(
    "/api/conversations/:id/events",
    { schema: { params } },
    async (req, reply) => {
      chat.session(req.params.id);
      if (req.headers["last-event-id"])
        for (const r of chat.requests(req.params.id))
          if (r.threadId && chat.unsettled(r))
            try {
              await reconcile(r.id);
            } catch {
              /* Keep saved uncertainty; reconnect never dispatches. */
            }
      reply.hijack();
      reply.raw.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-store",
        connection: "keep-alive",
      });
      const send = () => {
        const view = chat.view(req.params.id);
        reply.raw.write(
          `id: ${view.revision}\nevent: chat\ndata: ${JSON.stringify(view)}\n\n`,
        );
      };
      let group = subscribers.get(req.params.id);
      if (!group) {
        group = new Set();
        subscribers.set(req.params.id, group);
      }
      group.add(send);
      send();
      const timer = setInterval(
        () => reply.raw.write(": keepalive\n\n"),
        15000,
      );
      const close = () => {
        clearInterval(timer);
        group!.delete(send);
      };
      reply.raw.on("close", close);
      const end = () => {
        close();
        reply.raw.end();
        streams.delete(end);
      };
      streams.add(end);
      reply.raw.on("close", () => streams.delete(end));
    },
  );
  app.addHook("preClose", async () => {
    detach?.();
    for (const r of chat.requests())
      if (chat.unsettled(r)) {
        r.phase = "unknown";
        r.error = "PROCESS_INTERRUPTED";
        save(r);
      }
    for (const end of streams) end();
    subscribers.clear();
    await attached?.close();
  });
}

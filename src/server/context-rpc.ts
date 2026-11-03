import { createServer, type Socket } from "node:net";
import { mkdtemp, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { OperationError, type openStore } from "./store.js";
import type { ChatRequest } from "../shared/chat.js";
import { explicitInstruction } from "./context-store.js";
import type { RecordInterpretation } from "../shared/record-instruction.js";

export const contextTools = [
  "get_execution_context",
  "find_records",
  "read_records",
  "update_work_context",
  "record_manual_work",
  "amend_record",
  "record_human_decision",
] as const;
export interface McpEndpoint {
  socketPath: string;
  credential: string;
}

/** Short private path avoids Unix socket length limits. Nothing is exposed over HTTP. */
export async function startContextRpc(store: ReturnType<typeof openStore>) {
  const directory = await mkdtemp(join(tmpdir(), "scene-rpc-"));
  await chmod(directory, 0o700);
  const endpoint: McpEndpoint = {
    socketPath: join(directory, "rpc"),
    credential: randomBytes(32).toString("hex"),
  };
  const bindings = new Map<
    string,
    {
      requestId: string;
      executionId: string;
      attempt: number;
      threadId: string;
      turnId: string | null;
      generation: string;
    }
  >();
  const connections = new Map<string, string>();
  let generation = randomUUID();
  const sockets = new Set<Socket>();
  let interpret:
    | ((
        request: ChatRequest,
        stillCurrent: () => boolean,
      ) => Promise<RecordInterpretation>)
    | undefined;
  const interpretations = new Map<string, Promise<RecordInterpretation>>();
  function authorize(input: any): ChatRequest {
    const credential =
      typeof input?.credential === "string"
        ? Buffer.from(input.credential)
        : Buffer.alloc(0);
    const binding = bindings.get(input.args?.contextRef);
    if (!binding || binding.generation !== generation)
      throw new OperationError(403, "STALE_CONTEXT");
    const r = store.chat.get(binding.requestId);
    const expected = Buffer.from(
      connections.get(r.conversationId) ?? endpoint.credential,
    );
    if (
      credential.length !== expected.length ||
      !timingSafeEqual(credential, expected)
    )
      throw new OperationError(403, "INVALID_CONNECTION");
    if (
      r.retryCount !== binding.attempt ||
      r.threadId !== binding.threadId ||
      !binding.turnId ||
      r.turnId !== binding.turnId ||
      r.phase !== "running" ||
      r.terminal ||
      r.stopRequested ||
      r.error
    )
      throw new OperationError(403, "STALE_CONTEXT");
    if (store.chat.session(r.conversationId).threadId !== binding.threadId)
      throw new OperationError(403, "STALE_CONTEXT");
    return r;
  }
  async function call(input: any) {
    let r = authorize(input);
    const args = input.args;
    const tool = input.tool;
    if (!contextTools.includes(tool))
      throw new OperationError(403, "PERMISSION_DENIED");
    if (
      typeof args.operationId !== "string" ||
      !/^[a-zA-Z0-9-]{8,100}$/.test(args.operationId)
    )
      throw new OperationError(400, "INVALID_OPERATION_ID");
    if (
      ["update_work_context", "record_manual_work", "amend_record"].includes(
        tool,
      )
    ) {
      // Validate the acting model's narrow arguments BEFORE any interpretation.
      if (args.sourceRequestId !== r.id)
        throw new OperationError(403, "EXPLICIT_INSTRUCTION_REQUIRED");
      if (
        Object.keys(args).some(
          (key) =>
            !["sourceRequestId", "contextRef", "operationId"].includes(key),
        )
      )
        throw new OperationError(403, "PERMISSION_DENIED");
      if (!explicitInstruction(r.body) && !r.recordInterpretation) {
        if (!interpret)
          throw new OperationError(409, "RECORD_INTERPRETATION_FAILED");
        const key = `${r.id}:${r.retryCount}`;
        const stillCurrent = () => {
          try {
            authorize(input);
            return true;
          } catch {
            return false;
          }
        };
        let pending = interpretations.get(key);
        if (!pending) {
          pending = interpret(r, stillCurrent);
          interpretations.set(key, pending);
        }
        const resolution = await pending;
        r = authorize(input);
        r.recordInterpretation = resolution;
        store.chat.save(r);
      }
      r = authorize(input);
      return store.contextOperation(
        args.operationId,
        r.id,
        { tool, args },
        () =>
          r.recordInterpretation?.status === "clarification"
            ? {
                complete: false,
                needsClarification: true,
                question: r.recordInterpretation.question,
              }
            : store.context.apply(r, tool, args),
      );
    }
    if (tool === "record_human_decision")
      throw new OperationError(409, "FEATURE_UNAVAILABLE");
    const keys = [
      "contextRef",
      "operationId",
      ...(tool === "get_execution_context" ? [] : ["after", "afterRequests"]),
    ];
    if (Object.keys(args).some((key) => !keys.includes(key)))
      throw new OperationError(403, "PERMISSION_DENIED");
    const after = args.after ?? 0;
    const afterRequests = args.afterRequests ?? 0;
    if (
      ![after, afterRequests].every(
        (value) => Number.isSafeInteger(value) && value >= 0,
      )
    )
      throw new OperationError(400, "INVALID_CURSOR");
    return store.contextOperation(args.operationId, r.id, { tool, args }, () =>
      tool === "get_execution_context"
        ? {
            requestId: r.id,
            role: r.role ?? "none",
            execution: bindings.get(args.contextRef),
            fixed: r.contextSnapshot,
            current: store.context.context(r.workId),
            plan: r.plan,
            remainingRetries: 2 - r.retryCount,
            unavailable: [
              "production",
              "protection",
              "human_decision",
              "file_attachment",
            ],
          }
        : store.context.history(r.workId, after, afterRequests),
    );
  }
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    socket.setTimeout(60000, () => socket.destroy());
    let buffer = "";
    let queued = Promise.resolve();
    socket.setEncoding("utf8");
    socket.on("data", (data) => {
      buffer += data;
      if (Buffer.byteLength(buffer) > 1024 * 1024) {
        socket.destroy();
        return;
      }
      let end: number;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        queued = queued.then(async () => {
          try {
            const result = await call(JSON.parse(line));
            if (!socket.destroyed)
              socket.write(JSON.stringify({ result }) + "\n");
          } catch (error) {
            if (!socket.destroyed)
              socket.write(
                JSON.stringify({
                  error:
                    error instanceof OperationError
                      ? error.code
                      : "RPC_REJECTED",
                }) + "\n",
              );
          }
        });
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(endpoint.socketPath, resolve);
  });
  await chmod(endpoint.socketPath, 0o600);
  return {
    endpoint,
    setInterpreter(value: NonNullable<typeof interpret>) {
      interpret = value;
    },
    configuration(conversationId: string) {
      let credential = connections.get(conversationId);
      if (!credential) {
        credential = randomBytes(32).toString("hex");
        connections.set(conversationId, credential);
      }
      return {
        "mcp_servers.scene_craft.env": {
          SCENE_CRAFT_RPC_SOCKET: endpoint.socketPath,
          SCENE_CRAFT_RPC_CREDENTIAL: credential,
        },
      };
    },
    issue(r: ChatRequest) {
      const ref = randomUUID();
      bindings.set(ref, {
        requestId: r.id,
        executionId: randomUUID(),
        attempt: r.retryCount,
        threadId: r.threadId!,
        turnId: null,
        generation,
      });
      return ref;
    },
    bind(r: ChatRequest) {
      for (const binding of bindings.values())
        if (
          binding.requestId === r.id &&
          binding.attempt === r.retryCount &&
          binding.threadId === r.threadId &&
          !binding.turnId
        )
          binding.turnId = r.turnId;
    },
    revoke() {
      bindings.clear();
      connections.clear();
      generation = randomUUID();
    },
    async close() {
      bindings.clear();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    },
  };
}

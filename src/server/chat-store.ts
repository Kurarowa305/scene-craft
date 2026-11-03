import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type { ChatRequest, ChatSession, ModelChoice } from "../shared/chat.js";
import type { VersionPlan } from "../shared/versions.js";
import { OperationError } from "./store.js";

export function chatStore(
  db: DatabaseSync,
  once: <T>(key: string, content: unknown[], write: () => T) => T,
) {
  function session(id: string): ChatSession {
    if (!db.prepare("SELECT id FROM conversations WHERE id = ?").get(id))
      throw new OperationError(404, "NOT_FOUND");
    const row = db
      .prepare("SELECT data FROM chat_sessions WHERE conversation_id = ?")
      .get(id);
    if (row) return JSON.parse(row.data as string);
    const latest = db
      .prepare(
        "SELECT data FROM chat_selections ORDER BY sequence DESC LIMIT 1",
      )
      .get();
    const result: ChatSession = {
      conversationId: id,
      threadId: null,
      selection: latest ? JSON.parse(latest.data as string) : null,
    };
    db.prepare("INSERT INTO chat_sessions VALUES (?, ?)").run(
      id,
      JSON.stringify(result),
    );
    return result;
  }
  function saveSession(value: ChatSession) {
    db.prepare(
      "UPDATE chat_sessions SET data = ? WHERE conversation_id = ?",
    ).run(JSON.stringify(value), value.conversationId);
    db.prepare(
      "INSERT INTO chat_events (conversation_id, request_id) VALUES (?, NULL)",
    ).run(value.conversationId);
  }
  function requests(id?: string): ChatRequest[] {
    return db
      .prepare(
        id
          ? "SELECT data FROM chat_requests WHERE conversation_id = ? ORDER BY sequence"
          : "SELECT data FROM chat_requests ORDER BY sequence",
      )
      .all(...(id ? [id] : []))
      .map((row) => JSON.parse(row.data as string));
  }
  function get(id: string): ChatRequest {
    const row = db
      .prepare("SELECT data FROM chat_requests WHERE id = ?")
      .get(id);
    if (!row) throw new OperationError(404, "NOT_FOUND");
    return JSON.parse(row.data as string);
  }
  function save(value: ChatRequest) {
    db.prepare("UPDATE chat_requests SET data = ? WHERE id = ?").run(
      JSON.stringify(value),
      value.id,
    );
    db.prepare(
      "INSERT INTO chat_events (conversation_id, request_id) VALUES (?, ?)",
    ).run(value.conversationId, value.id);
  }
  function unsettled(r: ChatRequest) {
    return ["accepted", "running", "stopping", "unknown"].includes(r.phase);
  }
  // Process ownership was lost. Never replay a turn on startup.
  for (const r of requests())
    if (["accepted", "running", "stopping"].includes(r.phase)) {
      r.phase = "unknown";
      r.error = "PROCESS_INTERRUPTED";
      save(r);
    }
  return {
    session,
    saveSession,
    requests,
    get,
    save,
    unsettled,
    view(id: string) {
      return {
        session: session(id),
        requests: requests(id),
        revision: Number(
          db
            .prepare(
              "SELECT COALESCE(MAX(sequence),0) AS n FROM chat_events WHERE conversation_id = ?",
            )
            .get(id)!.n,
        ),
      };
    },
    select(key: string, id: string, selection: ModelChoice) {
      return once(key, ["chat-selection", id, selection], () => {
        const s = session(id);
        s.selection = selection;
        saveSession(s);
        db.prepare("INSERT INTO chat_selections (data) VALUES (?)").run(
          JSON.stringify(selection),
        );
        return s;
      });
    },
    accept(
      key: string,
      id: string,
      body: string,
      plan: (workId: string) => VersionPlan,
      role = "none",
      context?: (
        workId: string,
        plan: VersionPlan,
      ) => { snapshot: unknown; instructions: string },
    ) {
      const saved = once(key, ["chat-send", id, body, role], () => {
        const s = session(id);
        if (!s.selection) throw new OperationError(409, "MODEL_REQUIRED");
        const workId = db
          .prepare("SELECT work_id FROM conversations WHERE id = ?")
          .get(id)!.work_id as string;
        if (requests().some((r) => r.workId === workId && unsettled(r)))
          throw new OperationError(409, "CHAT_RECONCILIATION_REQUIRED");
        const r: ChatRequest = {
          role,
          attempts: [],
          id: randomUUID(),
          conversationId: id,
          workId,
          body,
          selection: s.selection,
          actualModel: null,
          runtime: null,
          threadId: s.threadId,
          turnId: null,
          phase: "accepted",
          stopRequested: false,
          error: null,
          terminal: null,
          items: [],
          plan: plan(workId),
          createdAt: new Date().toISOString(),
          retryCount: 0,
          previousAttempt: null,
        };
        if (context) {
          const fixed = context(workId, r.plan);
          r.contextSnapshot = fixed.snapshot;
          r.instructions = fixed.instructions;
        }
        db.prepare(
          "INSERT INTO chat_requests (id, conversation_id, work_id, data) VALUES (?, ?, ?, ?)",
        ).run(r.id, id, workId, JSON.stringify(r));
        return r;
      });
      return get(saved.id);
    },
    stop(key: string, id: string) {
      once(key, ["chat-stop", id], () => {
        const r = get(id);
        r.stopRequested = true;
        if (unsettled(r)) r.phase = "stopping";
        save(r);
        return { id };
      });
      return get(id);
    },
    resume(key: string, id: string) {
      once(key, ["chat-resume", id], () => {
        const r = get(id);
        if (!r.terminal || !["interrupted", "blocked"].includes(r.phase))
          throw new OperationError(409, "CHAT_RECONCILIATION_REQUIRED");
        if (r.retryCount >= 2) throw new OperationError(409, "RETRY_LIMIT");
        if (
          requests().some(
            (other) =>
              other.workId === r.workId && other.id !== id && unsettled(other),
          )
        )
          throw new OperationError(409, "CHAT_RECONCILIATION_REQUIRED");
        const s = session(r.conversationId);
        r.attempts.push({
          stopRequested: r.stopRequested,
          turnId: r.turnId,
          selection: r.selection,
          actualModel: r.actualModel,
          runtime: r.runtime,
          terminal: r.terminal,
          error: r.error,
          items: r.items,
        });
        r.previousAttempt = r.turnId;
        r.turnId = null;
        r.actualModel = null;
        r.runtime = null;
        r.terminal = null;
        r.items = [];
        r.error = null;
        r.stopRequested = false;
        r.phase = "accepted";
        r.retryCount++;
        if (s.selection) r.selection = s.selection;
        save(r);
        return { id };
      });
      return get(id);
    },
  };
}

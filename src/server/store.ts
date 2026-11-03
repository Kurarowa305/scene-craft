import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import type {
  ImportInput,
  ImportOperation,
  SavedState,
} from "../shared/files.js";
import { join } from "node:path";
import type { Work, Conversation, BodyRecord } from "../shared/contracts.js";
import type { GitReference, VersionPlan } from "../shared/versions.js";
import { chatStore } from "./chat-store.js";
import { contextStore } from "./context-store.js";
import { auxiliaryStore } from "./auxiliary-store.js";
import { sideStore } from "./side-store.js";

export class OperationError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
  ) {
    super(code);
  }
}

/** Owns the SQLite transaction: the result and receipt are committed together. */
export function openStore(directory: string) {
  const db = new DatabaseSync(join(directory, "records.sqlite"));
  try {
    db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;");
    const version = (
      db.prepare("PRAGMA user_version").get() as { user_version: number }
    ).user_version;
    if (version !== 0 && version !== 1)
      throw new Error("UNSUPPORTED_STORAGE_VERSION");
    if (version === 0)
      db.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE works (sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, name TEXT NOT NULL, intent TEXT, created_at TEXT NOT NULL);
      CREATE TABLE conversations (sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, work_id TEXT NOT NULL REFERENCES works(id), created_at TEXT NOT NULL);
      CREATE TABLE records (sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, conversation_id TEXT NOT NULL REFERENCES conversations(id), body TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE INDEX conversations_work ON conversations(work_id, sequence);
      CREATE INDEX records_conversation ON records(conversation_id, sequence);
      CREATE TABLE receipts (request_key TEXT PRIMARY KEY, content TEXT NOT NULL, result TEXT NOT NULL);
      PRAGMA user_version = 1;
      COMMIT;
    `);
  } catch (error) {
    db.close();
    throw error;
  }

  // Preserve the initial records DB before adding the import schema. No existing rows change.
  if (
    !db
      .prepare(
        "SELECT name FROM sqlite_master WHERE name = 'import_operations'",
      )
      .get()
  ) {
    const backup = join(directory, "records.before-imports.sqlite");
    if (!existsSync(backup)) db.prepare("VACUUM INTO ?").run(backup);
    db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE import_operations (id TEXT PRIMARY KEY, request_key TEXT NOT NULL UNIQUE, work_id TEXT NOT NULL REFERENCES works(id), data TEXT NOT NULL);
      CREATE TABLE saved_states (sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, work_id TEXT NOT NULL REFERENCES works(id), data TEXT NOT NULL);
      CREATE TABLE current_states (work_id TEXT PRIMARY KEY REFERENCES works(id), state_id TEXT NOT NULL REFERENCES saved_states(id));
      CREATE TABLE current_state_updates (sequence INTEGER PRIMARY KEY AUTOINCREMENT, work_id TEXT NOT NULL REFERENCES works(id), before_id TEXT, after_id TEXT NOT NULL REFERENCES saved_states(id), operation_id TEXT NOT NULL UNIQUE REFERENCES import_operations(id));
      COMMIT;`);
  }
  function readState(id: string): SavedState {
    const row = db
      .prepare("SELECT data FROM saved_states WHERE id = ?")
      .get(id) as { data: string } | undefined;
    if (!row) throw new OperationError(404, "STATE_NOT_FOUND");
    return JSON.parse(row.data);
  }
  if (
    !db
      .prepare("SELECT name FROM sqlite_master WHERE name = 'git_settings'")
      .get()
  ) {
    const backup = join(directory, "records.before-git-versions.sqlite");
    if (!existsSync(backup)) db.prepare("VACUUM INTO ?").run(backup);
    db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE git_settings (sequence INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE work_git (work_id TEXT PRIMARY KEY REFERENCES works(id), data TEXT NOT NULL);
      CREATE TABLE version_plans (id TEXT PRIMARY KEY, work_id TEXT NOT NULL REFERENCES works(id), data TEXT NOT NULL);
      COMMIT;`);
  }
  function defaultDefinition(): GitReference | null {
    const row = db
      .prepare("SELECT data FROM git_settings ORDER BY sequence DESC LIMIT 1")
      .get() as { data: string } | undefined;
    return row ? JSON.parse(row.data) : null;
  }
  function workVersions(workId: string): {
    definition: GitReference | null;
    style: GitReference | null;
  } {
    requireEntity("works", workId);
    const row = db
      .prepare("SELECT data FROM work_git WHERE work_id = ?")
      .get(workId) as { data: string } | undefined;
    return row ? JSON.parse(row.data) : { definition: null, style: null };
  }
  function decorateWork(work: Work): Work {
    const refs = workVersions(work.id);
    return { ...work, style: refs.style, plannedDefinition: refs.definition };
  }
  function versionPlan(id: string): VersionPlan {
    const row = db
      .prepare("SELECT data FROM version_plans WHERE id = ?")
      .get(id) as { data: string } | undefined;
    if (!row) throw new OperationError(404, "NOT_FOUND");
    return JSON.parse(row.data);
  }
  function operation(id: string): ImportOperation {
    const row = db
      .prepare("SELECT data FROM import_operations WHERE id = ?")
      .get(id) as { data: string } | undefined;
    if (!row) throw new OperationError(404, "OPERATION_NOT_FOUND");
    return JSON.parse(row.data);
  }
  function current(workId: string): string | null {
    return (
      (
        db
          .prepare("SELECT state_id FROM current_states WHERE work_id = ?")
          .get(workId) as { state_id: string } | undefined
      )?.state_id ?? null
    );
  }
  function requireEntity(table: "works" | "conversations", id: string) {
    if (!db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(id))
      throw new OperationError(404, "NOT_FOUND");
  }
  function once<T>(key: string, content: unknown[], write: () => T): T {
    db.exec("BEGIN IMMEDIATE");
    try {
      const serialized = JSON.stringify(content);
      const receipt = db
        .prepare("SELECT content, result FROM receipts WHERE request_key = ?")
        .get(key) as { content: string; result: string } | undefined;
      if (receipt) {
        if (receipt.content !== serialized)
          throw new OperationError(409, "REQUEST_KEY_CONFLICT");
        db.exec("COMMIT");
        return JSON.parse(receipt.result) as T;
      }
      const result = write();
      db.prepare("INSERT INTO receipts VALUES (?, ?, ?)").run(
        key,
        serialized,
        JSON.stringify(result),
      );
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  const workColumns =
    "id, sequence, name, intent, NULL AS style, created_at AS createdAt";
  const conversationColumns =
    "id, sequence, work_id AS workId, NULL AS title, created_at AS createdAt";
  const recordColumns =
    "id, sequence, conversation_id AS conversationId, body, 'record' AS kind, 'human' AS author, created_at AS createdAt";
  if (
    !db
      .prepare("SELECT name FROM sqlite_master WHERE name = 'chat_sessions'")
      .get()
  ) {
    const backup = join(directory, "records.before-chat.sqlite");
    if (!existsSync(backup)) db.prepare("VACUUM INTO ?").run(backup);
    db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE chat_sessions (conversation_id TEXT PRIMARY KEY REFERENCES conversations(id), data TEXT NOT NULL);
      CREATE TABLE chat_selections (sequence INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL);
      CREATE TABLE chat_requests (sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, conversation_id TEXT NOT NULL REFERENCES conversations(id), work_id TEXT NOT NULL REFERENCES works(id), data TEXT NOT NULL);
      CREATE TABLE chat_events (sequence INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id TEXT NOT NULL REFERENCES conversations(id), request_id TEXT REFERENCES chat_requests(id));
      COMMIT;`);
  }
  const chat = chatStore(db, once);
  if (
    !db
      .prepare("SELECT name FROM sqlite_master WHERE name='auxiliary_jobs'")
      .get()
  ) {
    const backup = join(directory, "records.before-auxiliary.sqlite");
    if (!existsSync(backup)) db.prepare("VACUUM INTO ?").run(backup);
  }
  const auxiliary = auxiliaryStore(db, once);
  if (
    !db
      .prepare("SELECT name FROM sqlite_master WHERE name = 'text_revisions'")
      .get()
  ) {
    const backup = join(directory, "records.before-context.sqlite");
    if (!existsSync(backup)) db.prepare("VACUUM INTO ?").run(backup);
    db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE text_revisions (sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, work_id TEXT NOT NULL REFERENCES works(id), data TEXT NOT NULL);
      CREATE INDEX text_revisions_work ON text_revisions(work_id, sequence);
      CREATE TABLE context_operations (sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, request_id TEXT NOT NULL REFERENCES chat_requests(id), data TEXT NOT NULL);
      COMMIT;`);
  }
  const sides = sideStore(db, directory, once);
  const context = contextStore(db);
  function stateView(state: SavedState): SavedState {
    const text = context.recordText(state.recordId);
    return {
      ...state,
      recordBody: text.body,
      reason:
        "reason" in text
          ? typeof text.reason === "string"
            ? text.reason
            : null
          : state.reason,
    };
  }
  // Existing chats receive their inherited selection before a later choice changes it.
  for (const row of db
    .prepare("SELECT id FROM conversations ORDER BY sequence")
    .all())
    chat.session(row.id as string);
  return {
    sides,
    context,
    auxiliary,
    contextOperation: (
      key: string,
      requestId: string,
      input: unknown,
      execute: () => unknown,
    ) =>
      once(`tool:${key}`, [requestId, input], () => {
        const result = execute();
        db.prepare(
          "INSERT INTO context_operations (id, request_id, data) VALUES (?, ?, ?)",
        ).run(
          key,
          requestId,
          JSON.stringify({
            input,
            result,
            createdAt: new Date().toISOString(),
          }),
        );
        return result;
      }),
    chat,
    close: () => db.close(),
    defaultDefinition,
    workVersions,
    versionPlan,
    versionPlans: (workId: string): VersionPlan[] => {
      requireEntity("works", workId);
      return db
        .prepare(
          "SELECT data FROM version_plans WHERE work_id = ? ORDER BY rowid",
        )
        .all(workId)
        .map((row) => JSON.parse(row.data as string));
    },
    planVersions: (
      key: string,
      workId: string,
      select: () => { definition: GitReference; style: GitReference | null },
    ) =>
      once(key, ["version-plan", workId], () => {
        requireEntity("works", workId);
        const refs = select();
        const plan: VersionPlan = {
          id: randomUUID(),
          workId,
          ...refs,
          createdAt: new Date().toISOString(),
        };
        db.prepare("INSERT INTO version_plans VALUES (?, ?, ?)").run(
          plan.id,
          workId,
          JSON.stringify(plan),
        );
        return plan;
      }),
    selectDefault: (key: string, commit: string, select: () => GitReference) =>
      once(key, ["default-definition", commit], () => {
        const definition = select();
        db.prepare(
          "INSERT INTO git_settings (data, created_at) VALUES (?, ?)",
        ).run(JSON.stringify(definition), new Date().toISOString());
        return { definition };
      }),
    state: readState,
    operation,
    operations: (workId: string) => {
      requireEntity("works", workId);
      return db
        .prepare(
          "SELECT data FROM import_operations WHERE work_id = ? ORDER BY rowid",
        )
        .all(workId)
        .map((row) => JSON.parse(row.data as string) as ImportOperation);
    },
    states: (workId: string) => {
      requireEntity("works", workId);
      return {
        currentStateId: current(workId),
        states: db
          .prepare(
            "SELECT data FROM saved_states WHERE work_id = ? ORDER BY sequence",
          )
          .all(workId)
          .map((row) =>
            stateView(JSON.parse(row.data as string) as SavedState),
          ),
      };
    },
    planImport: (conversationId: string, input: ImportInput) => {
      const planned = once(
        input.requestKey,
        [
          "import",
          conversationId,
          input.body,
          input.application,
          input.beforeStateId,
          input.reason ?? null,
          input.render ? [input.render.stateId, input.render.fileId] : null,
          input.files.map((file) => [
            file.rootId,
            file.relativePath,
            file.role,
          ]),
        ],
        () => {
          requireEntity("conversations", conversationId);
          const workId = (
            db
              .prepare("SELECT work_id FROM conversations WHERE id = ?")
              .get(conversationId) as { work_id: string }
          ).work_id;
          const pending = db
            .prepare("SELECT data FROM import_operations WHERE work_id = ?")
            .all(workId)
            .some(
              (row) =>
                (JSON.parse(row.data as string) as ImportOperation).phase !==
                  "committed" &&
                (JSON.parse(row.data as string) as ImportOperation).phase !==
                  "abandoned",
            );
          if (pending) throw new OperationError(409, "IMPORT_PENDING");
          if (current(workId) !== input.beforeStateId)
            throw new OperationError(409, "STALE_STATE");
          if (
            input.beforeStateId &&
            readState(input.beforeStateId).workId !== workId
          )
            throw new OperationError(409, "WRONG_WORK");
          if (input.render) {
            const renderState = readState(input.render.stateId);
            if (
              renderState.workId !== workId ||
              !renderState.files.some(
                (file) =>
                  file.id === input.render!.fileId && file.role === "render",
              )
            )
              throw new OperationError(400, "INVALID_RENDER");
          }
          const op: ImportOperation = {
            id: randomUUID(),
            requestKey: input.requestKey,
            workId,
            conversationId,
            stateId: randomUUID(),
            input,
            phase: "planned",
            error: null,
            createdAt: new Date().toISOString(),
          };
          db.prepare("INSERT INTO import_operations VALUES (?, ?, ?, ?)").run(
            op.id,
            op.requestKey,
            workId,
            JSON.stringify(op),
          );
          return op;
        },
      );
      return operation(planned.id);
    },
    sealImport: (id: string, completionHash: string) => {
      const op = operation(id);
      op.completionHash = completionHash;
      db.prepare("UPDATE import_operations SET data = ? WHERE id = ?").run(
        JSON.stringify(op),
        id,
      );
    },
    abandonImport: (key: string, id: string) =>
      once(key, ["abandon-import", id], () => {
        const op = operation(id);
        if (op.phase !== "incomplete" && op.phase !== "abandoned")
          throw new OperationError(409, "RECONCILIATION_REQUIRED");
        op.phase = "abandoned";
        db.prepare("UPDATE import_operations SET data = ? WHERE id = ?").run(
          JSON.stringify(op),
          id,
        );
        return { operationId: id, status: "abandoned" };
      }),
    markImport: (
      id: string,
      phase: ImportOperation["phase"],
      error: string | null,
    ) => {
      const op = operation(id);
      if (op.phase === "committed") return;
      op.phase = phase;
      op.error = error;
      db.prepare("UPDATE import_operations SET data = ? WHERE id = ?").run(
        JSON.stringify(op),
        id,
      );
    },
    importResult: (id: string) => {
      const op = operation(id);
      const state = readState(op.stateId);
      const record = db
        .prepare(`SELECT ${recordColumns} FROM records WHERE id = ?`)
        .get(state.recordId) as unknown as BodyRecord;
      return {
        operationId: id,
        state: stateView(state),
        record: { ...record, ...context.latest(record) },
      };
    },
    commitImport: (id: string, state: SavedState) => {
      db.exec("BEGIN IMMEDIATE");
      try {
        const op = operation(id);
        if (op.phase !== "committed") {
          if (current(op.workId) !== op.input.beforeStateId)
            throw new OperationError(409, "STALE_STATE");
          db.prepare(
            "INSERT INTO records (id, conversation_id, body, created_at) VALUES (?, ?, ?, ?)",
          ).run(
            state.recordId,
            op.conversationId,
            op.input.body,
            state.createdAt,
          );
          db.prepare(
            "INSERT INTO saved_states (id, work_id, data) VALUES (?, ?, ?)",
          ).run(state.id, op.workId, JSON.stringify(state));
          db.prepare(
            "INSERT INTO current_states VALUES (?, ?) ON CONFLICT(work_id) DO UPDATE SET state_id = excluded.state_id",
          ).run(op.workId, state.id);
          db.prepare(
            "INSERT INTO current_state_updates (work_id, before_id, after_id, operation_id) VALUES (?, ?, ?, ?)",
          ).run(op.workId, op.input.beforeStateId, state.id, op.id);
          op.phase = "committed";
          op.error = null;
          db.prepare("UPDATE import_operations SET data = ? WHERE id = ?").run(
            JSON.stringify(op),
            op.id,
          );
        }
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    works: () =>
      (
        db
          .prepare(`SELECT ${workColumns} FROM works ORDER BY sequence`)
          .all() as unknown as Work[]
      ).map(decorateWork),
    createWork: (
      key: string,
      name: string,
      intent: string | null,
      styleCommit: string | null = null,
      select?: () => {
        definition: GitReference | null;
        style: GitReference | null;
      },
    ) =>
      once(
        key,
        ["work", name, intent, ...(styleCommit ? [styleCommit] : [])],
        () => {
          const refs = select?.() ?? { definition: null, style: null };
          const id = randomUUID();
          db.prepare(
            "INSERT INTO works (id, name, intent, created_at) VALUES (?, ?, ?, ?)",
          ).run(id, name, intent, new Date().toISOString());
          db.prepare("INSERT INTO work_git VALUES (?, ?)").run(
            id,
            JSON.stringify(refs),
          );
          return decorateWork(
            db
              .prepare(`SELECT ${workColumns} FROM works WHERE id = ?`)
              .get(id) as unknown as Work,
          );
        },
      ),
    conversations: (workId: string) => {
      requireEntity("works", workId);
      const result = db
        .prepare(
          `SELECT ${conversationColumns} FROM conversations WHERE work_id = ? AND id NOT IN (SELECT conversation_id FROM side_chats) ORDER BY sequence`,
        )
        .all(workId) as unknown as Conversation[];
      return result.map((c) => ({ ...c, title: auxiliary.name(c.id) }));
    },
    createConversation: (key: string, workId: string) =>
      once(key, ["conversation", workId], () => {
        requireEntity("works", workId);
        const id = randomUUID();
        db.prepare(
          "INSERT INTO conversations (id, work_id, created_at) VALUES (?, ?, ?)",
        ).run(id, workId, new Date().toISOString());
        chat.session(id);
        return db
          .prepare(
            `SELECT ${conversationColumns} FROM conversations WHERE id = ?`,
          )
          .get(id) as unknown as Conversation;
      }),
    records: (conversationId: string) => {
      requireEntity("conversations", conversationId);
      const records = db
        .prepare(
          `SELECT ${recordColumns} FROM records WHERE conversation_id = ? ORDER BY sequence`,
        )
        .all(conversationId) as unknown as BodyRecord[];
      return records.map((record) => ({
        ...record,
        ...context.latest(record),
      }));
    },
    createRecord: (key: string, conversationId: string, body: string) =>
      once(key, ["record", conversationId, body], () => {
        requireEntity("conversations", conversationId);
        sides.requireMain(conversationId);
        const id = randomUUID();
        db.prepare(
          "INSERT INTO records (id, conversation_id, body, created_at) VALUES (?, ?, ?, ?)",
        ).run(id, conversationId, body, new Date().toISOString());
        return db
          .prepare(`SELECT ${recordColumns} FROM records WHERE id = ?`)
          .get(id) as unknown as BodyRecord;
      }),
  };
}

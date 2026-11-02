import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { Work, Conversation, BodyRecord } from "../shared/contracts.js";

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
  return {
    close: () => db.close(),
    works: () =>
      db
        .prepare(`SELECT ${workColumns} FROM works ORDER BY sequence`)
        .all() as unknown as Work[],
    createWork: (key: string, name: string, intent: string | null) =>
      once(key, ["work", name, intent], () => {
        const id = randomUUID();
        db.prepare(
          "INSERT INTO works (id, name, intent, created_at) VALUES (?, ?, ?, ?)",
        ).run(id, name, intent, new Date().toISOString());
        return db
          .prepare(`SELECT ${workColumns} FROM works WHERE id = ?`)
          .get(id) as unknown as Work;
      }),
    conversations: (workId: string) => {
      requireEntity("works", workId);
      return db
        .prepare(
          `SELECT ${conversationColumns} FROM conversations WHERE work_id = ? ORDER BY sequence`,
        )
        .all(workId) as unknown as Conversation[];
    },
    createConversation: (key: string, workId: string) =>
      once(key, ["conversation", workId], () => {
        requireEntity("works", workId);
        const id = randomUUID();
        db.prepare(
          "INSERT INTO conversations (id, work_id, created_at) VALUES (?, ?, ?)",
        ).run(id, workId, new Date().toISOString());
        return db
          .prepare(
            `SELECT ${conversationColumns} FROM conversations WHERE id = ?`,
          )
          .get(id) as unknown as Conversation;
      }),
    records: (conversationId: string) => {
      requireEntity("conversations", conversationId);
      return db
        .prepare(
          `SELECT ${recordColumns} FROM records WHERE conversation_id = ? ORDER BY sequence`,
        )
        .all(conversationId) as unknown as BodyRecord[];
    },
    createRecord: (key: string, conversationId: string, body: string) =>
      once(key, ["record", conversationId, body], () => {
        requireEntity("conversations", conversationId);
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

import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { SideChat } from "../shared/side-chat.js";
import { OperationError } from "./store.js";

/** Keep frozen originals behind read_records instead of putting them in every turn. */
export function sideReference(side: SideChat) {
  const shared = side.snapshot as {
    work: unknown;
    states: { currentStateId: string | null };
    style: unknown;
  };
  const latest = side.mainMessages.at(-1);
  return {
    conversationId: side.conversationId,
    mainConversationId: side.mainConversationId,
    topic: side.topic,
    fixedAt: side.createdAt,
    work: shared.work,
    currentStateId: shared.states.currentStateId,
    style: shared.style,
    selectedStates: side.selectedStates.map((s) => ({
      id: s.id,
      application: s.application,
      files: s.files.map((f) => ({ id: f.id, role: f.role, sha256: f.sha256 })),
      missing: s.missing,
    })),
    latestMainMessage: latest
      ? {
          id: latest.id,
          excerpt: latest.body.slice(0, 4000),
          excerptOnly: true,
        }
      : null,
    originals: {
      tool: "read_records",
      recordCount: side.history.records.length,
      requestCount: side.history.requests.length,
    },
  };
}

export function sideStore(
  db: DatabaseSync,
  directory: string,
  once: <T>(key: string, content: unknown[], write: () => T) => T,
) {
  if (
    !db.prepare("SELECT name FROM sqlite_master WHERE name='side_chats'").get()
  ) {
    const backup = join(directory, "records.before-side-chats.sqlite");
    if (!existsSync(backup)) db.prepare("VACUUM INTO ?").run(backup);
    db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE side_chats (conversation_id TEXT PRIMARY KEY REFERENCES conversations(id), main_conversation_id TEXT NOT NULL REFERENCES conversations(id), data TEXT NOT NULL);
      CREATE INDEX side_chats_main ON side_chats(main_conversation_id);
      COMMIT;`);
  }
  function get(id: string): SideChat | null {
    const row = db
      .prepare("SELECT data FROM side_chats WHERE conversation_id=?")
      .get(id);
    return row ? JSON.parse(row.data as string) : null;
  }
  return {
    get,
    requireMain(id: string) {
      if (get(id)) throw new OperationError(403, "SIDE_CHAT_READ_ONLY");
    },
    list(mainId: string): SideChat[] {
      return db
        .prepare(
          "SELECT data FROM side_chats WHERE main_conversation_id=? ORDER BY rowid",
        )
        .all(mainId)
        .map((row) => JSON.parse(row.data as string));
    },
    create(
      key: string,
      mainId: string,
      selectedStateIds: string[],
      capture: (
        workId: string,
      ) => Omit<
        SideChat,
        "conversationId" | "mainConversationId" | "topic" | "createdAt"
      >,
    ) {
      return once(key, ["side-chat", mainId, selectedStateIds], () => {
        const main = db
          .prepare("SELECT work_id FROM conversations WHERE id=?")
          .get(mainId);
        if (!main) throw new OperationError(404, "NOT_FOUND");
        if (get(mainId)) throw new OperationError(403, "SIDE_CHAT_READ_ONLY");
        const fixed = capture(main.work_id as string);
        const side: SideChat = {
          ...fixed,
          conversationId: randomUUID(),
          mainConversationId: mainId,
          createdAt: new Date().toISOString(),
        };
        db.prepare(
          "INSERT INTO conversations (id,work_id,created_at) VALUES (?,?,?)",
        ).run(side.conversationId, main.work_id as string, side.createdAt);
        db.prepare("INSERT INTO side_chats VALUES (?,?,?)").run(
          side.conversationId,
          mainId,
          JSON.stringify(side),
        );
        return side;
      });
    },
  };
}

import type { DatabaseSync } from "node:sqlite";
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  renameSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import type { ChatRequest } from "../shared/chat.js";
import type {
  ReferencePage,
  ReferenceCandidate,
  ReferenceSelection,
  ReferenceView,
} from "../shared/references.js";
import { OperationError } from "./store.js";
export function referenceStore(
  db: DatabaseSync,
  directory: string,
  imageRoot?: string,
) {
  if (
    !db
      .prepare("SELECT name FROM sqlite_master WHERE name='reference_searches'")
      .get()
  ) {
    const backup = join(directory, "records.before-references.sqlite");
    if (!existsSync(backup)) db.prepare("VACUUM INTO ?").run(backup);
    db.exec(`BEGIN IMMEDIATE;
   CREATE TABLE reference_searches (sequence INTEGER PRIMARY KEY AUTOINCREMENT, request_id TEXT NOT NULL REFERENCES chat_requests(id), item_id TEXT NOT NULL, attempt INTEGER NOT NULL, work_id TEXT NOT NULL REFERENCES works(id), data TEXT NOT NULL, UNIQUE(request_id,attempt,item_id));
   COMMIT;`);
  }
  if (
    !db
      .prepare("SELECT name FROM sqlite_master WHERE name='reference_pages'")
      .get()
  )
    db.exec(`BEGIN IMMEDIATE;
  CREATE TABLE reference_pages (sequence INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,work_id TEXT NOT NULL REFERENCES works(id),request_id TEXT NOT NULL REFERENCES chat_requests(id),data TEXT NOT NULL);
  CREATE TABLE reference_candidates (sequence INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,work_id TEXT NOT NULL REFERENCES works(id),page_id TEXT NOT NULL REFERENCES reference_pages(id),data TEXT NOT NULL);
  CREATE TABLE reference_selections (sequence INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,reference_id TEXT NOT NULL REFERENCES reference_candidates(id),request_id TEXT NOT NULL REFERENCES chat_requests(id),data TEXT NOT NULL,UNIQUE(reference_id,request_id));
  COMMIT;`);
  // An old process cannot still own an in-progress external search.
  if (
    db
      .prepare(
        "SELECT 1 FROM reference_searches WHERE json_extract(data,'$.status')='in_progress' LIMIT 1",
      )
      .get()
  )
    db.prepare(
      "UPDATE reference_searches SET data=json_set(data,'$.status','interrupted') WHERE json_extract(data,'$.status')='in_progress'",
    ).run();
  function view(workId: string): ReferenceView {
    const rows = (table: string) =>
      db
        .prepare(`SELECT data FROM ${table} WHERE work_id=? ORDER BY sequence`)
        .all(workId)
        .map((row) => JSON.parse(row.data as string));
    return {
      searches: rows("reference_searches"),
      pages: rows("reference_pages"),
      candidates: rows("reference_candidates"),
      selections: db
        .prepare(
          "SELECT s.data FROM reference_selections s JOIN reference_candidates c ON c.id=s.reference_id WHERE c.work_id=? ORDER BY s.sequence",
        )
        .all(workId)
        .map((row) => JSON.parse(row.data as string)),
    };
  }
  function page(workId: string, id: string): ReferencePage {
    const value = view(workId).pages.find((p) => p.id === id);
    if (!value) throw new OperationError(404, "REFERENCE_PAGE_NOT_FOUND");
    return value;
  }
  function find(id: string): ReferenceCandidate {
    const row = db
      .prepare("SELECT data FROM reference_candidates WHERE id=?")
      .get(id);
    if (!row) throw new OperationError(404, "REFERENCE_NOT_FOUND");
    return JSON.parse(row.data as string);
  }
  function candidate(workId: string, id: string) {
    const value = find(id);
    if (value.workId !== workId)
      throw new OperationError(404, "REFERENCE_NOT_FOUND");
    return value;
  }
  function persistPage(p: ReferencePage) {
    db.prepare(
      "INSERT INTO reference_pages (id,work_id,request_id,data) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
    ).run(p.id, p.workId, p.requestId, JSON.stringify(p));
  }
  function source(r: ChatRequest) {
    return {
      workId: r.workId,
      requestId: r.id,
      conversationId: r.conversationId,
      threadId: r.threadId,
      turnId: r.turnId,
      attempt: r.retryCount,
      checkedAt: new Date().toISOString(),
    };
  }
  return {
    view,
    page,
    candidate,
    find,
    source,
    persistPage,
    context(workId: string) {
      const data = view(workId);
      const selected = data.candidates.filter((c) =>
        data.selections.some((s) => s.referenceId === c.id),
      );
      return {
        selected,
        pages: data.pages.filter((p) =>
          selected.some(
            (c) => c.pageId === p.id || c.image.permissionPageId === p.id,
          ),
        ),
        selections: data.selections,
      };
    },
    canStoreImage: Boolean(imageRoot),
    search(r: ChatRequest, item: any, complete: boolean) {
      if (item.type !== "webSearch" || r.role !== "reference") return;
      const data = {
        ...source(r),
        itemId: item.id,
        query: item.query ?? null,
        action: item.action ?? null,
        status: complete ? "completed" : "in_progress",
        resultAvailability: Array.isArray(item.results)
          ? item.results.length
            ? "results"
            : "empty"
          : "not_provided",
        results: item.results ?? null,
      };
      const old = db
        .prepare(
          "SELECT data FROM reference_searches WHERE request_id=? AND attempt=? AND item_id=?",
        )
        .get(r.id, r.retryCount, item.id);
      if (old) {
        const previous = JSON.parse(old.data as string);
        if (!complete && previous.status === "completed") return;
        if (item.results == null && Array.isArray(previous.results)) {
          data.results = previous.results;
          data.resultAvailability = previous.resultAvailability;
        }
        data.action ??= previous.action;
        data.query ??= previous.query;
      }
      db.prepare(
        "INSERT INTO reference_searches (request_id,item_id,attempt,work_id,data) VALUES (?,?,?,?,?) ON CONFLICT(request_id,attempt,item_id) DO UPDATE SET data=excluded.data",
      ).run(r.id, item.id, r.retryCount, r.workId, JSON.stringify(data));
    },
    finishSearches(r: ChatRequest, status: string) {
      const rows = db
        .prepare(
          "SELECT sequence,data FROM reference_searches WHERE request_id=? AND attempt=?",
        )
        .all(r.id, r.retryCount);
      for (const row of rows) {
        const data = JSON.parse(row.data as string);
        if (data.status !== "in_progress") continue;
        data.status = status === "completed" ? "unknown" : status;
        data.checkedAt = new Date().toISOString();
        db.prepare("UPDATE reference_searches SET data=? WHERE sequence=?").run(
          JSON.stringify(data),
          row.sequence,
        );
      }
    },
    save(c: ReferenceCandidate, bytes?: Buffer) {
      if (bytes) {
        const root = join(imageRoot!, "reference-images");
        mkdirSync(root, { recursive: true, mode: 0o700 });
        const temporary = join(root, `${c.id}.partial`);
        writeFileSync(temporary, bytes, { mode: 0o600 });
        renameSync(temporary, join(root, c.id));
      }
      db.prepare(
        "INSERT INTO reference_candidates (id,work_id,page_id,data) VALUES (?,?,?,?)",
      ).run(c.id, c.workId, c.pageId, JSON.stringify(c));
      return { complete: true, candidate: c, link: `/api/references/${c.id}` };
    },
    select(
      r: ChatRequest,
      id: string,
      authorization: import("./reference-interpreter.js").ReferenceAuthorization,
    ) {
      const c = candidate(r.workId, id);
      if (
        authorization.status !== "select" ||
        authorization.referenceId !== c.id
      )
        throw new OperationError(403, "EXPLICIT_INSTRUCTION_REQUIRED");
      const old = view(r.workId).selections.find(
        (s) => s.requestId === r.id && s.referenceId === id,
      );
      if (old) return { complete: true, selection: old };
      const selection: ReferenceSelection = {
        id: randomUUID(),
        referenceId: id,
        requestId: r.id,
        body: r.body,
        authorization,
        author: "human",
        createdAt: new Date().toISOString(),
      };
      db.prepare(
        "INSERT INTO reference_selections (id,reference_id,request_id,data) VALUES (?,?,?,?)",
      ).run(selection.id, id, r.id, JSON.stringify(selection));
      return { complete: true, selection };
    },
    image(c: ReferenceCandidate) {
      if (!imageRoot)
        throw new OperationError(409, "FILE_STORAGE_NOT_CONFIGURED");
      if (c.image.status !== "stored")
        throw new OperationError(404, "REFERENCE_IMAGE_NOT_RETAINED");
      let bytes: Buffer;
      try {
        bytes = readFileSync(join(imageRoot!, "reference-images", c.id));
      } catch {
        throw new OperationError(404, "REFERENCE_IMAGE_MISSING");
      }
      if (
        createHash("sha256").update(bytes).digest("hex") !== c.image.sha256 ||
        bytes.length !== c.image.size
      )
        throw new OperationError(409, "REFERENCE_IMAGE_CORRUPT");
      return bytes;
    },
  };
}

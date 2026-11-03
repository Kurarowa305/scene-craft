import type { DatabaseSync } from "node:sqlite";
import { randomUUID, createHash } from "node:crypto";
import type { RecordInstruction } from "../shared/record-instruction.js";
import type { ChatRequest } from "../shared/chat.js";
import { OperationError } from "./store.js";

export interface TextRevision {
  id: string;
  workId: string;
  targetId: string;
  field: string;
  body: string;
  previousId: string | null;
  previousBody: string | null;
  sourceRequestId: string;
  author: "human";
  createdAt: string;
}

// Fast path for existing shorthand. Other wording is interpreted in a separate
// tool-free thread and bound to the original human message before applying.
export function explicitInstruction(body: string): RecordInstruction | null {
  const intent = /^制作意図を更新: ([\s\S]+)$/.exec(body);
  if (intent)
    return { tool: "update_work_context", field: "intent", body: intent[1] };
  const record = /^手作業を記録: ([\s\S]+)$/.exec(body);
  if (record)
    return { tool: "record_manual_work", field: "body", body: record[1] };
  const amend =
    /^記録を訂正: ([a-f0-9-]{36}) (body|reason|summary) ([\s\S]+)$/.exec(body);
  if (
    amend &&
    (amend[2] === "body" || amend[2] === "reason" || amend[2] === "summary")
  )
    return {
      tool: "amend_record",
      targetId: amend[1],
      field: amend[2],
      body: amend[3],
    };
  return null;
}

export function contextStore(db: DatabaseSync) {
  function revisions(workId: string): TextRevision[] {
    return db
      .prepare(
        "SELECT data FROM text_revisions WHERE work_id = ? ORDER BY sequence",
      )
      .all(workId)
      .map((row) => JSON.parse(row.data as string));
  }
  function context(workId: string) {
    const work = db
      .prepare("SELECT id, name, intent FROM works WHERE id = ?")
      .get(workId);
    if (!work) throw new OperationError(404, "NOT_FOUND");
    return { work, revisions: revisions(workId) };
  }
  function history(workId: string, after = 0, afterRequests = 0) {
    const rows = db
      .prepare(
        `SELECT r.id, r.sequence, r.conversation_id AS conversationId,
      r.body, r.created_at AS createdAt FROM records r
      JOIN conversations c ON c.id = r.conversation_id
      WHERE c.work_id = ? AND r.sequence > ? ORDER BY r.sequence LIMIT 50`,
      )
      .all(workId, after);
    const conversations = db
      .prepare(
        "SELECT id FROM conversations WHERE work_id = ? ORDER BY sequence",
      )
      .all(workId);
    const requestRows = db
      .prepare(
        "SELECT sequence, data FROM chat_requests WHERE work_id = ? AND sequence > ? ORDER BY sequence LIMIT 50",
      )
      .all(workId, afterRequests);
    const requests = requestRows.map((row) => JSON.parse(row.data as string));
    return {
      records: rows,
      conversations,
      requests,
      nextAfter: rows.length === 50 ? rows.at(-1)!.sequence : null,
      nextRequestAfter:
        requestRows.length === 50 ? requestRows.at(-1)!.sequence : null,
      revisions: revisions(workId),
      originalText: true,
    };
  }
  function latest(record: { id: string; body: string }) {
    const row = db
      .prepare(
        `SELECT c.work_id FROM conversations c JOIN records r ON r.conversation_id = c.id WHERE r.id = ?`,
      )
      .get(record.id);
    const changes = revisions(row!.work_id as string).filter(
      (v) => v.targetId === record.id,
    );
    if (!changes.length) return record;
    const result = {
      ...record,
      originalBody: record.body,
      reason: initialReason(record.id),
      summary: null as string | null,
    };
    for (const revision of changes) {
      if (revision.field === "body") result.body = revision.body;
      if (revision.field === "reason") result.reason = revision.body;
      if (revision.field === "summary") result.summary = revision.body;
    }
    return result;
  }
  function initialReason(recordId: string): string | null {
    const state = db
      .prepare(
        "SELECT data FROM saved_states WHERE json_extract(data, '$.recordId') = ? LIMIT 1",
      )
      .get(recordId);
    return state ? (JSON.parse(state.data as string).reason ?? null) : null;
  }
  function apply(r: ChatRequest, tool: string, args: Record<string, unknown>) {
    const resolved = r.recordInterpretation;
    if (
      resolved &&
      resolved.sourceHash !== createHash("sha256").update(r.body).digest("hex")
    )
      throw new OperationError(403, "EXPLICIT_INSTRUCTION_REQUIRED");
    const directive = explicitInstruction(r.body) ?? resolved?.instruction;
    if (!directive || directive.tool !== tool || args.sourceRequestId !== r.id)
      throw new OperationError(403, "EXPLICIT_INSTRUCTION_REQUIRED");
    // No model-authored value, target, role or work ID can enlarge this directive.
    const allowed = ["sourceRequestId", "contextRef", "operationId"];
    if (Object.keys(args).some((key) => !allowed.includes(key)))
      throw new OperationError(403, "PERMISSION_DENIED");
    const existing = revisions(r.workId).find(
      (v) => v.sourceRequestId === r.id,
    );
    if (existing)
      return { operationId: existing.id, complete: true, revision: existing };
    let targetId = r.workId;
    let previousBody: string | null = null;
    if (tool === "update_work_context") {
      previousBody = context(r.workId).work.intent as string | null;
    } else if (tool === "record_manual_work") {
      targetId = randomUUID();
      db.prepare(
        "INSERT INTO records (id, conversation_id, body, created_at) VALUES (?, ?, ?, ?)",
      ).run(
        targetId,
        r.conversationId,
        directive.body,
        new Date().toISOString(),
      );
    } else {
      targetId = directive.targetId!;
      const record = db
        .prepare(
          `SELECT r.body FROM records r JOIN conversations c ON c.id = r.conversation_id
          WHERE r.id = ? AND c.work_id = ?`,
        )
        .get(targetId, r.workId);
      if (!record) throw new OperationError(404, "RECORD_NOT_FOUND");
      if (directive.field === "body") previousBody = record.body as string;
      if (directive.field === "reason") previousBody = initialReason(targetId);
    }
    const previous = revisions(r.workId)
      .filter((v) => v.targetId === targetId && v.field === directive.field)
      .at(-1);
    const revision: TextRevision = {
      id: randomUUID(),
      workId: r.workId,
      targetId,
      field: directive.field,
      body: directive.body,
      previousId: previous?.id ?? null,
      previousBody: previous?.body ?? previousBody,
      sourceRequestId: r.id,
      author: "human",
      createdAt: new Date().toISOString(),
    };
    db.prepare(
      "INSERT INTO text_revisions (id, work_id, data) VALUES (?, ?, ?)",
    ).run(revision.id, r.workId, JSON.stringify(revision));
    if (tool === "update_work_context")
      db.prepare("UPDATE works SET intent = ? WHERE id = ?").run(
        directive.body,
        r.workId,
      );
    return { operationId: revision.id, complete: true, revision };
  }
  function recordTargets(workId: string) {
    return db
      .prepare(
        `SELECT r.id, r.body FROM records r JOIN conversations c ON c.id = r.conversation_id
      WHERE c.work_id = ? ORDER BY r.sequence DESC LIMIT 50`,
      )
      .all(workId)
      .map((row) => latest({ id: row.id as string, body: row.body as string }));
  }
  return { context, history, apply, latest, recordTargets };
}

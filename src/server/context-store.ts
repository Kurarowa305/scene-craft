import type { DatabaseSync } from "node:sqlite";
import { randomUUID, createHash } from "node:crypto";
import type { RecordInstruction } from "../shared/record-instruction.js";
import type { ChatRequest } from "../shared/chat.js";
import { OperationError } from "./store.js";

export interface TextRevision {
  action?: "create" | "update";
  mode?: "replace" | "append" | "edit";
  addedText?: string;
  format?: "unified-record-v1";
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
  const intentAppend = /^制作意図に追記: ([\s\S]+)$/.exec(body);
  if (intentAppend)
    return {
      tool: "update_work_context",
      field: "intent",
      mode: "append",
      body: intentAppend[1],
    };
  const recordAppend = /^記録に追記: ([a-f0-9-]{36}) ([\s\S]+)$/.exec(body);
  if (recordAppend)
    return {
      tool: "amend_record",
      field: "body",
      mode: "append",
      targetId: recordAppend[1],
      body: recordAppend[2],
    };
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
  function operation(directive: RecordInstruction) {
    const action =
      directive.action ??
      (directive.mode === "append" || directive.mode === "edit"
        ? "update"
        : "create");
    if (directive.field === "intent")
      return action === "create" ? "create_work_intent" : "update_work_intent";
    if (directive.field === "body")
      return action === "create"
        ? "create_manual_record"
        : "update_manual_record";
    return "legacy_amend";
  }
  function acceptsTool(tool: string, directive: RecordInstruction) {
    const op = operation(directive);
    return (
      tool === op ||
      (tool === "update_work_context" && directive.field === "intent") ||
      (tool === "record_manual_work" && op === "create_manual_record") ||
      (tool === "amend_record" &&
        Boolean(directive.targetId) &&
        directive.field !== "intent")
    );
  }
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
    const originalReason = initialReason(record.id);
    if (!changes.length && !originalReason) return record;
    const result = {
      ...record,
      originalBody: record.body,
      reason: originalReason,
      summary: null as string | null,
    };
    let unified = false;
    for (const revision of changes) {
      if (revision.field === "body") {
        result.body = revision.body;
        if (revision.format === "unified-record-v1") {
          unified = true;
          result.reason = null;
        }
      }
      if (revision.field === "reason") {
        // Older clients can still submit their old reason command. Keep its text
        // in the unified note once a record has switched to the new format.
        if (unified) result.body = appendText(result.body, revision.body);
        else result.reason = revision.body;
      }
      if (revision.field === "summary") result.summary = revision.body;
    }
    if (!unified) result.body = appendText(result.body, result.reason);
    return result;
  }
  function appendText(before: string | null, text: string | null) {
    return before && text ? `${before}\n${text}` : before || text || "";
  }
  function recordText(id: string) {
    const row = db.prepare("SELECT body FROM records WHERE id = ?").get(id);
    if (!row) throw new OperationError(404, "RECORD_NOT_FOUND");
    return latest({ id, body: row.body as string });
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
    if (
      !directive ||
      !acceptsTool(tool, directive) ||
      args.sourceRequestId !== r.id
    )
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
    if (directive.field === "intent") {
      previousBody = context(r.workId).work.intent as string | null;
    } else if (
      operation(directive) === "create_manual_record" &&
      !directive.targetId
    ) {
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
      if (directive.field === "body") previousBody = recordText(targetId).body;
      if (directive.field === "reason") previousBody = initialReason(targetId);
    }
    const previous = revisions(r.workId)
      .filter((v) => v.targetId === targetId && v.field === directive.field)
      .at(-1);
    if (directive.field !== "body")
      previousBody = previous?.body ?? previousBody;
    if (directive.baseText !== undefined && directive.baseText !== previousBody)
      throw new OperationError(409, "STALE_RECORD_TEXT");
    const mode = directive.mode ?? "replace";
    const nextBody =
      mode === "append"
        ? appendText(previousBody, directive.body)
        : directive.body;
    const revision: TextRevision = {
      id: randomUUID(),
      workId: r.workId,
      targetId,
      field: directive.field,
      body: nextBody,
      mode,
      action:
        directive.action ??
        (mode === "append" || mode === "edit" ? "update" : "create"),
      ...(directive.field === "body"
        ? { format: "unified-record-v1" as const }
        : {}),
      ...(mode === "append" ? { addedText: directive.body } : {}),
      previousId: previous?.id ?? null,
      previousBody,
      sourceRequestId: r.id,
      author: "human",
      createdAt: new Date().toISOString(),
    };
    db.prepare(
      "INSERT INTO text_revisions (id, work_id, data) VALUES (?, ?, ?)",
    ).run(revision.id, r.workId, JSON.stringify(revision));
    if (directive.field === "intent")
      db.prepare("UPDATE works SET intent = ? WHERE id = ?").run(
        nextBody,
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
  return { context, history, apply, latest, recordTargets, recordText };
}

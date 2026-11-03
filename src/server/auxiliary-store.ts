import type { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import type {
  AuxiliaryJob,
  AuxiliaryView,
  SourceText,
  SummaryRevision,
} from "../shared/auxiliary.js";
import type { ChatRequest } from "../shared/chat.js";
import { OperationError } from "./store.js";

export function auxiliaryStore(
  db: DatabaseSync,
  once: <T>(key: string, content: unknown[], write: () => T) => T,
) {
  if (
    !db
      .prepare("SELECT name FROM sqlite_master WHERE name='auxiliary_jobs'")
      .get()
  )
    db.exec(`BEGIN IMMEDIATE; CREATE TABLE IF NOT EXISTS auxiliary_settings (id INTEGER PRIMARY KEY CHECK(id=1), model TEXT NOT NULL);
    INSERT OR IGNORE INTO auxiliary_settings VALUES (1, 'gpt-6-luna');
    CREATE TABLE IF NOT EXISTS conversation_names (conversation_id TEXT PRIMARY KEY REFERENCES conversations(id), name TEXT NOT NULL, author TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS auxiliary_pauses (conversation_id TEXT PRIMARY KEY REFERENCES conversations(id), source_request_id TEXT NOT NULL REFERENCES chat_requests(id), error TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS auxiliary_jobs (sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, conversation_id TEXT NOT NULL REFERENCES conversations(id), data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS summary_revisions (sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, conversation_id TEXT NOT NULL REFERENCES conversations(id), data TEXT NOT NULL); COMMIT;`);
  function model() {
    return db.prepare("SELECT model FROM auxiliary_settings WHERE id=1").get()!
      .model as string;
  }
  function jobs(id: string): AuxiliaryJob[] {
    return db
      .prepare(
        "SELECT data FROM auxiliary_jobs WHERE conversation_id=? ORDER BY sequence",
      )
      .all(id)
      .map((row) => JSON.parse(row.data as string));
  }
  function summaries(id: string): SummaryRevision[] {
    return db
      .prepare(
        "SELECT data FROM summary_revisions WHERE conversation_id=? ORDER BY sequence",
      )
      .all(id)
      .map((row) => JSON.parse(row.data as string));
  }
  function sources(id: string): SourceText[] {
    const records = db
      .prepare(
        "SELECT id, body FROM records WHERE conversation_id=? ORDER BY sequence",
      )
      .all(id)
      .map((row) => ({
        id: `record:${row.id}`,
        requestId: null,
        body: row.body as string,
        complete: true,
      }));
    const requests: ChatRequest[] = db
      .prepare(
        "SELECT data FROM chat_requests WHERE conversation_id=? ORDER BY sequence",
      )
      .all(id)
      .map((row) => JSON.parse(row.data as string));
    return [
      ...records,
      ...requests.flatMap((r) => [
        {
          id: `request:${r.id}`,
          requestId: r.id,
          body: r.body,
          complete: true,
        },
        ...[...r.attempts, r].flatMap((a, index) =>
          a.items
            .filter((i) => i.type === "agentMessage")
            .map((i) => ({
              id: `item:${r.id}:${index}:${i.id}:${i.complete ? "complete" : "partial"}:${createHash("sha256").update(i.text).digest("hex")}`,
              requestId: r.id,
              body: i.text,
              complete: i.complete,
            })),
        ),
      ]),
    ];
  }
  function view(id: string): AuxiliaryView {
    if (!db.prepare("SELECT id FROM conversations WHERE id=?").get(id))
      throw new OperationError(404, "NOT_FOUND");
    const name = db
      .prepare(
        "SELECT name, author FROM conversation_names WHERE conversation_id=?",
      )
      .get(id);
    const all = summaries(id);
    const covered = new Set(all.flatMap((s) => s.sources.map((t) => t.id)));
    return {
      model: model(),
      name: (name?.name as string) ?? null,
      nameAuthor: (name?.author as AuxiliaryView["nameAuthor"]) ?? null,
      jobs: jobs(id),
      summaries: all,
      pending: sources(id).filter((s) => !covered.has(s.id)),
    };
  }
  function save(job: AuxiliaryJob) {
    db.prepare("UPDATE auxiliary_jobs SET data=? WHERE id=?").run(
      JSON.stringify(job),
      job.id,
    );
  }
  // Ownership was lost: pending work is never dispatched automatically on restart.
  for (const row of db.prepare("SELECT data FROM auxiliary_jobs").all()) {
    const job: AuxiliaryJob = JSON.parse(row.data as string);
    if (["pending", "running"].includes(job.status)) {
      job.status = "failed";
      job.error = "PROCESS_INTERRUPTED";
      job.finishedAt = new Date().toISOString();
      save(job);
    }
  }
  const api = {
    view,
    save,
    name(id: string) {
      return (
        (db
          .prepare(
            "SELECT name FROM conversation_names WHERE conversation_id=?",
          )
          .get(id)?.name as string) ?? null
      );
    },
    paused(id: string, requestId: string) {
      return !!db
        .prepare(
          "SELECT error FROM auxiliary_pauses WHERE conversation_id=? AND source_request_id=?",
        )
        .get(id, requestId);
    },
    pause(job: AuxiliaryJob) {
      db.prepare(
        "INSERT INTO auxiliary_pauses VALUES (?,?,?) ON CONFLICT(conversation_id) DO UPDATE SET source_request_id=excluded.source_request_id,error=excluded.error",
      ).run(job.conversationId, job.sourceRequestId, job.error);
    },
    pending(id: string) {
      const row = db
        .prepare("SELECT data FROM auxiliary_jobs WHERE id=?")
        .get(id);
      return row && JSON.parse(row.data as string).status === "pending";
    },
    configure(key: string, value: string) {
      return once(key, ["auxiliary-model", value], () => {
        db.prepare("UPDATE auxiliary_settings SET model=? WHERE id=1").run(
          value,
        );
        return { model: value };
      });
    },
    rename(key: string, id: string, name: string) {
      view(id);
      return once(key, ["conversation-name", id, name], () => {
        db.prepare(
          "INSERT INTO conversation_names VALUES (?,?,'human',?) ON CONFLICT(conversation_id) DO UPDATE SET name=excluded.name,author='human',created_at=excluded.created_at",
        ).run(id, name, new Date().toISOString());
        return { name };
      });
    },
    create(
      r: ChatRequest,
      kind: AuxiliaryJob["kind"],
      explicit = false,
    ): AuxiliaryJob | null {
      const current = view(r.conversationId);
      if (
        kind === "name" &&
        (current.name ||
          current.jobs.some(
            (j) =>
              j.kind === "name" &&
              (!explicit ||
                ["pending", "running", "completed"].includes(j.status)),
          ))
      )
        return null;
      const first: ChatRequest = JSON.parse(
        db
          .prepare(
            "SELECT data FROM chat_requests WHERE conversation_id=? ORDER BY sequence LIMIT 1",
          )
          .get(r.conversationId)!.data as string,
      );
      const texts =
        kind === "name"
          ? [
              {
                id: `request:${first.id}`,
                requestId: first.id,
                body: first.body,
                complete: true,
              },
            ]
          : current.pending;
      if (
        !texts.length ||
        current.jobs.some(
          (j) => j.kind === kind && ["pending", "running"].includes(j.status),
        )
      )
        return null;
      const job: AuxiliaryJob = {
        id: randomUUID(),
        conversationId: r.conversationId,
        kind,
        model: current.model,
        sourceRequestId: r.id,
        generation: r.retryCount,
        sources: texts,
        status: "pending",
        threadId: null,
        turnId: null,
        runtime: null,
        actualModel: null,
        error: null,
        result: null,
        createdAt: new Date().toISOString(),
        finishedAt: null,
      };
      db.prepare(
        "INSERT INTO auxiliary_jobs (id,conversation_id,data) VALUES (?,?,?)",
      ).run(job.id, job.conversationId, JSON.stringify(job));
      return job;
    },
    finish(job: AuxiliaryJob, text: string) {
      once(
        `auxiliary-result-${job.id}`,
        ["auxiliary-result", job.id, text],
        () => {
          job.result = text;
          job.status = "completed";
          job.finishedAt = new Date().toISOString();
          save(job);
          if (job.kind === "name")
            db.prepare(
              "INSERT OR IGNORE INTO conversation_names VALUES (?,?,'assistant',?)",
            ).run(job.conversationId, text, job.finishedAt);
          else {
            const revision: SummaryRevision = {
              id: randomUUID(),
              jobId: job.id,
              body: text,
              sources: job.sources,
              previousId: null,
              author: "assistant",
              createdAt: job.finishedAt,
            };
            db.prepare(
              "INSERT INTO summary_revisions (id,conversation_id,data) VALUES (?,?,?)",
            ).run(revision.id, job.conversationId, JSON.stringify(revision));
          }
          return { id: job.id };
        },
      );
    },
    correct(key: string, id: string, summaryId: string, body: string) {
      return once(key, ["summary-correction", id, summaryId, body], () => {
        const all = summaries(id);
        const old = all.find((s) => s.id === summaryId);
        if (!old) throw new OperationError(404, "NOT_FOUND");
        if (all.some((s) => s.previousId === summaryId))
          throw new OperationError(409, "STALE_SUMMARY");
        const revision: SummaryRevision = {
          ...old,
          id: randomUUID(),
          body,
          previousId: old.id,
          author: "human",
          createdAt: new Date().toISOString(),
        };
        db.prepare(
          "INSERT INTO summary_revisions (id,conversation_id,data) VALUES (?,?,?)",
        ).run(revision.id, id, JSON.stringify(revision));
        return revision;
      });
    },
  };
  return {
    ...api,
    context(workId: string) {
      return db
        .prepare(
          "SELECT id FROM conversations WHERE work_id=? AND id NOT IN (SELECT conversation_id FROM side_chats) ORDER BY sequence",
        )
        .all(workId)
        .map((row) => {
          const value = view(row.id as string);
          return {
            conversationId: row.id,
            summaries: value.summaries.filter(
              (s) => !value.summaries.some((v) => v.previousId === s.id),
            ),
            pending: value.pending,
          };
        });
    },
    resume(key: string, r: ChatRequest) {
      return once(key, ["auxiliary-resume", r.conversationId], () => {
        db.prepare("DELETE FROM auxiliary_pauses WHERE conversation_id=?").run(
          r.conversationId,
        );
        return [api.create(r, "name", true), api.create(r, "summary", true)];
      });
    },
  };
}

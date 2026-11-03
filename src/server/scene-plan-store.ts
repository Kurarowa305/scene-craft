import type { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { OperationError } from "./store.js";
import type { ChatRequest } from "../shared/chat.js";
import type {
  ScenePlan,
  ScenePlanInput,
  ScenePlanView,
  PlanAuthorization,
  PlanDecision,
} from "../shared/scene-plans.js";
export function scenePlanStore(db: DatabaseSync, directory: string) {
  if (
    !db.prepare("SELECT name FROM sqlite_master WHERE name='scene_plans'").get()
  ) {
    const backup = join(directory, "records.before-scene-plans.sqlite");
    if (!existsSync(backup)) db.prepare("VACUUM INTO ?").run(backup);
    db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE scene_plans (sequence INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,work_id TEXT NOT NULL REFERENCES works(id),request_id TEXT NOT NULL REFERENCES chat_requests(id),data TEXT NOT NULL);
      CREATE TABLE scene_plan_decisions (sequence INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,plan_id TEXT NOT NULL REFERENCES scene_plans(id),request_id TEXT NOT NULL REFERENCES chat_requests(id),target TEXT NOT NULL,data TEXT NOT NULL,UNIQUE(plan_id,request_id,target));
      COMMIT;`);
  }
  function view(workId: string): ScenePlanView {
    return {
      plans: db
        .prepare(
          "SELECT data FROM scene_plans WHERE work_id=? ORDER BY sequence",
        )
        .all(workId)
        .map((row) => JSON.parse(row.data as string)),
      decisions: db
        .prepare(
          "SELECT d.data FROM scene_plan_decisions d JOIN scene_plans p ON p.id=d.plan_id WHERE p.work_id=? ORDER BY d.sequence",
        )
        .all(workId)
        .map((row) => JSON.parse(row.data as string)),
    };
  }
  function find(id: string): ScenePlan {
    const row = db.prepare("SELECT data FROM scene_plans WHERE id=?").get(id);
    if (!row) throw new OperationError(404, "SCENE_PLAN_NOT_FOUND");
    return JSON.parse(row.data as string);
  }
  function get(workId: string, id: string) {
    const p = find(id);
    if (p.workId !== workId)
      throw new OperationError(404, "SCENE_PLAN_NOT_FOUND");
    return p;
  }
  return {
    view,
    find,
    get,
    save(r: ChatRequest, input: ScenePlanInput) {
      const snapshot = r.contextSnapshot as {
        work?: unknown;
        states?: unknown;
        references?: {
          selected: {
            id: string;
            pageId: string;
            usage?: { pageId: string };
          }[];
          pages: { id: string }[];
          selections: { referenceId: string }[];
        };
      };
      const selected =
        snapshot.references?.selected.filter((c) =>
          input.referenceIds.includes(c.id),
        ) ?? [];
      const p: ScenePlan = {
        ...input,
        id: randomUUID(),
        workId: r.workId,
        createdAt: new Date().toISOString(),
        source: {
          requestId: r.id,
          conversationId: r.conversationId,
          threadId: r.threadId,
          turnId: r.turnId,
          attempt: r.retryCount,
        },
        fixed: {
          context: {
            work: snapshot.work,
            states: snapshot.states,
            references: {
              selected,
              pages:
                snapshot.references?.pages.filter((page) =>
                  selected.some(
                    (c) => c.pageId === page.id || c.usage?.pageId === page.id,
                  ),
                ) ?? [],
              selections:
                snapshot.references?.selections.filter((s) =>
                  input.referenceIds.includes(s.referenceId),
                ) ?? [],
            },
          },
          git: r.plan,
        },
      };
      db.prepare(
        "INSERT INTO scene_plans (id,work_id,request_id,data) VALUES (?,?,?,?)",
      ).run(p.id, p.workId, r.id, JSON.stringify(p));
      return { complete: true, plan: p, link: `/api/scene-plans/${p.id}` };
    },
    decide(r: ChatRequest, authorization: PlanAuthorization) {
      const plan = get(r.workId, authorization.planId!);
      const target = authorization.hypothesisId ?? "";
      if (
        !["accept", "revise", "hold"].includes(authorization.status) ||
        (target && !plan.hypotheses.some((h) => h.id === target))
      )
        throw new OperationError(403, "EXPLICIT_INSTRUCTION_REQUIRED");
      const old = view(r.workId).decisions.find(
        (d) =>
          d.planId === plan.id &&
          d.requestId === r.id &&
          (d.hypothesisId ?? "") === target,
      );
      if (old) return { complete: true, decision: old };
      const d: PlanDecision = {
        id: randomUUID(),
        planId: plan.id,
        hypothesisId: authorization.hypothesisId,
        action: authorization.status as PlanDecision["action"],
        requestId: r.id,
        body: r.body,
        author: "human",
        createdAt: new Date().toISOString(),
        authorization,
      };
      db.prepare(
        "INSERT INTO scene_plan_decisions (id,plan_id,request_id,target,data) VALUES (?,?,?,?,?)",
      ).run(d.id, plan.id, r.id, target, JSON.stringify(d));
      return { complete: true, decision: d };
    },
  };
}

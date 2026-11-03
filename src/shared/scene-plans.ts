import type { ChatRequest } from "./chat.js";
export interface ScenePlanInput {
  title: string;
  body: string;
  referenceIds: string[];
  parts: {
    id: string;
    name: string;
    placement: string;
    dimensions: string;
    order: number;
  }[];
  hypotheses: { id: string; body: string; evidence: string; missing: string }[];
  previousPlanId?: string;
}
export interface ScenePlan extends ScenePlanInput {
  id: string;
  workId: string;
  createdAt: string;
  source: {
    requestId: string;
    conversationId: string;
    threadId: string | null;
    turnId: string | null;
    attempt: number;
  };
  fixed: { context: unknown; git: ChatRequest["plan"] };
}
export interface PlanAuthorization {
  status: "accept" | "revise" | "hold" | "clarification" | "not_requested";
  planId: string | null;
  hypothesisId: string | null;
  question: string | null;
  threadId: string;
  turnId: string;
  model: string;
  runtime: string | null;
}
export interface PlanDecision {
  id: string;
  planId: string;
  hypothesisId: string | null;
  action: "accept" | "revise" | "hold";
  requestId: string;
  body: string;
  author: "human";
  createdAt: string;
  authorization: PlanAuthorization;
}
export interface ScenePlanView {
  plans: ScenePlan[];
  decisions: PlanDecision[];
}
const text = { type: "string", minLength: 1, maxLength: 20000 };
const id = { ...text, maxLength: 100 };
export const planToolProperties: Record<string, Record<string, unknown>> = {
  save_scene_plan: {
    title: { ...text, maxLength: 500 },
    body: text,
    referenceIds: {
      type: "array",
      maxItems: 100,
      uniqueItems: true,
      items: id,
    },
    previousPlanId: id,
    parts: {
      type: "array",
      minItems: 1,
      maxItems: 100,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "name", "placement", "dimensions", "order"],
        properties: {
          id,
          name: text,
          placement: text,
          dimensions: text,
          order: { type: "integer", minimum: 1, maximum: 1000 },
        },
      },
    },
    hypotheses: {
      type: "array",
      maxItems: 100,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "body", "evidence", "missing"],
        properties: { id, body: text, evidence: text, missing: text },
      },
    },
  },
  record_human_decision: { sourceRequestId: id, planId: id, hypothesisId: id },
};
export const planToolRequired: Record<string, string[]> = {
  save_scene_plan: ["title", "body", "referenceIds", "parts", "hypotheses"],
  record_human_decision: ["sourceRequestId", "planId"],
};
export const planToolDescriptions: Record<string, string> = {
  save_scene_plan:
    "Planning role only. Save an immutable proposed scene plan: human-readable body, parts with stable IDs, relative placement, approximate dimensions with units, production order; hypotheses with stable IDs, evidence and missing information. Supply referenceIds from fixed.references.selected only (empty if none). Uncertain structures MUST be hypotheses, never accepted facts. previousPlanId links a revised proposal without transferring decisions. Return plan ID/link; never start modeling.",
  record_human_decision:
    "Main chat only. Record the current human's explicit accept, revise or hold decision for an exact scene plan and optionally one exact hypothesisId. Pass current sourceRequestId, planId, optional hypothesisId only. Backend independently interprets the entire human message. Whole-plan acceptance does NOT accept hypotheses. Revision records instructions, not approval of a new proposal. Ambiguity returns needsClarification. Other target types are unavailable.",
};

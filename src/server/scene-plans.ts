import { OperationError, type openStore } from "./store.js";
import type { ChatRequest } from "../shared/chat.js";
import {
  planToolProperties,
  planToolRequired,
  type ScenePlanInput,
  type PlanAuthorization,
} from "../shared/scene-plans.js";
export type PlanInterpreter = (
  r: ChatRequest,
  planId: string,
  hypothesisId: string | null,
  current: () => boolean,
) => Promise<PlanAuthorization>;
// Validate at the RPC boundary too: stdio schemas are not an authorization boundary.
function valid(value: any, schema: any): boolean {
  if (schema.type === "string")
    return (
      typeof value === "string" &&
      !!value.trim() &&
      value.length <= schema.maxLength
    );
  if (schema.type === "integer")
    return (
      Number.isSafeInteger(value) &&
      value >= schema.minimum &&
      value <= schema.maximum
    );
  if (schema.type === "array")
    return (
      Array.isArray(value) &&
      value.length >= (schema.minItems ?? 0) &&
      value.length <= schema.maxItems &&
      (!schema.uniqueItems || new Set(value).size === value.length) &&
      value.every((v) => valid(v, schema.items))
    );
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).every((k) => k in schema.properties) &&
    schema.required.every((k: string) => k in value) &&
    Object.entries(value).every(([k, v]) => valid(v, schema.properties[k]))
  );
}
export function scenePlanService(
  store: ReturnType<typeof openStore>,
  interpret: PlanInterpreter,
) {
  return async (
    r: ChatRequest,
    tool: string,
    args: Record<string, any>,
    current: () => ChatRequest,
  ) => {
    const properties = planToolProperties[tool];
    if (
      !valid(args, {
        type: "object",
        properties: {
          ...properties,
          contextRef: { type: "string", maxLength: 100 },
          operationId: { type: "string", maxLength: 100 },
        },
        required: planToolRequired[tool],
      })
    )
      throw new OperationError(400, "INVALID_SCENE_PLAN_ARGUMENTS");
    if (tool === "save_scene_plan") {
      if (r.role !== "planning")
        throw new OperationError(403, "PLANNING_ROLE_REQUIRED");
      const { contextRef, operationId, ...input } = args;
      for (const items of [input.parts, input.hypotheses])
        if (
          new Set(items.map((x: { id: string }) => x.id)).size !== items.length
        )
          throw new OperationError(400, "DUPLICATE_PLAN_ITEM");
      const fixed = r.contextSnapshot as {
        references?: { selected?: { id: string }[] };
      };
      if (
        input.referenceIds.some(
          (id: string) =>
            !fixed?.references?.selected?.some((c) => c.id === id),
        )
      )
        throw new OperationError(409, "REFERENCE_NOT_SELECTED_AT_REQUEST");
      if (input.previousPlanId)
        store.scenePlans.get(r.workId, input.previousPlanId);
      current();
      return () => store.scenePlans.save(current(), input as ScenePlanInput);
    }
    if (args.sourceRequestId !== r.id)
      throw new OperationError(403, "EXPLICIT_INSTRUCTION_REQUIRED");
    const plan = store.scenePlans.get(r.workId, args.planId);
    const hypothesisId = args.hypothesisId ?? null;
    if (hypothesisId && !plan.hypotheses.some((h) => h.id === hypothesisId))
      throw new OperationError(404, "PLAN_HYPOTHESIS_NOT_FOUND");
    const authorization = await interpret(r, plan.id, hypothesisId, () => {
      try {
        current();
        return true;
      } catch {
        return false;
      }
    });
    current();
    return () =>
      ["accept", "revise", "hold"].includes(authorization.status) &&
      authorization.planId === plan.id &&
      authorization.hypothesisId === hypothesisId
        ? store.scenePlans.decide(current(), authorization)
        : {
            complete: false,
            needsClarification: true,
            question:
              authorization.question ??
              "対象の計画・仮説と採用・修正・保留の指示を明記してください。",
          };
  };
}

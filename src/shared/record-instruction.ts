export interface RecordInstruction {
  action?: "create" | "update";
  mode?: "replace" | "append" | "edit";
  baseText?: string | null;
  tool:
    | "create_work_intent"
    | "update_work_intent"
    | "create_manual_record"
    | "update_manual_record";
  field: "intent" | "body" | "reason" | "summary";
  body: string;
  targetId?: string;
}
export interface RecordInterpretation {
  sourceHash: string;
  model: string;
  runtime: string | null;
  threadId: string;
  turnId: string;
  status: "update" | "not_requested" | "clarification";
  instruction: RecordInstruction | null;
  question: string | null;
}

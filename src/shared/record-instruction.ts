export interface RecordInstruction {
  tool: "update_work_context" | "record_manual_work" | "amend_record";
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

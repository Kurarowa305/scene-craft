import type { VersionPlan } from "./versions.js";
import type { RecordInterpretation } from "./record-instruction.js";
export interface ModelChoice {
  model: string;
  effort: string;
  speed: "standard" | "fast";
}
export interface ChatModel {
  id: string;
  model: string;
  displayName: string;
  isDefault: boolean;
  defaultReasoningEffort: string;
  supportedReasoningEfforts: { reasoningEffort: string }[];
}
export interface ChatSession {
  instructionKey?: string;
  conversationId: string;
  threadId: string | null;
  selection: ModelChoice | null;
}
export interface ChatItem {
  id: string;
  type: string;
  text: string;
  complete: boolean;
}
export interface ChatRequest {
  recordInterpretation?: RecordInterpretation;
  role?: string;
  contextSnapshot?: unknown;
  instructions?: string;
  attempts: {
    stopRequested: boolean;
    turnId: string | null;
    selection: ModelChoice;
    actualModel: string | null;
    runtime: string | null;
    terminal: string | null;
    error: string | null;
    items: ChatItem[];
  }[];
  id: string;
  conversationId: string;
  workId: string;
  body: string;
  selection: ModelChoice;
  actualModel: string | null;
  runtime: string | null;
  threadId: string | null;
  turnId: string | null;
  phase:
    | "accepted"
    | "running"
    | "stopping"
    | "completed"
    | "interrupted"
    | "blocked"
    | "unknown";
  stopRequested: boolean;
  error: string | null;
  terminal: string | null;
  items: ChatItem[];
  plan: VersionPlan;
  createdAt: string;
  retryCount: number;
  previousAttempt: string | null;
}
export interface ChatView {
  auxiliary: import("./auxiliary.js").AuxiliaryView;
  session: ChatSession;
  requests: ChatRequest[];
  revision: number;
}

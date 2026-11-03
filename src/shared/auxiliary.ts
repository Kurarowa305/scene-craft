export interface SourceText {
  id: string;
  requestId: string | null;
  body: string;
  complete: boolean;
}
export interface AuxiliaryJob {
  id: string;
  conversationId: string;
  kind: "name" | "summary";
  model: string;
  sourceRequestId: string;
  generation: number;
  sources: SourceText[];
  status: "pending" | "running" | "completed" | "failed" | "stopped";
  threadId: string | null;
  turnId: string | null;
  runtime: string | null;
  actualModel: string | null;
  error: string | null;
  result: string | null;
  createdAt: string;
  finishedAt: string | null;
}
export interface SummaryRevision {
  id: string;
  jobId: string;
  body: string;
  sources: SourceText[];
  previousId: string | null;
  author: "human" | "assistant";
  createdAt: string;
}
export interface AuxiliaryView {
  model: string;
  name: string | null;
  nameAuthor: "human" | "assistant" | null;
  jobs: AuxiliaryJob[];
  summaries: SummaryRevision[];
  pending: SourceText[];
}

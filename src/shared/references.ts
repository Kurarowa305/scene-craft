export interface ReferencePage {
  id: string;
  workId: string;
  requestId: string;
  conversationId: string;
  threadId: string | null;
  turnId: string | null;
  attempt: number;
  url: string;
  finalUrl: string;
  purpose: string;
  checkedAt: string;
  status: "available" | "broken" | "failed" | "stopped";
  text: string;
  sha256: string | null;
  error: string | null;
}
export interface ReferenceCandidate {
  id: string;
  workId: string;
  requestId: string;
  conversationId: string;
  threadId: string | null;
  turnId: string | null;
  attempt: number;
  pageId: string;
  title: string;
  author: string | null;
  element: string;
  intentRelation: string;
  checkedAt: string;
  image: {
    status:
      "url_only" | "not_retained" | "stored" | "broken" | "failed" | "stopped";
    url: string | null;
    sha256: string | null;
    size: number | null;
    mime: string | null;
    permissionPageId: string | null;
    permissionQuote: string | null;
    error: string | null;
  };
}
export interface ReferenceSelection {
  authorization?: {
    status: string;
    referenceId: string | null;
    question: string | null;
    threadId: string;
    turnId: string;
    model: string;
    runtime: string | null;
  };
  id: string;
  referenceId: string;
  requestId: string;
  body: string;
  author: "human";
  createdAt: string;
}
export interface ReferenceView {
  searches: {
    requestId: string;
    turnId: string | null;
    itemId: string;
    action: unknown;
    query: string | null;
    status: string;
    resultAvailability: string;
    checkedAt: string;
  }[];
  pages: ReferencePage[];
  candidates: ReferenceCandidate[];
  selections: ReferenceSelection[];
}

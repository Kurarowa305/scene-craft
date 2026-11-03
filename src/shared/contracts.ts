import type { GitReference } from "./versions.js";
export interface Work {
  id: string;
  sequence: number;
  name: string;
  intent: string | null;
  style: GitReference | null;
  plannedDefinition: GitReference | null;
  createdAt: string;
}
export interface Conversation {
  id: string;
  sequence: number;
  workId: string;
  title: null;
  createdAt: string;
}
export interface BodyRecord {
  originalBody?: string;
  reason?: string | null;
  summary?: string | null;
  id: string;
  sequence: number;
  conversationId: string;
  body: string;
  kind: "record";
  author: "human";
  createdAt: string;
}

export interface Work {
  id: string;
  sequence: number;
  name: string;
  intent: string | null;
  style: null;
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
  id: string;
  sequence: number;
  conversationId: string;
  body: string;
  kind: "record";
  author: "human";
  createdAt: string;
}

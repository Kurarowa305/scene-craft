import type { VersionPlan } from "./versions.js";
import type { SavedState } from "./files.js";

export interface SideChat {
  conversationId: string;
  mainConversationId: string;
  topic: string;
  createdAt: string;
  plan: VersionPlan;
  snapshot: unknown;
  selectedStates: SavedState[];
  mainMessages: { id: string; body: string; items: unknown[] }[];
  history: {
    records: unknown[];
    requests: unknown[];
    conversations: unknown[];
    revisions: unknown[];
  };
}

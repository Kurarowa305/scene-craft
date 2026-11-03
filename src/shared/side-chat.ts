import type { VersionPlan } from "./versions.js";
import type { SavedState } from "./files.js";

export interface SideChat {
  conversationId: string;
  mainConversationId: string;
  /** Historical user-entered topic; retained on existing snapshots only. */
  topic?: string;
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

export interface SideChatView extends SideChat {
  /** Display value from conversation_names; not saved in side_chats.data. */
  title: string | null;
}

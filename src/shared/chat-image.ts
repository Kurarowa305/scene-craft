export interface ChatImage {
  id: string;
  name: string;
  mime: "image/png" | "image/jpeg" | "image/webp";
  size: number;
  sha256: string;
  width: number;
  height: number;
}
export const imageUrl = (conversationId: string, imageId: string) =>
  `/api/conversations/${conversationId}/images/${imageId}`;

import { useEffect, useRef, useState } from "react";
import type { ChatImage } from "../shared/chat-image";
import { imageUrl } from "../shared/chat-image";
import { uploadChatImage, write, SaveError } from "./api";

interface DraftImage {
  id: string;
  file: File;
  preview: string;
  uploaded?: ChatImage;
}
const drafts = new Map<string, DraftImage[]>();
export interface ImageControls {
  selectImages: () => void;
  addImages: (files: File[]) => Promise<void>;
  busy: boolean;
}

export function useChatImages(
  conversationId: string,
  onBusy?: (busy: boolean) => void,
) {
  const [items, setItems] = useState(() => drafts.get(conversationId) ?? []);
  const [busy, setBusy] = useState(false);
  const operating = useRef(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setItems(drafts.get(conversationId) ?? []);
  }, [conversationId]);
  function update(next: DraftImage[]) {
    drafts.set(conversationId, next);
    setItems(next);
  }
  async function transfer(next: DraftImage[]) {
    for (const item of next.filter((item) => !item.uploaded)) {
      item.uploaded = await uploadChatImage(conversationId, item.id, item.file);
      update([...next]);
    }
  }
  async function operate(action: () => Promise<void>) {
    if (operating.current) throw new Error("画像の受け渡し中です。");
    operating.current = true;
    setBusy(true);
    onBusy?.(true);
    setError("");
    try {
      await action();
    } catch (failure) {
      setError((failure as Error).message);
      throw failure;
    } finally {
      operating.current = false;
      setBusy(false);
      onBusy?.(false);
    }
  }
  return {
    items,
    busy,
    error,
    addImages: (files: File[]) =>
      operate(async () => {
        const current = drafts.get(conversationId) ?? [];
        if (
          current.length + files.length > 5 ||
          current.reduce((n, item) => n + item.file.size, 0) +
            files.reduce((n, file) => n + file.size, 0) >
            40 * 1024 ** 2
        )
          throw new Error("画像は5枚、合計40MiBまでです。");
        if (
          files.some(
            (file) =>
              !/\.(png|jpe?g|webp)$/i.test(file.name) ||
              file.size > 20 * 1024 ** 2,
          )
        )
          throw new Error(
            "PNG・JPEG・WebPの静止画を1枚20MiBまでで選択してください。",
          );
        const added = await Promise.all(
          files.map(async (file) => ({
            id: crypto.randomUUID(),
            file,
            preview: await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(String(reader.result));
              reader.onerror = () =>
                reject(new Error("画像を読み込めません。"));
              reader.readAsDataURL(file);
            }),
          })),
        );
        const next = [...current, ...added];
        update(next);
        await transfer(next);
      }),
    retry: () => operate(() => transfer(drafts.get(conversationId) ?? [])),
    remove: (id: string) =>
      operate(async () => {
        const current = drafts.get(conversationId) ?? [];
        try {
          await write(
            `/api/conversations/${conversationId}/images/${id}/remove`,
            {},
          );
        } catch (failure) {
          if (!(failure instanceof SaveError && failure.status === 404))
            throw failure;
        }
        update(current.filter((item) => item.id !== id));
      }).catch(() => {}),
    clear() {
      drafts.delete(conversationId);
      setItems([]);
      setError("");
    },
  };
}
export function SentImages({
  conversationId,
  images,
}: {
  conversationId: string;
  images: ChatImage[];
}) {
  return (
    <div className="sent-images">
      {images.map((image) => (
        <a
          key={image.id}
          href={imageUrl(conversationId, image.id)}
          target="_blank"
          rel="noreferrer"
        >
          <img src={imageUrl(conversationId, image.id)} alt={image.name} />
        </a>
      ))}
    </div>
  );
}

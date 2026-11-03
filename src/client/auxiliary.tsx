import { useState } from "react";
import type { AuxiliaryView } from "../shared/auxiliary";
import type { ChatModel } from "../shared/chat";
import { write } from "./api";

export function Auxiliary({
  value,
  models,
  conversationId,
  requestId,
  refresh,
  onError,
}: {
  value: AuxiliaryView;
  models: ChatModel[];
  conversationId: string;
  requestId?: string;
  refresh: () => Promise<void>;
  onError: (error: string) => void;
}) {
  const [name, setName] = useState("");
  const [correction, setCorrection] = useState("");
  const [editing, setEditing] = useState<string>();
  const [busy, setBusy] = useState(false);
  async function save(path: string, body: Record<string, unknown>) {
    setBusy(true);
    try {
      await write(path, body);
      await refresh();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="会話名と保存用要約">
      <h3>会話名: {value.name ?? "未命名"}</h3>
      <label>
        会話名を変更
        <input
          aria-label="会話名を変更"
          value={name}
          maxLength={100}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <button
        disabled={busy || !name.trim()}
        onClick={() =>
          void save(`/api/conversations/${conversationId}/name`, { name })
        }
      >
        会話名を保存
      </button>
      <details>
        <summary>保存用要約・根拠・補助モデル</summary>
        {requestId &&
          value.jobs.some((j) => ["pending", "running"].includes(j.status)) && (
            <button
              disabled={busy}
              onClick={() =>
                void save(`/api/chat-requests/${requestId}/stop`, {})
              }
            >
              補助処理を停止
            </button>
          )}
        <label>
          命名・要約モデル
          <select
            aria-label="命名・要約モデル"
            value={value.model}
            disabled={busy}
            onChange={(e) =>
              void save("/api/auxiliary/model", { model: e.target.value })
            }
          >
            {!models.some((m) => m.model === value.model) && (
              <option value={value.model}>{value.model}（利用不可）</option>
            )}
            {models.map((m) => (
              <option key={m.model} value={m.model}>
                {m.displayName}
              </option>
            ))}
          </select>
        </label>
        <p>
          初期値: GPT-6
          Luna。変更は新しく受け付ける補助処理に適用します。制作モデルとは別の設定です。
        </p>
        <p>未要約: {value.pending.length} 件</p>
        <button
          disabled={busy}
          onClick={() =>
            void save(
              `/api/conversations/${conversationId}/auxiliary/resume`,
              {},
            )
          }
        >
          未処理の命名・要約を実行
        </button>
        <p>
          人間の停止・認証待ち・利用上限中は、依頼を明示再開するか、新しい依頼を送信してください。
        </p>
        {value.summaries.map((s) => (
          <article key={s.id}>
            <p className="record-body">{s.body}</p>
            <p>
              要約ID: {s.id} / 記入者: {s.author === "human" ? "人間" : "AI"} /{" "}
              {s.createdAt}
            </p>
            {s.previousId && <p>訂正元: {s.previousId}</p>}
            <details>
              <summary>対象原文と根拠 ({s.sources.length} 件)</summary>
              {s.sources.map((t) => (
                <div key={t.id}>
                  <code>{t.id}</code>
                  <p className="record-body">
                    {t.body}
                    {!t.complete && "（途中・欠落の可能性）"}
                  </p>
                </div>
              ))}
            </details>
            {!value.summaries.some((v) => v.previousId === s.id) && (
              <button
                onClick={() => {
                  setEditing(s.id);
                  setCorrection(s.body);
                }}
              >
                この要約を訂正
              </button>
            )}
            {editing === s.id && (
              <div>
                <label>
                  訂正する要約
                  <textarea
                    aria-label="訂正する要約"
                    value={correction}
                    onChange={(e) => setCorrection(e.target.value)}
                  />
                </label>
                <button
                  disabled={busy || !correction.trim()}
                  onClick={() =>
                    void save(
                      `/api/conversations/${conversationId}/summaries/${s.id}`,
                      { body: correction },
                    ).then(() => setEditing(undefined))
                  }
                >
                  要約の訂正を保存
                </button>
              </div>
            )}
          </article>
        ))}
        <details>
          <summary>未要約の原文</summary>
          {value.pending.map((s) => (
            <div key={s.id}>
              <code>{s.id}</code>
              <p className="record-body">
                {s.body}
                {!s.complete && "（途中）"}
              </p>
            </div>
          ))}
        </details>
        <details>
          <summary>補助処理の履歴</summary>
          {value.jobs.map((j) => (
            <p key={j.id}>
              {j.kind === "name" ? "命名" : "要約"}: {j.status} / 要求:{" "}
              {j.model} / 実モデル: {j.actualModel ?? "未確認"} /{" "}
              {j.error ?? "エラーなし"} / {j.createdAt}
            </p>
          ))}
        </details>
      </details>
    </section>
  );
}

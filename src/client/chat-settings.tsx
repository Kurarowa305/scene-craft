import { useEffect, useState } from "react";
import type { Work, Conversation } from "../shared/contracts";
import type { ChatModel, ChatView } from "../shared/chat";
import { read, write } from "./api";

export function ChatSettings({
  conversationId,
  works,
  onChange,
}: {
  conversationId: string;
  works: Work[];
  onChange: () => void;
}) {
  const [status, setStatus] = useState<{
    configured: boolean;
    authenticated: boolean;
    models: ChatModel[];
  }>();
  const [loaded, setLoaded] = useState(false);
  const [model, setModel] = useState("");
  const [authUrl, setAuthUrl] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const workIds = works.map((work) => work.id).join("|");
  useEffect(() => {
    let current = true;
    setLoaded(false);
    async function load() {
      try {
        const next = await read<NonNullable<typeof status>>("/api/codex");
        if (!current) return;
        setStatus(next);
        let target = conversationId;
        if (!target)
          for (const work of works) {
            const conversations = await read<Conversation[]>(
              `/api/works/${work.id}/conversations`,
            );
            if (!current) return;
            if (conversations[0]) {
              target = conversations[0].id;
              break;
            }
          }
        if (target) {
          const view = await read<ChatView>(
            `/api/conversations/${target}/chat`,
          );
          if (current) setModel(view.auxiliary.model);
        }
        if (current) setLoaded(true);
      } catch (failure) {
        if (current) setError((failure as Error).message);
      }
    }
    void load();
    return () => {
      current = false;
    };
  }, [conversationId, workIds]);
  async function action(operation: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await operation();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="chat-settings-page"
      aria-label="ChatGPT・命名と要約の設定"
    >
      <h3>ChatGPT認証</h3>
      <p className="intro">
        {!status
          ? "接続を確認中…"
          : status.authenticated
            ? "ChatGPT認証済み"
            : status.configured
              ? "ログインが必要"
              : "Codex未接続"}
      </p>
      <button
        type="button"
        className="secondary"
        disabled={busy}
        onClick={() =>
          void action(async () => {
            const result = await write<{ authUrl: string }>(
              "/api/codex/login",
              {},
            );
            setAuthUrl(result.authUrl);
          })
        }
      >
        ChatGPTでログイン
      </button>
      {authUrl && (
        <p>
          <a href={authUrl} target="_blank" rel="noreferrer">
            専用ログインを開く
          </a>
        </p>
      )}
      <button
        type="button"
        className="secondary"
        disabled={busy}
        onClick={() =>
          void action(async () => {
            setStatus(await read("/api/codex"));
            onChange();
          })
        }
      >
        接続状態を更新
      </button>
      <div className="rule" />
      <h3>命名・要約モデル</h3>
      <label className="field">
        命名・要約モデル
        <select
          aria-label="命名・要約モデル"
          value={model}
          disabled={busy || !status || !loaded}
          onChange={(event) => {
            const next = event.target.value;
            void action(async () => {
              const result = await write<{ model: string }>(
                "/api/auxiliary/model",
                { model: next },
              );
              setModel(result.model);
              onChange();
            });
          }}
        >
          {!model && (
            <option value="" disabled>
              モデルを選択
            </option>
          )}
          {model && !status?.models.some((item) => item.model === model) && (
            <option value={model}>{model}（利用不可）</option>
          )}
          {status?.models.map((item) => (
            <option key={item.id} value={item.model}>
              {item.displayName}
            </option>
          ))}
        </select>
      </label>
      <p className="hint">新しく受け付ける命名・要約から適用します。</p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

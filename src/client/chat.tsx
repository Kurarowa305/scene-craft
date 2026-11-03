import { useEffect, useRef, useState, useId, type FormEvent } from "react";
import type { BodyRecord } from "../shared/contracts";
import type { ChatModel, ChatView, ModelChoice } from "../shared/chat";
import { read, write } from "./api";
import { Auxiliary } from "./auxiliary";

const phases: Record<string, string> = {
  accepted: "受付済み",
  running: "応答中",
  stopping: "停止中",
  completed: "完了",
  interrupted: "停止しました",
  blocked: "対応が必要",
  unknown: "状態確認が必要",
};
const reasons: Record<string, string> = {
  AUTH_REQUIRED:
    "専用のChatGPT認証でログインし、状態を確認してから明示的に再開してください。",
  USAGE_LIMIT:
    "利用上限に達しました。利用可能になった後、状態を確認して明示的に再開してください。",
  MODEL_UNAVAILABLE:
    "選択したモデルを利用できません。モデルを選び直してください。",
  MODEL_REROUTED: "別モデルへの切替を検出し、停止しました。",
  INTERNAL_RETRY: "Codexが通信を復旧しています。追加送信は待ってください。",
  PROCESS_INTERRUPTED:
    "実行プロセスが終了しました。履歴の状態を確認してください。",
  ACCEPTANCE_UNKNOWN:
    "受付結果を確定できません。自動再送せず、履歴の照合を待ちます。",
};
interface Status {
  configured: boolean;
  authenticated: boolean;
  runtime: string | null;
  models: ChatModel[];
}
export function Chat({
  conversationId,
  onNameChanged,
  onRecordsChanged,
  side = false,
}: {
  conversationId: string;
  side?: boolean;
  onNameChanged: (name: string | null) => void;
  onRecordsChanged: (
    records: BodyRecord[],
    intent: string | null,
    revision: number,
  ) => void;
}) {
  const bodyId = useId();
  const alive = useRef(false);
  const contextFetch = useRef(0);
  const contextRevision = useRef(-1);
  const [view, setView] = useState<ChatView>();
  useEffect(() => {
    if (view) onNameChanged(view.auxiliary.name);
  }, [view?.auxiliary.name]);
  function applyView(next: ChatView) {
    setView((previous) =>
      previous && previous.revision > next.revision ? previous : next,
    );
  }
  const [status, setStatus] = useState<Status>();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [authUrl, setAuthUrl] = useState("");
  const [roles, setRoles] = useState<{ id: string; description: string }[]>([]);
  const [role, setRole] = useState("none");
  const [context, setContext] = useState<{
    work: { intent: string | null };
    revisions: {
      id: string;
      targetId: string;
      field: string;
      body: string;
      previousBody: string | null;
      createdAt: string;
    }[];
  }>();
  async function refreshContext(v: ChatView) {
    if (side) return;
    if (!alive.current || v.revision < contextRevision.current) return;
    contextRevision.current = v.revision;
    const sequence = ++contextFetch.current;
    const workId = v.requests[0]?.workId;
    if (workId) {
      try {
        const [next, records] = await Promise.all([
          read<NonNullable<typeof context>>(`/api/works/${workId}/context`),
          read<BodyRecord[]>(`/api/conversations/${conversationId}/records`),
        ]);
        if (alive.current && sequence === contextFetch.current) {
          setContext(next);
          onRecordsChanged(records, next.work.intent, next.revisions.length);
        }
      } catch {
        if (alive.current)
          setError("共有情報を取得できません。接続状態を更新してください。");
      }
    }
  }
  const selection = view?.session.selection;
  const active = view?.requests.find((r) =>
    ["accepted", "running", "stopping", "unknown"].includes(r.phase),
  );
  async function refresh() {
    const [s, v] = await Promise.all([
      read<Status>("/api/codex"),
      read<ChatView>(`/api/conversations/${conversationId}/chat`),
    ]);
    setStatus(s);
    applyView(v);
    await refreshContext(v);
  }
  useEffect(() => {
    alive.current = true;
    let current = true;
    let source: EventSource | undefined;
    void read<{ id: string; description: string }[]>("/api/roles")
      .then(setRoles)
      .catch(() => setRoles([]));
    void Promise.all([
      read<Status>("/api/codex"),
      read<ChatView>(`/api/conversations/${conversationId}/chat`),
    ])
      .then(([s, v]) => {
        if (!current) return;
        setStatus(s);
        applyView(v);
        void refreshContext(v);
        source = new EventSource(`/api/conversations/${conversationId}/events`);
        source.addEventListener("chat", (event) => {
          if (current) {
            const next = JSON.parse((event as MessageEvent).data);
            applyView(next);
            void refreshContext(next);
          }
        });
        source.onerror = () => {
          if (current)
            setError(
              "接続を確認中です。保存済み履歴から自動で表示を復帰します。",
            );
        };
        source.onopen = () => {
          if (current) setError("");
        };
      })
      .catch(() => {
        if (current) setError("会話を取得できません。再読み込みしてください。");
      });
    return () => {
      alive.current = false;
      ++contextFetch.current;
      current = false;
      source?.close();
    };
  }, [conversationId]);
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function choose(s: ModelChoice) {
    await write(
      `/api/conversations/${conversationId}/model`,
      s as unknown as Record<string, unknown>,
    );
    await refresh();
  }
  function send(e: FormEvent) {
    e.preventDefault();
    void action(async () => {
      await write(`/api/conversations/${conversationId}/messages`, {
        body: draft,
        ...(side ? {} : { role }),
      });
      setDraft("");
      await refresh();
    });
  }
  const model = status?.models.find((m) => m.model === selection?.model);
  return (
    <section
      className="codex-chat"
      aria-label={side ? "サイドチャットの会話" : "Codexとの会話"}
    >
      <div className="section-heading">
        <h3>{side ? "相談専用サイドチャット" : "Codexとの会話"}</h3>
        <span>
          {status?.authenticated
            ? "ChatGPT認証済み"
            : status?.configured
              ? "ログインが必要"
              : "Codex未接続"}
        </span>
      </div>
      <p className="hint">
        {side
          ? "開始時の文脈で相談します。制作・採否・記録・制作意図や保護の変更・メインへの依頼受け渡しはできません。"
          : "工程ごとの相談・文脈参照と、明示した文章の記録ができます。制作ファイル操作・保護の適用・採否は準備中です。"}
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={() =>
          void action(async () => {
            const r = await write<{ authUrl: string }>("/api/codex/login", {});
            setAuthUrl(r.authUrl);
          })
        }
      >
        ChatGPTでログイン
      </button>
      {authUrl && (
        <a href={authUrl} target="_blank" rel="noreferrer">
          専用ログインを開く
        </a>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={() => void action(refresh)}
      >
        接続状態を更新
      </button>
      {error && <p role="alert">{error}</p>}
      {view && !side && (
        <Auxiliary
          value={view.auxiliary}
          models={status?.models ?? []}
          conversationId={conversationId}
          requestId={view.requests.at(-1)?.id}
          refresh={refresh}
          onError={setError}
        />
      )}
      <div className="chat-settings">
        {!side && (
          <label>
            工程
            <select
              aria-label="工程"
              value={role}
              disabled={busy || !!active}
              onChange={(e) => setRole(e.target.value)}
            >
              <option value="none">なし</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.description}（相談・記録）
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          会話モデル
          <select
            aria-label="会話モデル"
            value={selection?.model ?? ""}
            disabled={busy || !view}
            onChange={(e) => {
              const m = status!.models.find((m) => m.model === e.target.value)!;
              void action(() =>
                choose({
                  model: m.model,
                  effort: m.defaultReasoningEffort,
                  speed: "standard",
                }),
              );
            }}
          >
            <option value="" disabled>
              モデルを選択
            </option>
            {selection && !model && (
              <option value={selection.model}>
                {selection.model}（利用不可）
              </option>
            )}
            {status?.models.map((m) => (
              <option key={m.id} value={m.model}>
                {m.displayName}
              </option>
            ))}
          </select>
        </label>
        <label>
          推論強度
          <select
            aria-label="推論強度"
            value={selection?.effort ?? ""}
            disabled={busy || !model}
            onChange={(e) =>
              void action(() =>
                choose({ ...selection!, effort: e.target.value }),
              )
            }
          >
            {model?.supportedReasoningEfforts.map((e) => (
              <option key={e.reasoningEffort}>{e.reasoningEffort}</option>
            ))}
          </select>
        </label>
        <label>
          速度
          <select
            aria-label="速度"
            value={selection?.speed ?? "standard"}
            disabled={busy || !selection}
            onChange={(e) =>
              void action(() =>
                choose({
                  ...selection!,
                  speed: e.target.value as ModelChoice["speed"],
                }),
              )
            }
          >
            <option value="standard">標準</option>
            <option value="fast">高速</option>
          </select>
        </label>
      </div>
      <p className="hint">選択の変更は次の依頼から適用します。</p>
      {!side && (
        <details>
          <summary>記録の指示方法</summary>
          <p>
            自然な文章から全文の作成・置き換え（CREATE）か、既存内容への追記・編集（UPDATE）を判断します。対象や内容が曖昧なときは確認します。引用の紹介や通常の相談だけでは更新しません。
          </p>
          <p>制作意図を「夕暮れの静かな港」に変えてください</p>
          <p>制作意図に「夕方の光を重視」を追記して</p>
          <p>制作意図の「夕暮れ」を「夜明け」に変更して</p>
          <p>手作業で「Photoshopで空の色を調整した」を記録して</p>
          <p>直前の記録に「静けさを出すため、照明も調整した」を追記して</p>
          <p>
            直前の記録の全文を「空と照明を調整した。落ち着いた雰囲気にするため。」に変更して
          </p>
          <p>直前の記録の「空」を「海」に変更して</p>
          <p>従来の省略書式も利用できます。</p>
          <p>記録を訂正: 記録ID body 変更後の全文</p>
          <p>
            訂正項目は
            body（手作業の文章）・summary（要約）です。理由も手作業の文章へ含めて記録できます。追記は「記録に追記:
            記録ID
            追加文」とも指示できます。記録IDは下の更新履歴で確認できます。
          </p>
        </details>
      )}
      {context && (
        <details>
          <summary>共有情報と更新履歴</summary>
          <p>現在の制作意図: {context.work.intent ?? "未入力"}</p>
          {context.revisions.map((v) => (
            <article key={v.id}>
              <p>
                記録ID: {v.targetId} / {v.field}
              </p>
              <p>{v.body}</p>
              <p>
                以前: {v.previousBody ?? "未入力"} / 記入者: 人間 /{" "}
                {v.createdAt}
              </p>
            </article>
          ))}
        </details>
      )}
      <div aria-live="polite">
        {view?.requests.map((r) => (
          <article className="record" key={r.id}>
            <strong>あなた</strong>
            <p className="hint">工程: {r.role ?? "none"}</p>
            <p className="record-body">{r.body}</p>
            <strong>{phases[r.phase]}</strong>
            <p className="hint">
              要求: {r.selection.model} / {r.selection.effort} /{" "}
              {r.selection.speed} · 実モデル: {r.actualModel ?? "未確認"}
            </p>
            {r.attempts.flatMap((a, index) =>
              a.items
                .filter((i) => i.type === "agentMessage")
                .map((i) => (
                  <p className="record-body" key={`${index}-${i.id}`}>
                    前の実行: {i.text}
                  </p>
                )),
            )}
            {r.items
              .filter((i) => i.type === "agentMessage")
              .map((i) => (
                <p className="record-body" key={i.id}>
                  {i.text}
                  {!i.complete && "（途中）"}
                </p>
              ))}
            {r.error && (
              <p>
                {reasons[r.error] ??
                  "状態を確認し、必要な対処を行ってください。自動再送は行いません。"}
              </p>
            )}
            {r.phase === "completed" && r.items.some((i) => !i.complete) && (
              <p>本文に欠落の可能性があります。履歴を照合してください。</p>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  await write(`/api/chat-requests/${r.id}/reconcile`, {});
                  await refresh();
                })
              }
            >
              履歴を照合
            </button>
            {["interrupted", "blocked"].includes(r.phase) && r.terminal && (
              <button
                type="button"
                disabled={busy || r.retryCount >= 2 || !!active}
                onClick={() =>
                  void action(async () => {
                    await write(`/api/chat-requests/${r.id}/resume`, {});
                    await refresh();
                  })
                }
              >
                この依頼を再開
              </button>
            )}
          </article>
        ))}
      </div>
      <form className="composer" onSubmit={send}>
        <label htmlFor={bodyId}>Codexへのメッセージ</label>
        <textarea
          id={bodyId}
          value={draft}
          rows={4}
          maxLength={200000}
          onChange={(e) => setDraft(e.target.value)}
          disabled={busy}
        />
        <div className="composer-footer">
          <button
            className="primary"
            disabled={
              busy ||
              !!active ||
              !status?.authenticated ||
              !model ||
              !draft.trim()
            }
          >
            Codexへ送信
          </button>
          {active && (
            <button
              type="button"
              onClick={() =>
                void action(async () => {
                  await write(`/api/chat-requests/${active.id}/stop`, {});
                  await refresh();
                })
              }
            >
              停止
            </button>
          )}
        </div>
      </form>
    </section>
  );
}

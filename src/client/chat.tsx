import { useChatImages, SentImages, type ImageControls } from "./chat-images";
import {
  useEffect,
  useRef,
  useState,
  useId,
  type FormEvent,
  type ReactNode,
} from "react";
import type { BodyRecord } from "../shared/contracts";
import type { ChatModel, ChatView, ModelChoice } from "../shared/chat";
import { read, write } from "./api";
import { ReferenceLinks, useReferences } from "./references";
import { Icon, Popup } from "./ui";

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
  onSideNamesChanged,
  attachment,
  recordDraft,
  onDraftChange,
  onRecord,
  recordDisabled,
  onStatusChange,
  composerExtra,
  forceRecord,
  draftLocked,
  connectionRevision = 0,
  onImageBusyChange,
}: {
  conversationId: string;
  composerExtra?: ReactNode;
  forceRecord?: boolean;
  draftLocked?: boolean;
  connectionRevision?: number;
  attachment?: ReactNode | ((controls: ImageControls) => ReactNode);
  onImageBusyChange?: (busy: boolean) => void;
  recordDraft?: string;
  onDraftChange?: (draft: string) => void;
  onRecord?: (body: string) => Promise<void>;
  recordDisabled?: boolean;
  onStatusChange?: (state: string) => void;
  side?: boolean;
  onSideNamesChanged?: (names: Record<string, string | null>) => void;
  onNameChanged: (name: string | null) => void;
  onRecordsChanged: (
    records: BodyRecord[],
    intent: string | null,
    revision: number,
  ) => void;
}) {
  const bodyId = useId();
  const imageInput = useRef<HTMLInputElement>(null);
  const images = useChatImages(conversationId, onImageBusyChange);
  const hasImages = images.items.length > 0;

  const alive = useRef(false);
  const contextFetch = useRef(0);
  const contextRevision = useRef(-1);
  const [view, setView] = useState<ChatView>();
  const references = useReferences(
    side ? undefined : view?.requests[0]?.workId,
    view?.revision ?? 0,
  );
  useEffect(() => {
    if (view) onNameChanged(view.auxiliary.name);
  }, [view?.auxiliary.name]);
  useEffect(() => {
    if (view) onSideNamesChanged?.(view.sideNames);
  }, [view?.sideNames]);
  function applyView(next: ChatView) {
    setView((previous) =>
      previous && previous.revision > next.revision ? previous : next,
    );
  }
  const [status, setStatus] = useState<Status>();
  const [ownDraft, setOwnDraft] = useState("");
  const draft = recordDraft ?? ownDraft;
  const setDraft = onDraftChange ?? setOwnDraft;
  const [sendMode, setSendMode] = useState("chat");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const actionGate = useRef<Promise<void> | null>(null);
  const [roles, setRoles] = useState<{ id: string; description: string }[]>([]);
  const [role, setRole] = useState("none");
  type WorkContext = { work: { intent: string | null }; revisions: unknown[] };
  async function refreshContext(v: ChatView) {
    if (side) return;
    if (!alive.current || v.revision < contextRevision.current) return;
    contextRevision.current = v.revision;
    const sequence = ++contextFetch.current;
    const workId = v.requests[0]?.workId;
    if (workId) {
      try {
        const [next, records] = await Promise.all([
          read<WorkContext>(`/api/works/${workId}/context`),
          read<BodyRecord[]>(`/api/conversations/${conversationId}/records`),
        ]);
        if (alive.current && sequence === contextFetch.current) {
          onRecordsChanged(records, next.work.intent, v.revision);
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
  useEffect(() => {
    if (!view) return;
    const requests = view.requests;
    const latest = requests.at(-1);
    const state =
      latest && ["unknown", "blocked"].includes(latest.phase)
        ? "attention"
        : latest && ["accepted", "running", "stopping"].includes(latest.phase)
          ? "running"
          : latest?.phase === "interrupted"
            ? "stopped"
            : "";
    onStatusChange?.(state);
  }, [view]);
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
  useEffect(() => {
    if (!connectionRevision || !alive.current) return;
    void refresh().catch(() => {
      if (alive.current) setError("接続状態を取得できません。");
    });
  }, [connectionRevision]);
  async function action(fn: () => Promise<void>) {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    actionGate.current = gate;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      if (actionGate.current === gate) actionGate.current = null;
      release();
    }
  }
  async function addImages(files: File[]) {
    // A saved-image download may finish after the message send has started.
    while (actionGate.current) await actionGate.current;
    await images.addImages(files);
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
      const submitter = (e.nativeEvent as SubmitEvent)
        .submitter as HTMLButtonElement | null;
      if (
        !hasImages &&
        !side &&
        onRecord &&
        (submitter?.value === "record" ||
          (!hasImages && (sendMode === "record" || forceRecord)))
      ) {
        await onRecord(draft);
        setDraft("");
        return;
      }
      const sentImageIds = images.items.map((item) => item.id);
      await write(`/api/conversations/${conversationId}/messages`, {
        body: draft,
        ...(sentImageIds.length ? { imageIds: sentImageIds } : {}),
        ...(side ? {} : { role }),
      });
      setDraft("");
      images.clear(sentImageIds);
      await refresh();
    });
  }
  const model = status?.models.find((m) => m.model === selection?.model);
  return (
    <section
      className="codex-chat"
      aria-label={side ? "サイドチャットの会話" : "Codexとの会話"}
    >
      <div className="messages">
        {side && (
          <div className="panel-top">
            <h2>サイドチャット</h2>
            <span className="badge">相談専用</span>
          </div>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div aria-live="polite">
          {view?.requests.map((r) => (
            <article className="message exchange" key={r.id}>
              <div className="message user">
                <div className="message-label">あなた</div>
                {!!r.images?.length && (
                  <SentImages
                    conversationId={conversationId}
                    images={r.images}
                  />
                )}
                {r.body && <p className="record-body message-body">{r.body}</p>}
              </div>
              <div className="message-label">
                <span className="assistant-dot">s</span>scene-craft{" "}
                <span className="hint">{phases[r.phase]}</span>
              </div>
              <details className="execution-details">
                <summary>実行の詳細</summary>
                <p className="hint">工程: {r.role ?? "none"}</p>
                <p className="hint">
                  要求: {r.selection.model} / {r.selection.effort} /{" "}
                  {r.selection.speed} · 実モデル: {r.actualModel ?? "未確認"}
                </p>
              </details>
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
              {!side && (
                <ReferenceLinks
                  candidates={
                    references.view?.candidates.filter(
                      (c) => c.requestId === r.id,
                    ) ?? []
                  }
                />
              )}
              {r.error && (
                <p>
                  {reasons[r.error] ??
                    "状態を確認し、必要な対処を行ってください。自動再送は行いません。"}
                </p>
              )}
              {r.phase === "completed" && r.items.some((i) => !i.complete) && (
                <p>本文に欠落の可能性があります。</p>
              )}
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
      </div>
      <div className="composer-area">
        <form className="composer" onSubmit={send}>
          <label className="sr-only" htmlFor={bodyId}>
            {side ? "サイドチャットのメッセージ" : "メッセージ"}
          </label>
          <textarea
            id={bodyId}
            value={draft}
            rows={3}
            maxLength={200000}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(event) => {
              if (
                event.key !== "Enter" ||
                event.shiftKey ||
                event.nativeEvent.isComposing ||
                event.keyCode === 229
              )
                return;
              event.preventDefault();
              const form = event.currentTarget.form;
              const submit = form?.querySelector<HTMLButtonElement>(
                "button.send[type='submit']",
              );
              if (submit && !submit.disabled) form?.requestSubmit(submit);
            }}
            disabled={busy || draftLocked}
            placeholder={
              side ? "操作方法や、気になることを相談…" : "メッセージを入力…"
            }
          />
          {composerExtra}
          <input
            ref={imageInput}
            className="sr-only"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            disabled={busy || images.busy}
            aria-label="LLMに添付する画像を選択"
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              event.target.value = "";
              void addImages(files).catch((failure) =>
                setError(failure.message),
              );
            }}
          />
          {hasImages && (
            <div className="draft-images" aria-label="添付画像">
              {images.items.map((item) => (
                <div key={item.id} className="draft-image">
                  <img src={item.preview} alt={item.file.name} />
                  <button
                    type="button"
                    aria-label={`${item.file.name}を外す`}
                    disabled={busy || images.busy}
                    onClick={() => void images.remove(item.id)}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          {images.error && (
            <p role="alert" className="error">
              {images.error}
            </p>
          )}
          {images.busy && <p role="status">画像を添付中…</p>}
          {!images.busy && images.items.some((item) => !item.uploaded) && (
            <button
              type="button"
              disabled={busy || images.busy}
              onClick={() => void images.retry().catch(() => {})}
            >
              同じ画像で再試行
            </button>
          )}

          <div className="composer-tools">
            <div className="row">
              {typeof attachment === "function"
                ? attachment({
                    busy: busy || images.busy,
                    addImages,
                    selectImages: () => imageInput.current?.click(),
                  })
                : attachment}
              <div className="composer-selects">
                {!side && (
                  <label>
                    <span className="sr-only">エージェント</span>
                    <select
                      aria-label="エージェント"
                      value={role}
                      disabled={busy || !!active}
                      onChange={(e) => setRole(e.target.value)}
                    >
                      <option value="none">なし</option>
                      {roles.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.description}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label>
                  <span className="sr-only">会話モデル</span>
                  <select
                    aria-label="会話モデル"
                    value={selection?.model ?? ""}
                    disabled={busy || !view}
                    onChange={(e) => {
                      const m = status!.models.find(
                        (m) => m.model === e.target.value,
                      )!;
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
                {!side && onRecord && (
                  <select
                    aria-label="送信方法"
                    value={
                      hasImages ? "chat" : forceRecord ? "record" : sendMode
                    }
                    disabled={hasImages || forceRecord || draftLocked}
                    onChange={(e) => setSendMode(e.target.value)}
                  >
                    <option value="chat">会話で送信</option>
                    <option value="record">記録として送信</option>
                  </select>
                )}
                <Popup
                  label="モデルの詳細設定"
                  className="model-options"
                  icon={<Icon name="settings" />}
                >
                  {() => (
                    <div className="model-options-content">
                      <label>
                        <span>推論強度</span>
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
                            <option key={e.reasoningEffort}>
                              {e.reasoningEffort}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>速度</span>
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
                      <p className="hint">変更は次の依頼から適用します。</p>
                    </div>
                  )}
                </Popup>
              </div>
            </div>
            {active ? (
              <button
                className="send stop"
                type="button"
                aria-label="現在の作業を停止"
                disabled={busy || active.phase === "stopping"}
                onClick={() =>
                  void action(async () => {
                    await write(`/api/chat-requests/${active.id}/stop`, {});
                    await refresh();
                  })
                }
              >
                {active.phase === "stopping" ? "…" : "■"}
              </button>
            ) : (
              <button
                className="send"
                type="submit"
                aria-label={
                  side
                    ? "相談を送信"
                    : !hasImages && (sendMode === "record" || forceRecord)
                      ? "記録として送信"
                      : "Codexへ送信"
                }
                disabled={
                  busy ||
                  images.busy ||
                  images.items.some((item) => !item.uploaded) ||
                  (!hasImages && (sendMode === "record" || forceRecord)
                    ? recordDisabled
                    : !status?.authenticated || !model) ||
                  (!draft.trim() && !hasImages)
                }
              >
                <Icon name="send" />
              </button>
            )}
          </div>
        </form>
      </div>
    </section>
  );
}

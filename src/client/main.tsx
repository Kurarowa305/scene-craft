import { StrictMode, useEffect, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import type { Work, Conversation, BodyRecord } from "../shared/contracts";
import { read, write } from "./api";
import { FileRecords } from "./file-records";
import { VersionSettings, WorkVersions } from "./versions";
import { Chat } from "./chat";
import "./style.css";

function App() {
  const [works, setWorks] = useState<Work[]>([]);
  const [worksLoaded, setWorksLoaded] = useState(false);
  const [workId, setWorkId] = useState("");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationId, setConversationId] = useState("");
  const [records, setRecords] = useState<BodyRecord[]>([]);
  const [recordsLoaded, setRecordsLoaded] = useState(false);
  const [name, setName] = useState("");
  const [intent, setIntent] = useState("");
  const [styleChoice, setStyleChoice] = useState("none");
  const [styleCommit, setStyleCommit] = useState("");
  const [versionRevision, setVersionRevision] = useState(0);
  const [recordRevision, setRecordRevision] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [loadingChats, setLoadingChats] = useState(false);
  const [loadingRecords, setLoadingRecords] = useState(false);
  const loading = loadingChats || loadingRecords;
  const [error, setError] = useState("");
  const [stopped, setStopped] = useState(false);
  const work = works.find((item) => item.id === workId);
  const draft = drafts[conversationId] ?? "";
  useEffect(() => {
    let active = true;
    read<Work[]>("/api/works")
      .then((result) => {
        if (active) {
          setWorks(result);
          setWorksLoaded(true);
        }
      })
      .catch((failure) => {
        if (active) setError(failure.message);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    setConversations([]);
    setLoadingChats(Boolean(workId));
    if (workId) {
      read<Conversation[]>(`/api/works/${workId}/conversations`)
        .then((result) => {
          if (active) setConversations(result);
        })
        .catch((failure) => {
          if (active) setError(failure.message);
        })
        .finally(() => {
          if (active) setLoadingChats(false);
        });
    }
    return () => {
      active = false;
    };
  }, [workId]);
  useEffect(() => {
    let active = true;
    setRecords([]);
    setRecordsLoaded(false);
    setLoadingRecords(Boolean(conversationId));
    if (conversationId) {
      read<BodyRecord[]>(`/api/conversations/${conversationId}/records`)
        .then((result) => {
          if (active) {
            setRecords(result);
            setRecordsLoaded(true);
          }
        })
        .catch((failure) => {
          if (active) setError(failure.message);
        })
        .finally(() => {
          if (active) setLoadingRecords(false);
        });
    }
    return () => {
      active = false;
    };
  }, [conversationId]);
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
  function createWork(event: FormEvent) {
    event.preventDefault();
    void action(async () => {
      const created = await write<Work>("/api/works", {
        name,
        styleCommit: styleChoice === "none" ? null : styleCommit,
        ...(intent ? { intent } : {}),
      });
      setWorks((previous) =>
        previous.some((item) => item.id === created.id)
          ? previous
          : [...previous, created],
      );
      setConversationId("");
      setWorkId(created.id);
      setName("");
      setIntent("");
    });
  }
  function createConversation(target: string) {
    void action(async () => {
      const created = await write<Conversation>(
        `/api/works/${target}/conversations`,
        {},
      );
      if (workId === target) {
        setConversations((previous) =>
          previous.some((item) => item.id === created.id)
            ? previous
            : [...previous, created],
        );
      } else {
        setWorkId(target);
      }
      setConversationId(created.id);
    });
  }
  function submitRecord(event: FormEvent) {
    event.preventDefault();
    const target = conversationId;
    void action(async () => {
      const created = await write<BodyRecord>(
        `/api/conversations/${target}/records`,
        { body: draft },
      );
      setRecords((previous) =>
        previous.some((item) => item.id === created.id)
          ? previous
          : [...previous, created],
      );
      setDrafts((previous) => ({ ...previous, [target]: "" }));
    });
  }
  if (stopped)
    return (
      <main className="stopped">
        <h1>終了を要求しました</h1>
        <p>
          この画面を閉じられます。再び使うときはショートカットから起動してください。
        </p>
      </main>
    );
  return (
    <div className="app">
      <header className="app-header">
        <div>
          <span className="brand">scene-craft</span>
          <span className="edition">制作ノート</span>
        </div>
        <button
          className="quiet"
          disabled={busy}
          onClick={() =>
            void action(async () => {
              await write("/api/shutdown", {}, false);
              setStopped(true);
            })
          }
        >
          アプリ終了
        </button>
      </header>
      <div className="workspace">
        <aside className="sidebar">
          <div className="section-heading">
            <h2>作品</h2>
            <span>{works.length}</span>
          </div>
          <nav aria-label="作品とチャット">
            {works.map((item) => (
              <section className="work-entry" key={item.id}>
                <div className="work-row">
                  <button
                    className={
                      workId === item.id ? "work-name selected" : "work-name"
                    }
                    disabled={busy || loading}
                    onClick={() => {
                      setError("");
                      setConversationId("");
                      setWorkId(item.id);
                    }}
                  >
                    {item.name}
                  </button>
                  <button
                    className="new-chat"
                    aria-label={`${item.name}に新しいチャット`}
                    title="新しいチャット"
                    disabled={busy || loading}
                    onClick={() => createConversation(item.id)}
                  >
                    ＋
                  </button>
                </div>
                {workId === item.id && (
                  <div className="chat-list">
                    {conversations.map((chat, index) => (
                      <button
                        className={
                          conversationId === chat.id ? "chat selected" : "chat"
                        }
                        key={chat.id}
                        disabled={busy || loading}
                        onClick={() => {
                          setError("");
                          setConversationId(chat.id);
                        }}
                      >
                        未命名のチャット {index + 1}
                      </button>
                    ))}
                  </div>
                )}
              </section>
            ))}
          </nav>
          <form className="create-work" onSubmit={createWork}>
            <h3>新しい作品</h3>
            <label>
              作品名
              <input
                required
                maxLength={200}
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={busy}
                placeholder="例：夕暮れの港"
              />
            </label>
            <label>
              制作意図（任意）
              <textarea
                maxLength={20000}
                value={intent}
                onChange={(event) => setIntent(event.target.value)}
                disabled={busy}
                rows={3}
                placeholder="この作品で表現したいこと"
              />
            </label>
            <label>
              作品の作風
              <select
                aria-label="作品の作風"
                value={styleChoice}
                disabled={busy}
                onChange={(e) => setStyleChoice(e.target.value)}
              >
                <option value="none">作風なし</option>
                <option value="commit">Gitコミットを指定</option>
              </select>
            </label>
            {styleChoice === "commit" && (
              <label>
                作風のフルコミット
                <input
                  required
                  pattern="([a-f0-9]{40}|[a-f0-9]{64})"
                  value={styleCommit}
                  onChange={(e) => setStyleCommit(e.target.value)}
                  disabled={busy}
                />
              </label>
            )}
            <button
              className="primary"
              disabled={busy || !worksLoaded || !name.trim()}
            >
              作品を作成
            </button>
          </form>
          <VersionSettings
            onChange={() => setVersionRevision((value) => value + 1)}
          />
        </aside>
        <main className="main">
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
          {work ? (
            <>
              <div className="work-header">
                <div className="eyebrow">
                  作品 / {work.style ? `作風 ${work.style.commit}` : "作風なし"}
                </div>
                <h1>{work.name}</h1>
                {work.intent && <p className="intent">{work.intent}</p>}
              </div>
              <WorkVersions
                key={workId}
                workId={workId}
                revision={versionRevision}
              />
              {conversationId ? (
                <>
                  <div className="conversation-heading">
                    <h2>
                      未命名のチャット{" "}
                      {conversations.findIndex(
                        (item) => item.id === conversationId,
                      ) + 1}
                    </h2>
                    <span>本文の記録</span>
                  </div>
                  <div
                    className="records"
                    aria-live="polite"
                    aria-busy={loading}
                  >
                    {loading ? (
                      <p className="empty">読み込み中…</p>
                    ) : !recordsLoaded ? (
                      <p className="empty">記録を取得できません。</p>
                    ) : records.length === 0 ? (
                      <p className="empty">まだ記録はありません。</p>
                    ) : (
                      records.map((record) => (
                        <article className="record" key={record.id}>
                          <div className="record-meta">
                            <strong>手作業の記録</strong>
                            <time dateTime={record.createdAt}>
                              {new Date(record.createdAt).toLocaleString(
                                "ja-JP",
                              )}
                            </time>
                          </div>
                          <p className="record-body">{record.body}</p>
                          {record.reason && <p>理由: {record.reason}</p>}
                          {record.summary && <p>要約: {record.summary}</p>}
                        </article>
                      ))
                    )}
                  </div>
                  <Chat
                    key={`chat-${conversationId}`}
                    conversationId={conversationId}
                    onRecordsChanged={(items, nextIntent, revision) => {
                      setRecords(items);
                      setRecordRevision(revision);
                      setWorks((previous) =>
                        previous.map((w) =>
                          w.id === workId ? { ...w, intent: nextIntent } : w,
                        ),
                      );
                    }}
                  />
                  <FileRecords
                    recordRevision={recordRevision}
                    onBusy={setBusy}
                    key={conversationId}
                    workId={workId}
                    conversationId={conversationId}
                    disabled={busy || loading}
                    onRecord={(record) =>
                      setRecords((previous) =>
                        previous.some((item) => item.id === record.id)
                          ? previous
                          : [...previous, record],
                      )
                    }
                  />
                  <form className="composer" onSubmit={submitRecord}>
                    <label htmlFor="record-body">記録する本文</label>
                    <textarea
                      id="record-body"
                      rows={5}
                      required
                      maxLength={200000}
                      value={draft}
                      onChange={(event) =>
                        setDrafts((previous) => ({
                          ...previous,
                          [conversationId]: event.target.value,
                        }))
                      }
                      disabled={busy || loading}
                      placeholder="作業内容や判断の理由を、そのまま残せます。"
                    />
                    <div className="composer-footer">
                      <p className="hint">AIを使わず、原文を保存します。</p>
                      <button
                        className="primary"
                        disabled={
                          busy || loading || !recordsLoaded || !draft.trim()
                        }
                      >
                        {busy ? "保存中…" : "記録として送信"}
                      </button>
                    </div>
                  </form>
                </>
              ) : (
                <div className="empty welcome">
                  <h2>作品の記録を始める</h2>
                  <p>作品名の右の ＋ から、新しいチャットを開いてください。</p>
                </div>
              )}
            </>
          ) : (
            <div className="welcome">
              <div className="eyebrow">YOUR CREATIVE PROCESS</div>
              <h1>
                制作の過程を、
                <br />
                作品とともに。
              </h1>
              <p>
                作品を作成し、チャットに手作業の内容や
                <br />
                考えたことを残していきましょう。
              </p>
              <span className="welcome-note">
                作品を選ぶか、左から新しい作品を作成してください。
              </span>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

import { StrictMode, useEffect, useRef, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import type {
  SourceFile,
  ImportInput,
  SavedState,
  ImportOperation,
} from "../shared/files";
import type { Work, Conversation, BodyRecord } from "../shared/contracts";
import { read, write, uploadFile, SaveError } from "./api";
import { FileRecords } from "./file-records";
import { VersionSettings, WorkVersions } from "./versions";
import { Chat } from "./chat";
import { ChatEntry } from "./chat-entry";
import { ChatSettings } from "./chat-settings";
import { SideChats } from "./side-chats";
import {
  Icon,
  Modal,
  Popup,
  ResizeHandle,
  Unavailable,
  shellStyle,
} from "./ui";
import "./style.css";
import { usePaneLayout } from "./pane-layout";

function App() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploads, setUploads] = useState<Record<string, SourceFile[]>>({});
  const [selectedFiles, setSelectedFiles] = useState<
    Record<string, { id: string; file: File }[]>
  >({});
  const [uploading, setUploading] = useState(false);
  const pendingImports = useRef<Record<string, ImportInput>>({});
  const [pendingImport, setPendingImport] = useState(false);
  const [modal, setModal] = useState<
    "work" | "settings" | "reflection" | "works" | null
  >(null);
  const [settingsTab, setSettingsTab] = useState("version");
  const shell = useRef<HTMLDivElement>(null);
  const panes = usePaneLayout(shell);
  const [showPanel, setShowPanel] = useState(false);
  const [connectionRevision, setConnectionRevision] = useState(0);
  const [statuses, setStatuses] = useState<Record<string, string>>({});
  const [works, setWorks] = useState<Work[]>([]);
  const [worksLoaded, setWorksLoaded] = useState(false);
  const [workId, setWorkId] = useState("");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationId, setConversationId] = useState("");
  const [records, setRecords] = useState<BodyRecord[]>([]);
  const [recordsLoaded, setRecordsLoaded] = useState(false);
  const recordsFetch = useRef(0);
  const [initialFile, setInitialFile] = useState<File | null>(null);
  const creation = useRef<{
    fileId: string;
    work?: Work;
    conversation?: Conversation;
    input?: ImportInput;
  } | null>(null);
  const [name, setName] = useState("");
  const [intent, setIntent] = useState("");
  const [styleChoice, setStyleChoice] = useState("none");
  const [styleCommit, setStyleCommit] = useState("");
  const [versionRevision, setVersionRevision] = useState(0);
  const [recordRevision, setRecordRevision] = useState(0);
  const [sideNames, setSideNames] = useState<Record<string, string | null>>({});
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
    const sequence = ++recordsFetch.current;
    setRecords([]);
    setRecordsLoaded(false);
    setLoadingRecords(Boolean(conversationId));
    if (conversationId) {
      read<BodyRecord[]>(`/api/conversations/${conversationId}/records`)
        .then((result) => {
          if (active && sequence === recordsFetch.current) {
            setRecords(result);
            setRecordsLoaded(true);
          }
        })
        .catch((failure) => {
          if (active && sequence === recordsFetch.current)
            setError(failure.message);
        })
        .finally(() => {
          if (active && sequence === recordsFetch.current)
            setLoadingRecords(false);
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
      if (initialFile && !/\.(blend|psd|psb)$/i.test(initialFile.name))
        throw new Error(
          "既存ファイルは.blend、.psd、.psbから選択してください。",
        );
      const attempt = initialFile
        ? (creation.current ??= { fileId: crypto.randomUUID() })
        : null;
      const created =
        attempt?.work ??
        (await write<Work>("/api/works", {
          name,
          styleCommit: styleChoice === "none" ? null : styleCommit,
          ...(intent ? { intent } : {}),
        }).catch((failure) => {
          if (
            failure instanceof SaveError &&
            failure.status &&
            failure.status >= 400 &&
            failure.status < 500
          )
            creation.current = null;
          throw failure;
        }));
      if (attempt && initialFile) {
        attempt.work = created;
        attempt.conversation ??= await write<Conversation>(
          `/api/works/${created.id}/conversations`,
          {},
        );
        if (!attempt.input) {
          const uploaded = await uploadFile(
            attempt.conversation.id,
            attempt.fileId,
            initialFile,
          );
          attempt.input = {
            requestKey: crypto.randomUUID(),
            body: `${initialFile.name}を取り込みました。`,
            application:
              uploaded.file.role === "blend" ? "Blender" : "Photoshop",
            beforeStateId: null,
            files: [uploaded.file],
          };
        }
        await write(
          `/api/conversations/${attempt.conversation.id}/imports`,
          attempt.input as unknown as Record<string, unknown>,
          false,
        );
      }
      finishWorkCreation(created, attempt?.conversation?.id ?? "");
    });
  }
  function finishWorkCreation(created: Work, createdConversationId: string) {
    setWorks((previous) =>
      previous.some((item) => item.id === created.id)
        ? previous
        : [...previous, created],
    );
    setConversationId(createdConversationId);
    setWorkId(created.id);
    setModal(null);
    setName("");
    setIntent("");
    setInitialFile(null);
    creation.current = null;
  }
  function stopInitialImport() {
    void action(async () => {
      const attempt = creation.current;
      if (!attempt?.work) return;
      if (attempt.input) {
        const operations = await read<ImportOperation[]>(
          `/api/works/${attempt.work.id}/imports`,
        );
        const operation = operations.find(
          (item) => item.requestKey === attempt.input?.requestKey,
        );
        if (
          !operation ||
          !["incomplete", "committed", "abandoned"].includes(operation.phase)
        )
          throw new Error(
            "保存状態を確認中です。同じ内容で再試行してください。",
          );
        if (operation?.phase === "incomplete")
          await write(`/api/imports/${operation.id}/abandon`, {});
      }
      finishWorkCreation(attempt.work, attempt.conversation?.id ?? "");
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
  async function transferFiles(items: { id: string; file: File }[]) {
    setUploading(true);
    setError("");
    const target = conversationId;
    try {
      const files: SourceFile[] = [];
      for (const item of items)
        files.push((await uploadFile(target, item.id, item.file)).file);
      setUploads((previous) => ({
        ...previous,
        [target]: [
          ...new Map(
            [...(previous[target] ?? []), ...files].map((file) => [
              file.relativePath,
              file,
            ]),
          ).values(),
        ],
      }));
      setSelectedFiles((previous) => ({ ...previous, [target]: [] }));
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setUploading(false);
    }
  }
  async function submitRecord(body: string) {
    setBusy(true);
    try {
      const target = conversationId;
      const attached = uploads[target] ?? [];
      if (attached.length) {
        let input = pendingImports.current[target];
        if (!input) {
          const current = await read<{ currentStateId: string | null }>(
            `/api/works/${workId}/states`,
          );
          input = {
            requestKey: crypto.randomUUID(),
            body,
            files: attached,
            application: attached.some((f) => f.role === "blend")
              ? "Blender"
              : attached.some((f) => f.role === "psd")
                ? "Photoshop"
                : "Other",
            beforeStateId: current.currentStateId,
          };
          pendingImports.current[target] = input;
          setPendingImport(true);
        }
        let result: { record: BodyRecord; state: SavedState };
        try {
          result = await write<{ record: BodyRecord; state: SavedState }>(
            `/api/conversations/${target}/imports`,
            input as unknown as Record<string, unknown>,
            false,
          );
        } catch (failure) {
          if (
            failure instanceof SaveError &&
            [400, 403, 404, 409].includes(failure.status ?? 0)
          ) {
            const operations = await read<ImportOperation[]>(
              `/api/works/${workId}/imports`,
            );
            if (!operations.some((op) => op.requestKey === input.requestKey)) {
              delete pendingImports.current[target];
              setPendingImport(false);
            }
          }
          throw failure;
        }
        delete pendingImports.current[target];
        setPendingImport(false);
        setUploads((previous) => ({ ...previous, [target]: [] }));
        setRecordRevision((value) => value + 1);
        setRecords((previous) =>
          previous.some((item) => item.id === result.record.id)
            ? previous
            : [...previous, result.record],
        );
      } else {
        const created = await write<BodyRecord>(
          `/api/conversations/${target}/records`,
          { body },
        );
        setRecords((previous) =>
          previous.some((item) => item.id === created.id)
            ? previous
            : [...previous, created],
        );
      }
    } finally {
      setBusy(false);
    }
  }
  async function abandonAttachment() {
    await action(async () => {
      const input = pendingImports.current[conversationId];
      const operations = await read<ImportOperation[]>(
        `/api/works/${workId}/imports`,
      );
      const op = operations.find(
        (item) => item.requestKey === input?.requestKey,
      );
      if (!op || op.phase !== "incomplete")
        throw new Error(
          "照合が必要です。同じ内容で再送し、保存結果を確認してください。",
        );
      await write(`/api/imports/${op.id}/abandon`, {});
      delete pendingImports.current[conversationId];
      setPendingImport(false);
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
    <div
      ref={shell}
      className={`shell ${showPanel ? "mobile-panel" : ""}`}
      style={shellStyle(panes.widths[0], panes.widths[1])}
    >
      <aside
        className={`sidebar ${panes.collapsed[0] ? "pane-collapsed" : ""}`}
      >
        {panes.collapsed[0] && (
          <button
            className="pane-restore"
            aria-label="チャット一覧を表示"
            disabled={!panes.canRestore(0)}
            title={
              panes.canRestore(0)
                ? "チャット一覧を表示"
                : "ウィンドウを広げると表示できます"
            }
            onClick={() => panes.restore(0)}
          >
            ☰
          </button>
        )}
        <div className="brand">
          <span className="brand-mark">s</span>
          <span className="brand-name">scene-craft</span>
          <small>WORKSPACE</small>
        </div>
        <div className="sidebar-tools">
          <button
            className="nav-button"
            disabled={busy || uploading || pendingImport}
            aria-label="作品を作成"
            onClick={() => setModal("work")}
          >
            <Icon name="plus" />
            <span>作品を作成</span>
          </button>
          <button
            className="nav-button mobile-toggle"
            aria-label="作品を選択"
            disabled={busy || uploading || pendingImport}
            onClick={() => setModal("works")}
          >
            <Icon name="folder" />
          </button>
          <button
            className="nav-button"
            aria-label="作品を振り返る"
            onClick={() => setModal("reflection")}
          >
            <Icon name="history" />
            <span>作品を振り返る</span>
          </button>
        </div>
        <div className="nav-label">作品とチャット</div>
        <nav className="projects" aria-label="作品とチャット">
          {!worksLoaded && <p className="hint">作品を読み込み中…</p>}
          {works.map((item) => (
            <section className="project" key={item.id}>
              <div className="project-heading">
                <button
                  className="project-title"
                  disabled={busy || loading || uploading || pendingImport}
                  onClick={() => {
                    setError("");
                    setConversationId("");
                    setWorkId(item.id);
                  }}
                >
                  <Icon name="folder" />
                  <span>{item.name}</span>
                </button>
                <button
                  className="icon project-new-chat"
                  aria-label={`${item.name}に新しいチャット`}
                  title="新しいチャット"
                  disabled={busy || loading || uploading || pendingImport}
                  onClick={() => createConversation(item.id)}
                >
                  <Icon name="plus" />
                </button>
              </div>
              {workId === item.id &&
                conversations.map((chat, index) => (
                  <ChatEntry
                    key={chat.id}
                    chat={chat}
                    title={chat.title ?? `未命名のチャット ${index + 1}`}
                    selected={conversationId === chat.id}
                    status={statuses[chat.id] ?? ""}
                    disabled={busy || loading || uploading || pendingImport}
                    onSelect={() => {
                      setError("");
                      setConversationId(chat.id);
                      setShowPanel(false);
                    }}
                    onRename={(name) =>
                      setConversations((previous) =>
                        previous.map((item) =>
                          item.id === chat.id ? { ...item, title: name } : item,
                        ),
                      )
                    }
                  />
                ))}
            </section>
          ))}
        </nav>
        <div className="sidebar-footer">
          <button
            className="nav-button"
            aria-label="設定・保存データ"
            onClick={() => setModal("settings")}
          >
            <Icon name="settings" />
            <span>設定・保存データ</span>
          </button>
          <button
            className="nav-button"
            disabled={busy}
            onClick={() =>
              void action(async () => {
                await write("/api/shutdown", {}, false);
                setStopped(true);
              })
            }
          >
            <span className="icon">⏻</span>
            <span>アプリ終了</span>
          </button>
        </div>
      </aside>
      <ResizeHandle label="作品一覧の幅" {...panes.handle(0)} />
      <div className="workspace">
        <div className="workspace-body">
          <main
            className={`main-chat ${panes.collapsed[1] ? "pane-collapsed" : ""}`}
            aria-label="メインチャット"
          >
            <header className="chat-header">
              <h1>
                {conversationId
                  ? (conversations.find((c) => c.id === conversationId)
                      ?.title ??
                    `未命名のチャット ${conversations.findIndex((c) => c.id === conversationId) + 1}`)
                  : (work?.name ?? "scene-craft")}
              </h1>
              <button
                className="icon mobile-toggle"
                aria-label="右タブを表示"
                onClick={() => setShowPanel(true)}
              >
                ⇄
              </button>
            </header>
            {error && modal !== "work" && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            {conversationId && work ? (
              <>
                <Chat
                  key={conversationId}
                  conversationId={conversationId}
                  recordDraft={draft}
                  onDraftChange={(value) =>
                    setDrafts((previous) => ({
                      ...previous,
                      [conversationId]: value,
                    }))
                  }
                  onRecord={submitRecord}
                  recordDisabled={
                    busy || loading || uploading || !recordsLoaded
                  }
                  draftLocked={pendingImport}
                  forceRecord={!!uploads[conversationId]?.length}
                  onStatusChange={(value) =>
                    setStatuses((previous) => ({
                      ...previous,
                      [conversationId]: value,
                    }))
                  }
                  connectionRevision={connectionRevision}
                  attachment={
                    <Popup
                      label="成果物・ファイルを添付"
                      className="attachment-anchor"
                      icon={<Icon name="plus" />}
                      disabled={uploading || pendingImport}
                    >
                      {(close) => (
                        <>
                          <div className="menu-heading">
                            制作ファイルと保存状態
                          </div>
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              panes.restore(2);
                              setShowPanel(true);
                              document.dispatchEvent(
                                new CustomEvent("open-artifacts"),
                              );
                              close();
                            }}
                          >
                            保存済み成果物を開く
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              fileInput.current?.click();
                              close();
                            }}
                          >
                            コンピューターからファイルを添付
                          </button>
                        </>
                      )}
                    </Popup>
                  }
                  composerExtra={
                    <>
                      <input
                        className="sr-only"
                        ref={fileInput}
                        type="file"
                        aria-label="コンピューターからファイルを選択"
                        multiple
                        accept=".blend,.psd,.psb,.png,.jpg,.jpeg,.webp,.exr,.tif,.tiff"
                        onChange={(e) => {
                          const items = Array.from(
                            e.target.files ?? [],
                            (file) => ({ id: crypto.randomUUID(), file }),
                          );
                          setSelectedFiles((previous) => ({
                            ...previous,
                            [conversationId]: items,
                          }));
                          if (items.length) void transferFiles(items);
                          e.target.value = "";
                        }}
                      />
                      {uploading && (
                        <p className="hint" role="status">
                          ファイルを受け渡し中…
                        </p>
                      )}
                      {!uploading &&
                        (selectedFiles[conversationId]?.length ?? 0) > 0 && (
                          <button
                            type="button"
                            onClick={() =>
                              void transferFiles(
                                selectedFiles[conversationId] ?? [],
                              )
                            }
                          >
                            同じファイルで再送
                          </button>
                        )}
                      {!!uploads[conversationId]?.length && (
                        <div className="attachments">
                          {uploads[conversationId]!.map((file) => (
                            <span
                              className="source-chip"
                              key={file.relativePath}
                            >
                              <span>{file.relativePath.split("/").at(-1)}</span>
                              <button
                                type="button"
                                aria-label={`${file.relativePath.split("/").at(-1)}を外す`}
                                disabled={pendingImport}
                                onClick={() =>
                                  setUploads((previous) => ({
                                    ...previous,
                                    [conversationId]: previous[
                                      conversationId
                                    ]!.filter((f) => f !== file),
                                  }))
                                }
                              >
                                ×
                              </button>
                            </span>
                          ))}
                          <p>保存済みファイルを本文と一緒に記録します。</p>
                        </div>
                      )}
                      {pendingImport && (
                        <div className="note">
                          <p role="status">
                            保存結果の確認待ちです。入力を保持して、同じ内容で再送します。
                          </p>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void abandonAttachment()}
                          >
                            未完成の添付記録を中止
                          </button>
                        </div>
                      )}
                    </>
                  }
                  onSideNamesChanged={setSideNames}
                  onNameChanged={(name) =>
                    setConversations((previous) =>
                      previous.map((c) =>
                        c.id === conversationId ? { ...c, title: name } : c,
                      ),
                    )
                  }
                  onRecordsChanged={(items, nextIntent, revision) => {
                    ++recordsFetch.current;
                    setRecords(items);
                    setRecordsLoaded(true);
                    setLoadingRecords(false);
                    setRecordRevision(revision);
                    setWorks((previous) =>
                      previous.map((w) =>
                        w.id === workId ? { ...w, intent: nextIntent } : w,
                      ),
                    );
                  }}
                />
              </>
            ) : (
              <div className="new-chat-intro">
                <span className="assistant-dot">s</span>
                <h2>{work ? "作品の記録を始める" : "何をつくりますか？"}</h2>
                <p>
                  {work
                    ? "作品名の右の ＋ から、新しいチャットを開いてください。"
                    : "作品を選ぶか、新しい作品を作成してください。"}
                </p>
                {!work && (
                  <button
                    className="secondary"
                    disabled={busy || uploading || pendingImport}
                    onClick={() => setModal("work")}
                  >
                    新しい作品
                  </button>
                )}
              </div>
            )}
          </main>
          <ResizeHandle label="チャットと右タブの幅" {...panes.handle(1)} />
          <div
            className={`tab-region ${panes.collapsed[2] ? "pane-collapsed" : ""}`}
          >
            {panes.collapsed[2] && (
              <button
                className="pane-restore"
                aria-label="右タブを表示"
                disabled={!panes.canRestore(2)}
                title={
                  panes.canRestore(2)
                    ? "右タブを表示"
                    : "ウィンドウを広げると表示できます"
                }
                onClick={() => panes.restore(2)}
              >
                ▣
              </button>
            )}
            <SideChats
              key={conversationId || workId}
              mainId={conversationId}
              connectionRevision={connectionRevision}
              workId={workId}
              recordRevision={recordRevision + records.length}
              names={sideNames}
              onMobileBack={() => setShowPanel(false)}
              styleContent={
                work ? (
                  <>
                    <h2>作風・制作方針</h2>
                    <p className="intro">
                      作品の制作意図は、一般的な制作方針より優先します。
                    </p>
                    <div className="list-row">
                      <div>
                        <strong>この作品の制作意図</strong>
                        <p>{work.intent ?? "未入力"}</p>
                      </div>
                    </div>
                    <WorkVersions workId={workId} revision={versionRevision} />
                    <label className="field">
                      この作品に適用する版
                      <select disabled>
                        <option>{work.style?.commit ?? "作風なし"}</option>
                      </select>
                    </label>
                    <button disabled className="secondary">
                      選んだ版を作品に適用
                    </button>
                    <Unavailable>作風の変更・制作方針の採用</Unavailable>
                  </>
                ) : undefined
              }
              filesContent={
                conversationId && workId ? (
                  <FileRecords
                    recordRevision={recordRevision}
                    onSaved={() => setRecordRevision((value) => value + 1)}
                    onBusy={setBusy}
                    workId={workId}
                    disabled={busy || loading || uploading || pendingImport}
                  />
                ) : undefined
              }
            />
          </div>
        </div>
      </div>
      {modal === "works" && (
        <Modal title="作品を選択" close={() => setModal(null)}>
          <div className="tab-type-list">
            {works.map((w) => (
              <button
                key={w.id}
                onClick={() => {
                  setWorkId(w.id);
                  setConversationId("");
                  setError("");
                  setModal(null);
                  setShowPanel(false);
                }}
              >
                <Icon name="folder" />
                <span>{w.name}</span>
              </button>
            ))}
          </div>
        </Modal>
      )}
      {modal === "work" && (
        <Modal title="作品を作成" close={() => !busy && setModal(null)}>
          <form className="create-work" onSubmit={createWork}>
            <label className="field">
              作品名
              <input
                required
                maxLength={200}
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={busy || Boolean(creation.current)}
                autoFocus
                placeholder="例：夕暮れの港"
              />
            </label>
            <label className="field">
              制作意図（任意）
              <textarea
                maxLength={20000}
                value={intent}
                onChange={(e) => setIntent(e.target.value)}
                disabled={busy || Boolean(creation.current)}
                rows={3}
                placeholder="この作品で表現したいこと"
              />
            </label>
            <label className="field">
              作品の作風
              <select
                aria-label="作品の作風"
                value={styleChoice}
                disabled={busy || Boolean(creation.current)}
                onChange={(e) => setStyleChoice(e.target.value)}
              >
                <option value="none">作風なし</option>
                <option value="commit">Gitコミットを指定</option>
              </select>
            </label>
            {styleChoice === "commit" && (
              <label className="field">
                作風のフルコミット
                <input
                  required
                  pattern="([a-f0-9]{40}|[a-f0-9]{64})"
                  value={styleCommit}
                  onChange={(e) => setStyleCommit(e.target.value)}
                  disabled={busy || Boolean(creation.current)}
                />
              </label>
            )}
            <label className="field">
              既存ファイルから始める（任意）
              <input
                type="file"
                accept=".blend,.psd,.psb"
                disabled={busy || Boolean(creation.current)}
                onChange={(event) =>
                  setInitialFile(event.target.files?.[0] ?? null)
                }
              />
              {initialFile && <span>{initialFile.name}</span>}
            </label>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            {error && creation.current?.work && (
              <button type="button" disabled={busy} onClick={stopInitialImport}>
                取り込みを中止して作品を開く
              </button>
            )}
            <div className="dialog-footer">
              <button
                type="button"
                className="secondary"
                onClick={() => setModal(null)}
                disabled={busy}
              >
                キャンセル
              </button>
              <button
                className="primary"
                disabled={
                  busy ||
                  uploading ||
                  pendingImport ||
                  !worksLoaded ||
                  !name.trim()
                }
              >
                {creation.current ? "同じ内容で再試行" : "作品を作成"}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {modal === "reflection" && (
        <Modal title="作品を振り返る" close={() => setModal(null)}>
          <p className="intro">対象作品の全履歴を振り返ります。</p>
          <div className="reflection-list">
            {works.map((w) => (
              <label key={w.id}>
                <input type="checkbox" />
                {w.name}
              </label>
            ))}
          </div>
          <Unavailable>振り返り</Unavailable>
          <div className="dialog-footer">
            <button disabled className="primary">
              振り返りを始める
            </button>
          </div>
        </Modal>
      )}
      {modal === "settings" && (
        <Modal title="設定・保存データ" close={() => setModal(null)}>
          <nav className="settings-nav">
            {[
              ["chat", "ChatGPT・モデル"],
              ["backup", "バックアップ"],
              ["data", "保存データ"],
              ["version", "版とGit"],
            ].map(([id, label]) => (
              <button
                key={id}
                className={settingsTab === id ? "active" : ""}
                onClick={() => setSettingsTab(id)}
              >
                {label}
              </button>
            ))}
          </nav>
          {settingsTab === "chat" ? (
            <ChatSettings
              conversationId={conversationId}
              works={works}
              onChange={() => setConnectionRevision((value) => value + 1)}
            />
          ) : settingsTab === "version" ? (
            <VersionSettings
              onChange={() => setVersionRevision((v) => v + 1)}
            />
          ) : settingsTab === "backup" ? (
            <>
              <h3>全体バックアップ</h3>
              <label className="field">
                バックアップ先
                <input disabled placeholder="保存先フォルダー" />
              </label>
              <button className="secondary" disabled>
                バックアップを作成
              </button>
              <div className="rule" />
              <h3>バックアップから復元</h3>
              <label className="field">
                復元先
                <input disabled placeholder="空の保存先フォルダー" />
              </label>
              <button className="secondary" disabled>
                復元する
              </button>
              <Unavailable>バックアップ・復元</Unavailable>
            </>
          ) : (
            <>
              <h3>保存データ管理</h3>
              <p className="intro">
                制作データの容量と、削除が影響する保存状態を確認します。
              </p>
              <button className="secondary" disabled>
                保存データを確認
              </button>
              <Unavailable>保存実体の削除・形式移行</Unavailable>
            </>
          )}
        </Modal>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

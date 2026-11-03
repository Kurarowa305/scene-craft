import { useEffect, useRef, useState, type ReactNode } from "react";
import type { SideChat } from "../shared/side-chat";
import type { SavedState, FixedFile } from "../shared/files";
import { read, write } from "./api";
import { References } from "./references";
import { Chat } from "./chat";
import { Icon, Unavailable } from "./ui";

type Kind =
  | "new"
  | "catalog"
  | "side"
  | "history"
  | "guards"
  | "style"
  | "reference"
  | "artifact"
  | "reference-detail";
interface Tab {
  id: string;
  kind: Kind;
  title: string;
  referenceId?: string;
  sideId?: string;
  state?: SavedState;
  file?: FixedFile;
}
const choices = [
  ["catalog", "image", "成果物", "この作品のファイル・編集案を開く"],
  ["side", "chat", "サイドチャット", "制作と並行して、気になることを相談"],
  ["history", "history", "制作履歴", "分岐と手修正のつながりを見る"],
  ["guards", "shield", "保護一覧", "変更させない対象と項目を管理"],
  ["style", "leaf", "作風・制作方針", "作品で使う方針と版を確認"],
  ["reference", "image", "参考資料", "出典付きの参考資料・選択した要素を確認"],
] as const;

export function SideChats({
  mainId,
  connectionRevision,
  workId,
  recordRevision,
  names,
  styleContent,
  onMobileBack,
  onReveal,
}: {
  mainId: string;
  connectionRevision: number;
  workId: string;
  recordRevision: number;
  names: Record<string, string | null>;
  styleContent?: ReactNode;
  onMobileBack: () => void;
  onReveal: () => void;
}) {
  const [sideTitles, setSideTitles] = useState<Record<string, string | null>>(
    {},
  );
  const creating = useRef(new Set<string>());
  const creationInputs = useRef(
    new Map<string, { requestKey: string; selectedStateIds: string[] }>(),
  );
  const [states, setStates] = useState<SavedState[]>([]);
  const [tabs, setTabs] = useState<Tab[]>([
    { id: "new", kind: "new", title: "新しいタブ" },
  ]);
  const [active, setActive] = useState("new");
  const [error, setError] = useState("");
  const [selectedState, setSelectedState] = useState<string | null>(null);
  const tab = tabs.find((t) => t.id === active);
  useEffect(() => {
    let current = true;
    if (workId)
      read<{ states: SavedState[] }>(`/api/works/${workId}/states`)
        .then((data) => {
          if (current) setStates(data.states);
        })
        .catch(() => {
          if (current) setError("保存済み成果物を取得できません。");
        });
    return () => {
      current = false;
    };
  }, [mainId, workId, recordRevision]);
  useEffect(() => {
    function catalog() {
      show({ id: "catalog", kind: "catalog", title: "成果物" });
    }
    document.addEventListener("open-artifacts", catalog);
    return () => document.removeEventListener("open-artifacts", catalog);
  }, []);
  useEffect(() => {
    function open(event: Event) {
      const detail = (
        event as CustomEvent<{ id: string; title: string; workId: string }>
      ).detail;
      if (!detail || detail.workId !== workId) return;
      show({
        id: `reference-${detail.id}`,
        kind: "reference-detail",
        title: detail.title,
        referenceId: detail.id,
      });
      onReveal();
    }
    document.addEventListener("open-reference", open);
    return () => document.removeEventListener("open-reference", open);
  }, [workId, onReveal]);
  function sideTitle(id: string) {
    return names[id] ?? sideTitles[id] ?? "未命名のサイドチャット";
  }
  function show(next: Tab) {
    setTabs((previous) =>
      previous.some((t) => t.id === next.id) ? previous : [...previous, next],
    );
    setActive(next.id);
  }
  function choose(kind: Kind) {
    const target = active;
    const existing =
      kind === "side"
        ? undefined
        : tabs.find((t) => t.kind === kind && t.id !== active);
    if (existing) {
      setTabs((previous) => previous.filter((t) => t.id !== active));
      setActive(existing.id);
      return;
    }
    setTabs((previous) =>
      previous.map((t) =>
        t.id === active
          ? {
              ...t,
              kind,
              title: choices.find((c) => c[0] === kind)?.[2] ?? t.title,
            }
          : t,
      ),
    );
    if (kind === "side") void createSide(target);
  }
  async function createSide(target: string) {
    if (!mainId || creating.current.has(target)) return;
    creating.current.add(target);
    setError("");
    try {
      const input = creationInputs.current.get(target) ?? {
        requestKey: crypto.randomUUID(),
        selectedStateIds: selectedState ? [selectedState] : [],
      };
      creationInputs.current.set(target, input);
      const side = await write<SideChat>(
        `/api/conversations/${mainId}/side-chats`,
        input,
        false,
      );
      setTabs((previous) =>
        previous.map((t) =>
          t.id === target ? { ...t, sideId: side.conversationId } : t,
        ),
      );
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      creating.current.delete(target);
    }
  }
  return (
    <aside className="inspector" aria-label="右側タブ">
      <nav className="tabs" role="tablist" aria-label="成果物と相談のタブ">
        <button
          className="icon mobile-toggle"
          aria-label="チャットに戻る"
          onClick={onMobileBack}
        >
          ⇄
        </button>
        {tabs.map((t) => (
          <div className={`tab ${active === t.id ? "active" : ""}`} key={t.id}>
            <button
              className="tab-open"
              role="tab"
              id={`tab-${t.id}`}
              aria-controls={`panel-${t.id}`}
              aria-selected={active === t.id}
              onClick={() => setActive(t.id)}
            >
              {t.sideId ? sideTitle(t.sideId) : t.title}
            </button>
            <button
              className="tab-close"
              aria-label={`${t.sideId ? sideTitle(t.sideId) : t.title}を閉じる`}
              onClick={() => {
                setTabs((previous) => previous.filter((x) => x.id !== t.id));
                if (active === t.id)
                  setActive(tabs.find((x) => x.id !== t.id)?.id ?? "");
              }}
            >
              ×
            </button>
          </div>
        ))}
        <button
          className="icon tab-add"
          aria-label="新しいタブ"
          onClick={() =>
            show({ id: crypto.randomUUID(), kind: "new", title: "新しいタブ" })
          }
        >
          <Icon name="plus" />
        </button>
      </nav>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="panel-content">
        {tabs.map((t) => (
          <section
            key={t.id}
            className={t.sideId ? "side-tab" : undefined}
            role="tabpanel"
            id={`panel-${t.id}`}
            aria-labelledby={`tab-${t.id}`}
            hidden={active !== t.id}
          >
            {t.kind === "new" && (
              <div className="tab-chooser">
                <div className="eyebrow">NEW TAB</div>
                <h2>タブを開く</h2>
                <p className="muted">このタブで開く内容を選んでください。</p>
                <div className="tab-type-list">
                  {choices.map(([kind, icon, title, description]) => (
                    <button
                      key={kind}
                      disabled={kind === "side" && !mainId}
                      onClick={() => choose(kind)}
                    >
                      <Icon name={icon} />
                      <span>
                        <strong>{title}</strong>
                        <small>{description}</small>
                      </span>
                      <span className="type-arrow">↗</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {t.kind === "catalog" && (
              <div className="panel-page">
                <h2>成果物</h2>
                {!states.length && (
                  <p className="muted">成果物はまだありません。</p>
                )}
                {states.flatMap((s) =>
                  s.files.map((f) => (
                    <button
                      className="artifact-link"
                      key={`${s.id}-${f.id}`}
                      onClick={() => {
                        setSelectedState(s.id);
                        show({
                          id: `file-${s.id}-${f.id}`,
                          kind: "artifact",
                          title: f.source.relativePath.split("/").at(-1)!,
                          state: s,
                          file: f,
                        });
                      }}
                    >
                      <Icon name="image" />
                      <span>
                        <strong>
                          {f.source.relativePath.split("/").at(-1)}
                        </strong>
                      </span>
                      <span className="arrow">↗</span>
                    </button>
                  )),
                )}
              </div>
            )}
            {t.kind === "artifact" && t.state && t.file && (
              <Preview key={t.id} state={t.state} file={t.file} />
            )}
            {t.kind === "side" &&
              (t.sideId ? (
                <Chat
                  conversationId={t.sideId}
                  side
                  connectionRevision={connectionRevision}
                  onNameChanged={(name) =>
                    setSideTitles((previous) => ({
                      ...previous,
                      [t.sideId!]: name,
                    }))
                  }
                  onRecordsChanged={() => {}}
                />
              ) : (
                <div className="empty" role="status">
                  <p>
                    {error
                      ? "相談を開けませんでした。"
                      : "チャットを開いています…"}
                  </p>
                  {error && (
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => void createSide(t.id)}
                    >
                      再試行
                    </button>
                  )}
                </div>
              ))}
            {t.kind === "style" && (
              <div className="panel-page">
                {styleContent ?? (
                  <p className="muted">作品を選択してください。</p>
                )}
              </div>
            )}
            {t.kind === "guards" && (
              <div className="panel-page">
                <div className="eyebrow">PROTECTION</div>
                <h2>保護一覧</h2>
                <p className="intro">変更させない対象と項目を管理します。</p>
                <label className="field">
                  対象
                  <input placeholder="カメラ・材質など" disabled />
                </label>
                <label className="field">
                  保護する項目
                  <input placeholder="位置・回転・設定など" disabled />
                </label>
                <button className="secondary" disabled>
                  保護を追加
                </button>
                <Unavailable>保護指定の登録・解除</Unavailable>
              </div>
            )}
            {t.kind === "history" && (
              <div className="panel-page">
                <div className="eyebrow">PRODUCTION HISTORY</div>
                <h2>制作履歴</h2>
                <p className="intro">
                  左から右へ、分岐と手修正のつながりを表示します。
                </p>
                <div
                  className="history-placeholder"
                  aria-label="制作履歴の表示領域"
                >
                  <span>保存状態</span>
                  <span>→</span>
                  <span>変更後</span>
                </div>
                <Unavailable>制作履歴の分岐グラフ・復元・派生</Unavailable>
                <button className="secondary" disabled>
                  この状態に戻す
                </button>{" "}
                <button className="secondary" disabled>
                  ここから別作品を作成
                </button>
              </div>
            )}
            {(t.kind === "reference" || t.kind === "reference-detail") && (
              <References
                workId={workId}
                revision={recordRevision}
                referenceId={t.referenceId}
              />
            )}
          </section>
        ))}
        {!tab && (
          <div className="empty">
            <p>＋からタブを開いてください。</p>
          </div>
        )}
      </div>
    </aside>
  );
}
function Preview({ state, file }: { state: SavedState; file: FixedFile }) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [failed, setFailed] = useState(false);
  const image = /\.(png|jpe?g|webp)$/i.test(file.source.relativePath);
  const url = `/api/states/${state.id}/files/${file.id}`;
  return (
    <div className="preview-wrap">
      <div className="panel-top">
        <div>
          <h2>{file.source.relativePath}</h2>
          <span className="muted">
            保存済みの状態 · {new Date(state.createdAt).toLocaleString("ja-JP")}
          </span>
        </div>
      </div>
      {image && !failed ? (
        <div
          className="preview-canvas"
          onWheel={(e) =>
            setZoom((z) =>
              Math.max(0.2, Math.min(5, z * (e.deltaY < 0 ? 1.1 : 0.9))),
            )
          }
          onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
          onPointerMove={(e) => {
            if (e.currentTarget.hasPointerCapture(e.pointerId))
              setPan((p) => ({ x: p.x + e.movementX, y: p.y + e.movementY }));
          }}
          onPointerUp={(e) =>
            e.currentTarget.releasePointerCapture(e.pointerId)
          }
        >
          <img
            src={`${url}?inline=1`}
            onError={() => setFailed(true)}
            draggable={false}
            alt={`${file.source.relativePath}のプレビュー`}
            style={{
              transform: `translate(${pan.x}px,${pan.y}px) scale(${zoom})`,
            }}
          />
        </div>
      ) : (
        <div className="empty">
          <p>
            {failed
              ? "画像を取得できません。実体の欠落・破損や接続を確認してください。"
              : "このファイルの画像プレビューは未取得です。"}
          </p>
          <p>制作ファイルと本文の記録は残っています。</p>
        </div>
      )}
      <div className="preview-toolbar">
        <a href={url}>ファイルを開く</a>
        <div className="row">
          <button
            aria-label="縮小"
            onClick={() => setZoom((z) => Math.max(0.2, z / 1.2))}
          >
            −
          </button>
          <span>{Math.round(zoom * 100)}%</span>
          <button
            aria-label="拡大"
            onClick={() => setZoom((z) => Math.min(5, z * 1.2))}
          >
            ＋
          </button>
          <button
            onClick={() => {
              setZoom(1);
              setPan({ x: 0, y: 0 });
            }}
          >
            フィット
          </button>
        </div>
      </div>
    </div>
  );
}

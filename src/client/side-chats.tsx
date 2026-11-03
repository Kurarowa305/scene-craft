import { useEffect, useState, type FormEvent } from "react";
import type { SideChat, SideChatView } from "../shared/side-chat";
import type { ChatView } from "../shared/chat";
import type { SavedState } from "../shared/files";
import { read, write } from "./api";
import { Chat } from "./chat";

export function SideChats({
  mainId,
  workId,
  recordRevision,
}: {
  mainId: string;
  workId: string;
  recordRevision: number;
}) {
  const [sides, setSides] = useState<SideChatView[]>([]);
  const [states, setStates] = useState<SavedState[]>([]);
  const [open, setOpen] = useState<string[]>([]);
  const [active, setActive] = useState("");
  const [names, setNames] = useState<Record<string, string | null>>({});
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let current = true;
    Promise.all([
      read<SideChatView[]>(`/api/conversations/${mainId}/side-chats`),
      read<{ states: SavedState[] }>(`/api/works/${workId}/states`),
    ])
      .then(([s, data]) => {
        if (current) {
          setSides((previous) => [
            ...new Map(
              [...s, ...previous].map((side) => [side.conversationId, side]),
            ).values(),
          ]);
          setStates(data.states);
        }
      })
      .catch(() => {
        if (current) setError("保存済みの相談・成果物を取得できません。");
      });
    return () => {
      current = false;
    };
  }, [mainId, workId, recordRevision]);
  function named(id: string, name: string | null) {
    setNames((previous) =>
      previous[id] === name ? previous : { ...previous, [id]: name },
    );
  }
  function title(id: string) {
    return (
      names[id] ??
      sides.find((s) => s.conversationId === id)?.title ??
      `未命名のサイドチャット ${sides.findIndex((s) => s.conversationId === id) + 1}`
    );
  }
  // Closed tabs still receive naming results without mounting their full chat UI.
  const closedIds = sides
    .filter((s) => !open.includes(s.conversationId))
    .map((s) => s.conversationId)
    .join(",");
  useEffect(() => {
    const sources = closedIds
      ? closedIds.split(",").map((id) => {
          const source = new EventSource(`/api/conversations/${id}/events`);
          source.addEventListener("chat", (event) => {
            const view: ChatView = JSON.parse((event as MessageEvent).data);
            named(id, view.auxiliary.name);
          });
          return source;
        })
      : [];
    return () => {
      for (const source of sources) source.close();
    };
  }, [closedIds]);
  function show(id: string) {
    setOpen((previous) =>
      previous.includes(id) ? previous : [...previous, id],
    );
    setActive(id);
  }
  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const side = await write<SideChat>(
        `/api/conversations/${mainId}/side-chats`,
        { selectedStateIds: selected },
      );
      setSides((previous) =>
        previous.some((s) => s.conversationId === side.conversationId)
          ? previous
          : [...previous, { ...side, title: null }],
      );
      show(side.conversationId);
      setSelected([]);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <aside className="side-panel" aria-label="右側タブ">
      <div role="tablist" aria-label="相談タブ">
        <button
          role="tab"
          aria-selected={!active}
          onClick={() => setActive("")}
        >
          ＋ 新しいタブ
        </button>
        {open.map((id) => (
          <button
            role="tab"
            key={id}
            aria-selected={active === id}
            onClick={() => setActive(id)}
          >
            {title(id)}
          </button>
        ))}
      </div>
      {error && <p role="alert">{error}</p>}
      {!active && (
        <div role="tabpanel">
          <form onSubmit={(e) => void create(e)}>
            <label>
              タブの種類
              <select aria-label="タブの種類">
                <option>サイドチャット</option>
              </select>
            </label>
            <label>
              参照する保存済み成果物
              <select
                multiple
                aria-label="参照する保存済み成果物"
                value={selected}
                onChange={(e) =>
                  setSelected(
                    Array.from(e.target.selectedOptions, (o) => o.value),
                  )
                }
              >
                {states.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.application} / {s.recordBody ?? s.id}
                  </option>
                ))}
              </select>
            </label>
            {!states.length && <p>参照できる保存済み成果物はありません。</p>}
            <p className="hint">
              開始時の作品情報・メインの原文・選択成果物を固定します。
            </p>
            <button disabled={busy}>相談を開始</button>
          </form>
          <h3>保存済みの相談</h3>
          {sides.map((s) => (
            <button
              key={s.conversationId}
              onClick={() => show(s.conversationId)}
            >
              相談を再表示: {title(s.conversationId)}
            </button>
          ))}
        </div>
      )}
      {open.map((id) => {
        return (
          <div role="tabpanel" key={id} hidden={active !== id}>
            <button
              onClick={() => {
                setOpen((previous) => previous.filter((x) => x !== id));
                setActive("");
              }}
            >
              タブを閉じる
            </button>
            <p className="hint">
              タブを閉じても実行は継続します。「停止」でこの相談だけを止めます。
            </p>
            <Chat
              conversationId={id}
              side
              onNameChanged={(name) => named(id, name)}
              onRecordsChanged={() => {}}
            />
          </div>
        );
      })}
    </aside>
  );
}

import { useEffect, useState } from "react";
import type { SavedState, ImportOperation } from "../shared/files";
import { read, write } from "./api";

const reasons: Record<string, string> = {
  not_found: "依存ファイルが見つかりません",
  cycle: "依存参照が循環しています",
  outside_root: "依存先が許可されたフォルダー外です",
  inspection_pending: "内容と依存関係の検査は未実施です",
};
export function FileRecords({
  workId,
  disabled,
  onBusy,
  recordRevision,
  onSaved,
}: {
  workId: string;
  disabled: boolean;
  onBusy: (busy: boolean) => void;
  recordRevision: number;
  onSaved: () => void;
}) {
  const [states, setStates] = useState<SavedState[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [operations, setOperations] = useState<ImportOperation[]>([]);
  const [statesLoaded, setStatesLoaded] = useState(false);
  const loaded = statesLoaded;
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    setStatesLoaded(false);
    void read<{ states: SavedState[]; currentStateId: string | null }>(
      `/api/works/${workId}/states`,
    )
      .then((result) => {
        if (active) {
          setStates(result.states);
          setCurrent(result.currentStateId);
          setStatesLoaded(true);
        }
      })
      .catch(() => {
        if (active)
          setError("保存状態を取得できません。再読み込みしてください。");
      });
    return () => {
      active = false;
    };
  }, [workId, recordRevision]);
  useEffect(() => {
    let active = true;
    void read<ImportOperation[]>(`/api/works/${workId}/imports`)
      .then((items) => {
        if (active) setOperations(items);
      })
      .catch((failure) => {
        if (active) setError(failure.message);
      });
    return () => {
      active = false;
    };
  }, [workId, recordRevision]);
  return (
    <section className="file-records" aria-label="制作ファイルと保存状態">
      <h3>保存状態</h3>
      {!loaded && <p>保存状態を読み込み中…</p>}
      {states.map((state, index) => (
        <article className="saved-state" key={state.id}>
          <h4>
            {state.changeKind === "import" ? "取り込み" : "手修正"} {index + 1}{" "}
            {current === state.id ? "（現在）" : ""}
          </h4>
          <p>
            変更前：
            {state.beforeStateId
              ? `保存状態 ${states.findIndex((item) => item.id === state.beforeStateId) + 1}`
              : "なし（取り込み前の経緯は不明）"}{" "}
            → 変更後：保存状態 {index + 1}
          </p>
          <p>{state.application}</p>
          {state.recordBody && (
            <p className="saved-state-text">{state.recordBody}</p>
          )}
          <p>
            元レンダー：
            {state.render
              ? `${state.render.stateId} / ${state.render.fileId}`
              : "不明・未指定"}
          </p>
          <ul>
            {state.files.map((file) => (
              <li key={file.id}>
                <a href={`/api/states/${state.id}/files/${file.id}`}>
                  {file.role}：{file.source.relativePath}
                </a>
                （{file.size} bytes）
              </li>
            ))}
          </ul>
          {state.files
            .filter(
              (file) =>
                (file.role === "preview" || file.role === "render") &&
                /\.(png|jpe?g|webp)$/i.test(file.source.relativePath),
            )
            .map((file) => (
              <img
                className="state-preview"
                loading="lazy"
                key={file.id}
                src={`/api/states/${state.id}/files/${file.id}?inline=1`}
                alt={`保存状態 ${index + 1} の${file.role === "preview" ? "プレビュー" : "レンダー"}`}
              />
            ))}
          {state.missing.length > 0 && (
            <>
              <p className="hint">
                不足・未確認があります。必要な制作操作は利用できません。
              </p>
              <ul>
                {state.missing.map((item, i) => (
                  <li key={i}>
                    {item.source.relativePath}：{reasons[item.reason]}
                  </li>
                ))}
              </ul>
            </>
          )}
        </article>
      ))}
      {operations
        .filter((op) => op.phase !== "committed" && op.phase !== "abandoned")
        .map((op) => (
          <p role="status" key={op.id}>
            {op.phase === "reconciling" ? "照合待ち" : "未完成"}：
            {op.input.body}。同じ内容で再送してください。
            <button
              disabled={busy || disabled}
              onClick={async () => {
                setBusy(true);
                onBusy(true);
                setError("");
                try {
                  await write(
                    `/api/conversations/${op.conversationId}/imports`,
                    op.input as unknown as Record<string, unknown>,
                    false,
                  );
                  setOperations((items) =>
                    items.filter((item) => item.id !== op.id),
                  );
                  onSaved();
                } catch (failure) {
                  setError((failure as Error).message);
                } finally {
                  setBusy(false);
                  onBusy(false);
                }
              }}
            >
              同じ内容で再送
            </button>
            {op.phase === "incomplete" && (
              <button
                disabled={busy || disabled}
                onClick={async () => {
                  setBusy(true);
                  onBusy(true);
                  setError("");
                  try {
                    await write(`/api/imports/${op.id}/abandon`, {});
                    setOperations((previous) =>
                      previous.filter((item) => item.id !== op.id),
                    );
                  } catch (failure) {
                    setError((failure as Error).message);
                  } finally {
                    setBusy(false);
                    onBusy(false);
                  }
                }}
              >
                未完成の登録を中止
              </button>
            )}
          </p>
        ))}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

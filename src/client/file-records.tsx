import { useEffect, useState, type FormEvent } from "react";
import type {
  SavedState,
  SourceFile,
  ImportInput,
  ImportOperation,
} from "../shared/files";
import type { BodyRecord } from "../shared/contracts";
import { read, write, SaveError } from "./api";

const reasons: Record<string, string> = {
  not_found: "依存ファイルが見つかりません",
  cycle: "依存参照が循環しています",
  outside_root: "依存先が許可されたフォルダー外です",
  inspection_pending: "内容と依存関係の検査は未実施です",
};
export function FileRecords({
  workId,
  conversationId,
  onRecord,
  disabled,
  onBusy,
}: {
  workId: string;
  conversationId: string;
  onRecord: (record: BodyRecord) => void;
  disabled: boolean;
  onBusy: (busy: boolean) => void;
}) {
  const [roots, setRoots] = useState<{
    sources: { id: string }[];
    configured: boolean;
  }>();
  const [states, setStates] = useState<SavedState[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [operations, setOperations] = useState<ImportOperation[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [sourceRoot, setSourceRoot] = useState("");
  const [paths, setPaths] = useState<Record<string, string>>({});
  const [application, setApplication] =
    useState<ImportInput["application"]>("Blender");
  const [body, setBody] = useState("");
  const [reason, setReason] = useState("");
  const [render, setRender] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // Keep exactly the same input and request key until its save is confirmed.
  const [pending, setPending] = useState<ImportInput | null>(null);
  useEffect(() => {
    let active = true;
    Promise.all([
      read<{ sources: { id: string }[]; configured: boolean }>(
        "/api/file-roots",
      ),
      read<{ states: SavedState[]; currentStateId: string | null }>(
        `/api/works/${workId}/states`,
      ),
      read<ImportOperation[]>(`/api/works/${workId}/imports`),
    ])
      .then(([rootInfo, result, ops]) => {
        if (!active) return;
        setRoots(rootInfo);
        setSourceRoot(rootInfo.sources[0]?.id ?? "");
        setStates(result.states);
        setCurrent(result.currentStateId);
        setOperations(ops);
        setLoaded(true);
        const previous = ops.find(
          (op) =>
            op.conversationId === conversationId &&
            op.phase !== "committed" &&
            op.phase !== "abandoned",
        );
        if (previous) {
          setPending(previous.input);
          setBody(previous.input.body);
          setReason(previous.input.reason ?? "");
          setApplication(previous.input.application);
          setSourceRoot(previous.input.files[0]?.rootId ?? "");
          setPaths(
            Object.fromEntries(
              previous.input.files.map((file) => [
                file.role,
                file.relativePath,
              ]),
            ),
          );
          if (previous.input.render)
            setRender(JSON.stringify(previous.input.render));
        }
      })
      .catch((failure) => active && setError(failure.message));
    return () => {
      active = false;
    };
  }, [workId, conversationId]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    onBusy(true);
    setError("");
    const files = Object.entries(paths)
      .filter(([, path]) => path.trim())
      .map(([role, path]) => ({
        rootId: sourceRoot,
        relativePath: path,
        role: role as SourceFile["role"],
      }));
    const input: ImportInput = pending ?? {
      requestKey: crypto.randomUUID(),
      body,
      application,
      beforeStateId: current,
      files,
      ...(reason ? { reason } : {}),
      ...(render ? { render: JSON.parse(render) } : {}),
    };
    setPending(input);
    try {
      const result = await write<{ state: SavedState; record: BodyRecord }>(
        `/api/conversations/${conversationId}/imports`,
        input as unknown as Record<string, unknown>,
        false,
      );
      onRecord(result.record);
      setStates((previous) =>
        previous.some((item) => item.id === result.state.id)
          ? previous
          : [...previous, result.state],
      );
      setCurrent(result.state.id);
      setOperations((previous) =>
        previous.filter((item) => item.stateId !== result.state.id),
      );
      setPending(null);
      setPaths({});
      setBody("");
      setReason("");
      setRender("");
    } catch (failure) {
      setError((failure as Error).message);
      try {
        const ops = await read<ImportOperation[]>(
          `/api/works/${workId}/imports`,
        );
        setOperations(ops);
        if (
          failure instanceof SaveError &&
          [400, 403, 404, 409].includes(failure.status ?? 0) &&
          !ops.some((op) => op.requestKey === input.requestKey)
        ) {
          setPending(null);
          const latest = await read<{
            states: SavedState[];
            currentStateId: string | null;
          }>(`/api/works/${workId}/states`);
          setStates(latest.states);
          setCurrent(latest.currentStateId);
        }
      } catch {}
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }
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
          <p>
            {state.application} / 理由：{state.reason ?? "未入力"}
          </p>
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
            {op.phase === "incomplete" && (
              <button
                disabled={busy || disabled}
                onClick={async () => {
                  setBusy(true);
                  onBusy(true);
                  setError("");
                  try {
                    await write(`/api/imports/${op.id}/abandon`, {});
                    setPending(null);
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
      {loaded && !roots?.configured && (
        <p className="hint">
          制作ファイルの保存先が未設定です。起動設定のファイル領域を設定してください。
        </p>
      )}
      {roots?.configured && (
        <details>
          <summary>制作ファイルを添付して記録</summary>
          <form onSubmit={submit}>
            <p className="hint">
              Blender・Photoshopで保存を済ませ、取り込み中は編集を止めてください。未保存の画面内容は取得しません。
            </p>
            {pending && (
              <p role="status">
                保存結果の確認待ちです。入力を保持して、同じ内容で再送します。
              </p>
            )}
            <fieldset disabled={busy || disabled || Boolean(pending)}>
              <label>
                作業アプリ
                <select
                  value={application}
                  onChange={(e) =>
                    setApplication(e.target.value as ImportInput["application"])
                  }
                >
                  <option>Blender</option>
                  <option>Photoshop</option>
                  <option>Other</option>
                </select>
              </label>
              <label>
                取り込み元フォルダー
                <select
                  value={sourceRoot}
                  onChange={(e) => setSourceRoot(e.target.value)}
                >
                  {roots.sources.map((root) => (
                    <option key={root.id}>{root.id}</option>
                  ))}
                </select>
              </label>
              {(
                [
                  ["blend", "Blenderファイル"],
                  ["psd", "PSD / PSBファイル"],
                  ["preview", "プレビュー画像"],
                  ["render", "元レンダー画像"],
                ] as const
              ).map(([role, label]) => (
                <label key={role}>
                  {label}（フォルダー内の相対パス）
                  <input
                    value={paths[role] ?? ""}
                    onChange={(e) =>
                      setPaths((previous) => ({
                        ...previous,
                        [role]: e.target.value,
                      }))
                    }
                    placeholder={role === "blend" ? "scene.blend" : undefined}
                  />
                </label>
              ))}
              <label>
                ファイル記録の本文
                <textarea
                  required
                  value={body}
                  maxLength={200000}
                  onChange={(e) => setBody(e.target.value)}
                />
              </label>
              <label>
                手修正の理由（任意）
                <textarea
                  value={reason}
                  maxLength={20000}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              <label>
                参照した元レンダー
                <select
                  value={render}
                  onChange={(e) => setRender(e.target.value)}
                >
                  <option value="">不明・未指定</option>
                  {states.flatMap((state) =>
                    state.files
                      .filter((file) => file.role === "render")
                      .map((file) => (
                        <option
                          key={state.id + file.id}
                          value={JSON.stringify({
                            stateId: state.id,
                            fileId: file.id,
                          })}
                        >
                          {file.source.relativePath}（保存状態{" "}
                          {states.findIndex((item) => item.id === state.id) + 1}
                          ）
                        </option>
                      )),
                  )}
                </select>
              </label>
            </fieldset>
            <button
              className="primary"
              disabled={
                busy ||
                disabled ||
                !loaded ||
                !body.trim() ||
                !Object.values(paths).some((path) => path.trim())
              }
            >
              {busy
                ? "保存中…"
                : pending
                  ? "同じ内容で再送"
                  : "ファイルと本文を記録"}
            </button>
          </form>
        </details>
      )}
    </section>
  );
}

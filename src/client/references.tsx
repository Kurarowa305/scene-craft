import { useEffect, useState } from "react";
import { read } from "./api";
import type { ReferenceView } from "../shared/references";
import { Icon } from "./ui";
import type { ReferenceCandidate } from "../shared/references";
export function openReference(candidate: ReferenceCandidate) {
  document.dispatchEvent(
    new CustomEvent("open-reference", {
      detail: {
        id: candidate.id,
        title: candidate.title,
        workId: candidate.workId,
      },
    }),
  );
}
export function useReferences(workId: string | undefined, revision: number) {
  const [view, setView] = useState<ReferenceView>();
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    if (!workId) {
      setView(undefined);
      return;
    }
    read<ReferenceView>(`/api/works/${workId}/references`)
      .then((value) => {
        if (active) {
          setView(value);
          setError("");
        }
      })
      .catch(() => {
        if (active) setError("参考資料を取得できません。");
      });
    return () => {
      active = false;
    };
  }, [workId, revision]);
  return { view, error };
}
export function ReferenceLinks({
  candidates,
}: {
  candidates: ReferenceCandidate[];
}) {
  if (!candidates.length) return null;
  return (
    <section className="reference-links" aria-label="参考資料のリンク">
      {candidates.map((c) => (
        <button
          className="artifact-link"
          aria-label={c.title}
          key={c.id}
          onClick={() => openReference(c)}
        >
          <Icon name="image" />
          <span>
            <strong>{c.title}</strong>
          </span>
          <span className="arrow">↗</span>
        </button>
      ))}
    </section>
  );
}
export function References({
  workId,
  revision,
  referenceId,
}: {
  workId: string;
  revision: number;
  referenceId?: string;
}) {
  const { view, error } = useReferences(workId || undefined, revision);
  const [missing, setMissing] = useState<Record<string, boolean>>({});
  if (!referenceId)
    return (
      <section className="panel-page" aria-label="参考資料の一覧">
        <h2>参考資料</h2>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {!workId ? (
          <p className="muted">作品を選択してください。</p>
        ) : !view ? (
          <p className="muted">参考資料を読み込み中…</p>
        ) : !view.candidates.length ? (
          <p className="muted">
            まだ参考資料はありません。メインチャットのエージェントで参考調査を選んで依頼してください。
          </p>
        ) : (
          <ReferenceLinks candidates={view.candidates} />
        )}
        <ReferenceSearches view={view} />
      </section>
    );
  return (
    <section
      className="panel-page reference-detail"
      aria-label="参考資料の詳細"
    >
      <h2>
        {view?.candidates.find((c) => c.id === referenceId)?.title ??
          "参考資料"}
      </h2>
      {error && <p role="alert">{error}</p>}
      {
        <p>
          会話でタイトルまたはIDを指定して参考として選べます。参考画像の保存許可と、制作素材としての利用許可は別です。
        </p>
      }
      {view?.candidates.length === 0 && <p>まだ参考資料はありません。</p>}
      {view?.candidates
        .filter((c) => c.id === referenceId)
        .map((c) => {
          const p = view.pages.find((p) => p.id === c.pageId);
          const selections = view.selections.filter(
            (s) => s.referenceId === c.id,
          );
          return (
            <article
              className="reference-record"
              id={`reference-${c.id}`}
              key={c.id}
            >
              <p>
                {selections.length
                  ? "参考として選択済み"
                  : "未選択（不採用ではありません）"}
              </p>
              {
                <>
                  <p>参考ID: {c.id}</p>
                  <p>作者: {c.author ?? "不明"}</p>
                  {p && (
                    <p>
                      出典:{" "}
                      <a href={p.url} target="_blank" rel="noreferrer">
                        {p.url}
                      </a>{" "}
                      / 確認日: {p.checkedAt}
                      {p.finalUrl !== p.url && ` / 取得先: ${p.finalUrl}`}
                    </p>
                  )}
                  <p>参考要素: {c.element}</p>
                  <p>制作意図との関係: {c.intentRelation}</p>
                  <p>
                    ページ:{" "}
                    {p?.status === "available"
                      ? "取得済み"
                      : p?.status === "broken"
                        ? "リンク切れ"
                        : p?.status === "stopped"
                          ? "取得停止"
                          : "取得失敗"}{" "}
                    {p?.error}
                  </p>
                  <p>
                    画像:{" "}
                    {missing[c.id]
                      ? "保存画像が欠落・破損しています"
                      : {
                          stored: "管理下に保存済み",
                          url_only: "URLのみ・画像未保持",
                          not_retained: "画像未保持（保存条件未確認）",
                          broken: "リンク切れ・画像未保持",
                          failed: "取得失敗・画像未保持",
                          stopped: "取得停止・画像未保持",
                        }[c.image.status]}
                  </p>
                  {c.image.status === "stored" && !missing[c.id] && (
                    <>
                      <img
                        className="reference-image"
                        src={`/api/references/${c.id}/image`}
                        alt={c.title}
                        onError={() =>
                          setMissing((v) => ({ ...v, [c.id]: true }))
                        }
                      />
                      <a
                        href={`/api/references/${c.id}/image`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        保存した参考画像
                      </a>
                    </>
                  )}
                  {c.image.url && (
                    <p>
                      画像の出典:{" "}
                      <a href={c.image.url} target="_blank" rel="noreferrer">
                        {c.image.url}
                      </a>
                    </p>
                  )}
                  <p>
                    保存条件: {c.image.permissionQuote ?? "不明"} /
                    制作素材としての利用条件: 未確認
                  </p>
                  {c.image.permissionPageId && (
                    <p>
                      条件の根拠:{" "}
                      {
                        view.pages.find(
                          (p) => p.id === c.image.permissionPageId,
                        )?.url
                      }
                    </p>
                  )}
                  {p?.text && (
                    <details>
                      <summary>取得した本文</summary>
                      <p className="record-body">{p.text}</p>
                    </details>
                  )}
                  {selections.map((s) => (
                    <div key={s.id}>
                      <strong>人間の選択原文・任意理由</strong>
                      <p className="record-body">{s.body}</p>
                      <p>
                        {s.author} / {s.createdAt}
                      </p>
                    </div>
                  ))}
                </>
              }
            </article>
          );
        })}
      <ReferenceSearches view={view} />
    </section>
  );
}

function ReferenceSearches({ view }: { view: ReferenceView | undefined }) {
  return (
    <details>
      <summary>検索・ページ取得の記録</summary>
      {view?.searches.map((s) => (
        <p key={`${s.requestId}-${s.itemId}-${s.checkedAt}`}>
          {s.query ?? JSON.stringify(s.action)} /{" "}
          {s.status === "failed"
            ? "検索失敗"
            : s.status === "in_progress"
              ? "検索中"
              : s.status === "interrupted"
                ? "検索中断"
                : s.status === "unknown"
                  ? "検索結果未確定"
                  : s.status === "completed"
                    ? "検索完了"
                    : s.status}{" "}
          /{" "}
          {s.resultAvailability === "empty"
            ? "結果なし"
            : s.resultAvailability === "not_provided"
              ? "結果一覧未提供（結果なしとは未確認）"
              : "結果あり"}{" "}
          / {s.checkedAt}
        </p>
      ))}
      {view?.pages.map((p) => (
        <p key={p.id}>
          <a href={p.url} target="_blank" rel="noreferrer">
            {p.url}
          </a>{" "}
          / {p.status} {p.error}
        </p>
      ))}
    </details>
  );
}

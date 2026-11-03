import { useEffect, useState } from "react";
import { read } from "./api";
import type { ReferenceView } from "../shared/references";
export function References({
  workId,
  revision,
  compact = false,
}: {
  workId: string;
  revision: number;
  compact?: boolean;
}) {
  const [view, setView] = useState<ReferenceView>();
  const [error, setError] = useState("");
  const [missing, setMissing] = useState<Record<string, boolean>>({});
  useEffect(() => {
    let active = true;
    read<ReferenceView>(`/api/works/${workId}/references`)
      .then((v) => {
        if (active) {
          setView(v);
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
  return (
    <section aria-label={compact ? "参考資料のリンク" : "参考資料の詳細"}>
      <h3>参考資料</h3>
      {error && <p role="alert">{error}</p>}
      {!compact && (
        <p>
          会話でタイトルまたはIDを指定して参考として選べます。参考画像の保存許可と、制作素材としての利用許可は別です。
        </p>
      )}
      {view?.candidates.length === 0 && <p>まだ参考資料はありません。</p>}
      {view?.candidates.map((c) => {
        const p = view.pages.find((p) => p.id === c.pageId);
        const selections = view.selections.filter(
          (s) => s.referenceId === c.id,
        );
        return (
          <article className="record" id={`reference-${c.id}`} key={c.id}>
            <a
              href={`/api/references/${c.id}`}
              target="_blank"
              rel="noreferrer"
            >
              {c.title}
            </a>
            <p>
              {selections.length
                ? "参考として選択済み"
                : "未選択（不採用ではありません）"}
            </p>
            {!compact && (
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
                      view.pages.find((p) => p.id === c.image.permissionPageId)
                        ?.url
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
            )}
          </article>
        );
      })}
      {!compact && (
        <details>
          <summary>検索・ページ取得の記録</summary>
          {view?.searches.map((s) => (
            <p key={`${s.requestId}-${s.itemId}-${s.checkedAt}`}>
              {s.query ?? JSON.stringify(s.action)} /{" "}
              {s.status === "failed"
                ? "検索失敗"
                : s.status === "in_progress"
                  ? "検索中"
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
      )}
    </section>
  );
}
